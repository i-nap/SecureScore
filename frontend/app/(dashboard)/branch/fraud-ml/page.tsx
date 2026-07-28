"use client";

import { useEffect, useState } from "react";
import { branchFraudML, type FraudMLResult, type FraudAlert } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { Brain, AlertTriangle, ShieldCheck, TrendingUp, Eye } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

function ScoreBar({ score, color }: { score: number; color: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-ink-soft">{pct}%</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-100 text-red-700 border border-red-200",
    medium: "bg-amber-100 text-amber-700 border border-amber-200",
    low: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[level] ?? styles.low}`}>
      {level}
    </span>
  );
}

const TooltipContent = ({ active, payload }: { active?: boolean; payload?: { value: number }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-line rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-ink">Ensemble Score</p>
      <p className="text-ink-soft">{(payload[0].value * 100).toFixed(1)}%</p>
    </div>
  );
};

export default function FraudMLPage() {
  const [data, setData] = useState<FraudMLResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    branchFraudML(50)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <Spinner size="lg" />
      <p className="text-ink-soft text-sm">Running ML fraud scan…</p>
    </div>
  );

  if (error) return (
    <div className="m-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
  );

  if (!data) return null;

  const totalCustomers = data.total_customers ?? 0;
  const highCount = data.high_risk_count ?? 0;
  const medCount = data.medium_risk_count ?? 0;
  const lowCount = totalCustomers - highCount - medCount;
  const flagRate = totalCustomers > 0 ? ((highCount + medCount) / totalCustomers * 100).toFixed(1) : "0";

  const chartData = data.alerts.slice(0, 15).map((a, i) => ({
    name: `C${i + 1}`,
    score: a.ensemble_score,
    level: a.risk_level,
  }));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-red-600 via-rose-600 to-orange-600 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">IsolationForest + XGBoost Ensemble</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">ML Fraud Detection</h1>
            <p className="mt-1 text-red-100 text-sm">{data.branch} Branch · Real-time anomaly scoring</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black">{flagRate}%</p>
            <p className="text-red-200 text-xs mt-0.5">Flagged rate</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "Total Customers", value: totalCustomers.toLocaleString(), icon: <Eye size={14} /> },
            { label: "High Risk", value: highCount.toString(), icon: <AlertTriangle size={14} /> },
            { label: "Medium Risk", value: medCount.toString(), icon: <TrendingUp size={14} /> },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 rounded-xl px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-red-100 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chart + summary row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bar chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">Top 15 — Ensemble Fraud Scores</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<TooltipContent />} />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.level === "high" ? "#ef4444" : d.level === "medium" ? "#f59e0b" : "#10b981"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 justify-center">
            {[["#ef4444", "High Risk"], ["#f59e0b", "Medium Risk"], ["#10b981", "Low Risk"]].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5 text-xs text-ink-soft">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{l}
              </div>
            ))}
          </div>
        </div>

        {/* Risk breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5 flex flex-col justify-between">
          <h2 className="text-sm font-semibold text-ink mb-4">Portfolio Breakdown</h2>
          <div className="space-y-4">
            {[
              { label: "High Risk", count: highCount, color: "bg-red-500", pct: highCount / Math.max(totalCustomers, 1) },
              { label: "Medium Risk", count: medCount, color: "bg-amber-400", pct: medCount / Math.max(totalCustomers, 1) },
              { label: "Low Risk", count: lowCount, color: "bg-emerald-500", pct: lowCount / Math.max(totalCustomers, 1) },
            ].map((r) => (
              <div key={r.label}>
                <div className="flex justify-between text-xs text-ink-soft mb-1">
                  <span>{r.label}</span>
                  <span className="font-semibold">{r.count} <span className="text-ink-faint font-normal">({(r.pct * 100).toFixed(1)}%)</span></span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${r.color} rounded-full`} style={{ width: `${r.pct * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-canvas rounded-xl text-center">
            <p className="text-xs text-ink-soft">Model</p>
            <p className="text-sm font-semibold text-ink mt-0.5">IF + XGB Ensemble</p>
          </div>
        </div>
      </div>

      {/* Alert table */}
      <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Fraud Alert Details</h2>
          <span className="text-xs text-ink-faint">{data.alerts.length} alerts</span>
        </div>
        {data.alerts.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2">
            <ShieldCheck size={36} className="text-emerald-300" />
            <p className="text-ink-faint text-sm">No fraud alerts detected</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-line bg-canvas">
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Ensemble Score</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">IF Score</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">XGB Prob</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Risk</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Top Flag</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((alert: FraudAlert, i: number) => {
                  const barColor = alert.risk_level === "high" ? "bg-red-500" : alert.risk_level === "medium" ? "bg-amber-400" : "bg-emerald-500";
                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-50 cursor-pointer transition-colors ${expanded === alert.customer_id ? "bg-teal-soft/50" : "hover:bg-canvas"}`}
                      onClick={() => setExpanded(expanded === alert.customer_id ? null : alert.customer_id)}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-ink-soft">{alert.customer_id}</td>
                      <td className="px-5 py-3 w-40">
                        <ScoreBar score={alert.ensemble_score} color={barColor} />
                      </td>
                      <td className="px-5 py-3 text-ink-soft text-xs">{alert.if_score?.toFixed(3) ?? "—"}</td>
                      <td className="px-5 py-3 text-ink-soft text-xs">{alert.xgb_fraud_prob?.toFixed(3) ?? "—"}</td>
                      <td className="px-5 py-3"><RiskBadge level={alert.risk_level} /></td>
                      <td className="px-5 py-3 text-xs text-ink-soft max-w-[200px] truncate">
                        {alert.top_flag_reason?.replace(/_/g, " ") ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
