"use client";
import { useEffect, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { hqBranchExplainability, type BranchExplainabilityResult, type FeatureWeightData } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { Brain, AlertTriangle, Info } from "lucide-react";

const BRANCH_COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6"];
const FEATURE_LABELS: Record<string, string> = {
  annual_income: "Annual Income", debt_to_income: "Debt/Income Ratio",
  repayment_history_score: "Repayment History", employment_months: "Employment Months",
  collateral_value: "Collateral Value", credit_history_months: "Credit History", existing_loans: "Existing Loans",
};

export default function BranchExplainabilityPage() {
  const [data, setData] = useState<BranchExplainabilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFeature, setSelectedFeature] = useState<FeatureWeightData | null>(null);

  useEffect(() => {
    hqBranchExplainability().then((d) => { setData(d); if (d.features.length) setSelectedFeature(d.features[0]); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>;

  const deviationData = data.features.map((f) => ({
    feature: FEATURE_LABELS[f.feature] ?? f.feature,
    global: f.global,
    deviation: Math.round(f.max_deviation * 1000) / 1000,
  }));

  const featureChartData = selectedFeature
    ? [
        { name: "Global", value: selectedFeature.global, isGlobal: true },
        ...data.branches.map((b, i) => ({ name: b, value: selectedFeature.branches[b] ?? 0, isGlobal: false, color: BRANCH_COLORS[i % BRANCH_COLORS.length] })),
      ]
    : [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Brain size={22} className="text-teal" />Per-Branch Model Explainability
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          How each branch&apos;s local federated model weights features differently from the global model. {data.global_model}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Feature Deviation from Global (sorted by divergence)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={deviationData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(3)} />
              <YAxis dataKey="feature" type="category" tick={{ fontSize: 10 }} width={120} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [(v ?? 0).toFixed(4), "Max Deviation"]} />
              <Bar dataKey="deviation" radius={[0, 4, 4, 0]}>
                {deviationData.map((_, i) => <Cell key={i} fill={i === 0 ? "#ef4444" : i < 3 ? "#f59e0b" : "#6366f1"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Feature Deep-Dive</h2>
            <select value={selectedFeature?.feature ?? ""} onChange={(e) => setSelectedFeature(data.features.find((f) => f.feature === e.target.value) ?? null)}
              className="text-xs px-2 py-1.5 border border-line rounded-lg bg-white focus:outline-none">
              {data.features.map((f) => <option key={f.feature} value={f.feature}>{FEATURE_LABELS[f.feature] ?? f.feature}</option>)}
            </select>
          </div>
          {selectedFeature && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={featureChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(3)} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [(v ?? 0).toFixed(4), "Weight"]} />
                <ReferenceLine y={selectedFeature.global} stroke="#374151" strokeDasharray="6 3" label={{ value: "Global", position: "insideTopRight", fontSize: 10, fill: "#374151" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {featureChartData.map((d, i) => <Cell key={i} fill={d.isGlobal ? "#374151" : BRANCH_COLORS[i - 1] ?? "#6366f1"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" />Notable Branch Divergences</h2>
        <div className="space-y-3">
          {data.insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-canvas rounded-xl">
              <span className="text-lg shrink-0">{ins.Direction === "higher" ? "⬆️" : "⬇️"}</span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  <span className="text-teal">{ins.Branch}</span> weights{" "}
                  <span className="text-amber-600">{FEATURE_LABELS[ins.Feature] ?? ins.Feature}</span>{" "}
                  {ins.Multiplier}× {ins.Direction} than global
                </p>
                <p className="text-xs text-ink-soft mt-0.5">{ins.Reason}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="bg-teal-soft border-blue-200">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-800">
            In federated learning, each branch&apos;s local model learns from its own data distribution.
            Rural branches naturally put more weight on collateral (income is irregular), while urban branches
            rely more on salary-based income signals. This heterogeneity is a <strong>feature</strong> of FL —
            the global model aggregates these insights through FedAvg, producing a more robust global estimator.
          </p>
        </div>
      </Card>
    </div>
  );
}
