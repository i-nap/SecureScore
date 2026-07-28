"use client";

import { useEffect, useState } from "react";
import { customerCashflow, type CashflowForecast } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Calendar, AlertTriangle, Info } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(v: number) {
  if (v >= 1_000_000) return `NPR ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `NPR ${(v / 1_000).toFixed(1)}K`;
  return `NPR ${Math.round(v)}`;
}

function fmtFull(v: number) {
  return `NPR ${Math.round(v).toLocaleString()}`;
}

// ─── custom tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: {name:string; value:number; color:string}[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-line rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-semibold text-ink mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-ink-soft">{p.name}:</span>
          <span className="font-semibold text-ink">{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── trend badge ────────────────────────────────────────────────────────────

function TrendPill({ trend }: { trend: string }) {
  const cfg = {
    increasing: { icon: <TrendingUp size={14} />, label: "Increasing", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    decreasing: { icon: <TrendingDown size={14} />, label: "Decreasing", cls: "bg-red-100 text-red-700 border-red-200" },
    stable:     { icon: <Minus size={14} />,       label: "Stable",     cls: "bg-blue-100 text-teal-deep border-blue-200" },
  }[trend] ?? { icon: <Minus size={14} />, label: trend, cls: "bg-gray-100 text-ink-soft border-line" };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── forecast card ──────────────────────────────────────────────────────────

function ForecastCard({ month, value, low, high, index }: {
  month: string; value: number; low: number; high: number; index: number;
}) {
  const gradients = [
    "from-teal to-teal-deep",
    "from-teal to-teal-deep",
    "from-teal to-teal-deep",
  ];
  const labels = ["Next Month", "Month +2", "Month +3"];
  const range  = high - low;
  const conf   = range > 0 ? Math.max(0, Math.min(100, Math.round((1 - range / value) * 100))) : 90;

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradients[index]} p-5 text-white shadow-lg`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-medium text-white/70 uppercase tracking-wider">{labels[index]}</p>
          <p className="text-lg font-bold mt-0.5">{month}</p>
        </div>
        <Calendar size={20} className="text-white/50" />
      </div>
      <p className="text-3xl font-extrabold tracking-tight">{fmt(value)}</p>
      <div className="mt-3 pt-3 border-t border-white/20">
        <p className="text-xs text-white/60">Confidence range</p>
        <p className="text-sm font-semibold text-white/90 mt-0.5">
          {fmt(low)} — {fmt(high)}
        </p>
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between text-xs text-white/60 mb-1">
          <span>Confidence</span>
          <span>{conf}%</span>
        </div>
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white/70 rounded-full" style={{ width: `${conf}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── summary stat ────────────────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-line last:border-0">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {sub && <p className="text-xs text-ink-faint mt-0.5">{sub}</p>}
      </div>
      <p className="text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function CashflowPage() {
  const [data, setData] = useState<CashflowForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");

  useEffect(() => {
    customerCashflow()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-ink-faint">Loading your cash flow forecast…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
        <p className="text-sm font-semibold text-red-700">Unable to load forecast</p>
        <p className="text-xs text-red-500 mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // Build combined chart data
  const historicalPoints = (data.historical_series ?? []).map((v, i) => ({
    month:    data.historical_months?.[i] ?? `M-${(data.historical_series?.length ?? 0) - i}`,
    Spending: Math.round(v),
    type:     "historical" as const,
  }));

  const forecastPoints = data.next_3_months.map((v, i) => ({
    month:    data.forecast_months[i] + "★",
    Forecast: Math.round(v),
    Low:      Math.round(data.confidence_low[i]),
    High:     Math.round(data.confidence_high[i]),
    type:     "forecast" as const,
  }));

  const avgLine = Math.round(data.historical_avg_monthly);

  const avgForecast = Math.round(
    data.next_3_months.reduce((a, b) => a + b, 0) / data.next_3_months.length,
  );
  const changeVsAvg = ((avgForecast - avgLine) / Math.max(avgLine, 1)) * 100;

  const hasFestival =
    data.seasonal_note && data.seasonal_note !== "No major festivals expected in forecast window";

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-white/50 uppercase tracking-widest font-semibold mb-1">
              Cash Flow Forecast · {data.branch}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">Spending Outlook</h1>
            <p className="text-sm text-white/60 mt-1">{data.method}</p>
          </div>
          <TrendPill trend={data.trend} />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-white/10">
          <div>
            <p className="text-xs text-white/50">Avg Monthly (hist.)</p>
            <p className="text-xl font-bold mt-0.5">{fmt(avgLine)}</p>
          </div>
          <div>
            <p className="text-xs text-white/50">Avg Forecast</p>
            <p className="text-xl font-bold mt-0.5">{fmt(avgForecast)}</p>
          </div>
          <div>
            <p className="text-xs text-white/50">vs Historical</p>
            <p className={`text-xl font-bold mt-0.5 ${changeVsAvg >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {changeVsAvg >= 0 ? "+" : ""}{changeVsAvg.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* ── Festival alert ──────────────────────────────────────────── */}
      {hasFestival && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4">
          <span className="text-2xl mt-0.5">🎉</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Festival Season Ahead</p>
            <p className="text-sm text-amber-700 mt-0.5">{data.seasonal_note}</p>
          </div>
        </div>
      )}

      {/* ── 3-month forecast cards ──────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-3">
          3-Month Forecast
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {data.next_3_months.map((val, i) => (
            <ForecastCard
              key={i}
              index={i}
              month={data.forecast_months[i]}
              value={val}
              low={data.confidence_low[i]}
              high={data.confidence_high[i]}
            />
          ))}
        </div>
      </div>

      {/* ── Combined history + forecast chart ──────────────────────── */}
      {historicalPoints.length > 0 && (
        <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-ink">Spending History & Forecast</h2>
              <p className="text-xs text-ink-faint mt-0.5">Last 12 months + 3-month projection</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1 rounded bg-blue-400 inline-block" />
                Historical
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1 rounded bg-violet-500 inline-block" />
                Forecast
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded border-t border-dashed border-gray-400 inline-block" />
                Avg
              </span>
            </div>
          </div>

          {/* Historical bars */}
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={historicalPoints} barCategoryGap="30%">
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.8} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
              <ReferenceLine y={avgLine} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="Spending" fill="url(#barGrad)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>

          {/* Forecast area with CI */}
          <div className="mt-4 pt-4 border-t border-line">
            <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-3">Forecast with Confidence Interval</p>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={forecastPoints}>
                <defs>
                  <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fcastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6d28d9" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="High"     stroke="transparent" fill="url(#ciGrad)" name="Upper CI" />
                <Area type="monotone" dataKey="Forecast" stroke="url(#fcastGrad)" strokeWidth={2.5} fill="url(#ciGrad)" dot={{ r: 5, fill: "#7c3aed", strokeWidth: 2, stroke: "#fff" }} name="Forecast" />
                <Area type="monotone" dataKey="Low"      stroke="transparent" fill="#fff" name="Lower CI" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Summary stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Info size={14} className="text-blue-500" />
            <h3 className="text-sm font-bold text-ink">Spending Summary</h3>
          </div>
          <StatRow
            label="Historical Avg Monthly"
            value={fmtFull(avgLine)}
            sub="Based on last 12 months"
          />
          <StatRow
            label="Projected Avg Monthly"
            value={fmtFull(avgForecast)}
            sub="Next 3 months ensemble"
          />
          <StatRow
            label="Change vs Historical"
            value={`${changeVsAvg >= 0 ? "+" : ""}${changeVsAvg.toFixed(1)}%`}
          />
          <StatRow
            label="Trend Direction"
            value={data.trend.charAt(0).toUpperCase() + data.trend.slice(1)}
          />
        </div>

        <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={14} className="text-violet-500" />
            <h3 className="text-sm font-bold text-ink">Month-by-Month</h3>
          </div>
          {data.next_3_months.map((val, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b border-line last:border-0">
              <div>
                <p className="text-sm font-medium text-ink">{data.forecast_months[i]}</p>
                <p className="text-xs text-ink-faint">
                  Range: {fmt(data.confidence_low[i])} – {fmt(data.confidence_high[i])}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-ink">{fmtFull(val)}</p>
                <p className="text-xs text-ink-faint">
                  {((val / Math.max(avgLine, 1) - 1) * 100).toFixed(1)}% vs avg
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
