"use client";

import { useEffect, useState } from "react";
import { branchRateOptimize, type RateOptimizerResult } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { Percent, TrendingUp, AlertCircle, ShieldCheck, Info } from "lucide-react";

const LOAN_TYPES = [
  { value: "home_loan", label: "Home Loan", base: 9.0 },
  { value: "business_loan", label: "Business Loan", base: 12.0 },
  { value: "personal_loan", label: "Personal Loan", base: 16.0 },
  { value: "microfinance", label: "Microfinance", base: 20.0 },
  { value: "agricultural", label: "Agricultural", base: 8.0 },
];

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

function NumInput({ value, onChange, min, max, step, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 0.1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-line bg-canvas py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition px-3"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default function RateOptimizerPage() {
  const [loanType, setLoanType] = useState("personal_loan");
  const [riskGrade, setRiskGrade] = useState("C");
  const [marketRate, setMarketRate] = useState(14.5);
  const [policyFloor, setPolicyFloor] = useState(7.0);
  const [policyCeil, setPolicyCeil] = useState(22.0);
  const [dti, setDti] = useState(0.35);
  const [collateralCoverage, setCollateralCoverage] = useState(0.35);
  const [tenureMonths, setTenureMonths] = useState(60);
  const [digitalScore, setDigitalScore] = useState(60);
  const [priority, setPriority] = useState("balanced");
  const [rate, setRate] = useState<RateOptimizerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    branchRateOptimize({
      loan_type: loanType,
      risk_grade: riskGrade,
      market_rate: marketRate,
      policy_floor: policyFloor,
      policy_ceil: policyCeil,
      dti,
      collateral_coverage: collateralCoverage,
      tenure_months: tenureMonths,
      digital_score: digitalScore,
      priority: priority as "growth" | "balanced" | "margin",
    })
      .then((res) => {
        if (active) setRate(res);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loanType, riskGrade, marketRate, policyFloor, policyCeil, dti, collateralCoverage, tenureMonths, digitalScore, priority]);

  const range = Math.max(1, policyCeil - policyFloor);
  const pos = (v: number) => ((v - policyFloor) / range) * 100;
  const deltaLabel = rate
    ? (rate.delta_vs_market >= 0 ? `+${rate.delta_vs_market.toFixed(2)}%` : `${rate.delta_vs_market.toFixed(2)}%`)
    : "--";

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-lime-600 to-green-700 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Percent size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">Interest Rate Optimizer</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Branch Pricing Strategy</h1>
            <p className="mt-1 text-lime-100 text-sm">
              Bayesian style optimizer blending policy, market competition, and borrower risk.
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
              <ShieldCheck size={14} className="text-lime-100" />
              <span className="text-xs font-semibold text-white">Available</span>
            </div>
            <p className="text-[11px] text-lime-200 mt-1">Policy aligned pricing</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-4">Inputs</p>
            <div className="space-y-4">
              <Field label="Loan Type">
                <select
                  value={loanType}
                  onChange={(e) => setLoanType(e.target.value)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-lime-400"
                >
                  {LOAN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Risk Grade">
                  <select
                    value={riskGrade}
                    onChange={(e) => setRiskGrade(e.target.value)}
                    className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-lime-400"
                  >
                    {"ABCDF".split("").map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Market Rate" hint="%">
                  <NumInput value={marketRate} onChange={setMarketRate} min={5} max={30} step={0.1} suffix="%" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Policy Floor" hint="%">
                  <NumInput value={policyFloor} onChange={setPolicyFloor} min={0} max={20} step={0.1} suffix="%" />
                </Field>
                <Field label="Policy Ceiling" hint="%">
                  <NumInput value={policyCeil} onChange={setPolicyCeil} min={10} max={35} step={0.1} suffix="%" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="DTI Ratio" hint="0 to 1">
                  <NumInput value={dti} onChange={setDti} min={0} max={1} step={0.01} />
                </Field>
                <Field label="Collateral Coverage" hint="0 to 1">
                  <NumInput value={collateralCoverage} onChange={setCollateralCoverage} min={0} max={1} step={0.01} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tenure" hint="months">
                  <NumInput value={tenureMonths} onChange={setTenureMonths} min={6} max={240} step={6} />
                </Field>
                <Field label="Digital Score" hint="0 to 100">
                  <NumInput value={digitalScore} onChange={setDigitalScore} min={0} max={100} step={1} />
                </Field>
              </div>
              <Field label="Branch Priority">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-lime-400"
                >
                  <option value="growth">Growth</option>
                  <option value="balanced">Balanced</option>
                  <option value="margin">Margin</option>
                </select>
              </Field>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wider">Recommended Rate</p>
                <p className="text-3xl font-black text-ink mt-1">
                  {rate ? `${rate.recommended_rate.toFixed(2)}%` : "--"}
                </p>
                <p className="text-xs text-ink-soft mt-1">
                  Model baseline: {rate ? `${rate.model_rate.toFixed(2)}%` : "--"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink-faint">Market Delta</p>
                <p className="text-2xl font-bold text-lime-700">{deltaLabel}</p>
                <p className="text-[11px] text-ink-faint mt-0.5">vs market</p>
              </div>
            </div>

            {loading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
                <Spinner size="sm" /> Updating rates...
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600">{error}</div>
            )}

            <div className="mt-5 rounded-xl border border-line bg-canvas p-4">
              <div className="flex items-center justify-between text-xs text-ink-soft mb-3">
                <span>Policy Floor</span>
                <span>Policy Ceiling</span>
              </div>
              <div className="relative h-2 bg-white rounded-full border border-line">
                <div
                  className="absolute top-0 left-0 h-2 rounded-full bg-gradient-to-r from-lime-200 to-lime-400"
                  style={{ width: `${pos(rate?.band_high ?? policyFloor)}%` }}
                />
                {[
                  { label: "Floor", value: policyFloor, color: "bg-slate-500" },
                  { label: "Market", value: marketRate, color: "bg-amber-400" },
                  { label: "Recommended", value: rate?.recommended_rate ?? policyFloor, color: "bg-emerald-500" },
                  { label: "Ceiling", value: policyCeil, color: "bg-slate-500" },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{ left: `${pos(m.value)}%` }}
                  >
                    <span className={`block w-2.5 h-2.5 rounded-full ${m.color}`} />
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-soft">
                <div>
                  Band: {rate ? `${rate.band_low.toFixed(2)}% - ${rate.band_high.toFixed(2)}%` : "--"}
                </div>
                <div className="text-right">Policy: {policyFloor.toFixed(2)}% - {policyCeil.toFixed(2)}%</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              <Info size={16} className="text-lime-600" />
              <h2 className="text-sm font-semibold text-ink">Decision Notes</h2>
            </div>
            {(rate?.notes?.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-soft">No special adjustments detected.</p>
            ) : (
              <ul className="space-y-2 text-sm text-ink-soft">
                {(rate?.notes ?? []).map((n, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-lime-400" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-emerald-500" />
              <h2 className="text-sm font-semibold text-ink">Pricing Summary</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Base Rate</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {rate ? `${rate.base_rate.toFixed(2)}%` : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Recommended</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {rate ? `${rate.recommended_rate.toFixed(2)}%` : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Policy Status</p>
                <p className="text-lg font-bold text-emerald-600 mt-1">
                  <ShieldCheck size={16} className="inline mr-1" /> OK
                </p>
              </div>
            </div>
            <div className="mt-4 text-xs text-ink-soft">
              Market alignment reduces churn while keeping NRB compliance.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertCircle size={16} className="text-amber-600 mt-0.5" />
        This optimizer uses a demo heuristic. Plug in live policy inputs for production pricing.
      </div>
    </div>
  );
}
