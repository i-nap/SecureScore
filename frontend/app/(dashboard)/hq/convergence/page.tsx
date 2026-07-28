"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Spinner } from "@/components/ui";
import { hqConvergence, type ConvergenceResult, type ConvergenceRound } from "@/lib/api";
import { TrendingUp, Zap, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, ReferenceArea,
} from "recharts";

export default function ConvergencePage() {
  const [data, setData] = useState<ConvergenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"accuracy" | "loss">("accuracy");

  useEffect(() => {
    hqConvergence()
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const chartData = data.rounds.map((r: ConvergenceRound) => ({
    round: `R${r.round}`,
    "Federated (No DP)": view === "accuracy" ? r.fl_accuracy : r.fl_loss,
    "Centralised": view === "accuracy" ? r.central_accuracy : r.central_loss,
    "Federated + DP": view === "accuracy" ? r.dp_accuracy : r.dp_loss,
    byzantine: r.byzantine_active,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <TrendingUp size={22} className="text-teal" />
          FL Convergence Visualizer
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Compare federated vs centralised learning convergence, with and without differential privacy.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="FL Final F1" value={(data.final_fl_accuracy * 100).toFixed(1) + "%"} icon={<TrendingUp size={18} />} color="blue" />
        <StatCard label="Central Final F1" value={(data.final_central_accuracy * 100).toFixed(1) + "%"} icon={<Zap size={18} />} color="green" />
        <StatCard label="Privacy Cost" value={`ε = ${data.privacy_cost}`} icon={<ShieldCheck size={18} />} color="amber" />
        <StatCard label="Convergence Round" value={`R${data.convergence_round}`} icon={<AlertTriangle size={18} />} color="purple" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Training Curves</h2>
          <div className="flex gap-2">
            <button onClick={() => setView("accuracy")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${view === "accuracy" ? "bg-teal text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}>
              Accuracy (F1)
            </button>
            <button onClick={() => setView("loss")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${view === "loss" ? "bg-teal text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}>
              Loss
            </button>
          </div>
        </div>

        {data.byzantine_rounds.length > 0 && (
          <div className="flex items-center gap-2 mb-3 px-2 py-2 bg-red-50 rounded-lg">
            <AlertTriangle size={13} className="text-red-500" />
            <span className="text-xs text-red-700 font-medium">
              Byzantine attack active during rounds {data.byzantine_rounds.join(", ")} — note accuracy drop and recovery
            </span>
          </div>
        )}

        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="round" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={view === "accuracy" ? [0.6, 0.95] : [0.05, 0.8]}
              tickFormatter={(v) => view === "accuracy" ? (v * 100).toFixed(0) + "%" : v.toFixed(2)} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v: number | undefined) => view === "accuracy" ? `${((v ?? 0) * 100).toFixed(1)}%` : (v ?? 0).toFixed(4)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {/* Byzantine region shading */}
            <ReferenceArea x1="R3" x2="R5" fill="#fecaca" fillOpacity={0.4} label={{ value: "Byzantine", position: "insideTop", fontSize: 10, fill: "#dc2626" }} />
            <ReferenceLine x={`R${data.convergence_round}`} stroke="#6366f1" strokeDasharray="4 3"
              label={{ value: "Convergence", position: "insideTopRight", fontSize: 10, fill: "#6366f1" }} />
            <Line type="monotone" dataKey="Federated (No DP)" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="Centralised" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} strokeDasharray="6 2" />
            <Line type="monotone" dataKey="Federated + DP" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-teal-soft border-blue-200">
          <div className="flex items-center gap-2 mb-2"><div className="w-4 h-0.5 bg-blue-500 rounded" /><span className="text-xs font-bold text-blue-800">Federated (No DP)</span></div>
          <p className="text-sm text-teal-deep">Each branch trains locally; only model weights shared. Privacy by design — no raw data leaves branches.</p>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-2 mb-2"><div className="w-4 h-0.5 bg-emerald-500 rounded border-dashed border-t-2" /><span className="text-xs font-bold text-emerald-800">Centralised Baseline</span></div>
          <p className="text-sm text-emerald-700">All data pooled centrally. Faster convergence but violates data sovereignty and NRB data residency requirements.</p>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <div className="flex items-center gap-2 mb-2"><div className="w-4 h-0.5 bg-amber-500 rounded" style={{backgroundImage: "repeating-linear-gradient(90deg, #f59e0b, #f59e0b 3px, transparent 3px, transparent 6px)"}} /><span className="text-xs font-bold text-amber-800">Federated + DP</span></div>
          <p className="text-sm text-amber-700">Laplace noise added to gradients (ε = {data.privacy_cost}). Slightly lower accuracy but formal mathematical privacy guarantee.</p>
        </Card>
      </div>
    </div>
  );
}
