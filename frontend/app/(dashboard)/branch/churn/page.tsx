"use client";

import { useEffect, useState } from "react";
import { branchChurnSummary, type ChurnSummary } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { TrendingDown, Users, UserMinus, UserCheck, Zap } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";

function ChurnBar({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100);
  const color = prob >= 0.6 ? "bg-red-500" : prob >= 0.3 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-ink-soft w-10 text-right">{pct}%</span>
    </div>
  );
}

function RiskBadge({ prob }: { prob: number }) {
  const risk = prob >= 0.6 ? "high" : prob >= 0.3 ? "medium" : "low";
  const styles: Record<string, string> = {
    high: "bg-red-100 text-red-700 border border-red-200",
    medium: "bg-amber-100 text-amber-700 border border-amber-200",
    low: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[risk]}`}>
      {risk}
    </span>
  );
}

const COLORS = ["#ef4444", "#f59e0b", "#10b981"];

const PieTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-line rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-ink">{payload[0].name}</p>
      <p className="text-ink-soft">{payload[0].value} customers</p>
    </div>
  );
};

export default function ChurnPage() {
  const [data, setData] = useState<ChurnSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    branchChurnSummary()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <Spinner size="lg" />
      <p className="text-ink-soft text-sm">Analyzing customer retention…</p>
    </div>
  );

  if (error) return (
    <div className="m-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
  );

  if (!data) return null;

  const total = data.total_customers ?? 0;
  const highPct = total > 0 ? (data.high_risk_count ?? 0) / total * 100 : 0;
  const medPct  = total > 0 ? (data.medium_risk_count ?? 0) / total * 100 : 0;
  const lowCount = total - (data.high_risk_count ?? 0) - (data.medium_risk_count ?? 0);
  const lowPct  = total > 0 ? lowCount / total * 100 : 0;

  const pieData = [
    { name: "High Risk",   value: data.high_risk_count },
    { name: "Medium Risk", value: data.medium_risk_count },
    { name: "Low Risk",    value: lowCount },
  ];

  const retentionRate = (100 - data.avg_churn_probability * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">Random Forest · 30-Day Churn Predictor</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Churn Risk Monitor</h1>
            <p className="mt-1 text-orange-100 text-sm">{data.branch} Branch · RFM + digital engagement features</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black">{retentionRate}%</p>
            <p className="text-orange-100 text-xs mt-0.5">Retention rate</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-3">
          {[
            { label: "Total Customers",  value: total.toLocaleString(),                              icon: <Users size={14} /> },
            { label: "High Risk",        value: data.high_risk_count.toString(),                     icon: <UserMinus size={14} /> },
            { label: "Medium Risk",      value: data.medium_risk_count.toString(),                   icon: <TrendingDown size={14} /> },
            { label: "Avg Churn Prob",   value: `${(data.avg_churn_probability * 100).toFixed(1)}%`, icon: <Zap size={14} /> },
          ].map((s) => (
            <div key={s.label} className="bg-white/20 rounded-xl px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-orange-100 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Pie chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-2">Risk Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip content={<PieTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {[
              { label: "High Risk",   count: data.high_risk_count,   pct: highPct, color: "bg-red-500" },
              { label: "Medium Risk", count: data.medium_risk_count, pct: medPct,  color: "bg-amber-400" },
              { label: "Low Risk",    count: lowCount,               pct: lowPct,  color: "bg-emerald-500" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-xs text-ink-soft">
                <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${r.color}`} />
                <span className="flex-1">{r.label}</span>
                <span className="font-semibold">{r.count}</span>
                <span className="text-ink-faint w-12 text-right">({r.pct.toFixed(1)}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stacked bar */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">Risk Breakdown Bar</h2>
          <div className="mb-6">
            <div className="h-8 rounded-xl overflow-hidden flex shadow-inner">
              <div className="bg-red-500 transition-all flex items-center justify-center" style={{ width: `${highPct}%` }}>
                {highPct > 8 && <span className="text-white text-xs font-bold">{highPct.toFixed(0)}%</span>}
              </div>
              <div className="bg-amber-400 transition-all flex items-center justify-center" style={{ width: `${medPct}%` }}>
                {medPct > 8 && <span className="text-white text-xs font-bold">{medPct.toFixed(0)}%</span>}
              </div>
              <div className="bg-emerald-500 transition-all flex items-center justify-center flex-1">
                {lowPct > 8 && <span className="text-white text-xs font-bold">{lowPct.toFixed(0)}%</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-2">
            {[
              { label: "High Risk", count: data.high_risk_count, pct: highPct, bg: "bg-red-50", text: "text-red-700", border: "border-red-100" },
              { label: "Medium Risk", count: data.medium_risk_count, pct: medPct, bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
              { label: "Low Risk", count: lowCount, pct: lowPct, bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100" },
            ].map((r) => (
              <div key={r.label} className={`${r.bg} border ${r.border} rounded-xl p-3 text-center`}>
                <p className={`text-2xl font-bold ${r.text}`}>{r.count}</p>
                <p className="text-xs text-ink-soft mt-0.5">{r.label}</p>
                <p className={`text-lg font-semibold ${r.text} mt-1`}>{r.pct.toFixed(1)}%</p>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-teal-soft border border-teal/20 rounded-xl">
            <div className="flex items-center gap-2">
              <UserCheck size={14} className="text-teal" />
              <p className="text-xs text-teal-deep">
                <span className="font-semibold">Retention action recommended</span> for {data.high_risk_count + data.medium_risk_count} customers.
                Focus on digital re-engagement for high-risk accounts.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Top at-risk table */}
      <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Top At-Risk Customers</h2>
          <span className="text-xs text-ink-faint">{data.top_at_risk_customers.length} shown</span>
        </div>
        {data.top_at_risk_customers.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2">
            <UserCheck size={36} className="text-emerald-300" />
            <p className="text-ink-faint text-sm">No high-risk customers — great retention!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-line bg-canvas">
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">#</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Customer ID</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">30-Day Churn Probability</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {data.top_at_risk_customers.map((c, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-canvas/70 transition-colors">
                    <td className="px-5 py-3 text-xs text-ink-faint font-mono">{i + 1}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-soft">{c.customer_id}</td>
                    <td className="px-5 py-3 w-52"><ChurnBar prob={c.churn_probability} /></td>
                    <td className="px-5 py-3"><RiskBadge prob={c.churn_probability} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
