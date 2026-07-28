/**
 * api.ts — Typed fetch wrapper for the BFF Gateway (port 4000).
 * All three portals use this single client.
 */

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL || "http://localhost:4000";

// ─── Token helpers ──────────────────────────────────────
let _token: string | null = null;
let _refreshToken: string | null = null;
let _refreshing: Promise<string | null> | null = null;

export function setToken(t: string | null) {
  _token = t;
  if (t) localStorage.setItem("bff_token", t);
  else localStorage.removeItem("bff_token");
}

export function setRefreshToken(t: string | null) {
  _refreshToken = t;
  if (t) localStorage.setItem("bff_refresh_token", t);
  else localStorage.removeItem("bff_refresh_token");
}

export function getToken(): string | null {
  if (_token) return _token;
  if (typeof window !== "undefined") {
    _token = localStorage.getItem("bff_token");
  }
  return _token;
}

export function getRefreshToken(): string | null {
  if (_refreshToken) return _refreshToken;
  if (typeof window !== "undefined") {
    _refreshToken = localStorage.getItem("bff_refresh_token");
  }
  return _refreshToken;
}

async function tryRefresh(): Promise<string | null> {
  // Deduplicate: if a refresh is already in-flight, wait for it instead of
  // sending a second request with the same refresh token.
  if (_refreshing) return _refreshing;
  const rt = getRefreshToken();
  if (!rt) return null;
  _refreshing = (async () => {
    try {
      const res = await fetch(`${BFF_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) {
        setToken(null);
        setRefreshToken(null);
        return null;
      }
      const data = (await res.json()) as { token: string; expires_in: number };
      setToken(data.token);
      return data.token;
    } catch {
      return null;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

// ─── Generic fetch helper ───────────────────────────────
export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  return _fetch<T>(path, opts);
}

async function _fetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
  _retried = false,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BFF_URL}${path}`, { ...opts, headers });

  // On 401, attempt a single token refresh then retry the original request.
  if (res.status === 401 && !_retried) {
    const newToken = await tryRefresh();
    if (newToken) return _fetch<T>(path, opts, true);
    // Refresh failed — clear auth state so layout.tsx redirects to login.
    setToken(null);
    setRefreshToken(null);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = res.statusText;
    if (body) {
      try {
        const json = JSON.parse(body);
        message = json.detail ?? json.message ?? json.error ?? body;
      } catch {
        message = body;
      }
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ─── Auth ───────────────────────────────────────────────
export interface LoginResponse {
  token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    username: string;
    role: "admin" | "branch_manager" | "customer";
    branch_id: string;
    full_name: string;
    branch_type: string;
    customer_id?: string;
  };
}

export async function login(
  username: string,
  password: string,
  branch_id?: string,
): Promise<LoginResponse> {
  const data = await _fetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, branch_id: branch_id || "" }),
  });
  setToken(data.token);
  if (data.refresh_token) setRefreshToken(data.refresh_token);
  return data;
}

export async function getMe() {
  return _fetch<LoginResponse["user"]>("/api/auth/me");
}

export function logout() {
  setToken(null);
  setRefreshToken(null);
}

// ─── Customer endpoints ─────────────────────────────────
export interface ScoreResult {
  customer_id: string;
  prediction: string;
  probability_creditworthy: number;
  risk_bucket: string;
  features_used: number;
}

export interface XaiResult {
  customer_id: string;
  prediction: string;
  probability_creditworthy: number;
  top_factors: { feature: string; shap_value: number; feature_value: number }[];
}

export interface ChatResponse {
  reply: string;
  xai_context: XaiResult | null;
}

export interface RoboAdvice {
  branch_type: string;
  risk_profile: string;
  portfolio: Record<string, number>;
  projected_5yr: { mean: number; p10: number; p90: number };
  recommendations: string[];
}

export async function customerScore(customerId: string) {
  return _fetch<ScoreResult>(`/api/customer/score?customer_id=${customerId}`);
}

export async function customerExplain(customerId: string) {
  return _fetch<XaiResult>("/api/customer/explain", {
    method: "POST",
    body: JSON.stringify({ customer_id: customerId }),
  });
}

export async function customerChat(customerId: string, message: string) {
  return _fetch<ChatResponse>("/api/customer/chat", {
    method: "POST",
    body: JSON.stringify({ customer_id: customerId, message }),
  });
}

export async function customerRoboAdvice(
  profile: string,
  amount: number,
  branchId?: string,
) {
  return _fetch<RoboAdvice>("/api/customer/robo-advice", {
    method: "POST",
    body: JSON.stringify({ profile, amount, branch_id: branchId || "" }),
  });
}

// ─── Branch Manager endpoints ───────────────────────────
export interface BranchMetrics {
  branch_id: string;
  branch_type: string;
  total_customers: number;
  model_accuracy: number;
  approval_rate: number;
  avg_probability: number;
  demographic_breakdown: Record<string, unknown>;
}

export interface BranchCustomerList {
  branch_id: string;
  page: number;
  per_page: number;
  total: number;
  customers: {
    customer_id: string;
    prediction: string;
    probability: number;
  }[];
}

export interface FraudAlert {
  customer_id: string;
  metric: string;
  value: number;
  z_score: number;
  severity: string;
}

export interface DataDrift {
  branch_type: string;
  features: { feature: string; mean: number; std: number; drift_score: number }[];
}

export async function branchMetrics() {
  return _fetch<BranchMetrics>("/api/branch/metrics");
}

export async function branchCustomers(page = 1, perPage = 25) {
  return _fetch<BranchCustomerList>(
    `/api/branch/customers?page=${page}&per_page=${perPage}`,
  );
}

export async function branchExplain(customerId: string) {
  return _fetch<XaiResult>("/api/branch/explain", {
    method: "POST",
    body: JSON.stringify({ customer_id: customerId }),
  });
}

export async function branchFraudAlerts() {
  return _fetch<{ alerts: FraudAlert[] }>("/api/branch/fraud_alerts");
}

export interface TransactionIngestRequest {
  customer_id: string;
  amount: number;
  merchant?: string;
  timestamp?: string;
  channel?: string;
  is_international?: boolean;
  location?: string;
  payment_method?: string;
  device?: string;
}

export async function branchIngestTransaction(req: TransactionIngestRequest) {
  return _fetch<{ status: string; alert?: FraudAlert }>("/api/branch/transaction", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface LoanDecisionRecord {
  id: number;
  branch: string;
  customer_id?: string;
  requested_at: string;
  default_probability?: number;
  risk_grade?: string;
  suggested_interest_rate?: number;
  recommended_max_loan_npr?: number;
  nrb_compliant?: boolean;
}

export interface HQFingerprintDecisionRecord {
  fingerprint_id: string;
  branch_id: string;
  created_at: string;
  hq_grade?: string;
  branch_adjusted_grade?: string;
  default_probability?: number;
  branch_recommended_rate?: number;
  max_approved_loan_npr?: number;
  hq_model_version?: number;
  nrb_compliant?: boolean;
  requires_guarantor?: boolean;
}

export interface FraudAlertRecord {
  id: number;
  branch: string;
  customer_id?: string;
  detected_at: string;
  severity?: string;
  metric?: string;
  value?: number;
  z_score?: number;
  reason?: string;
  source?: string;
}

export async function branchLoanDecisions(params: {
  grade?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.grade) q.set("grade", params.grade);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: LoanDecisionRecord[]; total: number }>(
    `/api/branch/loan_decisions${qs ? `?${qs}` : ""}`,
  );
}

export async function branchHQFingerprints(params: {
  grade?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.grade) q.set("grade", params.grade);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: HQFingerprintDecisionRecord[]; total: number }>(
    `/api/branch/hq_fingerprints${qs ? `?${qs}` : ""}`,
  );
}

export async function branchFraudAlertHistory(params: {
  severity?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.severity) q.set("severity", params.severity);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: FraudAlertRecord[]; total: number }>(
    `/api/branch/fraud_alerts/history${qs ? `?${qs}` : ""}`,
  );
}

export async function branchDataDrift() {
  return _fetch<DataDrift>("/api/branch/data_drift");
}

// ─── HQ endpoints ───────────────────────────────────────
export interface HqStatus {
  server: string;
  version: string;
  current_round: number;
  min_branches: number;
  registered_branches: string[];
  all_branches: string[];
  submissions_this_round: string[];
  global_model_ready: boolean;
}

export interface BranchInfo {
  name: string;
  slug: string;
  type: string;
  edge_url: string;
  registered: boolean;
  submitted_this_round: boolean;
}

export interface AuditEntry {
  seq?: number;
  timestamp: string;
  event: string;
  branch: string;
  detail: string;
  hash: string;
  prev_hash?: string;
  payload_hash?: string;
  details_summary?: Record<string, unknown>;
}

export interface RoundHistory {
  rounds: {
    round: number;
    participants?: string[];
    branches?: string[];
    timestamp?: string;
    aggregated_at?: string;
    method?: string;
    branch_metrics?: Record<string, { accuracy?: number; f1?: number; train_size?: number }>;
  }[];
}

export async function hqLoanDecisions(params: {
  branch?: string;
  grade?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.branch) q.set("branch", params.branch);
  if (params.grade) q.set("grade", params.grade);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: LoanDecisionRecord[]; total: number }>(
    `/api/hq/loan_decisions${qs ? `?${qs}` : ""}`,
  );
}

export async function hqFingerprintDecisions(params: {
  branch?: string;
  grade?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.branch) q.set("branch", params.branch);
  if (params.grade) q.set("grade", params.grade);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: HQFingerprintDecisionRecord[]; total: number }>(
    `/api/hq/fingerprint_decisions${qs ? `?${qs}` : ""}`,
  );
}

export async function hqFraudAlerts(params: {
  branch?: string;
  severity?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.branch) q.set("branch", params.branch);
  if (params.severity) q.set("severity", params.severity);
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return _fetch<{ records: FraudAlertRecord[]; total: number }>(
    `/api/hq/fraud_alerts${qs ? `?${qs}` : ""}`,
  );
}

export async function hqStatus() {
  return _fetch<HqStatus>("/api/hq/status");
}

export async function hqHealth() {
  return _fetch<{ status: string }>("/api/hq/health");
}

export async function hqBranches() {
  return _fetch<{ branches: BranchInfo[]; current_round: number; global_model_ready: boolean }>(
    "/api/hq/branches",
  );
}

export async function hqRoundHistory() {
  return _fetch<RoundHistory>("/api/hq/round_history");
}

export async function hqAnomalyLog() {
  return _fetch<{ anomalies: unknown[] }>("/api/hq/anomaly_log");
}

export async function hqAuditLog(lastN = 50) {
  return _fetch<{ audit_log: AuditEntry[] }>(`/api/hq/audit_log?last_n=${lastN}`);
}

export async function hqAuditVerify() {
  return _fetch<{ valid: boolean; entries: number }>("/api/hq/audit_verify");
}

export async function hqModelRegistry() {
  return _fetch<{ models: unknown[] }>("/api/hq/model_registry");
}

export async function hqTriggerAggregation() {
  return _fetch<unknown>("/api/hq/trigger_aggregation", { method: "POST" });
}

export interface ByzantineDemoResult {
  detected: boolean;
  branch: string;
  attack_type: string;
  reason: string;
  cosine_similarity: number;
  sigma_threshold: number;
}

export async function byzantineDemo(
  branch: string,
  attackType: string,
): Promise<ByzantineDemoResult> {
  return _fetch<ByzantineDemoResult>("/api/hq/byzantine_demo", {
    method: "POST",
    body: JSON.stringify({ branch, attack_type: attackType }),
  });
}

// ─── μGraphCoder HQ endpoints ───────────────────────────
export async function muGraphCoderStatus() {
  return _fetch<{
    available: boolean;
    fingerprints_received: number;
    gnns_generated: number;
    is_training: boolean;
    last_trained_ts: number | null;
    current_version: number;
    branches_with_fingerprints: string[];
    branches_with_gnns: string[];
    comm_savings: Record<string, { ratio: number; mu_bytes: number; full_bytes: number }>;
  }>("/api/hq/mu_graphcoder/status");
}

export async function muGraphCoderReport() {
  return _fetch<{
    summary: { all_rqs_passed: boolean; rq1_passed: boolean; rq2_passed: boolean; rq3_passed: boolean; rq4_passed: boolean; generated_at: string };
    rq1_fingerprint_quality: Record<string, unknown>;
    rq2_accuracy_and_comm: Record<string, unknown>;
    rq3_drift_recovery: Record<string, unknown>;
    rq4_deployment: Record<string, unknown>;
  }>("/api/hq/mu_graphcoder/report");
}

export async function muGraphCoderTriggerTraining() {
  return _fetch<unknown>("/api/hq/mu_graphcoder/trigger_training", { method: "POST" });
}

// ─── Branch AI models ──────────────────────────────────

export interface FraudAlert {
  customer_id: string;
  ensemble_score: number;
  risk_level: "high" | "medium" | "low";
  top_flag_reason: string;
  if_score: number;
  xgb_fraud_prob: number;
}

export interface FraudMLResult {
  branch: string;
  total_customers: number;
  high_risk_count: number;
  medium_risk_count: number;
  alerts: FraudAlert[];
}

export async function branchFraudML(topN = 20): Promise<FraudMLResult> {
  return _fetch<FraudMLResult>(`/api/branch/fraud_ml?top_n=${topN}`);
}

export async function branchFraudMLExplain(customerId: string) {
  return _fetch<unknown>("/api/branch/fraud_ml/explain", {
    method: "POST",
    body: JSON.stringify({ customer_id: customerId }),
  });
}

export interface AMLScanResult {
  branch: string;
  scan_timestamp: string;
  total_customers_scanned: number;
  total_flagged: number;
  high_severity_count: number;
  medium_severity_count: number;
  nrb_threshold_npr: number;
  structuring_flags: unknown[];
  round_amount_flags: unknown[];
  anomaly_flags: unknown[];
  combined_alerts: unknown[];
}

export async function branchAMLScan(): Promise<AMLScanResult> {
  return _fetch<AMLScanResult>("/api/branch/aml_scan");
}

export async function branchAMLSar(customerId: string) {
  return _fetch<unknown>(`/api/branch/aml_sar/${customerId}`);
}

export interface LoanApplicationRequest {
  loan_amount: number;
  loan_tenure_months: number;
  monthly_income: number;
  dti: number;
  cibil_score: number;
  credit_utilization?: number;
  num_existing_loans?: number;
  employment_type?: string;
  collateral_value?: number;
  has_guarantor?: boolean;
  digital_engagement?: number;
  spending_consistency?: number;
}

export interface LoanRisk {
  default_probability: number;
  risk_grade: "A" | "B" | "C" | "D" | "F";
  risk_label: string;
  suggested_interest_rate: number;
  rate_range: [number, number];
  recommended_max_loan_npr: number;
  eligible_loan_types: string[];
  shap_factors: { feature: string; shap_value: number }[];
  nrb_compliant: boolean;
}

export async function branchLoanDefault(req: LoanApplicationRequest): Promise<LoanRisk> {
  return _fetch<LoanRisk>("/api/branch/loan_default", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function branchLoanPortfolio() {
  return _fetch<unknown>("/api/branch/loan_portfolio");
}

export interface ChurnSummary {
  branch: string;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  total_customers: number;
  avg_churn_probability: number;
  top_at_risk_customers: { customer_id: string; churn_probability: number }[];
}

export async function branchChurnSummary(): Promise<ChurnSummary> {
  return _fetch<ChurnSummary>("/api/branch/churn_summary");
}

export async function branchChurnCustomer(customerId: string) {
  return _fetch<unknown>(`/api/branch/churn/${customerId}`);
}

export interface UnifiedRisk {
  customer_id?: string;
  composite_risk_score: number;
  composite_risk_grade: "A" | "B" | "C" | "D" | "F";
  risk_dimensions: Record<string, number>;
  radar_data: { axis: string; value: number }[];
  primary_concern: string;
  primary_concern_severity: "high" | "medium" | "low";
  action_required: boolean;
  recommendations: string[];
  dimension_weights: Record<string, number>;
  sub_model_scores?: Record<string, number>;
}

export async function branchUnifiedRisk(customerId: string): Promise<UnifiedRisk> {
  return _fetch<UnifiedRisk>(`/api/branch/unified_risk/${customerId}`);
}

export interface BranchRiskDistribution {
  branch?: string;
  total_customers: number;
  grade_distribution: Record<string, number>;
  avg_composite_risk: number;
  high_risk_count: number;
  top_risk_customers: { customer_id: string; composite_risk_score: number }[];
  histogram_buckets: Record<string, number>;
}

export async function branchRiskDistribution(): Promise<BranchRiskDistribution> {
  return _fetch<BranchRiskDistribution>("/api/branch/risk_distribution");
}

export interface CollateralEstimateRequest {
  asset_type: "land" | "building" | "vehicle";
  location: string;
  area_sqft?: number;
  market_index?: number;
  condition?: "excellent" | "good" | "fair" | "poor";
  building_age?: number;
  vehicle_type?: "car" | "suv" | "bike" | "truck";
  vehicle_age?: number;
}

export interface CollateralEstimateResult {
  asset_type: string;
  location: string;
  adjusted_value: number;
  range_low: number;
  range_high: number;
  max_ltv: number;
  confidence: number;
  confidence_label: string;
  location_rate: number;
  breakdown: { label: string; value: string }[];
  notes: string[];
}

export async function branchCollateralEstimate(req: CollateralEstimateRequest): Promise<CollateralEstimateResult> {
  return _fetch<CollateralEstimateResult>("/api/branch/collateral_estimate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface RateOptimizerRequest {
  loan_type: string;
  risk_grade: string;
  market_rate: number;
  policy_floor: number;
  policy_ceil: number;
  dti: number;
  collateral_coverage: number;
  tenure_months: number;
  digital_score: number;
  priority: "growth" | "balanced" | "margin";
}

export interface RateOptimizerResult {
  base_rate: number;
  model_rate: number;
  recommended_rate: number;
  band_low: number;
  band_high: number;
  delta_vs_market: number;
  notes: string[];
}

export async function branchRateOptimize(req: RateOptimizerRequest): Promise<RateOptimizerResult> {
  return _fetch<RateOptimizerResult>("/api/branch/rate_optimizer", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface RemittanceAnalyzeRequest {
  customer_id: string;
  frequency: number;
  avg_amount: number;
  channel: string;
  corridor: string;
  sender_count: number;
  cashout_days: number;
}

export interface RemittanceAnalyzeResult {
  risk_score: number;
  severity: "Low" | "Medium" | "High";
  action: string;
  flags: string[];
  series: { month: string; total: number }[];
  avg_monthly: number;
  peak_monthly: number;
  base_monthly: number;
}

export async function branchRemittanceAnalyze(req: RemittanceAnalyzeRequest): Promise<RemittanceAnalyzeResult> {
  return _fetch<RemittanceAnalyzeResult>("/api/branch/remittance_analyze", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Customer AI ────────────────────────────────────────

export interface CashflowForecast {
  customer_id?: string;
  branch?: string;
  next_3_months: number[];
  forecast_months: string[];
  confidence_low: number[];
  confidence_high: number[];
  trend: "increasing" | "decreasing" | "stable";
  seasonal_note: string;
  historical_avg_monthly: number;
  historical_series?: number[];
  historical_months?: string[];
  method: string;
}

export interface BranchCashflowAggregate {
  branch: string;
  n_customers: number;
  forecast_months: string[];
  aggregate_forecast: number[];
  confidence_low: number[];
  confidence_high: number[];
  avg_monthly_historic: number;
  currency: string;
}

export async function customerCashflow(): Promise<CashflowForecast> {
  return _fetch<CashflowForecast>("/api/customer/cashflow");
}

export async function branchCashflowAggregate(): Promise<BranchCashflowAggregate> {
  return _fetch<BranchCashflowAggregate>("/api/customer/cashflow_branch");
}

export async function customerRiskProfile(): Promise<UnifiedRisk> {
  return _fetch<UnifiedRisk>("/api/customer/risk_profile");
}

// ─── HQ Security ────────────────────────────────────────

export interface CertInfo {
  name: string;
  days_until_expiry: number;
  expires_at: string | null;
  needs_rotation: boolean;
  status: "ok" | "expiring_soon" | "expired" | "parse_error";
}

export interface CertDashboard {
  total_certs: number;
  expiring_soon: number;
  already_expired: number;
  certs: CertInfo[];
  scan_timestamp: string;
}

export async function hqCertStatus(): Promise<CertDashboard> {
  return _fetch<CertDashboard>("/api/hq/security/cert_status");
}

export async function hqCertRotateNow() {
  return _fetch<{ rotated: string[] }>("/api/hq/security/cert_rotate", { method: "POST" });
}

export async function hqHoneypotLog(lastN = 100) {
  return _fetch<{ hits: unknown[]; stats: unknown }>(`/api/hq/security/honeypot_log?last_n=${lastN}`);
}

export async function hqAuditExport() {
  return _fetch<unknown>("/api/hq/security/audit_export", { method: "POST" });
}

export interface JwtRotationStatus {
  last_rotation: string;
  next_rotation: string;
  interval_hours: number;
  has_previous_key: boolean;
  rotation_count: number;
}

export async function hqJwtRotationStatus(): Promise<JwtRotationStatus> {
  return _fetch<JwtRotationStatus>("/api/hq/security/jwt_rotation_status");
}

export async function hqJwtRotateNow() {
  return _fetch<{ status: string; next_rotation: string }>("/api/hq/security/jwt_rotate_now", {
    method: "POST",
  });
}

export interface IdsBan {
  ip: string;
  seconds_remaining: number;
  unban_at: string;
}

export async function hqActiveIdsLog() {
  return _fetch<{ active_bans: IdsBan[]; stats: unknown }>("/api/hq/security/active_bans");
}

export async function hqIdsLog(lastN = 100) {
  return _fetch<{ events: unknown[] }>(`/api/hq/security/ids_log?last_n=${lastN}`);
}

export async function mfaSetup(username: string) {
  return _fetch<{ username: string; qr_code_b64: string; enrolled: boolean }>(
    "/api/auth/mfa/setup",
    { method: "POST", body: JSON.stringify({ username }) },
  );
}

export async function mfaVerify(username: string, otp_code: string) {
  return _fetch<{ username: string; verified: boolean }>("/api/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ username, otp_code }),
  });
}

export async function mfaStatus() {
  return _fetch<{ enrolled_users: { username: string; enrolled: boolean }[] }>(
    "/api/auth/mfa/status",
  );
}

// ─── HQ Pi devices ─────────────────────────────────────

export interface PiDevice {
  branch: string;
  ip?: string;
  online: boolean;
  last_seen?: string;
  offline_rounds?: number;
  hardware?: {
    cpu_temp_c: number | null;
    cpu_percent: number | null;
    memory_percent: number | null;
    memory_used_mb: number | null;
    uptime_seconds: number | null;
    platform: string;
  };
  pi_config?: Record<string, unknown>;
}

export async function hqPiDevices(): Promise<{ pi_devices: PiDevice[]; total: number }> {
  return _fetch<{ pi_devices: PiDevice[]; total: number }>("/api/hq/pi_devices");
}

export async function hqPiDevice(branch: string): Promise<PiDevice> {
  return _fetch<PiDevice>(`/api/hq/pi_devices/${branch}`);
}

// ─── AI Models Status ──────────────────────────────────────

export interface AIModelInfo {
  status: "trained" | "ready" | "failed" | "pending";
  n_customers?: number;
  n_flagged?: number;
  default_rate?: number;
  churn_rate?: number;
  accuracy?: number;
  f1?: number;
  auc?: number;
  ensemble_auc?: number;
  n_detectors?: number;
  dimensions?: number;
  method?: string;
  error?: string;
}

export interface AIModelsStatusResult {
  branch: string;
  n_customers: number;
  all_ready: boolean;
  models: {
    fraud_detection?: AIModelInfo;
    loan_default?: AIModelInfo;
    churn_predictor?: AIModelInfo;
    aml_monitor?: AIModelInfo;
    cashflow_forecaster?: AIModelInfo;
    unified_risk?: AIModelInfo;
  };
}

export async function branchAIModelsStatus(): Promise<AIModelsStatusResult> {
  return _fetch<AIModelsStatusResult>("/api/branch/ai_models_status");
}

// ─── HQ Unified Assessment (Fingerprint) ────────────────

export interface HQAssessRequest {
  applicant: {
    loan_amount: number;
    loan_tenure_months: number;
    monthly_income: number;
    dti: number;
    cibil_score: number;
    credit_utilization: number;
    num_existing_loans: number;
    collateral_value: number;
    has_guarantor: boolean;
    digital_engagement: number;
    spending_consistency: number;
  };
  loan_type: string;
  max_dti: number;
  collateral_weight: number;
  regional_risk_factor: number;
  min_cibil: number;
  require_guarantor_above: number;
  prioritize_digital: boolean;
  custom_label: string;
}

export interface HQAssessResult {
  fingerprint_id: string;
  branch_id: string;
  hq_grade: string;
  branch_adjusted_grade: string;
  default_probability: number;
  confidence: number;
  branch_recommended_rate: number;
  max_approved_loan_npr: number;
  eligible_products: string[];
  hq_model_version: number;
  global_customers_trained_on: number;
  branch_params_applied: Record<string, unknown>;
  risk_dimensions: {
    credit_quality: number;
    dti_health: number;
    collateral: number;
    digital_trust: number;
    regional_adjust: number;
  };
  decision_explanation: string[];
  nrb_compliant: boolean;
  requires_guarantor: boolean;
  fingerprint_timestamp: string;
}

export async function branchHQAssess(req: HQAssessRequest): Promise<HQAssessResult> {
  return _fetch<HQAssessResult>("/api/branch/hq_assess", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── SSE — Live Federated Round Events ─────────────────

export type RoundEventType =
  | "connected"
  | "round_started"
  | "branch_submitted"
  | "validation_passed"
  | "validation_failed"
  | "byzantine_detected"
  | "aggregating"
  | "round_complete"
  | "error";

export interface RoundEvent {
  type: RoundEventType;
  round: number;
  ts: string;
  data: Record<string, unknown>;
}

/**
 * Subscribe to live federated round events via SSE.
 *
 * Usage:
 *   const cleanup = subscribeToRoundEvents(
 *     (ev) => console.log(ev.type, ev.data),
 *     (err) => console.error(err),
 *   );
 *   // later: cleanup();
 *
 * Falls back to fetch + ReadableStream when EventSource cannot set the
 * Authorization header (standard browser limitation).
 */
export function subscribeToRoundEvents(
  onEvent: (event: RoundEvent) => void,
  onError?: (err: Event | Error) => void,
): () => void {
  const token = getToken();
  const url = `${BFF_URL}/api/hq/events/stream`;

  // Browsers can't add auth headers to EventSource, so we use fetch streaming.
  let aborted = false;
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE connection failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are delimited by double-newline
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (line.startsWith("data:")) {
              const json = line.slice(5).trim();
              if (!json) continue;
              try {
                const event: RoundEvent = JSON.parse(json);
                onEvent(event);
              } catch {
                // ignore malformed JSON
              }
            }
          }
        }
      }
    } catch (err) {
      if (!aborted && onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => {
    aborted = true;
    controller.abort();
  };
}

// ─── WebSocket ──────────────────────────────────────────
export type WsEventType =
  | "fraud_alert"
  | "weight_submission"
  | "aggregation_complete"
  | "pong";

export interface WsMessage {
  type: WsEventType;
  data?: Record<string, unknown>;
  ts: string;
}

export function connectWs(onMessage: (msg: WsMessage) => void): WebSocket {
  const wsUrl = BFF_URL.replace(/^http/, "ws") + "/ws/events";
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try {
      const msg: WsMessage = JSON.parse(ev.data);
      onMessage(msg);
    } catch {
      // ignore non-JSON
    }
  };
  // Keepalive ping every 30s
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 30_000);
  ws.onclose = () => clearInterval(interval);
  return ws;
}

// ── Banking API ──────────────────────────────────────────────────────────────

export interface BankAccount {
  id: string;
  account_number: string;
  account_type: string;
  balance: number;
  currency: string;
  interest_rate: number;
  opened_at: string | null;
  is_active?: boolean;
  account_status?: string;
  minimum_balance?: number;
}

export interface BankTransaction {
  id: string;
  reference_number: string;
  type: string;
  amount: number;
  fee: number;
  description: string;
  status: string;
  direction: "debit" | "credit";
  other_party: string | null;
  balance_after: number | null;
  created_at: string | null;
}

// ─── Cheque OCR auto-deposit ────────────────────────────
export interface ChequeFields {
  amount: number | null;
  amount_in_words: string | null;
  amount_in_words_value: number | null;
  amount_match: boolean | null;
  payee: string | null;
  account_number: string | null;
  cheque_number: string | null;
  routing_number: string | null;
  date: string | null;
  bank_name: string | null;
}

export interface ChequeScanResult {
  fields: ChequeFields;
  field_confidence?: Record<string, number>;
  overall_confidence: number;
  amount_verified?: boolean;
  needs_review: boolean;
  review_reasons?: string[];
  raw_lines: { text: string; confidence: number }[];
  branch?: string;
}

export interface ChequeDepositResult {
  status: string;
  reference_number: string;
  amount: number;
  balance_after: number;
  message: string;
}

// scanCheque uploads the cheque image to the BFF, which forwards it to the
// branch edge for on-device OCR. multipart/form-data: no JSON Content-Type so the
// browser sets the multipart boundary itself.
export async function scanCheque(file: File): Promise<ChequeScanResult> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BFF_URL}/api/banking/cheque/scan`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = res.statusText;
    try {
      message = JSON.parse(body).detail ?? message;
    } catch {
      if (body) message = body;
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<ChequeScanResult>;
}

export interface HandwritingResult {
  text: string;
  lines: { text: string; confidence: number }[];
  engine: string;
  overall_confidence: number;
  line_count: number;
  branch?: string;
}

// scanHandwriting digitises handwritten text on-branch (EasyOCR detect + TrOCR).
export async function scanHandwriting(file: File): Promise<HandwritingResult> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BFF_URL}/api/banking/ocr/handwriting`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = res.statusText;
    try { message = JSON.parse(body).detail ?? message; } catch { if (body) message = body; }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<HandwritingResult>;
}

export async function depositCheque(req: {
  account_number: string;
  amount: number;
  cheque_number?: string;
  payee?: string;
  drawer_bank?: string;
}): Promise<ChequeDepositResult> {
  return apiFetch<ChequeDepositResult>("/api/banking/cheque/deposit", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface FixedDeposit {
  id: string;
  fd_number: string;
  principal: number;
  interest_rate: number;
  tenure_months: number;
  maturity_date: string | null;
  maturity_amount: number;
  status: string;
  auto_renew: boolean;
  opened_at: string | null;
}

export interface UserProfile {
  id: string;
  full_name: string;
  username: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string;
  national_id: string | null;
  address: string | null;
  district: string | null;
  province: string | null;
  occupation: string | null;
  annual_income: number | null;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string | null;
}

export interface SecurityAudit {
  alerts: { level: string; type: string; message: string; count: number }[];
  summary: {
    total_transactions_30d: number;
    total_debits_30d: number;
    large_transactions: number;
    failed_transactions: number;
    off_hours_transactions: number;
    accounts_reviewed: number;
    audit_date: string;
  };
  status: "CLEAN" | "MEDIUM_RISK" | "HIGH_RISK";
}

export function getAccounts(): Promise<{ accounts: BankAccount[] }> {
  return _fetch("/api/banking/accounts");
}

export function searchAccount(q: string): Promise<{ results: unknown[]; query: string }> {
  return _fetch(`/api/banking/accounts/search?q=${encodeURIComponent(q)}`);
}

export function fundTransfer(payload: {
  from_account_number: string;
  to_account_number: string;
  amount: number;
  description?: string;
}): Promise<{ status: string; reference_number: string; amount: number; fee: number; from_balance_after: number; message: string }> {
  return _fetch("/api/banking/transfer", { method: "POST", body: JSON.stringify(payload) });
}

// ─── Bill payments ─────────────────────────────────────────

// Biller catalogue (keys must match go_bff billers map).
export const BILLERS: { key: string; label: string; field: string }[] = [
  { key: "nea_electricity", label: "NEA Electricity", field: "Consumer no." },
  { key: "khanepani_water", label: "Khanepani Water", field: "Customer ID" },
  { key: "ntc_topup", label: "NTC Topup", field: "Mobile no." },
  { key: "ncell_topup", label: "Ncell Topup", field: "Mobile no." },
  { key: "worldlink_net", label: "WorldLink Internet", field: "Customer ID" },
  { key: "vianet_net", label: "Vianet Internet", field: "Customer ID" },
  { key: "dishhome_tv", label: "DishHome TV", field: "Smartcard no." },
  { key: "khanepani_sewer", label: "Khanepani Sewerage", field: "Customer ID" },
];

export function payBill(payload: {
  account_number: string;
  biller: string;
  identifier: string;
  amount: number;
}): Promise<{ status: string; reference_number: string; biller: string; amount: number; balance_after: number; message: string }> {
  return _fetch("/api/banking/bill-pay", { method: "POST", body: JSON.stringify(payload) });
}

// ─── Beneficiaries + standing instructions ─────────────────

export interface Beneficiary {
  id: string;
  nickname: string;
  account_number: string;
  bank_name: string;
  created_at: string;
}

export interface StandingInstruction {
  id: string;
  from_account_number: string;
  to_account_number: string;
  amount: number;
  frequency: string;
  next_run: string;
  status: string;
  description: string;
  last_run: string;
}

export function listBeneficiaries(): Promise<{ beneficiaries: Beneficiary[] }> {
  return _fetch("/api/banking/beneficiaries");
}

export function addBeneficiary(payload: { nickname: string; account_number: string; bank_name?: string }): Promise<{ status: string; id: string }> {
  return _fetch("/api/banking/beneficiaries", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteBeneficiary(id: string): Promise<{ status: string }> {
  return _fetch(`/api/banking/beneficiaries/${id}`, { method: "DELETE" });
}

export function listStandingInstructions(): Promise<{ standing_instructions: StandingInstruction[] }> {
  return _fetch("/api/banking/standing-instructions");
}

export function createStandingInstruction(payload: {
  from_account_number: string;
  to_account_number: string;
  amount: number;
  frequency: "weekly" | "monthly";
  start_date?: string;
  description?: string;
}): Promise<{ status: string; id: string; next_run: string; frequency: string }> {
  return _fetch("/api/banking/standing-instructions", { method: "POST", body: JSON.stringify(payload) });
}

export function cancelStandingInstruction(id: string): Promise<{ status: string }> {
  return _fetch(`/api/banking/standing-instructions/${id}`, { method: "DELETE" });
}

// ─── Branch cash-demand forecast ───────────────────────────

export interface CashDemandPoint { date: string; demand: number; actual: boolean }
export interface CashForecastPoint { date: string; demand: number; lower: number; upper: number }

export interface CashDemand {
  branch_id: string;
  currency: string;
  generated_at: string;
  history: CashDemandPoint[];
  forecast: CashForecastPoint[];
  avg_daily_demand: number;
  peak: CashForecastPoint;
  recommended_vault_float: number;
  method: string;
  drivers: string[];
}

export function branchCashDemand(): Promise<CashDemand> {
  return _fetch("/api/branch/cash_demand");
}

// ─── Branch analytics copilot (2nd LLM) ────────────────────

export interface CopilotMetrics {
  active_accounts: number;
  dormant_accounts: number;
  total_deposits: number;
  txn_30d_count: number;
  txn_30d_volume: number;
  active_loans: number;
  loan_outstanding: number;
  overdue_installments: number;
  active_fds: number;
  fd_principal: number;
  pending_applications: number;
  pending_cheques: number;
}

export interface CopilotResponse {
  answer: string;
  source: string;  // "llm" | "rule-based"
  model: string;
  metrics: CopilotMetrics;
  branch: string;
  note: string;
}

export function branchCopilot(question: string): Promise<CopilotResponse> {
  return _fetch("/api/branch/copilot", { method: "POST", body: JSON.stringify({ question }) });
}

// ─── Debit cards + cheque books ────────────────────────────

export interface DebitCard {
  id: string;
  account_number: string;
  masked_number: string;
  network: string;
  status: string;
  daily_limit: number;
  expiry: string;
  issued_at: string;
}

export function listCards(): Promise<{ cards: DebitCard[] }> { return _fetch("/api/banking/cards"); }
export function issueCard(payload: { account_number: string; network?: string; daily_limit?: number }): Promise<{ status: string; masked_number: string }> {
  return _fetch("/api/banking/cards", { method: "POST", body: JSON.stringify(payload) });
}
export function blockCard(id: string): Promise<{ status: string }> { return _fetch(`/api/banking/cards/${id}/block`, { method: "POST" }); }
export function freezeCard(id: string): Promise<{ status: string }> { return _fetch(`/api/banking/cards/${id}/freeze`, { method: "POST" }); }
export function unblockCard(id: string): Promise<{ status: string }> { return _fetch(`/api/banking/cards/${id}/unblock`, { method: "POST" }); }
export function setCardLimit(id: string, daily_limit: number): Promise<{ status: string; daily_limit: number }> {
  return _fetch(`/api/banking/cards/${id}/limit`, { method: "POST", body: JSON.stringify({ daily_limit }) });
}

export interface ChequeBook {
  id: string;
  account_number: string;
  leaves: number;
  status: string;
  requested_at: string;
  updated_at: string;
}
export function listChequeBooks(): Promise<{ cheque_books: ChequeBook[] }> { return _fetch("/api/banking/cheque-books"); }
export function requestChequeBook(account_number: string, leaves: number): Promise<{ status: string; id: string }> {
  return _fetch("/api/banking/cheque-books", { method: "POST", body: JSON.stringify({ account_number, leaves }) });
}

export interface BranchChequeBook extends ChequeBook { customer: string }
export function listBranchChequeBooks(): Promise<{ cheque_books: BranchChequeBook[] }> { return _fetch("/api/branch/cheque-books"); }
export function advanceChequeBook(id: string): Promise<{ status: string; request_status: string }> {
  return _fetch(`/api/branch/cheque-books/${id}/advance`, { method: "POST" });
}

// ─── Cross-sell recommender ────────────────────────────────

export interface CrossSellRec {
  customer_id: string;
  name: string;
  product: string;
  reason: string;
  propensity: number;
  est_value: number;
}
export function branchCrossSell(): Promise<{ branch_id: string; recommendations: CrossSellRec[]; count: number; method: string }> {
  return _fetch("/api/branch/cross_sell");
}

// ─── General ledger (double-entry) ─────────────────────────

export interface GLTrialRow { code: string; name: string; type: string; debit: number; credit: number }
export interface GLTrialBalance { accounts: GLTrialRow[]; total_debit: number; total_credit: number; balanced: boolean }
export interface GLBalanceSheet {
  assets: number; liabilities: number; equity: number;
  income: number; expense: number; net_profit: number; balanced: boolean;
}
export interface GLJournalEntry {
  txn_ref: string; account_code: string; account_name: string;
  debit: number; credit: number; memo: string; created_at: string;
}

export function hqGLTrialBalance(): Promise<GLTrialBalance> { return _fetch("/api/hq/gl/trial-balance"); }
export function hqGLBalanceSheet(): Promise<GLBalanceSheet> { return _fetch("/api/hq/gl/balance-sheet"); }
export function hqGLJournal(): Promise<{ entries: GLJournalEntry[] }> { return _fetch("/api/hq/gl/journal"); }

// ─── Transaction blockchain ────────────────────────────────

export interface ChainBlock {
  index: number;
  prev_hash: string;
  merkle_root: string;
  tx_count: number;
  nonce: number;
  difficulty: number;
  timestamp: string;
  hash: string;
}

export function hqChainBlocks(): Promise<{ blocks: ChainBlock[]; height: number; pending: number }> {
  return _fetch("/api/hq/chain/blocks");
}
export function hqChainSeal(): Promise<{ status: string; block: ChainBlock }> {
  return _fetch("/api/hq/chain/seal", { method: "POST" });
}
export function hqChainVerify(): Promise<{ valid: boolean; blocks_verified: number; broken_at: number; message: string }> {
  return _fetch("/api/hq/chain/verify");
}

export function getTransactions(
  accountNumber: string,
  page = 1,
  perPage = 20,
): Promise<{ transactions: BankTransaction[]; total: number; page: number; total_pages: number }> {
  return _fetch(`/api/banking/transactions?account_number=${accountNumber}&page=${page}&per_page=${perPage}`);
}

export function getProfile(): Promise<UserProfile> {
  return _fetch("/api/banking/profile");
}

export function updateProfile(payload: {
  full_name?: string;
  address?: string;
  district?: string;
  province?: string;
  occupation?: string;
}): Promise<{ status: string; message: string }> {
  return _fetch("/api/banking/profile", { method: "PATCH", body: JSON.stringify(payload) });
}

export function changePassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ status: string; message: string }> {
  return _fetch("/api/banking/change-password", { method: "POST", body: JSON.stringify(payload) });
}

export function getFDs(): Promise<{ fixed_deposits: FixedDeposit[] }> {
  return _fetch("/api/banking/fd");
}

export function createFD(payload: {
  account_number: string;
  principal: number;
  tenure_months: number;
  auto_renew?: boolean;
}): Promise<{ status: string; fd_number: string; principal: number; interest_rate: number; tenure_months: number; maturity_amount: number; maturity_date: string; account_balance_after: number }> {
  return _fetch("/api/banking/fd", { method: "POST", body: JSON.stringify(payload) });
}

// ─── Loan servicing ────────────────────────────────────────

export interface LoanSummary {
  id: string;
  loan_number: string;
  loan_type: string;
  principal: number;
  interest_rate: number;
  tenure_months: number;
  emi: number;
  outstanding: number;
  status: string;
  disbursed_at: string;
  next_due_date: string;
  paid_installments: number;
  overdue_installments: number;
}

export interface LoanScheduleRow {
  installment_no: number;
  due_date: string;
  emi: number;
  principal: number;
  interest: number;
  balance_after: number;
  status: string;
  paid_at: string;
}

export interface LoanDetail {
  loan_number: string;
  loan_type: string;
  principal: number;
  interest_rate: number;
  tenure_months: number;
  emi: number;
  outstanding: number;
  status: string;
  purpose: string;
  collateral_value: number;
  has_guarantor: boolean;
  total_interest: number;
  disbursed_at: string;
  schedule: LoanScheduleRow[];
}

export function listLoans(): Promise<{ loans: LoanSummary[] }> {
  return _fetch("/api/banking/loans");
}

export function getLoan(loanNumber: string): Promise<LoanDetail> {
  return _fetch(`/api/banking/loans/${loanNumber}`);
}

export function disburseLoan(payload: {
  account_number: string;
  principal: number;
  tenure_months: number;
  loan_type: string;
  purpose?: string;
  collateral_value?: number;
  has_guarantor?: boolean;
}): Promise<{ status: string; loan_number: string; emi: number; total_payable: number; total_interest: number; interest_rate: number; risk_grade: string; account_balance_after: number; message: string }> {
  return _fetch("/api/banking/loans", { method: "POST", body: JSON.stringify(payload) });
}

export function repayLoan(loanNumber: string, installmentNo?: number): Promise<{ status: string; loan_number: string; installment_no: number; emi_paid: number; outstanding: number; loan_status: string; account_balance_after: number; message: string }> {
  return _fetch(`/api/banking/loans/${loanNumber}/pay`, {
    method: "POST",
    body: JSON.stringify(installmentNo ? { installment_no: installmentNo } : {}),
  });
}

export function prepayLoan(loanNumber: string, amount: number): Promise<{ status: string; loan_number: string; installments_cleared: number; amount_settled: number; outstanding: number; loan_status: string; message: string }> {
  return _fetch(`/api/banking/loans/${loanNumber}/prepay`, { method: "POST", body: JSON.stringify({ amount }) });
}

export function forecloseLoan(loanNumber: string): Promise<{ status: string; loan_number: string; settlement_amount: number; loan_status: string; account_balance_after: number; message: string }> {
  return _fetch(`/api/banking/loans/${loanNumber}/foreclose`, { method: "POST" });
}

export function breakFD(fdNumber: string): Promise<{ status: string; fd_number: string; principal_returned: number; penalty: number; message: string }> {
  return _fetch(`/api/banking/fd/${fdNumber}`, { method: "DELETE" });
}

export function getSecurityAudit(): Promise<SecurityAudit> {
  return _fetch("/api/banking/security-audit");
}

// ─── Account Applications ────────────────────────────────

export interface AccountApplication {
  id: number;
  customer_id?: string;
  account_type: string;
  purpose: string;
  initial_deposit: number;
  status: "pending" | "approved" | "rejected";
  review_note: string;
  created_at: string;
  reviewed_at: string;
  reviewed_by?: string;
}

export function applyForAccount(payload: {
  account_type: "savings" | "current" | "salary";
  purpose?: string;
  initial_deposit?: number;
}): Promise<{ application_id: number; status: string; message: string }> {
  return _fetch("/api/banking/account-application", { method: "POST", body: JSON.stringify(payload) });
}

export function getMyApplications(): Promise<{ applications: AccountApplication[]; total: number }> {
  return _fetch("/api/banking/account-applications");
}

// ─── Statement ───────────────────────────────────────────

export interface StatementEntry extends BankTransaction {
  direction: "debit" | "credit";
}

export function getStatement(accountNumber: string, from?: string, to?: string): Promise<{
  account_number: string;
  from: string;
  to: string;
  transactions: StatementEntry[];
  total_count: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}> {
  const q = new URLSearchParams({ account_number: accountNumber });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return _fetch(`/api/banking/statement?${q}`);
}

// ─── Branch Banking Management ───────────────────────────

export interface BranchBankingSummary {
  branch_id: string;
  total_accounts: number;
  active_accounts: number;
  dormant_accounts: number;
  total_balance_npr: number;
  pending_applications: number;
  active_fds: number;
  total_fd_value_npr: number;
}

export function getBranchBankingSummary(): Promise<BranchBankingSummary> {
  return _fetch("/api/branch/banking/summary");
}

export interface BranchClient {
  customer_id: string;
  full_name: string;
  national_id: string;
  occupation: string;
  kyc_status: string;
  account_count: number;
  total_balance: number;
}

export function getBranchClients(params?: { search?: string; page?: number; per_page?: number }): Promise<{ clients: BranchClient[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  return _fetch(`/api/branch/clients${q.toString() ? "?" + q : ""}`);
}

export interface ClientDetail {
  customer_id: string;
  profile: {
    id: string; full_name: string; username: string; date_of_birth: string;
    gender: string; nationality: string; national_id: string; address: string;
    district: string; province: string; occupation: string; annual_income: number;
    role: string; is_active: boolean; created_at: string;
  };
  kyc: { kyc_status: string; verified_by: string; notes: string; verified_at: string };
  accounts: (BankAccount & { account_status: string })[];
  fixed_deposits: FixedDeposit[];
}

export function getBranchClientDetail(customerId: string): Promise<ClientDetail> {
  return _fetch(`/api/branch/clients/${customerId}`);
}

export function verifyClientKYC(customerId: string, payload: { status: string; notes?: string }): Promise<{ kyc_status: string; message: string }> {
  return _fetch(`/api/branch/clients/${customerId}/verify-kyc`, { method: "POST", body: JSON.stringify(payload) });
}

export function getBranchAllAccounts(params?: { status?: string; type?: string; page?: number }): Promise<{ accounts: (BankAccount & { account_status: string; full_name: string; customer_id: string })[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.type) q.set("type", params.type);
  if (params?.page) q.set("page", String(params.page));
  return _fetch(`/api/branch/banking/accounts${q.toString() ? "?" + q : ""}`);
}

export function getBranchAllFDs(status?: string): Promise<{ fixed_deposits: (FixedDeposit & { full_name: string; customer_id: string })[]; total: number }> {
  return _fetch(`/api/branch/banking/fd${status ? "?status=" + status : ""}`);
}

export function getBranchApplications(status?: string): Promise<{ applications: AccountApplication[]; total: number }> {
  return _fetch(`/api/branch/account-applications${status ? "?status=" + status : ""}`);
}

export function approveBranchApplication(id: number, note?: string): Promise<{ status: string; account_number: string; message: string }> {
  return _fetch(`/api/branch/account-applications/${id}/approve`, { method: "POST", body: JSON.stringify({ note: note ?? "" }) });
}

export function rejectBranchApplication(id: number, note?: string): Promise<{ status: string; message: string }> {
  return _fetch(`/api/branch/account-applications/${id}/reject`, { method: "POST", body: JSON.stringify({ note: note ?? "" }) });
}

// ─── EOD / BOD ───────────────────────────────────────────

export interface EODPreview {
  branch_id: string;
  as_of: string;
  interest_eligible_accounts: number;
  projected_interest_npr: number;
  dormant_candidates: number;
  fds_maturing_today: number;
  fds_maturing_today_value: number;
  fds_maturing_next_7_days: number;
}

export interface EODResult {
  process_type: string;
  run_by: string;
  branch_id: string;
  started_at: string;
  completed_at: string;
  interest_posted_count: number;
  interest_posted_total: number;
  dormant_marked_count: number;
  fd_matured_count: number;
  fd_matured_total: number;
  status: string;
  fds_maturing_7_days?: { fd_number: string; customer: string; principal: number; maturity_date: string; maturity_amount: number }[];
  pending_applications?: number;
}

export interface EODLog {
  id: number;
  process_type: string;
  run_by: string;
  interest_posted_count: number;
  interest_posted_total: number;
  dormant_marked_count: number;
  fd_matured_count: number;
  fd_matured_total: number;
  status: string;
  started_at: string;
  completed_at: string;
}

export function getEODPreview(): Promise<EODPreview> {
  return _fetch("/api/banking/eod/preview");
}

export function runEOD(): Promise<EODResult> {
  return _fetch("/api/banking/eod", { method: "POST" });
}

export function runBOD(): Promise<EODResult> {
  return _fetch("/api/banking/bod", { method: "POST" });
}

export function getEODLogs(limit?: number): Promise<{ logs: EODLog[]; total: number }> {
  return _fetch(`/api/banking/eod/logs${limit ? "?limit=" + limit : ""}`);
}

// ─── Week-2: SHAP Explainability ────────────────────────

export interface ShapFeature {
  name: string;
  value: number;
  shap_value: number;
  direction: "positive" | "negative";
}

export interface ScoreExplanation {
  customer_id: string;
  base_value: number;
  prediction: number;
  features: ShapFeature[];
}

export function customerScoreExplanation(): Promise<ScoreExplanation> {
  return _fetch("/api/customer/score_explanation");
}

// ─── Week-2: What-If Simulator ──────────────────────────

export interface WhatIfRequest {
  annual_income: number;
  debt_to_income: number;
  employment_months: number;
  existing_loans: number;
  loan_amount_requested: number;
  collateral_value: number;
}

export interface WhatIfResult {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  change_from_baseline: number;
  key_driver: string;
}

export function customerWhatIf(req: WhatIfRequest): Promise<WhatIfResult> {
  return _fetch("/api/customer/whatif", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Week-2: Credit Journey ─────────────────────────────

export interface ScoreHistoryPoint {
  round: number;
  date: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  delta: number;
  reason: string;
}

export interface ScoreHistory {
  customer_id: string;
  history: ScoreHistoryPoint[];
}

export function customerScoreHistory(): Promise<ScoreHistory> {
  return _fetch("/api/customer/score_history");
}

// ─── Week 3: NRB Compliance Report (Feature A) ──────────────

export interface NRBComplianceReport {
  report_id: string;
  institution: string;
  reporting_period: string;
  round_number: number;
  privacy_compliance: {
    mechanism: string;
    epsilon_consumed: number;
    total_epsilon_budget: number;
    epsilon_remaining: number;
    clip_norm: number;
    compliant: boolean;
  };
  data_governance: {
    raw_data_centralized: boolean;
    data_stays_at_branch: boolean;
    branches_participated: string[];
    branches_count: number;
  };
  security_events: {
    byzantine_attempts: number;
    blocked_submissions: number;
    integrity_failures: number;
  };
  model_performance: {
    global_f1: number;
    global_accuracy: number;
    improvement_vs_previous: number;
  };
  audit_chain: {
    hash: string;
    chain_valid: boolean;
    total_events: number;
  };
  nrb_directives_met: string[];
  generated_at: string;
  signed_by: string;
}

export async function hqComplianceReport(round: number): Promise<NRBComplianceReport> {
  return _fetch<NRBComplianceReport>(`/api/hq/compliance_report?round=${round}`);
}

// ─── Week 3: Branch Contributions / Shapley (Feature B) ─────

export interface BranchContribution {
  branch: string;
  contribution_score: number;
  participation_rate: number;
  avg_local_f1: number;
  branch_type: string;
  rank: number;
}

export interface BranchContributionsResult {
  method: string;
  rounds_analyzed: number;
  contributions: BranchContribution[];
}

export async function hqBranchContributions(): Promise<BranchContributionsResult> {
  return _fetch<BranchContributionsResult>("/api/hq/branch_contributions");
}

// ─── Week 3: Stress Test (Feature C) ────────────────────────

export interface StressTestRequest {
  scenario: "recession" | "earthquake" | "inflation_spike" | "currency_crisis" | "custom";
  severity: number;
  custom_params?: { income_shock?: number; unemployment_delta?: number; existing_loans_shock?: number };
}

export interface StressTestBranchResult {
  branch: string;
  baseline: number;
  stressed: number;
  delta: number;
  risk_level: "low" | "medium" | "high";
  branch_type: string;
}

export interface StressTestResult {
  scenario: string;
  severity: number;
  baseline_default_rate: number;
  stressed_default_rate: number;
  delta: number;
  branches: StressTestBranchResult[];
  most_at_risk: string[];
  capital_adequacy_impact: string;
  recommendation: string;
}

export async function hqStressTest(req: StressTestRequest): Promise<StressTestResult> {
  return _fetch<StressTestResult>("/api/hq/stress_test", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Week 3: Privacy Budget (Feature D) ─────────────────────

export interface PrivacyBudgetRound {
  round: number;
  epsilon: number;
  cumulative: number;
  branches: number;
  noise_std: number;
}

export interface PrivacyBudgetResult {
  total_budget: number;
  epsilon_consumed: number;
  epsilon_remaining: number;
  clip_norm: number;
  mechanism: string;
  rounds: PrivacyBudgetRound[];
  projected_exhaustion_round: number;
  status: "healthy" | "warning" | "critical";
}

export async function hqPrivacyBudget(): Promise<PrivacyBudgetResult> {
  return _fetch<PrivacyBudgetResult>("/api/hq/privacy_budget");
}

// ─── AML Network Graph ───────────────────────────────────

export interface AMLNetworkNode {
  id: string;
  label: string;
  type: "customer" | "account" | "external";
  risk: "high" | "medium" | "low" | "unknown";
  branch?: string;
  amount?: number;
}

export interface AMLNetworkEdge {
  source: string;
  target: string;
  amount: number;
  type: string;
  suspicious: boolean;
  count: number;
}

export interface AMLNetworkData {
  nodes: AMLNetworkNode[];
  edges: AMLNetworkEdge[];
  summary: {
    total_nodes: number;
    suspicious_links: number;
    high_risk_customers: number;
  };
}

export async function branchAmlNetwork(): Promise<AMLNetworkData> {
  return _fetch<AMLNetworkData>("/api/branch/aml_network");
}

// ─── Privacy Attack Simulation ──────────────────────────

export interface GradientInversionResult {
  attack: string;
  branch: string;
  with_dp: boolean;
  attack_success: boolean;
  fidelity_score: number;
  reconstructed_features: Record<string, number>;
  real_vs_reconstructed: Array<{
    feature: string;
    real_mean: number;
    reconstructed_mean: number;
    error_pct: number;
  }>;
  dp_protection: string;
  interpretation: string;
}

export interface MembershipInferenceResult {
  attack: string;
  branch: string;
  n_queries: number;
  with_dp: boolean;
  attack_accuracy: number;
  baseline_accuracy: number;
  advantage: number;
  attack_success: boolean;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  interpretation: string;
}

export interface ModelInversionResult {
  attack: string;
  with_dp: boolean;
  creditworthy_prototype: Record<string, number>;
  default_prototype: Record<string, number>;
  similarity_to_real: number;
  attack_success: boolean;
  interpretation: string;
}

export async function hqPrivacyGradientInversion(
  branch: string,
  withDp: boolean,
): Promise<GradientInversionResult> {
  return _fetch<GradientInversionResult>("/api/hq/privacy/gradient_inversion", {
    method: "POST",
    body: JSON.stringify({ branch, with_dp: withDp }),
  });
}

export async function hqPrivacyMembershipInference(
  branch: string,
  withDp: boolean,
  nQueries: number,
): Promise<MembershipInferenceResult> {
  return _fetch<MembershipInferenceResult>("/api/hq/privacy/membership_inference", {
    method: "POST",
    body: JSON.stringify({ branch, with_dp: withDp, n_queries: nQueries }),
  });
}

export async function hqPrivacyModelInversion(
  withDp: boolean,
): Promise<ModelInversionResult> {
  return _fetch<ModelInversionResult>("/api/hq/privacy/model_inversion", {
    method: "POST",
    body: JSON.stringify({ with_dp: withDp }),
  });
}

// ─── Federated Benchmark ────────────────────────────────

export interface FederatedBenchmark {
  rounds_analysed: number;
  federated: { final_f1: number; final_accuracy: number; convergence_round: number };
  centralised_equivalent: { estimated_f1: number; estimated_accuracy: number; note: string };
  performance_gap: { f1_gap: number; accuracy_gap: number; federated_efficiency: number };
  privacy_cost_of_centralisation: {
    data_exposure_customers: number;
    regulatory_risk: string;
    breach_impact_npr: number;
  };
  learning_curves: Array<{ round: number; federated_f1: number; centralised_f1: number }>;
  algorithm_comparison?: {
    rounds: number[];
    metric: string;
    FedAvg: number[];
    FedProx: number[];
    Scaffold: number[];
    final_accuracy: { FedAvg: number; FedProx: number; Scaffold: number };
    note: string;
  };
  conclusion: string;
}

export async function hqFederatedBenchmark(): Promise<FederatedBenchmark> {
  return _fetch<FederatedBenchmark>("/api/hq/federated_benchmark");
}

// ─── Model Watermarking ─────────────────────────────────

export interface WatermarkStatus {
  status: string;
  watermark_id?: string;
  owner_id?: string;
  n_triggers?: number;
  embedded_at?: string;
  verification_key?: string;
}

export interface WatermarkVerifyResult {
  watermark_id: string;
  owner_id: string;
  verified: boolean;
  triggers_matched: number;
  triggers_total: number;
  match_rate: number;
  confidence: string;
  embedded_at: string;
  interpretation: string;
}

export async function hqWatermarkEmbed(
  ownerId: string,
  strength: number,
): Promise<WatermarkStatus> {
  return _fetch<WatermarkStatus>("/api/hq/security/watermark_embed", {
    method: "POST",
    body: JSON.stringify({ owner_id: ownerId, strength }),
  });
}

export async function hqWatermarkVerify(
  watermarkId: string,
): Promise<WatermarkVerifyResult> {
  return _fetch<WatermarkVerifyResult>("/api/hq/security/watermark_verify", {
    method: "POST",
    body: JSON.stringify({ watermark_id: watermarkId }),
  });
}

export async function hqWatermarkStatus(): Promise<WatermarkStatus> {
  return _fetch<WatermarkStatus>("/api/hq/security/watermark_status");
}

// ─── KYC Onboarding ─────────────────────────────────────

export interface KYCSubmitPayload {
  full_name: string;
  date_of_birth: string;
  gender: string;
  citizenship_number: string;
  phone: string;
  email: string;
  province: string;
  district: string;
  municipality: string;
  ward: string;
  employer_name: string;
  employment_type: string;
  monthly_income: number;
  years_employed: number;
  annual_income: number;
  existing_loans: number;
  dti_ratio: number;
  collateral_description: string;
  collateral_value: number;
  loan_purpose: string;
  loan_amount_requested: number;
}

export interface KYCSubmitResult {
  reference: string;
  status: string;
  estimated_processing: string;
  submitted_at: string;
}

export async function submitKYC(payload: KYCSubmitPayload): Promise<KYCSubmitResult> {
  return _fetch<KYCSubmitResult>("/api/customer/kyc_submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Counterfactual Explanation ──────────────────────────

export interface CounterfactualScenario {
  id: string;
  title: string;
  description: string;
  changes: Record<string, number>;
  new_score: number;
  delta: number;
  feasibility: string;
}

export interface CounterfactualResult {
  customer_id: string;
  current_score: number;
  current_grade: string;
  target_score: number;
  scenarios: CounterfactualScenario[];
  generated_at: string;
}

export function customerCounterfactual(): Promise<CounterfactualResult> {
  return _fetch("/api/customer/counterfactual");
}

// ─── Fairness Audit ──────────────────────────────────────

export interface FairnessSegment {
  group: string;
  count: number;
  avg_score: number;
  approval_rate: number;
  avg_dti: number;
  avg_income: number;
  demographic_parity: number;
}

export interface FairnessDistBin {
  range: string;
  urban: number;
  semi_urban: number;
  rural: number;
}

export interface FairnessAuditResult {
  segments: FairnessSegment[];
  score_distribution: FairnessDistBin[];
  gini_coefficient: number;
  disparate_impact: number;
  total_customers: number;
  audit_date: string;
  status: string;
}

export function hqFairnessAudit(): Promise<FairnessAuditResult> {
  return _fetch("/api/hq/fairness_audit");
}

// ─── Background Re-Verification ──────────────────────────
// Branch gives an instant decision on its local model; HQ re-verifies against
// the global federated model within ~30s. Queue side: branchVerifyBackground.
// Read side: branchVerifyResults.

export interface VerifyResult {
  customer_id: string;
  branch_id: string;
  immediate_decision: string | null;
  immediate_percentile: number | null;
  hq_percentile: number | null;
  verification_status: string;
  verified_at: string | null;
  timestamp: string | null;
}

export function branchVerifyBackground(
  customer_application: Record<string, unknown>,
  immediate_decision: Record<string, unknown>,
  branch_id: string,
): Promise<{ status: string; customer_id?: string; branch_id?: string }> {
  return _fetch("/api/v1/verify/background", {
    method: "POST",
    body: JSON.stringify({ customer_application, immediate_decision, branch_id }),
  });
}

export function branchVerifyResults(
  branch_id = "",
  limit = 50,
): Promise<{ results: VerifyResult[]; total: number; pending: number }> {
  const q = new URLSearchParams({ branch_id, limit: String(limit) });
  return _fetch(`/api/v1/verify/results?${q}`);
}

// ─── Admin: RBAC / users / branches / permissions ────────

export interface AdminUser {
  username: string;
  role: string;
  branch_id: string;
  full_name: string;
  email: string;
  customer_id: string;
  active: boolean;
  created_by: string;
  created_at: string;
}

export interface AdminBranch {
  name: string;
  branch_type: string;
  district: string;
  active: boolean;
}

export interface PermissionDef {
  Key: string;
  Label: string;
  Category: string;
}

export function adminListUsers(): Promise<{ users: AdminUser[] }> {
  return _fetch("/api/admin/users");
}

export function adminCreateUser(body: {
  username: string;
  password: string;
  role: string;
  branch_id?: string;
  full_name?: string;
  email?: string;
  customer_id?: string;
}): Promise<{ status: string; username: string }> {
  return _fetch("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
}

export function adminUpdateUser(
  username: string,
  body: Partial<{ role: string; branch_id: string; full_name: string; email: string; active: boolean; password: string }>,
): Promise<{ status: string }> {
  return _fetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function adminListBranches(): Promise<{ branches: AdminBranch[] }> {
  return _fetch("/api/admin/branches");
}

export function adminCreateBranch(body: {
  name: string;
  branch_type?: string;
  district?: string;
}): Promise<{ status: string; name: string }> {
  return _fetch("/api/admin/branches", { method: "POST", body: JSON.stringify(body) });
}

export function adminPermissionCatalog(): Promise<{ permissions: PermissionDef[] }> {
  return _fetch("/api/admin/permissions");
}

export function adminGetRolePerms(role: string): Promise<{ role: string; permissions: string[] }> {
  return _fetch(`/api/admin/roles/${encodeURIComponent(role)}/permissions`);
}

export function adminSetRolePerms(
  role: string,
  permissions: string[],
): Promise<{ status: string; role: string; count: number }> {
  return _fetch(`/api/admin/roles/${encodeURIComponent(role)}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
}

export function myPermissions(): Promise<{ role: string; permissions: string[] }> {
  return _fetch("/api/auth/my-permissions");
}

// ─── Teller / Cashier ────────────────────────────────────

export interface TellerTxnResult {
  status: string;
  reference_number: string;
  amount: number;
  balance_after: number;
  message: string;
}

export interface AccountEnquiry {
  account_number: string;
  holder: string;
  account_type: string;
  balance: number;
  branch_id: string;
  mini_statement: { reference_number: string; type: string; amount: number; balance_after: number; at: string }[];
}

export interface CashPosition {
  cashier: string;
  cash_deposits: number;
  deposit_count: number;
  cash_withdrawals: number;
  withdrawal_count: number;
  cheque_deposits: number;
  net_cash_position: number;
}

export function tellerDeposit(account_number: string, amount: number, remarks = ""): Promise<TellerTxnResult> {
  return _fetch("/api/teller/deposit", { method: "POST", body: JSON.stringify({ account_number, amount, remarks }) });
}

export function tellerWithdraw(account_number: string, amount: number, remarks = ""): Promise<TellerTxnResult> {
  return _fetch("/api/teller/withdraw", { method: "POST", body: JSON.stringify({ account_number, amount, remarks }) });
}

export function tellerChequeDeposit(body: {
  account_number: string;
  amount: number;
  cheque_number: string;
  payee?: string;
  drawer_bank?: string;
}): Promise<TellerTxnResult> {
  return _fetch("/api/teller/cheque-deposit", { method: "POST", body: JSON.stringify(body) });
}

export function tellerEnquiry(account_number: string): Promise<AccountEnquiry> {
  return _fetch(`/api/teller/enquiry?account_number=${encodeURIComponent(account_number)}`);
}

export function tellerCashPosition(): Promise<CashPosition> {
  return _fetch("/api/teller/cash-position");
}

// ─── Capital markets: MeroShare / IPO (ASBA) ─────────────

export interface DematStatus {
  linked: boolean;
  boid?: string;
  dp_id?: string;
  status?: string;
}

export interface IPOIssue {
  id: string;
  symbol: string;
  company: string;
  price: number;
  min_units: number;
  max_units: number;
  close_date: string;
  already_applied: boolean;
}

export interface IPOApplication {
  symbol: string;
  company: string;
  units: number;
  amount: number;
  status: string;
  applied_at: string;
}

export function getDemat(): Promise<DematStatus> {
  return _fetch("/api/customer/demat");
}

export function linkDemat(): Promise<{ status: string; boid: string; dp_id: string }> {
  return _fetch("/api/customer/demat/link", { method: "POST" });
}

export function listIPOs(): Promise<{ issues: IPOIssue[] }> {
  return _fetch("/api/customer/ipo");
}

export function applyIPO(
  issue_id: string,
  account_number: string,
  units: number,
): Promise<{ status: string; units: number; amount_blocked: number; reference_number: string; balance_after: number }> {
  return _fetch("/api/customer/ipo/apply", {
    method: "POST",
    body: JSON.stringify({ issue_id, account_number, units }),
  });
}

export function myIPOApplications(): Promise<{ applications: IPOApplication[] }> {
  return _fetch("/api/customer/ipo/applications");
}

export interface Holding {
  symbol: string;
  units: number;
  avg_price: number;
  value: number;
}

export function myPortfolio(): Promise<{ holdings: Holding[]; total_value: number }> {
  return _fetch("/api/customer/portfolio");
}

export function adminAllotIPO(issueId: string): Promise<{ status: string; symbol: string; applications: number }> {
  return _fetch(`/api/admin/ipo/${encodeURIComponent(issueId)}/allot`, { method: "POST" });
}

// ─── Maker-checker approvals + trial balance ─────────────

export interface ApprovalRequest {
  id: string;
  kind: string;
  requested_by: string;
  branch_id: string;
  amount: number;
  created_at: string;
}

export function listApprovals(): Promise<{ approvals: ApprovalRequest[] }> {
  return _fetch("/api/approvals");
}

export function approveRequest(id: string): Promise<{ status: string }> {
  return _fetch(`/api/approvals/${id}/approve`, { method: "POST" });
}

export function rejectRequest(id: string): Promise<{ status: string }> {
  return _fetch(`/api/approvals/${id}/reject`, { method: "POST" });
}

export interface TrialBalance {
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  difference: number;
}

export function trialBalance(): Promise<TrialBalance> {
  return _fetch("/api/hq/trial-balance");
}

// ─── CEO + IT consoles ───────────────────────────────────

export interface CEOOverview {
  total_deposits: number;
  total_accounts: number;
  total_transactions: number;
  branches: number;
  users: number;
  active_loans: number;
  active_fds: number;
  fd_book: number;
  branch_leaderboard: { branch: string; accounts: number; deposits: number }[];
}

export interface ITSystem {
  status: string;
  db_ok: boolean;
  total_users: number;
  active_users: number;
  transactions_today: number;
  tracked_ips: number;
  banned_ips: number;
}

export function ceoOverview(): Promise<CEOOverview> {
  return _fetch("/api/ceo/overview");
}

export function itSystem(): Promise<ITSystem> {
  return _fetch("/api/it/system");
}

// ─── Dollar / forex card ─────────────────────────────────

export interface ForexCard {
  has_card: boolean;
  masked_number?: string;
  usd_balance?: number;
  npr_equivalent?: number;
  rate: number;
}

export function forexCard(): Promise<ForexCard> {
  return _fetch("/api/customer/forex/card");
}

export function forexIssue(account_number: string): Promise<{ status: string; masked_number: string }> {
  return _fetch("/api/customer/forex/issue", { method: "POST", body: JSON.stringify({ account_number }) });
}

export function forexLoad(account_number: string, usd_amount: number): Promise<{ usd_card_balance: number; npr_account_balance: number; npr_amount: number }> {
  return _fetch("/api/customer/forex/load", { method: "POST", body: JSON.stringify({ account_number, usd_amount }) });
}

export function forexUnload(account_number: string, usd_amount: number): Promise<{ usd_card_balance: number; npr_account_balance: number; npr_amount: number }> {
  return _fetch("/api/customer/forex/unload", { method: "POST", body: JSON.stringify({ account_number, usd_amount }) });
}

// ─── Card controls + notifications ───────────────────────

export interface CardControls {
  pin_set: boolean;
  online: boolean;
  pos: boolean;
  atm: boolean;
}

export function cardControls(card_id: string): Promise<CardControls> {
  return _fetch(`/api/customer/card/controls?card_id=${encodeURIComponent(card_id)}`);
}

export function setCardPIN(card_id: string, pin: string): Promise<{ status: string }> {
  return _fetch("/api/customer/card/pin", { method: "POST", body: JSON.stringify({ card_id, pin }) });
}

export function setCardChannel(card_id: string, channel: "online" | "pos" | "atm", enabled: boolean): Promise<{ status: string }> {
  return _fetch("/api/customer/card/channel", { method: "POST", body: JSON.stringify({ card_id, channel, enabled }) });
}

export interface CardPurchaseResult {
  status: string;
  reference_number: string;
  amount: number;
  merchant: string;
  balance_after: number;
}

export function cardPurchase(card_id: string, pin: string, amount: number, merchant: string, channel: "pos" | "atm" = "pos"): Promise<CardPurchaseResult> {
  return _fetch("/api/customer/card/purchase", { method: "POST", body: JSON.stringify({ card_id, pin, amount, merchant, channel }) });
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
}

export function listNotifications(): Promise<{ notifications: Notification[]; unread: number }> {
  return _fetch("/api/customer/notifications");
}

export function markNotificationsRead(): Promise<{ status: string }> {
  return _fetch("/api/customer/notifications/read", { method: "POST" });
}

// ─── FL Convergence ──────────────────────────────────────

export interface ConvergenceRound {
  round: number;
  fl_accuracy: number;
  fl_loss: number;
  central_accuracy: number;
  central_loss: number;
  dp_accuracy: number;
  dp_loss: number;
  byzantine_active: boolean;
  byzantine_impact: number;
}

export interface ConvergenceResult {
  rounds: ConvergenceRound[];
  final_fl_accuracy: number;
  final_central_accuracy: number;
  privacy_cost: number;
  byzantine_rounds: number[];
  convergence_round: number;
}

export function hqConvergence(): Promise<ConvergenceResult> {
  return _fetch("/api/hq/convergence");
}

// ─── Model Drift Monitor ─────────────────────────────────

export interface BranchDriftData {
  branch: string;
  branch_type: string;
  drift_scores: number[];
  current_drift: number;
  status: string;
  trend: string;
}

export interface ModelDriftResult {
  branches: BranchDriftData[];
  alert_threshold: number;
  warn_threshold: number;
  rounds_tracked: number;
  alert_count: number;
  checked_at: string;
}

export function hqModelDrift(): Promise<ModelDriftResult> {
  return _fetch("/api/hq/model_drift");
}

// ─── Loan Apply ──────────────────────────────────────────

export interface LoanApplyPayload {
  loan_purpose: string;
  loan_amount: number;
  tenure_months: number;
  collateral_type: string;
  collateral_value: number;
  monthly_income: number;
  notes: string;
}

export interface LoanApplyResult {
  reference: string;
  status: string;
  decision_note: string;
  credit_score_used: number;
  loan_amount: number;
  loan_purpose: string;
  tenure_months: number;
  emi_estimate: number;
  ltv_ratio: number;
  submitted_at: string;
  estimated_decision: string;
  rejection_reason?: { feature: string; impact: string; improvement: string }[];
}

export function customerLoanApply(payload: LoanApplyPayload): Promise<LoanApplyResult> {
  return _fetch("/api/customer/loan_apply", { method: "POST", body: JSON.stringify(payload) });
}

export interface LoanRecord {
  reference: string;
  purpose: string;
  amount: number;
  status: string;
  applied_date: string;
  emi: number;
}

export interface LoanHistoryResult {
  loans: LoanRecord[];
  customer_id: string;
}

export function customerLoanHistory(): Promise<LoanHistoryResult> {
  return _fetch("/api/customer/loan_history");
}

// ─── Network Topology ────────────────────────────────────

export interface TopologyNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  participation: number;
  drift_score: number;
  byzantine: boolean;
  active_round: boolean;
}

export interface TopologyEdge {
  source: string;
  target: string;
  round: number;
  weight: number;
}

export interface NetworkTopologyResult {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  current_round: number;
  hq_node: string;
}

export function hqNetworkTopology(): Promise<NetworkTopologyResult> {
  return _fetch("/api/hq/network_topology");
}

// ─── Homomorphic Encryption Demo ─────────────────────────

export interface HEStep {
  phase: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
}

export interface HEDemoResult {
  steps: HEStep[];
  scheme: string;
  security_level: number;
  performance_overhead: string;
  privacy_guarantee: string;
}

export function hqHEDemo(): Promise<HEDemoResult> {
  return _fetch("/api/hq/he_demo");
}

// ─── KYC Face Verify ─────────────────────────────────────
export interface KYCFaceVerifyPayload {
  profile_photo: string;   // base64 — fresh selfie
  id_photo: string;        // base64 — uploaded ID document
  live_photos: string[];   // base64 array — liveness frames
}

export interface KYCFaceVerifyResult {
  profile_live_score: number;
  profile_id_score: number;
  verified: boolean;
  verdict: string;
  face_found_profile: boolean;
  face_found_id: boolean;
  live_faces_found: number;
  live_threshold?: number;
  id_threshold?: number;
  error?: string;
  detail?: string;
}

export function customerKYCFaceVerify(payload: KYCFaceVerifyPayload): Promise<KYCFaceVerifyResult> {
  return _fetch("/api/customer/kyc_face_verify", { method: "POST", body: JSON.stringify(payload) });
}

// ─── KYC AI Verify ───────────────────────────────────────

export interface KYCAIVerifyPayload {
  document_photo: string;
  live_photos: string[];
  signature_data: string;
  liveness_steps: string[];
  session_seconds?: number;
  interact_events?: number;
}

export interface KYCAIVerifyResult {
  customer_id: string;
  verified: boolean;
  verdict: string;
  face_match_score: number;
  liveness_passed: boolean;
  signature_match: number;
  liveness_steps_completed: number;
  confidence_breakdown: {
    biometric_check: number;
    liveness_check: number;
    signature_check: number;
    overall: number;
  };
  reference: string;
  verified_at: string;
}

export function customerKYCAIVerify(payload: KYCAIVerifyPayload): Promise<KYCAIVerifyResult> {
  return _fetch("/api/customer/kyc_ai_verify", { method: "POST", body: JSON.stringify(payload) });
}

// ─── KYC Applications (Branch Manager) ───────────────────

export interface KYCAppRecord {
  id: number;
  reference: string;
  customer_id: string;
  full_name: string;
  branch_id: string;
  status: string;
  ai_verified: boolean;
  face_profile_live: number;
  face_profile_id: number;
  liveness_passed: boolean;
  sig_match: number;
  loan_amount: number;
  loan_purpose: string;
  phone: string;
  submitted_at: string;
  review_note: string;
}

export interface KYCApplicationsResult {
  applications: KYCAppRecord[];
  total: number;
  branch_id: string;
}

export function branchKYCApplications(): Promise<KYCApplicationsResult> {
  return _fetch("/api/branch/kyc_applications");
}

export function branchKYCReview(id: number, action: "approve" | "reject", note: string): Promise<{ id: number; status: string }> {
  return _fetch(`/api/branch/kyc_review/${id}`, { method: "POST", body: JSON.stringify({ action, note }) });
}

export function customerKYCUpdateAI(payload: {
  reference: string;
  ai_verified: boolean;
  face_profile_live: number;
  face_profile_id: number;
  liveness_passed: boolean;
  sig_match_score: number;
  // legacy
  face_match_score?: number;
}): Promise<{ reference: string; updated: boolean }> {
  return _fetch("/api/customer/kyc_update_ai", { method: "POST", body: JSON.stringify(payload) });
}

// ─── Financial Health Score ──────────────────────────────
export interface HealthComponent { name: string; score: number; weight: number; status: string; tip: string; }
export interface HealthScoreResult { customer_id: string; overall_score: number; grade: string; components: HealthComponent[]; generated_at: string; }
export function customerHealthScore(): Promise<HealthScoreResult> { return _fetch("/api/customer/health_score"); }

// ─── Loan Eligibility ────────────────────────────────────
export interface LoanProduct { name: string; eligible: boolean; reason: string; max_amount: number; min_rate: number; max_tenure_months: number; min_score: number; }
export interface LoanEligibilityResult { customer_id: string; credit_score_pct: number; requested_amount: number; products: LoanProduct[]; eligible_count: number; checked_at: string; }
export function customerLoanEligibility(amount?: number): Promise<LoanEligibilityResult> { return _fetch(`/api/customer/loan_eligibility${amount ? `?amount=${amount}` : ""}`); }

// ─── Spending Analytics ──────────────────────────────────
export interface SpendingCategory { name: string; amount: number; percent: number; trend: string; monthly: number[]; }
export interface SpendingResult { customer_id: string; total_monthly_avg: number; categories: SpendingCategory[]; monthly_totals: number[]; months: string[]; top_category: string; period: string; source?: string; }
export function customerSpendingAnalytics(): Promise<SpendingResult> { return _fetch("/api/customer/spending_analytics"); }

// ─── Branch PAR ──────────────────────────────────────────
export interface PARMetric { period: number; portfolio_at_risk: number; amount_at_risk: number; loan_count: number; nrb_benchmark: number; status: string; }
export interface PARTrend { Month: string; PAR30: number; PAR60: number; PAR90: number; }
export interface PARResult { branch_id: string; total_portfolio_npr: number; par_metrics: PARMetric[]; monthly_trend: PARTrend[]; by_loan_type: { Type: string; PAR: number; Amount: number }[]; as_of: string; }
export function branchPAR(): Promise<PARResult> { return _fetch("/api/branch/par"); }

// ─── SAR Generator ──────────────────────────────────────
export interface SARResult { sar_number: string; report_date: string; branch_id: string; reporting_officer: string; subject: { customer_id: string; risk_score: number; risk_grade: string }; suspicious_transactions: { date: string; amount: number; type: string; flag: string }[]; total_suspicious_amount: number; detection_method: string; indicators: string[]; ml_confidence: number; recommended_action: string; nrb_reporting_required: boolean; regulatory_ref: string; }
export function branchGenerateSAR(customerId: string): Promise<SARResult> { return _fetch("/api/branch/generate_sar", { method: "POST", body: JSON.stringify({ customer_id: customerId }) }); }

// ─── Branch Leaderboard ──────────────────────────────────
export interface LeaderboardBranch { rank: number; branch: string; branch_type: string; overall_score: number; fl_participation: number; model_accuracy: number; approval_rate: number; default_rate: number; customer_growth: number; trend: string; badge: string; }
export interface BranchLeaderboardResult { branches: LeaderboardBranch[]; total: number; as_of: string; }
export function hqBranchLeaderboard(): Promise<BranchLeaderboardResult> { return _fetch("/api/hq/branch_leaderboard"); }

// ─── Branch Explainability ───────────────────────────────
export interface FeatureWeightData { feature: string; global: number; branches: Record<string, number>; max_deviation: number; }
export interface ExplainabilityInsight { Branch: string; Feature: string; Direction: string; Multiplier: number; Reason: string; }
export interface BranchExplainabilityResult { features: FeatureWeightData[]; branches: string[]; insights: ExplainabilityInsight[]; global_model: string; }
export function hqBranchExplainability(): Promise<BranchExplainabilityResult> { return _fetch("/api/hq/branch_explainability"); }

// ─── Split Learning ──────────────────────────────────────
export interface SplitLayerInfo { id: number; name: string; owner: string; neurons: number; activation: string; }
export interface SplitComparisonRow { metric: string; fl: string; sl: string; winner: string; }
export interface SplitConvergencePoint { Round: number; FLAccuracy: number; SLAccuracy: number; }
export interface SplitLearningResult { architecture: SplitLayerInfo[]; cut_layer: number; comparison: SplitComparisonRow[]; convergence: SplitConvergencePoint[]; split_description: string; }
export function hqSplitLearning(): Promise<SplitLearningResult> { return _fetch("/api/hq/split_learning"); }

// ─── ZKP Demo ───────────────────────────────────────────
export interface ZKPStep { phase: string; title: string; description: string; data: Record<string, unknown>; actor: string; }
export interface ZKPDemoResult { customer_id: string; claim: string; claim_valid: boolean; threshold: number; steps: ZKPStep[]; protocol: string; privacy_guarantee: string; soundness: string; }
export function hqZKPDemo(threshold?: number): Promise<ZKPDemoResult> { return _fetch(`/api/hq/zkp_demo${threshold ? `?threshold=${threshold}` : ""}`); }

// ─── Fraud Stream ────────────────────────────────────────
export function subscribeFraudStream(onEvent: (evt: { id: number; customer_id: string; amount: number; merchant: string; risk_score: number; flagged: boolean; rule: string; top_feature: string; timestamp: string; historical: boolean }) => void): () => void {
  const token = getToken();
  const es = new EventSource(`${BFF_URL}/api/branch/fraud_stream${token ? `?token=${token}` : ""}`);
  es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { } };
  return () => es.close();
}

// ─── FL Simulator ─────────────────────────────────────────
export interface FLSimulateRequest {
  branches: number;
  byzantine: number;
  dp_epsilon: number;
  learning_rate: number;
  rounds: number;
}
export interface FLSimulateRoundPoint {
  round: string;
  Federated: number;
  Centralised: number;
  "FL + DP": number;
  byzantine_active: boolean;
}
export interface FLSimulateResult {
  branches: number;
  byzantine: number;
  dp_epsilon: number;
  learning_rate: number;
  rounds: number;
  data: FLSimulateRoundPoint[];
  final_federated_accuracy: number;
  final_dp_accuracy: number;
  final_centralised_accuracy: number;
  vs_centralised_delta: number;
  healthy_branches: number;
  algorithm: { byzantine_detection: string; dp_mechanism: string };
}
export function hqFLSimulate(req: FLSimulateRequest): Promise<FLSimulateResult> {
  return _fetch<FLSimulateResult>("/api/hq/fl_simulate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
