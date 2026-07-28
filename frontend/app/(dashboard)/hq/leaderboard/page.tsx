"use client";
import { useEffect, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { hqBranchLeaderboard, type LeaderboardBranch } from "@/lib/api";
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";


function TrendIcon({ t }: { t: string }) {
  if (t === "up") return <TrendingUp size={13} className="text-emerald-500" />;
  if (t === "down") return <TrendingDown size={13} className="text-red-500" />;
  return <Minus size={13} className="text-ink-faint" />;
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState<keyof LeaderboardBranch>("overall_score");

  useEffect(() => {
    hqBranchLeaderboard().then((r) => setData(r.branches)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error}</div>;

  const top3 = data.slice(0, 3);
  const chartData = data.slice(0, 10).map((b) => ({ name: b.branch, value: Number(b[metric]) }));

  const METRICS = [
    { key: "overall_score", label: "Overall" }, { key: "fl_participation", label: "FL Participation" },
    { key: "model_accuracy", label: "Model Accuracy" }, { key: "approval_rate", label: "Approval Rate" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Trophy size={22} className="text-yellow-500" />Branch Performance Leaderboard</h1>
        <p className="text-sm text-ink-soft mt-1">Ranked by overall score across FL participation, model accuracy, approval rate, and growth.</p>
      </div>

      {/* Podium */}
      <div className="grid grid-cols-3 gap-4">
        {[top3[1], top3[0], top3[2]].map((b, i) => b && (
          <Card key={b.branch} className={`text-center ${i === 1 ? "bg-gradient-to-b from-yellow-50 to-white border-yellow-200 ring-2 ring-yellow-300" : ""}`}>
            <div className="text-3xl mb-2">{b.badge || `#${b.rank}`}</div>
            <p className="font-black text-ink">{b.branch}</p>
            <p className="text-xs text-ink-faint capitalize">{b.branch_type.replace("_","-")}</p>
            <p className={`text-2xl font-black mt-2 ${i === 1 ? "text-yellow-600" : "text-ink"}`}>{b.overall_score.toFixed(1)}</p>
            <p className="text-xs text-ink-faint">overall score</p>
          </Card>
        ))}
      </div>

      {/* Metric toggle */}
      <div className="flex gap-2 flex-wrap">
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key as keyof LeaderboardBranch)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${metric === m.key ? "bg-teal text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ink-faint border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4">Rank</th>
                  <th className="text-left py-3 px-4">Branch</th>
                  <th className="text-right py-3 px-4">Score</th>
                  <th className="text-center py-3 px-4">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.branch} className="border-b border-gray-50 hover:bg-canvas">
                    <td className="py-2.5 px-4">
                      {b.badge ? <span className="text-lg">{b.badge}</span> : <span className="text-sm font-bold text-ink-soft">#{b.rank}</span>}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-semibold text-ink text-sm">{b.branch}</p>
                      <p className="text-xs text-ink-faint capitalize">{b.branch_type.replace("_","-")}</p>
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-ink">{b.overall_score.toFixed(1)}</td>
                    <td className="py-2.5 px-4 text-center"><TrendIcon t={b.trend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-4">Top 10 — {METRICS.find(m => m.key === metric)?.label}</h2>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(2)}`, ""]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={i === 0 ? "#f59e0b" : i === 1 ? "#9ca3af" : i === 2 ? "#b45309" : "#6366f1"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>
    </div>
  );
}
