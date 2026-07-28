"use client";

import { useState, useEffect } from "react";
import { hqFederatedBenchmark, type FederatedBenchmark } from "@/lib/api";
import { Card, StatCard, Spinner, EmptyState } from "@/components/ui";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { GitCompare, AlertTriangle, CheckCircle } from "lucide-react";

export default function BenchmarkPage() {
  const [data, setData] = useState<FederatedBenchmark | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    hqFederatedBenchmark()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load benchmark"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-32"><Spinner size="lg" /></div>
  );
  if (error) return <EmptyState message={error} />;
  if (!data) return <EmptyState message="No benchmark data available." />;

  const fedF1 = (data.federated.final_f1 * 100).toFixed(1);
  const cenF1 = (data.centralised_equivalent.estimated_f1 * 100).toFixed(1);
  const efficiency = (data.performance_gap.federated_efficiency * 100).toFixed(1);
  const f1Gap = (data.performance_gap.f1_gap * 100).toFixed(2);

  const chartData = data.learning_curves.map((pt) => ({
    round: pt.round,
    "Federated (SecureScore)": parseFloat((pt.federated_f1 * 100).toFixed(2)),
    "Centralised Equivalent": parseFloat((pt.centralised_f1 * 100).toFixed(2)),
  }));

  const finalRound = chartData[chartData.length - 1]?.round ?? data.rounds_analysed;

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <GitCompare size={24} className="text-blue-500" />
          Federated vs Centralised Benchmark
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Quantifying the privacy-performance tradeoff
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Federated F1" value={`${fedF1}%`} color="blue" />
        <StatCard label="Centralised F1" value={`${cenF1}%`} color="default" />
        <StatCard label="FL Efficiency" value={`${efficiency}%`} color="green" />
        <StatCard label="Convergence Round" value={data.federated.convergence_round} color="purple" />
      </div>

      {/* Main Chart */}
      <Card>
        <h2 className="text-base font-semibold text-ink mb-1">Learning Curves</h2>
        <p className="text-xs text-ink-soft mb-4">
          F1 score over training rounds — federated vs centralised equivalent
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="round"
              tick={{ fontSize: 11 }}
              label={{ value: "Round", position: "insideBottom", offset: -4, fontSize: 11 }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={["auto", "auto"]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(2)}%`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              x={finalRound}
              stroke="#94a3b8"
              strokeDasharray="4 2"
              label={{ value: `Gap: ${f1Gap}%`, position: "top", fontSize: 11, fill: "#64748b" }}
            />
            <Line
              type="monotone"
              dataKey="Federated (SecureScore)"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="Centralised Equivalent"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* FL Optimizer Comparison */}
      {data.algorithm_comparison && (
        <Card>
          <h2 className="text-base font-semibold text-ink mb-1">FedAvg vs FedProx vs Scaffold</h2>
          <p className="text-xs text-ink-soft mb-4">
            Real federated optimisation on synthetic label-skewed (non-IID) data — test cross-entropy loss per round (lower = faster convergence)
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={data.algorithm_comparison.rounds.map((round, i) => ({
                round,
                FedAvg: data.algorithm_comparison!.FedAvg[i],
                FedProx: data.algorithm_comparison!.FedProx[i],
                Scaffold: data.algorithm_comparison!.Scaffold[i],
              }))}
              margin={{ top: 8, right: 24, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} label={{ value: "Round", position: "insideBottom", offset: -4, fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: number | undefined) => [(v ?? 0).toFixed(4)]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Scaffold" stroke="#10b981" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="FedAvg" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="FedProx" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {(["FedAvg", "FedProx", "Scaffold"] as const).map((m) => (
              <div key={m} className="bg-canvas rounded-lg p-3 text-center">
                <p className="text-xs text-ink-faint">{m} final acc</p>
                <p className="text-lg font-black text-ink">{(data.algorithm_comparison!.final_accuracy[m] * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-3">{data.algorithm_comparison.note}</p>
        </Card>
      )}

      {/* Privacy Cost Card */}
      <Card className="border-l-4 border-l-amber-400 bg-amber-50/40">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-3 flex-1">
            <h2 className="font-bold text-amber-800">The cost of centralisation</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-3 border border-amber-100">
                <p className="text-xs text-ink-soft">Customers&#39; data exposed</p>
                <p className="text-xl font-black text-red-600">
                  {data.privacy_cost_of_centralisation.data_exposure_customers.toLocaleString()}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-100">
                <p className="text-xs text-ink-soft">Regulatory risk</p>
                <p className="text-xl font-black text-red-600">
                  {data.privacy_cost_of_centralisation.regulatory_risk}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-100">
                <p className="text-xs text-ink-soft">Breach impact</p>
                <p className="text-xl font-black text-red-600">
                  NPR {(data.privacy_cost_of_centralisation.breach_impact_npr / 1e9).toFixed(1)}B
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold text-amber-700">This is why federated learning matters</p>
          </div>
        </div>
      </Card>

      {/* Conclusion Banner */}
      <Card className="border-l-4 border-l-green-500 bg-green-50/40">
        <div className="flex items-start gap-3">
          <CheckCircle size={20} className="text-green-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-bold text-green-800 mb-1">Conclusion</h2>
            <p className="text-sm text-green-700">{data.conclusion}</p>
          </div>
        </div>
      </Card>

      {/* Explanation Card */}
      <Card className="bg-teal-soft/40 border border-teal/20">
        <p className="text-sm text-blue-800">
          <strong>Federated efficiency of {efficiency}%</strong> means SecureScore achieves {efficiency}% of
          centralised model performance while keeping all customer data at the branch level — never shared with HQ.
        </p>
        <p className="text-xs text-teal mt-2">
          {data.centralised_equivalent.note}
        </p>
      </Card>
    </div>
  );
}
