"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { hqPrivacyBudget, type PrivacyBudgetResult, type PrivacyBudgetRound } from "@/lib/api";
import { Lock, ShieldCheck, Activity, TrendingDown, Info } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

function statusBadge(status: string) {
  if (status === "healthy") return <Badge variant="success">HEALTHY</Badge>;
  if (status === "warning") return <Badge variant="warning">WARNING</Badge>;
  return <Badge variant="danger">CRITICAL</Badge>;
}

function statusColor(status: string) {
  if (status === "healthy") return "green" as const;
  if (status === "warning") return "amber" as const;
  return "red" as const;
}

function cumulativeBarColor(cumulative: number, budget: number) {
  const pct = cumulative / budget;
  if (pct < 0.5) return "#10b981";
  if (pct < 0.8) return "#f59e0b";
  return "#ef4444";
}

function perRoundBarColor(cumulative: number, budget: number) {
  return cumulativeBarColor(cumulative, budget);
}

export default function PrivacyBudgetPage() {
  const [data, setData] = useState<PrivacyBudgetResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    hqPrivacyBudget()
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load privacy budget"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-red-600 bg-red-50 rounded-xl px-4 py-6 text-sm">
        {error || "No data available"}
      </div>
    );
  }

  const pctUsed = data.epsilon_consumed / data.total_budget;

  // Area chart: color changes based on cumulative value
  const areaData = data.rounds.map((r: PrivacyBudgetRound) => ({
    round: `R${r.round}`,
    cumulative: r.cumulative,
    budget: data.total_budget,
  }));

  // Per-round bar chart
  const barData = data.rounds.map((r: PrivacyBudgetRound) => ({
    round: `R${r.round}`,
    epsilon: r.epsilon,
    cumulative: r.cumulative,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Lock size={22} className="text-teal" />
            Privacy Budget (ε)
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Differential privacy epsilon consumption across federated rounds
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {statusBadge(data.status)}
          <Badge variant="default">{data.mechanism}</Badge>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Budget"
          value={`ε = ${data.total_budget.toFixed(2)}`}
          icon={<Lock size={18} />}
          color="blue"
        />
        <StatCard
          label="Consumed"
          value={`ε = ${data.epsilon_consumed.toFixed(4)}`}
          sub={`${(pctUsed * 100).toFixed(1)}% used`}
          icon={<TrendingDown size={18} />}
          color={statusColor(data.status)}
        />
        <StatCard
          label="Remaining"
          value={`ε = ${data.epsilon_remaining.toFixed(4)}`}
          icon={<ShieldCheck size={18} />}
          color={data.epsilon_remaining > 0.4 ? "green" : data.epsilon_remaining > 0.1 ? "amber" : "red"}
        />
        <StatCard
          label="Projected Exhaustion"
          value={`Round ${data.projected_exhaustion_round}`}
          icon={<Activity size={18} />}
          color={data.projected_exhaustion_round > 15 ? "green" : data.projected_exhaustion_round > 8 ? "amber" : "red"}
        />
      </div>

      {/* Budget progress bar */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">Budget Consumption Progress</h2>
          <span className="text-sm font-mono font-bold text-ink">
            {data.epsilon_consumed.toFixed(4)} / {data.total_budget.toFixed(2)}
          </span>
        </div>
        <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-6 rounded-full transition-all duration-700 ${
              pctUsed < 0.5 ? "bg-emerald-500" : pctUsed < 0.8 ? "bg-amber-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(pctUsed * 100, 100)}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white mix-blend-overlay">
            {(pctUsed * 100).toFixed(1)}% consumed
          </div>
        </div>
        <div className="flex justify-between text-xs text-ink-faint mt-1">
          <span>0</span>
          <span className="text-amber-500 font-medium">50% warning threshold</span>
          <span className="text-red-500 font-medium">80% critical</span>
          <span>ε = {data.total_budget}</span>
        </div>
      </Card>

      {/* Cumulative area chart */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Cumulative ε Consumption vs Round</h2>
          <span className="text-xs text-ink-faint">Dashed line = budget limit (ε = {data.total_budget})</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={areaData}>
            <defs>
              <linearGradient id="epsilonGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={pctUsed < 0.5 ? "#10b981" : pctUsed < 0.8 ? "#f59e0b" : "#ef4444"} stopOpacity={0.4} />
                <stop offset="95%" stopColor={pctUsed < 0.5 ? "#10b981" : pctUsed < 0.8 ? "#f59e0b" : "#ef4444"} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="round" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, data.total_budget * 1.05]} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={((v: number | undefined, name: string) => [
                (v ?? 0).toFixed(4),
                name === "cumulative" ? `Cumulative ε` : "Budget Limit",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ]) as any}
            />
            <ReferenceLine
              y={data.total_budget}
              stroke="#ef4444"
              strokeDasharray="6 3"
              label={{ value: `ε = ${data.total_budget} (Budget Limit)`, position: "insideTopRight", fontSize: 11, fill: "#ef4444" }}
            />
            <ReferenceLine
              y={data.total_budget * 0.5}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: "50% Warning", position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }}
            />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={pctUsed < 0.5 ? "#10b981" : pctUsed < 0.8 ? "#f59e0b" : "#ef4444"}
              fill="url(#epsilonGrad)"
              strokeWidth={2}
              name="cumulative"
              dot={{ r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Per-round bar chart */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Per-Round ε Consumption</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="round" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(3)} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={((v: number | undefined, _: string, props: { payload?: { cumulative: number } }) => [
                `ε = ${(v ?? 0).toFixed(4)} (cumulative: ${(props.payload?.cumulative ?? 0).toFixed(4)})`,
                "Epsilon",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ]) as any}
            />
            <Bar dataKey="epsilon" radius={[4, 4, 0, 0]}>
              {barData.map((d) => (
                <Cell key={d.round} fill={perRoundBarColor(d.cumulative, data.total_budget)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Round table */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Round-by-Round Detail</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-faint border-b border-line">
                <th className="text-left py-2 pr-4">Round</th>
                <th className="text-right py-2 pr-4">ε This Round</th>
                <th className="text-right py-2 pr-4">Cumulative ε</th>
                <th className="text-right py-2 pr-4">Budget Used</th>
                <th className="text-right py-2 pr-4">Branches</th>
                <th className="text-right py-2">Noise Std</th>
              </tr>
            </thead>
            <tbody>
              {data.rounds.map((r: PrivacyBudgetRound) => {
                const pct = r.cumulative / data.total_budget;
                return (
                  <tr key={r.round} className="border-b border-gray-50 hover:bg-canvas transition-colors">
                    <td className="py-2 pr-4 font-medium text-ink">Round {r.round}</td>
                    <td className="py-2 pr-4 text-right font-mono text-ink">{r.epsilon.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-right font-mono font-semibold text-ink">{r.cumulative.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-right">
                      <span
                        className={`text-xs font-semibold ${
                          pct < 0.5 ? "text-emerald-700" : pct < 0.8 ? "text-amber-700" : "text-red-700"
                        }`}
                      >
                        {(pct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right text-ink-soft">{r.branches}</td>
                    <td className="py-2 text-right font-mono text-ink-soft">{r.noise_std.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Explanation card */}
      <Card className="bg-teal-soft border-blue-200">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900 mb-1">About Differential Privacy</h3>
            <p className="text-sm text-blue-800 leading-relaxed">
              Differential privacy adds calibrated noise to model updates before they leave branch nodes.
              The privacy guarantee is parameterized by <strong>ε (epsilon)</strong> — lower values mean
              stronger privacy but more noise. Once ε = {data.total_budget.toFixed(1)} is consumed,
              the formal privacy guarantee weakens and federated retraining from fresh noise should be considered.
              Clip norm L2 = {data.clip_norm} is applied to model gradients before noise injection.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
