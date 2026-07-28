"use client";
import { useEffect, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { customerHealthScore, type HealthScoreResult, type HealthComponent } from "@/lib/api";
import { Heart, TrendingUp, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";

function GaugeArc({ score }: { score: number }) {
  const r = 80; const cx = 110; const cy = 110;
  const startAngle = 210; const sweepAngle = 120;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPath = (start: number, end: number) => {
    const s = { x: cx + r * Math.cos(toRad(start)), y: cy + r * Math.sin(toRad(start)) };
    const e = { x: cx + r * Math.cos(toRad(end)), y: cy + r * Math.sin(toRad(end)) };
    const large = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const endAngle = startAngle + (score / 100) * sweepAngle;
  const color = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="220" height="140" viewBox="0 0 220 140">
      <path d={arcPath(startAngle, startAngle + sweepAngle)} fill="none" stroke="#e5e7eb" strokeWidth="12" strokeLinecap="round" />
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" style={{ transition: "d 1s ease" }} />
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="32" fontWeight="bold" fill={color}>{Math.round(score)}</text>
      <text x={cx} y={cy + 28} textAnchor="middle" fontSize="11" fill="#9ca3af">out of 100</text>
    </svg>
  );
}

function ComponentBar({ c }: { c: HealthComponent }) {
  const color = c.status === "good" ? "bg-emerald-500" : c.status === "fair" ? "bg-amber-500" : "bg-red-500";
  const textColor = c.status === "good" ? "text-emerald-600" : c.status === "fair" ? "text-amber-600" : "text-red-600";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-ink">{c.name}</span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${textColor}`}>{c.score.toFixed(0)}/100</span>
          <span className="text-xs text-ink-faint">({(c.weight * 100).toFixed(0)}% weight)</span>
        </div>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${c.score}%` }} />
      </div>
      <p className="text-xs text-ink-faint flex items-center gap-1"><Info size={10} />{c.tip}</p>
    </div>
  );
}

export default function HealthScorePage() {
  const [data, setData] = useState<HealthScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerHealthScore().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>;

  const radarData = data.components.map((c) => ({ subject: c.name.split(" ")[0], score: c.score, fullMark: 100 }));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Heart size={22} className="text-rose-500" />Financial Health Score</h1>
        <p className="text-sm text-ink-soft mt-1">A holistic view of your financial wellness — beyond just credit.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="text-center">
          <h2 className="text-sm font-semibold text-ink mb-2">Overall Health Score</h2>
          <div className="flex justify-center"><GaugeArc score={data.overall_score} /></div>
          <div className={`inline-block mt-2 px-4 py-1 rounded-full text-sm font-bold ${data.grade === "Excellent" ? "bg-emerald-100 text-emerald-700" : data.grade === "Good" ? "bg-blue-100 text-teal-deep" : data.grade === "Fair" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
            {data.grade}
          </div>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Dimension Radar</h2>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
              <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(0)}`, "Score"]} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-5">Component Breakdown</h2>
        <div className="space-y-5">
          {data.components.map((c) => <ComponentBar key={c.name} c={c} />)}
        </div>
      </Card>

      <Card className="bg-teal-soft border-blue-200">
        <div className="flex items-start gap-3">
          <TrendingUp size={18} className="text-blue-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800 mb-1">How to improve your score</p>
            <ul className="space-y-1">
              {data.components.filter((c) => c.status !== "good").map((c) => (
                <li key={c.name} className="text-xs text-teal-deep flex items-start gap-1.5">
                  <AlertTriangle size={10} className="mt-0.5 shrink-0" />{c.tip}
                </li>
              ))}
              {data.components.every((c) => c.status === "good") && (
                <li className="text-xs text-teal-deep flex items-center gap-1.5"><CheckCircle2 size={11} />All components are in good standing — keep it up!</li>
              )}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
