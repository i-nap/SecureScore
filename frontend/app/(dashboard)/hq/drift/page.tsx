"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { hqModelDrift, type ModelDriftResult } from "@/lib/api";
import { Activity, AlertOctagon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const STATUS_COLORS: Record<string, string> = { stable: "#10b981", warning: "#f59e0b", alert: "#ef4444" };

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "increasing") return <TrendingUp size={14} className="text-red-500" />;
  if (trend === "decreasing") return <TrendingDown size={14} className="text-emerald-500" />;
  return <Minus size={14} className="text-ink-faint" />;
}

function StatusBadge({ s }: { s: string }) {
  if (s === "stable") return <Badge variant="success">Stable</Badge>;
  if (s === "warning") return <Badge variant="warning">Warning</Badge>;
  return <Badge variant="danger">Alert</Badge>;
}

export default function ModelDriftPage() {
  const [data, setData] = useState<ModelDriftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    hqModelDrift()
      .then((d) => { setData(d); if (d.branches.length > 0) setSelected(d.branches[0].branch); })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const selectedBranch = data.branches.find((b) => b.branch === selected);
  const driftChartData = selectedBranch?.drift_scores.map((d, i) => ({ round: `R${i + 1}`, drift: d })) ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Activity size={22} className="text-teal" />
          Model Drift Monitor
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Track divergence between each branch&apos;s local model and the global federated model over training rounds.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Branches Monitored" value={String(data.branches.length)} icon={<Activity size={18} />} color="blue" />
        <StatCard label="Alert Count" value={String(data.alert_count)} icon={<AlertOctagon size={18} />} color={data.alert_count > 0 ? "red" : "green"} />
        <StatCard label="Alert Threshold" value={`${(data.alert_threshold * 100).toFixed(0)}%`} icon={<AlertOctagon size={18} />} color="amber" />
        <StatCard label="Rounds Tracked" value={String(data.rounds_tracked)} icon={<Activity size={18} />} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch table */}
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Branch Drift Ranking</h2>
          <div className="space-y-2">
            {data.branches.map((b) => (
              <button key={b.branch} onClick={() => setSelected(b.branch)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left border ${selected === b.branch ? "border-teal/40 bg-teal-soft" : "border-transparent bg-canvas hover:bg-gray-100"}`}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[b.status] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink">{b.branch}</p>
                  <p className="text-xs text-ink-faint capitalize">{b.branch_type.replace("_", "-")}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TrendIcon trend={b.trend} />
                  <span className={`text-sm font-mono font-bold ${b.status === "alert" ? "text-red-600" : b.status === "warning" ? "text-amber-600" : "text-emerald-600"}`}>
                    {(b.current_drift * 100).toFixed(1)}%
                  </span>
                  <StatusBadge s={b.status} />
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Drift chart for selected branch */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">
              {selected ? `${selected} — Drift Over Rounds` : "Select a branch"}
            </h2>
            {selectedBranch && <StatusBadge s={selectedBranch.status} />}
          </div>
          {selectedBranch ? (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={driftChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, data.alert_threshold * 1.4]} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${((v ?? 0) * 100).toFixed(2)}%`, "Drift"]} />
                  <ReferenceLine y={data.alert_threshold} stroke="#ef4444" strokeDasharray="4 3"
                    label={{ value: "Alert threshold", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }} />
                  <ReferenceLine y={data.warn_threshold} stroke="#f59e0b" strokeDasharray="4 3"
                    label={{ value: "Warning", position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }} />
                  <Line type="monotone" dataKey="drift" stroke={STATUS_COLORS[selectedBranch.status]} strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-ink-faint mt-2 text-center">
                KL divergence between branch local weights and global model weights
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-ink-faint text-sm">Select a branch to view drift</div>
          )}
        </Card>
      </div>

      <Card className="bg-teal-soft border-blue-200">
        <p className="text-sm font-semibold text-blue-800 mb-1">What is model drift?</p>
        <p className="text-sm text-teal-deep">
          Model drift occurs when a branch&apos;s local training data distribution shifts away from the global distribution.
          High drift ({">"} {(data.alert_threshold * 100).toFixed(0)}%) indicates the branch&apos;s model is diverging —
          this can be caused by seasonal patterns (agriculture loans), local economic changes, or data quality issues.
          Byzantine fault detection uses drift scores as one signal to identify malicious nodes.
        </p>
      </Card>
    </div>
  );
}
