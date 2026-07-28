"use client";

import { useEffect, useState } from "react";
import { branchDataDrift, type DataDrift } from "@/lib/api";
import { Card, Spinner, EmptyState, Badge } from "@/components/ui";
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

export default function DataDriftPage() {
  const [drift, setDrift] = useState<DataDrift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    branchDataDrift()
      .then(setDrift)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!drift || !drift.features || drift.features.length === 0) {
    return <EmptyState message="No data drift information available." />;
  }

  const chartData = drift.features.map((f) => ({
    feature: f.feature.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    drift: parseFloat(f.drift_score.toFixed(3)),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Data Drift Analysis</h1>
        <p className="text-sm text-ink-soft mt-1">
          Monitoring feature distribution shifts for the{" "}
          <Badge variant="default">{drift.branch_type}</Badge> branch model
        </p>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Feature Drift Scores</h2>
        <p className="text-xs text-ink-faint mb-3">
          Higher drift scores indicate the feature distribution has shifted significantly from training data.
          Scores above 0.3 may need retraining.
        </p>
        <ResponsiveContainer width="100%" height={chartData.length * 36 + 40}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 130, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} domain={[0, "auto"]} />
            <YAxis dataKey="feature" type="category" tick={{ fontSize: 11 }} width={130} />
            <Tooltip formatter={(v) => [Number(v).toFixed(3), "Drift Score"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="drift" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.drift > 0.3 ? "#ef4444" : entry.drift > 0.15 ? "#f59e0b" : "#10b981"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Detailed table */}
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs font-medium text-ink-soft uppercase tracking-wide">
              <th className="px-4 py-3">Feature</th>
              <th className="px-4 py-3">Mean</th>
              <th className="px-4 py-3">Std Dev</th>
              <th className="px-4 py-3">Drift Score</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {drift.features.map((f) => (
              <tr key={f.feature} className="hover:bg-canvas">
                <td className="px-4 py-3 font-medium text-ink">
                  {f.feature.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </td>
                <td className="px-4 py-3 text-ink-soft">{f.mean.toFixed(3)}</td>
                <td className="px-4 py-3 text-ink-soft">{f.std.toFixed(3)}</td>
                <td className="px-4 py-3 font-mono">{f.drift_score.toFixed(3)}</td>
                <td className="px-4 py-3">
                  <Badge
                    variant={f.drift_score > 0.3 ? "danger" : f.drift_score > 0.15 ? "warning" : "success"}
                  >
                    {f.drift_score > 0.3 ? "High" : f.drift_score > 0.15 ? "Moderate" : "Stable"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
