"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  customerWhatIf,
  customerScoreExplanation,
  type WhatIfRequest,
  type WhatIfResult,
} from "@/lib/api";
import { Card, Badge, Spinner } from "@/components/ui";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 0.80) return "A";
  if (score >= 0.65) return "B";
  if (score >= 0.50) return "C";
  if (score >= 0.35) return "D";
  return "F";
}

function gradeVariant(grade: string): "success" | "warning" | "danger" | "default" {
  if (grade === "A" || grade === "B") return "success";
  if (grade === "C") return "warning";
  return "danger";
}

function gradeBg(grade: string): string {
  switch (grade) {
    case "A": return "#10b981";
    case "B": return "#3b82f6";
    case "C": return "#f59e0b";
    case "D": return "#f97316";
    default:  return "#ef4444";
  }
}

function friendlyDriver(name: string): string {
  const map: Record<string, string> = {
    annual_income: "Annual Income",
    debt_to_income: "Debt-to-Income Ratio",
    employment_months: "Employment Duration",
    credit_history_months: "Credit History",
    existing_loans: "Existing Loans",
    loan_amount_requested: "Loan Amount Requested",
    collateral_value: "Collateral Value",
    repayment_history_score: "Repayment Score",
  };
  return map[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── SVG Score Gauge ──────────────────────────────────────────

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const radius = 60;
  const stroke = 10;
  const cx = 80;
  const cy = 80;
  const arcLen = Math.PI * radius; // half-circle arc length
  const dashoffset = arcLen * (1 - score);
  const color = gradeBg(grade);

  return (
    <svg width="160" height="100" viewBox="0 0 160 100" aria-label={`Score gauge: ${(score * 100).toFixed(0)}%`}>
      {/* Background arc */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Foreground arc */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={arcLen}
        strokeDashoffset={dashoffset}
        style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease" }}
      />
      {/* Score text */}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="800" fill="#111827">
        {(score * 100).toFixed(0)}%
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize="12" fill="#6b7280">
        creditworthy
      </text>
    </svg>
  );
}

// ── Slider ───────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="font-semibold text-teal">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full bg-gray-200 accent-blue-600 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

const NPR = (v: number) =>
  v >= 100000 ? `NPR ${(v / 100000).toFixed(1)}L` : `NPR ${v.toLocaleString()}`;

// ── Page ─────────────────────────────────────────────────────

export default function WhatIfPage() {
  const { user } = useAuth();

  const [params, setParams] = useState<WhatIfRequest>({
    annual_income: 600000,
    debt_to_income: 0.35,
    employment_months: 36,
    existing_loans: 1,
    loan_amount_requested: 400000,
    collateral_value: 500000,
  });

  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load customer's real baseline score on mount
  useEffect(() => {
    customerScoreExplanation()
      .then((exp) => {
        // Pre-fill sliders from real feature values where available
        const fmap: Record<string, number> = {};
        for (const f of exp.features) fmap[f.name] = f.value;
        setParams((prev) => ({
          ...prev,
          annual_income: fmap.annual_income ?? prev.annual_income,
          debt_to_income: fmap.debt_to_income ?? prev.debt_to_income,
          employment_months: fmap.employment_months ?? prev.employment_months,
          existing_loans: fmap.existing_loans ?? prev.existing_loans,
          loan_amount_requested: fmap.loan_amount_requested ?? prev.loan_amount_requested,
          collateral_value: fmap.collateral_value ?? prev.collateral_value,
        }));
      })
      .catch(() => {/* ignore — just use defaults */})
      .finally(() => setInitializing(false));
  }, []);

  const runSimulation = useCallback((req: WhatIfRequest) => {
    setLoading(true);
    customerWhatIf(req)
      .then(setResult)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  // Debounced trigger on param change
  useEffect(() => {
    if (initializing) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSimulation(params), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [params, initializing, runSimulation]);

  const set = (key: keyof WhatIfRequest) => (v: number) =>
    setParams((prev) => ({ ...prev, [key]: v }));

  const grade = result ? result.grade : scoreToGrade(0.5);
  const scoreVal = result?.score ?? 0.5;
  const change = result?.change_from_baseline ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">What-If Simulator</h1>
        <p className="text-sm text-ink-soft mt-1">
          See how changes to your finances affect your credit score — updates live as you move the sliders.
        </p>
      </div>

      {initializing ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Left panel: sliders ── */}
          <Card className="lg:col-span-3 space-y-5">
            <h2 className="text-sm font-semibold text-ink">Adjust Your Financial Parameters</h2>

            <Slider
              label="Annual Income"
              value={params.annual_income}
              min={100000}
              max={5000000}
              step={50000}
              format={NPR}
              onChange={set("annual_income")}
            />
            <Slider
              label="Debt-to-Income Ratio"
              value={params.debt_to_income}
              min={0}
              max={0.8}
              step={0.01}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={set("debt_to_income")}
            />
            <Slider
              label="Employment Duration"
              value={params.employment_months}
              min={0}
              max={120}
              step={1}
              format={(v) => `${v} months`}
              onChange={set("employment_months")}
            />
            <Slider
              label="Existing Loans"
              value={params.existing_loans}
              min={0}
              max={10}
              step={1}
              format={(v) => `${v} loan${v !== 1 ? "s" : ""}`}
              onChange={set("existing_loans")}
            />
            <Slider
              label="Loan Amount Requested"
              value={params.loan_amount_requested}
              min={100000}
              max={5000000}
              step={50000}
              format={NPR}
              onChange={set("loan_amount_requested")}
            />
            <Slider
              label="Collateral Value"
              value={params.collateral_value}
              min={0}
              max={10000000}
              step={100000}
              format={NPR}
              onChange={set("collateral_value")}
            />
          </Card>

          {/* ── Right panel: live score ── */}
          <Card className="lg:col-span-2 flex flex-col items-center gap-5">
            <h2 className="text-sm font-semibold text-ink self-start">Simulated Score</h2>

            {loading ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Spinner size="md" />
                <p className="text-xs text-ink-faint">Calculating…</p>
              </div>
            ) : (
              <>
                <ScoreGauge score={scoreVal} grade={grade} />

                <Badge variant={gradeVariant(grade)} className="text-base px-4 py-1.5">
                  Grade {grade}
                </Badge>

                {/* Delta vs baseline */}
                <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                  change > 0.005
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : change < -0.005
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-canvas text-ink-soft border border-line"
                }`}>
                  {change > 0.005 ? (
                    <TrendingUp size={16} />
                  ) : change < -0.005 ? (
                    <TrendingDown size={16} />
                  ) : (
                    <Minus size={16} />
                  )}
                  {change > 0 ? "+" : ""}{(change * 100).toFixed(1)}% vs your baseline
                </div>

                {result && (
                  <div className="w-full rounded-xl bg-teal-soft border border-teal/20 px-4 py-3 text-center">
                    <p className="text-[11px] text-ink-soft mb-1">Key driver of change</p>
                    <p className="text-sm font-semibold text-teal-deep">
                      {friendlyDriver(result.key_driver)}
                    </p>
                  </div>
                )}

                <div className="w-full space-y-1 mt-1">
                  <div className="flex justify-between text-xs text-ink-soft">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${scoreVal * 100}%`,
                        background: `linear-gradient(90deg, ${gradeBg(grade)}88, ${gradeBg(grade)})`,
                      }}
                    />
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] text-ink-faint text-center">
              Powered by the {user?.branch_id?.replace(/_/g, " ")} branch federated model.
              Results are illustrative — contact your branch manager for a formal assessment.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
