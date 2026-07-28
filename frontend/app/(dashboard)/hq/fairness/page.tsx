"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { hqFairnessAudit, type FairnessAuditResult } from "@/lib/api";
import { Scale, AlertTriangle, CheckCircle2, Info, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";

const COLORS = { Urban: "#6366f1", "Semi-Urban": "#f59e0b", Rural: "#10b981" };

export default function FairnessAuditPage() {
  const [data, setData] = useState<FairnessAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    hqFairnessAudit()
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const segmentBarData = data.segments.map((s) => ({
    name: s.group,
    "Avg Score": s.avg_score,
    "Approval Rate (%)": s.approval_rate,
  }));

  const distData = data.score_distribution.map((b) => ({
    range: b.range, Urban: b.urban, SemiUrban: b.semi_urban, Rural: b.rural,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Scale size={22} className="text-teal" />
            Fairness & Bias Audit
          </h1>
          <p className="text-sm text-ink-soft mt-1">Credit score equity analysis across geographic segments</p>
        </div>
        <div className="flex gap-2 mt-1">
          {data.status === "acceptable" ? (
            <Badge variant="success">FAIR</Badge>
          ) : (
            <Badge variant="warning">CONCERN DETECTED</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Customers" value={data.total_customers.toLocaleString()} icon={<Users size={18} />} color="blue" />
        <StatCard label="Gini Coefficient" value={data.gini_coefficient.toFixed(3)} sub={data.gini_coefficient > 0.15 ? "Concern" : "Acceptable"} icon={<Scale size={18} />} color={data.gini_coefficient > 0.15 ? "red" : "green"} />
        <StatCard label="Disparate Impact" value={data.disparate_impact.toFixed(3)} sub="Rural ÷ Urban approval" icon={<AlertTriangle size={18} />} color={data.disparate_impact < 0.8 ? "red" : data.disparate_impact < 0.9 ? "amber" : "green"} />
        <StatCard label="Status" value={data.status === "acceptable" ? "FAIR" : "REVIEW"} icon={<CheckCircle2 size={18} />} color={data.status === "acceptable" ? "green" : "amber"} />
      </div>

      {/* Segment comparison table */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Segment Comparison</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-faint border-b border-line">
                <th className="text-left py-2 pr-4">Segment</th>
                <th className="text-right py-2 pr-4">Customers</th>
                <th className="text-right py-2 pr-4">Avg Score</th>
                <th className="text-right py-2 pr-4">Approval Rate</th>
                <th className="text-right py-2 pr-4">Avg DTI</th>
                <th className="text-right py-2 pr-4">Avg Income</th>
                <th className="text-right py-2">Parity Gap</th>
              </tr>
            </thead>
            <tbody>
              {data.segments.map((s) => (
                <tr key={s.group} className="border-b border-gray-50 hover:bg-canvas">
                  <td className="py-3 pr-4">
                    <span className="font-semibold text-ink">{s.group}</span>
                  </td>
                  <td className="py-3 pr-4 text-right text-ink-soft">{s.count.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right font-mono font-bold text-ink">{s.avg_score.toFixed(1)}</td>
                  <td className="py-3 pr-4 text-right">
                    <span className={`font-bold ${s.approval_rate > 60 ? "text-emerald-600" : s.approval_rate > 45 ? "text-amber-600" : "text-red-600"}`}>
                      {s.approval_rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right text-ink-soft">{(s.avg_dti * 100).toFixed(0)}%</td>
                  <td className="py-3 pr-4 text-right text-ink-soft">NPR {(s.avg_income / 1000).toFixed(0)}k</td>
                  <td className="py-3 text-right">
                    <span className={`text-xs font-bold ${s.demographic_parity < -10 ? "text-red-600" : s.demographic_parity < 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {s.demographic_parity > 0 ? "+" : ""}{s.demographic_parity.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Approval Rate by Segment</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={segmentBarData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="Approval Rate (%)" radius={[4, 4, 0, 0]}>
                {segmentBarData.map((d) => (
                  <Cell key={d.name} fill={COLORS[d.name as keyof typeof COLORS] ?? "#6366f1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Score Distribution by Segment</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={40} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Urban" fill="#6366f1" stackId="a" />
              <Bar dataKey="SemiUrban" name="Semi-Urban" fill="#f59e0b" stackId="a" />
              <Bar dataKey="Rural" fill="#10b981" stackId="a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900 mb-1">Regulatory Guidance</p>
            <p className="text-sm text-amber-800">
              Nepal Rastra Bank guidelines require a disparate impact ratio ≥ 0.80 (rural vs urban approval rates).
              Current ratio: <strong>{data.disparate_impact.toFixed(3)}</strong>.
              {data.disparate_impact < 0.80 ? " This falls below the recommended threshold and warrants review." : " This is within acceptable limits."}
              Federated learning isolates rural data to rural branches, which may help improve rural model accuracy over time.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
