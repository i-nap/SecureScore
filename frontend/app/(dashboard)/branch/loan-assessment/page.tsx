"use client";

import { useState } from "react";
import {
  branchLoanDefault,
  branchHQAssess,
  branchVerifyBackground,
  type LoanApplicationRequest,
  type LoanRisk,
  type HQAssessResult,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui";
import { CreditCard, CheckCircle, AlertTriangle, Info, ChevronRight, Fingerprint } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";

// ─── constants ────────────────────────────────────────────────────────────────

const GRADE_CFG: Record<string, { label: string; bg: string; text: string; ring: string; bar: string; desc: string }> = {
  A: { label: "Prime Borrower",    bg: "bg-emerald-50",  text: "text-emerald-700", ring: "ring-emerald-400",  bar: "bg-emerald-500", desc: "Excellent creditworthiness. Eligible for best available rates." },
  B: { label: "Good Standing",     bg: "bg-teal-soft",     text: "text-teal-deep",    ring: "ring-blue-400",    bar: "bg-blue-500",    desc: "Strong credit profile with minor concerns." },
  C: { label: "Standard Risk",     bg: "bg-amber-50",    text: "text-amber-700",   ring: "ring-amber-400",   bar: "bg-amber-500",   desc: "Acceptable risk. Standard documentation required." },
  D: { label: "Elevated Risk",     bg: "bg-orange-50",   text: "text-orange-700",  ring: "ring-orange-400",  bar: "bg-orange-500",  desc: "Higher risk profile. Additional collateral recommended." },
  F: { label: "High Risk / Deny",  bg: "bg-red-50",      text: "text-red-700",     ring: "ring-red-400",     bar: "bg-red-500",     desc: "Significant default risk. Loan not recommended." },
};

const LOAN_TYPES = [
  { value: "home_loan",      label: "Home Loan",        rate: "8.5–12%" },
  { value: "business_loan",  label: "Business Loan",    rate: "11–14%" },
  { value: "personal_loan",  label: "Personal Loan",    rate: "14–18%" },
  { value: "microfinance",   label: "Microfinance",     rate: "18–22%" },
  { value: "agricultural",   label: "Agricultural",     rate: "7–9%" },
];

const EMP_TYPES = ["salaried", "self_employed", "business", "agriculture", "daily_wage"];

// ─── sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-3">{children}</p>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-ink-soft">{label}</label>
        {hint && <span className="text-[10px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step, prefix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; prefix?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full rounded-xl border border-line bg-canvas py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition ${prefix ? "pl-10 pr-3" : "px-3"}`}
      />
    </div>
  );
}

function RiskBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-ink-soft font-medium">{label}</span>
        <span className="text-ink-soft">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

function gradeToDecision(grade: string): string {
  if (grade === "A" || grade === "B") return "APPROVE";
  if (grade === "C" || grade === "D") return "MANUAL_REVIEW";
  return "REJECT";
}

export default function LoanAssessmentPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<LoanApplicationRequest>({
    loan_amount:         500_000,
    loan_tenure_months:  60,
    monthly_income:      60_000,
    dti:                 0.35,
    cibil_score:         650,
    credit_utilization:  0.30,
    num_existing_loans:  1,
    employment_type:     "salaried",
    collateral_value:    0,
    has_guarantor:       false,
    digital_engagement:  60,
    spending_consistency: 65,
  });

  const [loanType, setLoanType] = useState("personal_loan");

  const [result,  setResult]  = useState<LoanRisk | null>(null);
  const [hqResult, setHqResult] = useState<HQAssessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hqLoading, setHqLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [hqError, setHqError] = useState("");

  const set = (k: keyof LoanApplicationRequest) => (v: unknown) =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await branchLoanDefault(form));
    } catch (e: unknown) {
      const msg = (e as Error).message;
      try { setError(JSON.parse(msg)?.detail ?? msg); } catch { setError(msg); }
    } finally {
      setLoading(false);
    }
  };

  const submitHq = async () => {
    setHqLoading(true);
    setHqError("");
    setHqResult(null);
    try {
      const hq = await branchHQAssess({
        applicant: {
          ...form,
          credit_utilization: form.credit_utilization ?? 0.3,
          num_existing_loans: form.num_existing_loans ?? 0,
          collateral_value: form.collateral_value ?? 0,
          has_guarantor: form.has_guarantor ?? false,
          digital_engagement: form.digital_engagement ?? 50,
          spending_consistency: form.spending_consistency ?? 50,
        },
        loan_type: loanType,
        max_dti: 0.45,
        collateral_weight: 0.5,
        regional_risk_factor: 1.0,
        min_cibil: 550,
        require_guarantor_above: 0.6,
        prioritize_digital: false,
        custom_label: "Branch pre-screened",
      });
      setHqResult(hq);
      // Queue HQ background re-verification of this immediate branch decision.
      // Fire-and-forget; surfaced at /branch/background-verify.
      void branchVerifyBackground(
        { ...form, loan_type: loanType },
        {
          decision: gradeToDecision(hq.branch_adjusted_grade),
          percentile: Math.round((1 - hq.default_probability) * 100),
          interest_rate: hq.branch_recommended_rate,
        },
        user?.branch_id ?? "",
      ).catch(() => {});
    } catch (e: unknown) {
      const msg = (e as Error).message;
      try { setHqError(JSON.parse(msg)?.detail ?? msg); } catch { setHqError(msg); }
    } finally {
      setHqLoading(false);
    }
  };

  const grade = result?.risk_grade ?? null;
  const cfg   = grade ? GRADE_CFG[grade] : null;
  const defPct = result ? Math.round(result.default_probability * 100) : 0;

  // Radar data for risk profile
  const radarData = result ? [
    { subject: "Credit",     A: Math.round((1 - result.default_probability) * 100) },
    { subject: "CIBIL",      A: Math.round(((form.cibil_score - 300) / 600) * 100) },
    { subject: "Income",     A: Math.min(100, Math.round((form.monthly_income / 100_000) * 100)) },
    { subject: "Collateral", A: (form.collateral_value ?? 0) > 0 ? 80 : 20 },
    { subject: "DTI",        A: Math.round((1 - Math.min(form.dti, 1)) * 100) },
  ] : [];

  const hqRadarData = hqResult ? [
    { subject: "Credit",     A: hqResult.risk_dimensions.credit_quality },
    { subject: "DTI",        A: hqResult.risk_dimensions.dti_health },
    { subject: "Collateral", A: hqResult.risk_dimensions.collateral },
    { subject: "Digital",    A: hqResult.risk_dimensions.digital_trust },
    { subject: "Regional",   A: hqResult.risk_dimensions.regional_adjust },
  ] : [];

  const showHqPanel = hqLoading || Boolean(hqError) || Boolean(hqResult);

  return (
    <div className="space-y-6 pb-8">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-teal-soft text-teal rounded-xl">
            <CreditCard size={24} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Loan Default Assessment</h1>
            <p className="text-sm text-white/70 mt-0.5">
              XGBoost ML · NRB-compliant risk grades · SHAP explainability
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-white/15">
          {LOAN_TYPES.slice(0, 3).map((lt) => (
            <div key={lt.value} className="bg-white/10 rounded-xl px-3 py-2.5">
              <p className="text-xs text-white/60">{lt.label}</p>
              <p className="text-sm font-bold mt-0.5">{lt.rate} p.a.</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Left: form ────────────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <SectionLabel>Loan Details</SectionLabel>
            <div className="space-y-4">
              <FormField label="Loan Amount" hint="NPR">
                <NumInput value={form.loan_amount} onChange={set("loan_amount")} min={10_000} step={10_000} prefix="NPR" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Tenure" hint="months">
                  <NumInput value={form.loan_tenure_months} onChange={set("loan_tenure_months")} min={6} max={240} />
                </FormField>
                <FormField label="Employment Type">
                  <select
                    value={form.employment_type}
                    onChange={(e) => set("employment_type")(e.target.value)}
                    className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {EMP_TYPES.map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <FormField label="Loan Type" hint="NRB rate band">
                <select
                  value={loanType}
                  onChange={(e) => setLoanType(e.target.value)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {LOAN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <SectionLabel>Applicant Profile</SectionLabel>
            <div className="space-y-4">
              <FormField label="Monthly Income" hint="NPR">
                <NumInput value={form.monthly_income} onChange={set("monthly_income")} min={5_000} step={5_000} prefix="NPR" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="CIBIL Score" hint="300–900">
                  <NumInput value={form.cibil_score} onChange={set("cibil_score")} min={300} max={900} />
                </FormField>
                <FormField label="Existing Loans">
                  <NumInput value={form.num_existing_loans ?? 0} onChange={set("num_existing_loans")} min={0} max={10} />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="DTI Ratio" hint="0–1">
                  <NumInput value={form.dti} onChange={set("dti")} min={0} max={1} step={0.01} />
                </FormField>
                <FormField label="Credit Utilization" hint="0–1">
                  <NumInput value={form.credit_utilization ?? 0.3} onChange={set("credit_utilization")} min={0} max={1} step={0.01} />
                </FormField>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <SectionLabel>Security & Engagement</SectionLabel>
            <div className="space-y-4">
              <FormField label="Collateral Value" hint="NPR">
                <NumInput value={form.collateral_value ?? 0} onChange={set("collateral_value")} min={0} step={50_000} prefix="NPR" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Digital Engagement" hint="0–100">
                  <NumInput value={form.digital_engagement ?? 50} onChange={set("digital_engagement")} min={0} max={100} />
                </FormField>
                <FormField label="Spending Consistency" hint="0–100">
                  <NumInput value={form.spending_consistency ?? 50} onChange={set("spending_consistency")} min={0} max={100} />
                </FormField>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Has Guarantor</p>
                  <p className="text-xs text-ink-faint">Reduces risk significantly</p>
                </div>
                <button
                  onClick={() => set("has_guarantor")(!form.has_guarantor)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${form.has_guarantor ? "bg-blue-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.has_guarantor ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-teal hover:bg-teal-deep active:scale-[0.98] text-white font-bold py-4 text-sm transition shadow-sm disabled:opacity-60"
          >
            {loading ? <Spinner size="sm" /> : (
              <>Assess Default Risk <ChevronRight size={16} /></>
            )}
          </button>

          <button
            onClick={submitHq}
            disabled={hqLoading}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-teal-soft hover:bg-indigo-100 text-teal-deep font-bold py-3.5 text-sm transition disabled:opacity-60"
          >
            {hqLoading ? <Spinner size="sm" /> : (
              <>Generate HQ Fingerprint <Fingerprint size={16} /></>
            )}
          </button>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* ── Right: result ─────────────────────────────────────────── */}
        <div className="xl:col-span-3 space-y-5">
          {!result && !loading && !showHqPanel && (
            <div className="rounded-2xl border-2 border-dashed border-line bg-canvas flex flex-col items-center justify-center text-center p-12 h-full min-h-[300px]">
              <div className="p-4 bg-teal-soft rounded-2xl mb-4">
                <CreditCard size={28} className="text-blue-400" />
              </div>
              <p className="text-sm font-semibold text-ink-soft">No assessment yet</p>
              <p className="text-xs text-ink-faint mt-1 max-w-xs">
                Fill in the applicant details and click Assess Default Risk to generate an ML-powered report.
              </p>
            </div>
          )}

          {result && cfg && (
            <>
              {/* Grade hero */}
              <div className={`rounded-2xl ${cfg.bg} border border-line p-6`}>
                <div className="flex items-center gap-5">
                  <div className={`text-4xl font-black w-20 h-20 flex items-center justify-center rounded-2xl ring-4 ${cfg.ring} ${cfg.bg} ${cfg.text} shadow-inner`}>
                    {grade}
                  </div>
                  <div className="flex-1">
                    <p className={`text-lg font-extrabold ${cfg.text}`}>{cfg.label}</p>
                    <p className="text-sm text-ink-soft mt-1">{cfg.desc}</p>
                    <div className="flex items-center gap-2 mt-3">
                      {result.nrb_compliant && (
                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 rounded-full px-2.5 py-1 font-semibold border border-emerald-200">
                          <CheckCircle size={11} />NRB Compliant
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-ink-soft">Default Risk</p>
                    <p className={`text-3xl font-black mt-0.5 ${defPct >= 50 ? "text-red-600" : defPct >= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                      {defPct}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <RiskBar label="Default Probability" pct={defPct} color={cfg.bar} />
                  <RiskBar label="Repayment Confidence" pct={100 - defPct} color="bg-emerald-500" />
                </div>
              </div>

              {/* Rate & loan details */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                  <p className="text-xs font-bold text-ink-faint uppercase tracking-wider mb-3">Interest Rate</p>
                  <p className="text-3xl font-black text-teal-deep">{result.suggested_interest_rate}%</p>
                  <p className="text-xs text-ink-soft mt-1">Range: {result.rate_range[0]}–{result.rate_range[1]}% p.a.</p>
                  <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{
                        width: `${((result.suggested_interest_rate - result.rate_range[0]) / Math.max(result.rate_range[1] - result.rate_range[0], 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-ink-faint mt-1">
                    <span>{result.rate_range[0]}%</span>
                    <span>{result.rate_range[1]}%</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                  <p className="text-xs font-bold text-ink-faint uppercase tracking-wider mb-3">Max Loan</p>
                  <p className="text-2xl font-black text-ink leading-tight">
                    {result.recommended_max_loan_npr >= 1_000_000
                      ? `${(result.recommended_max_loan_npr / 1_000_000).toFixed(2)}M`
                      : `${(result.recommended_max_loan_npr / 1_000).toFixed(0)}K`}
                    <span className="text-sm font-semibold text-ink-faint ml-1">NPR</span>
                  </p>
                  <p className="text-xs text-ink-soft mt-2">Eligible products:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.eligible_loan_types.map((t) => (
                      <span key={t} className="text-[11px] bg-teal-soft text-teal-deep rounded-full px-2 py-0.5 font-medium border border-teal/20">
                        {t.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Radar + SHAP side-by-side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Radar */}
                <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                  <p className="text-xs font-bold text-ink-faint uppercase tracking-wider mb-2">Risk Profile Radar</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={70}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "#6b7280" }} />
                      <Radar name="Score" dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* SHAP factors */}
                {result.shap_factors?.length > 0 && (
                  <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Info size={12} className="text-ink-faint" />
                      <p className="text-xs font-bold text-ink-faint uppercase tracking-wider">Key Risk Factors</p>
                    </div>
                    <div className="space-y-3">
                      {result.shap_factors.map((f, i) => {
                        const sv    = f.shap_value ?? (f as { feature: string; shap_value?: number; value?: number }).value ?? 0;
                        const isRisk = sv > 0;
                        const pct   = Math.min(100, Math.abs(sv) * 200);
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium text-ink">{f.feature}</span>
                              <span className={`font-bold ${isRisk ? "text-red-500" : "text-emerald-600"}`}>
                                {isRisk ? "+" : ""}{sv.toFixed(4)}
                              </span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isRisk ? "bg-red-400" : "bg-emerald-400"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {showHqPanel && (
            <div className="rounded-2xl border border-teal/20 bg-white shadow-sm p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest">HQ Fingerprint</p>
                  <h3 className="text-lg font-bold text-ink mt-1">Unified Decision Report</h3>
                  <p className="text-xs text-ink-soft mt-1">Global model result with branch-adjusted policy</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-teal-soft flex items-center justify-center">
                  <Fingerprint size={18} className="text-indigo-500" />
                </div>
              </div>

              {hqError && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{hqError}</p>
                </div>
              )}

              {hqLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
                  <Spinner size="sm" />
                  <span>Generating HQ fingerprint...</span>
                </div>
              )}

              {!hqLoading && !hqResult ? (
                <div className="mt-5 rounded-xl border border-dashed border-line bg-canvas px-4 py-6 text-center text-sm text-ink-soft">
                  Generate a HQ fingerprint to get a signed, branch-adjusted decision report.
                </div>
              ) : (
                hqResult && (
                  <div className="mt-5 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-xl border border-line p-4">
                        <p className="text-xs text-ink-faint">HQ Grade</p>
                        <p className="text-xl font-bold text-ink mt-1">{hqResult.hq_grade}</p>
                        <p className="text-xs text-ink-soft mt-1">Model v{hqResult.hq_model_version}</p>
                      </div>
                      <div className="rounded-xl border border-line p-4">
                        <p className="text-xs text-ink-faint">Branch-Adjusted Grade</p>
                        <p className="text-xl font-bold text-ink mt-1">{hqResult.branch_adjusted_grade}</p>
                        <p className="text-xs text-ink-soft mt-1">Fingerprint {hqResult.fingerprint_id}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-line p-3">
                        <p className="text-[11px] text-ink-faint">Default Prob.</p>
                        <p className="text-lg font-bold text-ink">{Math.round(hqResult.default_probability * 100)}%</p>
                      </div>
                      <div className="rounded-xl border border-line p-3">
                        <p className="text-[11px] text-ink-faint">Recommended Rate</p>
                        <p className="text-lg font-bold text-ink">{hqResult.branch_recommended_rate}%</p>
                      </div>
                      <div className="rounded-xl border border-line p-3">
                        <p className="text-[11px] text-ink-faint">Max Approved</p>
                        <p className="text-lg font-bold text-ink">NPR {Math.round(hqResult.max_approved_loan_npr).toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <p className="text-xs font-semibold text-ink-soft mb-2">Risk Dimensions</p>
                        <div className="h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart data={hqRadarData} outerRadius={80}>
                              <PolarGrid stroke="#e5e7eb" />
                              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                              <Radar dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-soft mb-2">Decision Notes</p>
                        <ul className="space-y-2 text-sm text-ink-soft">
                          {hqResult.decision_explanation.slice(0, 5).map((line, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
