"use client";

import { useEffect, useState } from "react";
import { branchCashDemand, type CashDemand } from "@/lib/api";
import { StatCard, Spinner, Card } from "@/components/ui";
import { Banknote, TrendingUp, Vault, CalendarClock, Info } from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const lakh = (n: number) => {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  return n.toLocaleString("en-NP");
};
const npr = (n: number) => "NPR " + lakh(n);
const shortDate = (s: string) => s.slice(5); // MM-DD

export default function CashDemandPage() {
  const [data, setData] = useState<CashDemand | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    branchCashDemand().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!data) return null;

  // One series: history (solid) then forecast (dashed) with a confidence band.
  const chart = [
    ...data.history.map((h) => ({ date: shortDate(h.date), history: h.demand })),
    ...data.forecast.map((f) => ({
      date: shortDate(f.date), forecast: f.demand, lower: f.lower, band: f.upper - f.lower,
    })),
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <Banknote size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Liquidity planning · Branch-local model</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Cash Demand Forecast</h1>
        <p className="mt-1 text-white/55 text-sm capitalize">{data.branch_id} branch · 7-day vault &amp; ATM cash projection</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Avg daily demand" value={npr(data.avg_daily_demand)} icon={<TrendingUp size={18} />} color="teal" />
        <StatCard label="7-day peak" value={npr(data.peak.demand)} sub={`on ${data.peak.date}`} icon={<CalendarClock size={18} />} color="gold" />
        <StatCard label="Recommended vault float" value={npr(data.recommended_vault_float)} sub="peak + 15% buffer" icon={<Vault size={18} />} color="teal" />
      </div>

      {/* Chart */}
      <Card>
        <h2 className="font-display text-lg font-semibold text-ink mb-1">Daily cash outflow — 14d actual + 7d forecast</h2>
        <p className="text-xs text-ink-faint mb-4">Solid = recorded / modelled history · dashed = forecast · shaded = ±15% band</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chart} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8a97ac" }} tickLine={false} axisLine={{ stroke: "#e6e9ef" }} />
            <YAxis tickFormatter={(v) => lakh(v as number)} tick={{ fontSize: 11, fill: "#8a97ac" }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              formatter={(v: number | string | undefined, name) => [npr(Number(v ?? 0)), name === "history" ? "Actual/Model" : name === "forecast" ? "Forecast" : String(name)]}
              contentStyle={{ borderRadius: 12, border: "1px solid #e6e9ef", fontSize: 12 }}
            />
            {/* Confidence band: transparent base + translucent height (stacked). */}
            <Area stackId="band" dataKey="lower" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area stackId="band" dataKey="band" stroke="none" fill="#0E7C66" fillOpacity={0.12} isAnimationActive={false} />
            <Line dataKey="history" stroke="#0E7C66" strokeWidth={2.5} dot={false} connectNulls />
            <Line dataKey="forecast" stroke="#0E7C66" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3, fill: "#0E7C66" }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Drivers */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-teal" />
          <h2 className="font-display text-lg font-semibold text-ink">What drives the forecast</h2>
        </div>
        <ul className="space-y-2">
          {data.drivers.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal shrink-0" />{d}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-faint border-t border-line pt-3">{data.method}</p>
      </Card>
    </div>
  );
}
