"use client";
import { useEffect, useState } from "react";
import { Card, Badge, Spinner } from "@/components/ui";
import { hqSplitLearning, type SplitLearningResult } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Cpu, Server, User, ArrowRight } from "lucide-react";

const OWNER_COLORS: Record<string, string> = { branch: "#6366f1", server: "#10b981", "branch→server": "#f59e0b" };
const OWNER_ICONS: Record<string, React.ReactNode> = {
  branch: <User size={14} className="text-indigo-500" />,
  server: <Server size={14} className="text-emerald-500" />,
  "branch→server": <ArrowRight size={14} className="text-amber-500" />,
};

export default function SplitLearningPage() {
  const [data, setData] = useState<SplitLearningResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showFL, setShowFL] = useState(true);
  const [showSL, setShowSL] = useState(true);

  useEffect(() => {
    hqSplitLearning().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>;

  const chartData = data.convergence.map((r) => ({ round: `R${r.Round}`, FL: r.FLAccuracy, SL: r.SLAccuracy }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Cpu size={22} className="text-teal" />Split Learning Demo
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Alternative privacy-preserving training: the model is split between branch and server — raw data never leaves the branch.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Architecture diagram */}
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Network Architecture (Split at Layer {data.cut_layer})</h2>
          <div className="space-y-2">
            {data.architecture.map((layer) => (
              <div key={layer.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${layer.id === data.cut_layer ? "border-amber-300 bg-amber-50" : "border-line bg-canvas"}`}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: OWNER_COLORS[layer.owner] ?? "#6366f1" }}>{layer.id}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink">{layer.name}</p>
                  <p className="text-xs text-ink-faint">{layer.neurons} neurons · {layer.activation}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {OWNER_ICONS[layer.owner]}
                  <span className="text-xs font-medium capitalize" style={{ color: OWNER_COLORS[layer.owner] }}>{layer.owner}</span>
                </div>
                {layer.id === data.cut_layer && <Badge variant="warning">CUT LAYER</Badge>}
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 bg-amber-50 rounded-xl text-xs text-amber-800">
            <strong>What is the cut layer?</strong> {data.split_description}
          </div>
        </Card>

        {/* Convergence chart */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Convergence Comparison</h2>
            <div className="flex gap-2">
              <button onClick={() => setShowFL((v) => !v)} className={`px-2 py-1 rounded text-xs font-medium ${showFL ? "bg-blue-100 text-teal-deep" : "bg-gray-100 text-ink-faint"}`}>FL</button>
              <button onClick={() => setShowSL((v) => !v)} className={`px-2 py-1 rounded text-xs font-medium ${showSL ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-ink-faint"}`}>SL</button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0.65, 0.90]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${((v ?? 0) * 100).toFixed(1)}%`, ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {showFL && <Line type="monotone" dataKey="FL" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} name="Federated Learning" />}
              {showSL && <Line type="monotone" dataKey="SL" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="6 2" name="Split Learning" />}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Comparison table */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">FL vs Split Learning — Feature Comparison</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-faint border-b border-line">
                <th className="text-left py-2.5 pr-4">Metric</th>
                <th className="text-center py-2.5 pr-4">
                  <span className="flex items-center gap-1 justify-center"><User size={12} className="text-blue-500" />Federated Learning</span>
                </th>
                <th className="text-center py-2.5 pr-4">
                  <span className="flex items-center gap-1 justify-center"><Cpu size={12} className="text-emerald-500" />Split Learning</span>
                </th>
                <th className="text-center py-2.5">Winner</th>
              </tr>
            </thead>
            <tbody>
              {data.comparison.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-canvas">
                  <td className="py-3 pr-4 font-medium text-ink text-xs">{row.metric}</td>
                  <td className="py-3 pr-4 text-center text-xs text-ink-soft">{row.fl}</td>
                  <td className="py-3 pr-4 text-center text-xs text-ink-soft">{row.sl}</td>
                  <td className="py-3 text-center">
                    {row.winner === "fl" && <Badge variant="default">FL ✓</Badge>}
                    {row.winner === "sl" && <Badge variant="success">SL ✓</Badge>}
                    {row.winner === "tie" && <span className="text-xs text-ink-faint">Tie</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
