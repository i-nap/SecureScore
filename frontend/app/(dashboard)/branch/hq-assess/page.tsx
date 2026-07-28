"use client";

import { useState } from "react";
import { branchHQAssess, type HQAssessRequest, type HQAssessResult } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  Fingerprint, Building2, CheckCircle2, AlertTriangle, Info,
  ChevronRight, Zap, Shield, Globe, TrendingUp, Star, Copy, Check,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from "recharts";

// ─── Grade config ─────────────────────────────────────────────────────────────

const GRADE_CFG: Record<string, {
  label: string; bg: string; text: string; border: string; bar: string; ring: string;
}> = {
  A: { label: "Prime",         bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-200", bar: "bg-emerald-500", ring: "ring-emerald-400" },
  B: { label: "Good",          bg: "bg-teal-soft",     text: "text-teal-deep",    border: "border-blue-200",    bar: "bg-blue-500",    ring: "ring-blue-400" },
  C: { label: "Standard",      bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200",   bar: "bg-amber-500",   ring: "ring-amber-400" },
  D: { label: "Elevated Risk", bg: "bg-orange-50",   text: "text-orange-700",  border: "border-orange-200",  bar: "bg-orange-500",  ring: "ring-orange-400" },
  F: { label: "High Risk",     bg: "bg-red-50",      text: "text-red-700",     border: "border-red-200",     bar: "bg-red-500",     ring: "ring-red-400" },
};

const LOAN_TYPES = [
  { value: "home_loan",     label: "Home Loan",      rate: "7.5–11%" },
  { value: "business_loan", label: "Business Loan",  rate: "10.5–14.5%" },
  { value: "personal_loan", label: "Personal Loan",  rate: "13.5–18.5%" },
  { value: "agricultural",  label: "Agricultural",   rate: "7–9.5%" },
  { value: "microfinance",  label: "Microfinance",   rate: "17–22%" },
];

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

function Num({ value, onChange, min, max, step, prefix }: {
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
        type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full rounded-xl border border-line bg-canvas py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition ${prefix ? "pl-10 pr-3" : "px-3"}`}
      />
    </div>
  );
}

function DimBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-ink-soft font-medium">{label}</span>
        <span className="text-ink-soft font-semibold">{value.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function SliderField({ label, hint, value, onChange, min, max, step, format }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <Field label={label} hint={hint ?? (format ? format(value) : String(value))}>
      <div className="relative pt-1">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 appearance-none rounded-full bg-gray-200 accent-indigo-500 cursor-pointer"
        />
        <div
          className="absolute left-0 top-1 h-1.5 bg-indigo-400 rounded-full pointer-events-none transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Field>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const DEFAULT_APPLICANT = {
  loan_amount: 500_000,
  loan_tenure_months: 60,
  monthly_income: 60_000,
  dti: 0.35,
  cibil_score: 650,
  credit_utilization: 0.30,
  num_existing_loans: 1,
  collateral_value: 0,
  has_guarantor: false,
  digital_engagement: 60,
  spending_consistency: 65,
};

const DEFAULT_PARAMS = {
  loan_type: "personal_loan",
  max_dti: 0.45,
  collateral_weight: 0.5,
  regional_risk_factor: 1.0,
  min_cibil: 550,
  require_guarantor_above: 0.60,
  prioritize_digital: false,
  custom_label: "",
};

export default function HQAssessPage() {
  const [applicant, setApplicant] = useState(DEFAULT_APPLICANT);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [result, setResult] = useState<HQAssessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const setA = (k: keyof typeof DEFAULT_APPLICANT) => (v: unknown) =>
    setApplicant((p) => ({ ...p, [k]: v }));
  const setP = (k: keyof typeof DEFAULT_PARAMS) => (v: unknown) =>
    setParams((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const req: HQAssessRequest = { applicant, ...params };
      setResult(await branchHQAssess(req));
    } catch (e: unknown) {
      const msg = (e as Error).message;
      try { setError(JSON.parse(msg)?.detail ?? msg); } catch { setError(msg); }
    } finally {
      setLoading(false);
    }
  };

  const copyFingerprint = () => {
    if (result) {
      navigator.clipboard.writeText(result.fingerprint_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hqCfg   = result ? (GRADE_CFG[result.hq_grade?.toUpperCase()]            ?? GRADE_CFG["C"]) : null;
  const brCfg   = result ? (GRADE_CFG[result.branch_adjusted_grade?.toUpperCase()] ?? GRADE_CFG["C"]) : null;
  const defPct  = result ? Math.round(result.default_probability * 100) : 0;
  const confPct = result ? Math.round(result.confidence * 100) : 0;

  const radarData = result ? [
    { subject: "Credit",     A: result.risk_dimensions.credit_quality },
    { subject: "DTI",        A: result.risk_dimensions.dti_health },
    { subject: "Collateral", A: result.risk_dimensions.collateral },
    { subject: "Digital",    A: result.risk_dimensions.digital_trust },
    { subject: "Regional",   A: result.risk_dimensions.regional_adjust },
  ] : [];

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero banner ───────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(ellipse at 80% 20%, white 0%, transparent 60%)",
        }} />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-white/15 rounded-xl backdrop-blur-sm">
                <Fingerprint size={20} />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight">HQ Unified Assessment</h1>
                <p className="text-blue-200 text-xs mt-0.5">Global model · Branch-tuned · Zero branch compute</p>
              </div>
            </div>
            <p className="text-sm text-white/75 max-w-lg leading-relaxed">
              The Head Office runs its federated model — trained on <strong className="text-white">all branch data</strong> —
              with your branch-specific parameters. Your device sends the request; HQ does all the heavy lifting and returns
              a signed fingerprint.
            </p>
          </div>
          <div className="shrink-0 text-right hidden md:block">
            <div className="flex items-center gap-1.5 bg-white/15 rounded-xl px-3 py-2 backdrop-blur-sm">
              <Building2 size={14} className="text-blue-200" />
              <span className="text-xs font-semibold text-white">HQ ← Branch</span>
            </div>
            <p className="text-[11px] text-blue-300 mt-1.5">Compute offloaded to HQ</p>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3">
          {[
            { icon: <Globe size={13} />, label: "Model Source",    value: "Global HQ Model" },
            { icon: <Zap size={13} />,   label: "Branch Compute",  value: "None (HQ only)" },
            { icon: <Shield size={13} />,label: "Compliance",       value: "NRB-compliant" },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-blue-200 mb-1">{s.icon}<span className="text-[10px]">{s.label}</span></div>
              <p className="text-sm font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Left col: inputs ─────────────────────────────── */}
        <div className="xl:col-span-2 space-y-5">

          {/* Applicant data */}
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-4">Applicant Data</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Loan Amount" hint="NPR">
                  <Num value={applicant.loan_amount} onChange={setA("loan_amount")} min={10_000} step={10_000} prefix="NPR" />
                </Field>
                <Field label="Tenure" hint="months">
                  <Num value={applicant.loan_tenure_months} onChange={setA("loan_tenure_months")} min={6} max={240} />
                </Field>
              </div>
              <Field label="Monthly Income" hint="NPR">
                <Num value={applicant.monthly_income} onChange={setA("monthly_income")} min={5_000} step={5_000} prefix="NPR" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CIBIL Score" hint="300–900">
                  <Num value={applicant.cibil_score} onChange={setA("cibil_score")} min={300} max={900} />
                </Field>
                <Field label="Existing Loans">
                  <Num value={applicant.num_existing_loans} onChange={setA("num_existing_loans")} min={0} max={10} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="DTI Ratio" hint="0–1">
                  <Num value={applicant.dti} onChange={setA("dti")} min={0} max={1} step={0.01} />
                </Field>
                <Field label="Credit Utilization" hint="0–1">
                  <Num value={applicant.credit_utilization} onChange={setA("credit_utilization")} min={0} max={1} step={0.01} />
                </Field>
              </div>
              <Field label="Collateral Value" hint="NPR">
                <Num value={applicant.collateral_value} onChange={setA("collateral_value")} min={0} step={50_000} prefix="NPR" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Digital Engagement" hint="0–100">
                  <Num value={applicant.digital_engagement} onChange={setA("digital_engagement")} min={0} max={100} />
                </Field>
                <Field label="Spending Consistency" hint="0–100">
                  <Num value={applicant.spending_consistency} onChange={setA("spending_consistency")} min={0} max={100} />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Has Guarantor</p>
                  <p className="text-xs text-ink-faint">Reduces default risk</p>
                </div>
                <button
                  onClick={() => setA("has_guarantor")(!applicant.has_guarantor)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${applicant.has_guarantor ? "bg-indigo-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${applicant.has_guarantor ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Branch params */}
          <div className="rounded-2xl border border-teal/20 bg-teal-soft/40 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Star size={13} className="text-indigo-500" />
              <p className="text-[11px] font-bold text-teal uppercase tracking-widest">Branch Parameters</p>
              <span className="text-[10px] bg-indigo-100 text-teal rounded-full px-2 py-0.5 font-semibold ml-auto">Your Policy</span>
            </div>
            <div className="space-y-4">
              <Field label="Loan Type Focus">
                <select
                  value={params.loan_type}
                  onChange={(e) => setP("loan_type")(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {LOAN_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>{lt.label} ({lt.rate})</option>
                  ))}
                </select>
              </Field>

              <SliderField
                label="Max DTI Threshold" hint={`${(params.max_dti * 100).toFixed(0)}%`}
                value={params.max_dti} onChange={setP("max_dti")} min={0.2} max={0.8} step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
              />

              <SliderField
                label="Collateral Weight" hint={params.collateral_weight.toFixed(1)}
                value={params.collateral_weight} onChange={setP("collateral_weight")} min={0} max={1} step={0.1}
                format={(v) => v.toFixed(1)}
              />

              <SliderField
                label="Regional Risk Factor" hint={`×${params.regional_risk_factor.toFixed(2)}`}
                value={params.regional_risk_factor} onChange={setP("regional_risk_factor")} min={0.8} max={1.5} step={0.05}
                format={(v) => `×${v.toFixed(2)}`}
              />

              <Field label="Minimum CIBIL" hint={String(params.min_cibil)}>
                <Num value={params.min_cibil} onChange={setP("min_cibil")} min={300} max={800} step={10} />
              </Field>

              <div className="flex items-center justify-between rounded-xl border border-teal/20 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Boost Digital-Active</p>
                  <p className="text-xs text-ink-faint">Prefer customers with high digital engagement</p>
                </div>
                <button
                  onClick={() => setP("prioritize_digital")(!params.prioritize_digital)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${params.prioritize_digital ? "bg-indigo-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${params.prioritize_digital ? "translate-x-5" : ""}`} />
                </button>
              </div>

              <Field label="Branch Note (optional)">
                <input
                  type="text" value={params.custom_label} maxLength={80}
                  onChange={(e) => setP("custom_label")(e.target.value)}
                  placeholder="e.g. Priority rural agriculture applicant"
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </Field>
            </div>
          </div>

          <button
            onClick={submit} disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-teal hover:bg-teal-deep active:bg-teal-deep text-white font-bold py-4 text-sm transition shadow-lg disabled:opacity-60"
          >
            {loading ? <Spinner size="sm" /> : (
              <>
                <Fingerprint size={16} />
                Request HQ Fingerprint
                <ChevronRight size={16} className="ml-auto" />
              </>
            )}
          </button>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* ── Right col: result ─────────────────────────────── */}
        <div className="xl:col-span-3 space-y-5">

          {!result && !loading && (
            <div className="rounded-2xl border-2 border-dashed border-line bg-white flex flex-col items-center justify-center text-center p-14 h-full min-h-[340px]">
              <div className="w-16 h-16 rounded-2xl bg-teal-soft flex items-center justify-center mb-4">
                <Fingerprint size={32} className="text-indigo-300" />
              </div>
              <p className="text-sm font-bold text-ink-soft">No fingerprint yet</p>
              <p className="text-xs text-ink-faint mt-1 max-w-sm leading-relaxed">
                Set your branch parameters and applicant data, then click
                <strong> Request HQ Fingerprint</strong>. HQ will run its global
                federated model and return a signed assessment.
              </p>
            </div>
          )}

          {result && hqCfg && brCfg && (
            <>
              {/* Fingerprint ID header */}
              <div className="rounded-2xl bg-gradient-to-r from-[#0c1626] to-[#11203A] text-white p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-ink-faint uppercase tracking-widest font-bold">HQ Fingerprint</p>
                  <p className="text-xl font-black font-mono tracking-widest mt-0.5">{result.fingerprint_id}</p>
                  <p className="text-[11px] text-ink-faint mt-1">
                    v{result.hq_model_version} · {result.global_customers_trained_on.toLocaleString()} global customers ·{" "}
                    {new Date(result.fingerprint_timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={copyFingerprint}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  title="Copy fingerprint ID"
                >
                  {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
              </div>

              {/* HQ vs Branch grade comparison */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`rounded-2xl border ${hqCfg.border} ${hqCfg.bg} p-5`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={13} className={hqCfg.text} />
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${hqCfg.text}`}>HQ Global Grade</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-4xl font-black w-16 h-16 flex items-center justify-center rounded-2xl ring-4 ${hqCfg.ring} ${hqCfg.text}`}>
                      {result.hq_grade}
                    </div>
                    <div>
                      <p className={`font-bold ${hqCfg.text}`}>{hqCfg.label}</p>
                      <p className="text-xs text-ink-soft mt-0.5">Pure global model</p>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border ${brCfg.border} ${brCfg.bg} p-5`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Star size={13} className={brCfg.text} />
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${brCfg.text}`}>Branch-Adjusted Grade</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-4xl font-black w-16 h-16 flex items-center justify-center rounded-2xl ring-4 ${brCfg.ring} ${brCfg.text}`}>
                      {result.branch_adjusted_grade}
                    </div>
                    <div>
                      <p className={`font-bold ${brCfg.text}`}>{brCfg.label}</p>
                      <p className="text-xs text-ink-soft mt-0.5">Your params applied</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key metrics row */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl border border-line bg-white shadow-sm p-4 text-center">
                  <p className="text-[10px] text-ink-faint font-bold uppercase tracking-wider">Default Risk</p>
                  <p className={`text-3xl font-black mt-1 ${defPct >= 50 ? "text-red-600" : defPct >= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                    {defPct}%
                  </p>
                </div>
                <div className="rounded-2xl border border-line bg-white shadow-sm p-4 text-center">
                  <p className="text-[10px] text-ink-faint font-bold uppercase tracking-wider">Rate</p>
                  <p className="text-3xl font-black mt-1 text-teal-deep">{result.branch_recommended_rate}%</p>
                  <p className="text-[10px] text-ink-faint">p.a.</p>
                </div>
                <div className="rounded-2xl border border-line bg-white shadow-sm p-4 text-center">
                  <p className="text-[10px] text-ink-faint font-bold uppercase tracking-wider">Confidence</p>
                  <p className={`text-3xl font-black mt-1 ${confPct >= 70 ? "text-emerald-600" : "text-amber-600"}`}>{confPct}%</p>
                </div>
              </div>

              {/* Max loan */}
              <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Max Approved Loan</p>
                    <p className="text-3xl font-black text-ink mt-1">
                      {result.max_approved_loan_npr >= 1_000_000
                        ? `${(result.max_approved_loan_npr / 1_000_000).toFixed(2)}M`
                        : result.max_approved_loan_npr > 0
                        ? `${(result.max_approved_loan_npr / 1_000).toFixed(0)}K`
                        : "Not Eligible"}
                      {result.max_approved_loan_npr > 0 && <span className="text-sm font-semibold text-ink-faint ml-1">NPR</span>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {result.nrb_compliant && (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 rounded-full px-2.5 py-1 font-semibold border border-emerald-200">
                        <CheckCircle2 size={11} />NRB Compliant
                      </span>
                    )}
                    {result.requires_guarantor && (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 rounded-full px-2.5 py-1 font-semibold border border-amber-200">
                        <AlertTriangle size={11} />Guarantor Required
                      </span>
                    )}
                  </div>
                </div>
                {result.eligible_products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {result.eligible_products.map((p) => (
                      <span key={p} className="text-[11px] bg-teal-soft text-teal-deep rounded-full px-2.5 py-1 font-medium border border-teal/20">
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Radar + Risk dimensions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                  <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-2">Risk Dimensions</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={65}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#6b7280" }} />
                      <Radar name="Score" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                  <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-3">Dimension Scores</p>
                  <div className="space-y-3">
                    <DimBar label="Credit Quality"  value={result.risk_dimensions.credit_quality}  color="bg-blue-500" />
                    <DimBar label="DTI Health"      value={result.risk_dimensions.dti_health}      color="bg-indigo-500" />
                    <DimBar label="Collateral"      value={result.risk_dimensions.collateral}      color="bg-emerald-500" />
                    <DimBar label="Digital Trust"   value={result.risk_dimensions.digital_trust}   color="bg-violet-500" />
                    <DimBar label="Regional Adjust" value={result.risk_dimensions.regional_adjust} color="bg-amber-500" />
                  </div>
                </div>
              </div>

              {/* Decision explanation */}
              <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Info size={13} className="text-ink-faint" />
                  <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Decision Explanation</p>
                  <span className="text-[10px] bg-slate-100 text-ink-soft rounded-full px-2 py-0.5 font-medium ml-auto">
                    HQ Global Model v{result.hq_model_version}
                  </span>
                </div>
                <ul className="space-y-2">
                  {result.decision_explanation.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink">
                      <TrendingUp size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
