"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  customerScoreExplanation,
  type ScoreExplanation,
  type ShapFeature,
} from "@/lib/api";
import { Card, Badge, StatCard } from "@/components/ui";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Info } from "lucide-react";

function gradeColor(grade: string) {
  switch (grade) {
    case "A": return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "B": return "text-teal bg-teal-soft border-blue-200";
    case "C": return "text-amber-600 bg-amber-50 border-amber-200";
    case "D": return "text-orange-600 bg-orange-50 border-orange-200";
    default:  return "text-red-600 bg-red-50 border-red-200";
  }
}

function scoreToGrade(score: number): string {
  if (score >= 0.80) return "A";
  if (score >= 0.65) return "B";
  if (score >= 0.50) return "C";
  if (score >= 0.35) return "D";
  return "F";
}

function formatFeatureValue(name: string, value: number): string {
  const lakh = 100000;
  if (name.includes("income") || name.includes("loan") || name.includes("collateral")) {
    if (value >= lakh) return `NPR ${(value / lakh).toFixed(1)}L`;
    return `NPR ${value.toLocaleString()}`;
  }
  if (name === "debt_to_income") return `${(value * 100).toFixed(0)}%`;
  if (name.includes("months")) return `${Math.round(value)} mo`;
  if (name === "repayment_history_score") return `${Math.round(value)}/100`;
  if (name === "existing_loans") return `${Math.round(value)}`;
  return value.toFixed(2);
}

function friendlyName(name: string): string {
  const map: Record<string, string> = {
    annual_income: "Annual Income",
    debt_to_income: "Debt-to-Income",
    employment_months: "Employment Duration",
    credit_history_months: "Credit History",
    existing_loans: "Existing Loans",
    loan_amount_requested: "Loan Requested",
    collateral_value: "Collateral Value",
    repayment_history_score: "Repayment Score",
  };
  return map[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function plainEnglish(f: ShapFeature): string {
  const valStr = formatFeatureValue(f.name, f.value);
  const direction = f.direction === "positive" ? "positively" : "negatively";
  const impact = Math.abs(f.shap_value) > 0.05 ? "strongly" : "slightly";
  switch (f.name) {
    case "annual_income":
      return `Your annual income of ${valStr} ${impact} impacts your score ${direction}.`;
    case "debt_to_income":
      return `A debt-to-income ratio of ${valStr} ${impact} affects your score ${direction}. ${f.direction === "negative" ? "Try reducing existing debt." : "This is within a healthy range."}`;
    case "employment_months":
      return `${valStr} of continuous employment ${impact} contributes ${direction} to your creditworthiness.`;
    case "credit_history_months":
      return `Your ${valStr} credit history ${impact} influences your score ${direction}.`;
    case "existing_loans":
      return `Having ${valStr} active loan(s) ${impact} affects your score ${direction}.`;
    case "loan_amount_requested":
      return `The loan amount of ${valStr} ${impact} impacts your score ${direction} relative to your profile.`;
    case "collateral_value":
      return `Collateral worth ${valStr} ${impact} supports your score ${direction}.`;
    case "repayment_history_score":
      return `Your repayment history score of ${valStr} ${impact} contributes ${direction} to your credit profile.`;
    default:
      return `${friendlyName(f.name)} (${valStr}) ${impact} affects your score ${direction}.`;
  }
}

// Skeleton loader component
function ExplainSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <div>
        <div className="h-7 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-80" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl bg-gray-100 h-24" />
        ))}
      </div>
      <div className="rounded-2xl bg-gray-100 h-72" />
      <div className="rounded-2xl bg-gray-100 h-40" />
    </div>
  );
}

export default function ExplainabilityPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ScoreExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerScoreExplanation()
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load explanation"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ExplainSkeleton />;

  if (error || !data) {
    return (
      <Card className="max-w-xl">
        <p className="text-red-600 text-sm text-center py-6">
          {error || "Unable to load score explanation."}
        </p>
      </Card>
    );
  }

  const grade = scoreToGrade(data.prediction);
  const prob = data.prediction;
  const topThree = data.features.slice(0, 3);

  const chartData = data.features.map((f) => ({
    name: friendlyName(f.name),
    rawName: f.name,
    value: f.shap_value,
    displayValue: formatFeatureValue(f.name, f.value),
    absValue: Math.abs(f.shap_value),
    direction: f.direction,
  }));

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">Why This Score?</h1>
        <p className="text-sm text-ink-soft mt-1">
          Feature contribution breakdown for your credit assessment
        </p>
      </div>

      {/* Score summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Big score */}
        <div className="rounded-2xl bg-white border border-line shadow-sm p-6 flex flex-col items-center justify-center gap-2 md:col-span-1">
          <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Credit Score</p>
          <div className={`text-5xl font-black border-2 rounded-2xl w-20 h-20 flex items-center justify-center ${gradeColor(grade)}`}>
            {grade}
          </div>
          <p className="text-sm font-semibold text-ink">{(prob * 100).toFixed(1)}% creditworthy</p>
        </div>

        <StatCard
          label="Positive Factors"
          value={data.features.filter((f) => f.direction === "positive").length}
          sub="helping your score"
          icon={<TrendingUp size={26} className="text-emerald-500" />}
          color="green"
        />
        <StatCard
          label="Negative Factors"
          value={data.features.filter((f) => f.direction === "negative").length}
          sub="hurting your score"
          icon={<TrendingDown size={26} className="text-red-500" />}
          color="red"
        />
      </div>

      {/* SHAP waterfall chart */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-1">Feature Contribution Waterfall</h2>
        <p className="text-xs text-ink-faint mb-4">
          Green bars improve your score; red bars reduce it. Sorted by absolute impact.
        </p>
        <ResponsiveContainer width="100%" height={chartData.length * 48 + 40}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 160, right: 60, top: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => v.toFixed(3)}
              domain={["auto", "auto"]}
            />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 12 }}
              width={155}
            />
            <Tooltip
              formatter={(value, _name, props) => [
                `SHAP: ${Number(value).toFixed(4)}  |  Value: ${(props.payload as { displayValue: string }).displayValue}`,
                (props.payload as { name: string }).name,
              ]}
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: (v: unknown) => typeof v === "number" ? v.toFixed(3) : "" }}>
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.direction === "positive" ? "#10b981" : "#ef4444"}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-3 justify-end text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500 inline-block" />
            Positive contribution
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-500 inline-block" />
            Negative contribution
          </span>
        </div>
      </Card>

      {/* Base value + prediction indicator */}
      <Card className="flex flex-wrap gap-6 items-center">
        <div className="text-center">
          <p className="text-xs text-ink-faint mb-1">Base Value (model avg)</p>
          <Badge variant="default" className="text-sm px-3 py-1">0.500</Badge>
        </div>
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-[120px]">
          <div
            className={`h-full rounded-full transition-all duration-700 ${prob >= 0.65 ? "bg-emerald-500" : prob >= 0.50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${prob * 100}%` }}
          />
        </div>
        <div className="text-center">
          <p className="text-xs text-ink-faint mb-1">Your Prediction</p>
          <Badge
            variant={prob >= 0.65 ? "success" : prob >= 0.50 ? "warning" : "danger"}
            className="text-sm px-3 py-1"
          >
            {(prob * 100).toFixed(1)}%
          </Badge>
        </div>
      </Card>

      {/* Plain-language explanation of top 3 factors */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Info size={15} className="text-blue-500 shrink-0" />
          <h2 className="text-sm font-semibold text-ink">Top 3 Factor Explanations</h2>
        </div>
        <div className="space-y-3">
          {topThree.map((f, idx) => (
            <div
              key={f.name}
              className={`flex gap-3 rounded-xl border px-4 py-3 ${
                f.direction === "positive"
                  ? "border-emerald-100 bg-emerald-50"
                  : "border-red-100 bg-red-50"
              }`}
            >
              <span className={`text-lg font-bold shrink-0 ${f.direction === "positive" ? "text-emerald-600" : "text-red-600"}`}>
                {idx + 1}.
              </span>
              <div>
                <p className="text-xs font-semibold text-ink mb-0.5">
                  {friendlyName(f.name)}{" "}
                  <span className="font-normal text-ink-soft">
                    — {formatFeatureValue(f.name, f.value)}
                  </span>
                </p>
                <p className="text-xs text-ink-soft">{plainEnglish(f)}</p>
              </div>
              <Badge
                variant={f.direction === "positive" ? "success" : "danger"}
                className="shrink-0 self-start ml-auto"
              >
                {f.shap_value >= 0 ? "+" : ""}{f.shap_value.toFixed(3)}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Footer note */}
      <p className="text-xs text-ink-faint text-center pb-2">
        SHAP values measure each feature&apos;s marginal contribution to the model prediction relative to the branch average.
        Calculated using the {user?.branch_id?.replace(/_/g, " ")} branch federated model.
      </p>
    </div>
  );
}
