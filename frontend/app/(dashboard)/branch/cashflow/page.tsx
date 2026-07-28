"use client";

import { useEffect, useState } from "react";
import { branchCashflowAggregate, type BranchCashflowAggregate } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Calendar, AlertTriangle, Users } from "lucide-react";

function fmt(v: number, currency = "NPR") {
  if (v >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`;
  return `${currency} ${Math.round(v)}`;
}

function TrendPill({ trend }: { trend: "increasing" | "decreasing" | "stable" }) {
  const cfg = {
    increasing: { icon: <TrendingUp size={14} />, label: "Increasing", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    decreasing: { icon: <TrendingDown size={14} />, label: "Decreasing", cls: "bg-red-100 text-red-700 border-red-200" },
    stable: { icon: <Minus size={14} />, label: "Stable", cls: "bg-blue-100 text-teal-deep border-blue-200" },
  }[trend];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function ForecastCard({ month, value, low, high, index, currency }: {
  month: string; value: number; low: number; high: number; index: number; currency: string;
}) {
  const gradients = [
    "from-teal to-teal-deep",
    "from-teal to-teal-deep",
    "from-teal to-teal-deep",
  ];
  const labels = ["Next Month", "Month +2", "Month +3"];
  const range = Math.max(0, high - low);
  const conf = value > 0 ? Math.max(0, Math.min(100, Math.round((1 - range / value) * 100))) : 80;

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradients[index]} p-5 text-white shadow-lg`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-medium text-white/70 uppercase tracking-wider">{labels[index]}</p>
          <p className="text-lg font-bold mt-0.5">{month}</p>
        </div>
        <Calendar size={20} className="text-white/50" />
      </div>
      <p className="text-3xl font-extrabold tracking-tight">{fmt(value, currency)}</p>
      <div className="mt-3 pt-3 border-t border-white/20">
        <p className="text-xs text-white/60">Confidence range</p>
        <p className="text-sm font-semibold text-white/90 mt-0.5">
          {fmt(low, currency)} - {fmt(high, currency)}
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

function ChartTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: { month: string; forecast: number; low: number; high: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-line rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-semibold text-ink mb-2">{p.month}</p>
      <p className="text-ink-soft">Forecast: {fmt(p.forecast)}</p>
      <p className="text-ink-soft text-xs mt-1">CI: {fmt(p.low)} - {fmt(p.high)}</p>
    </div>
  );
}

export default function BranchCashflowPage() {
  const [data, setData] = useState<BranchCashflowAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    branchCashflowAggregate()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-ink-faint">Loading branch cash flow forecast...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
        <p className="text-sm font-semibold text-red-700">Unable to load cash flow</p>
        <p className="text-xs text-red-500 mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const rows = data.forecast_months.map((month, i) => ({
    month,
    forecast: data.aggregate_forecast[i] ?? 0,
    low: data.confidence_low[i] ?? 0,
    high: data.confidence_high[i] ?? 0,
  }));

  const trend = (() => {
    if (rows.length < 2) return "stable" as const;
    const first = rows[0].forecast;
    const last = rows[rows.length - 1].forecast;
    if (last > first * 1.05) return "increasing" as const;
    if (last < first * 0.95) return "decreasing" as const;
    return "stable" as const;
  })();

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-white/50 uppercase tracking-widest font-semibold mb-1">
              Cash Flow Forecaster - {data.branch}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">Branch Aggregate Forecast</h1>
            <p className="text-sm text-white/60 mt-1">
              Exponential smoothing + 3-period MA ensemble
            </p>
          </div>
          <div className="text-right">
            <TrendPill trend={trend} />
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/60">
              <Users size={12} />
              {data.n_customers.toLocaleString()} customers
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-white/10">
          <div>
            <p className="text-xs text-white/50">Avg Monthly (hist.)</p>
            <p className="text-xl font-bold mt-0.5">{fmt(data.avg_monthly_historic, data.currency)}</p>
          </div>
          <div>
            <p className="text-xs text-white/50">Next 3 Months Avg</p>
            <p className="text-xl font-bold mt-0.5">
              {fmt(Math.round(rows.reduce((a, b) => a + b.forecast, 0) / Math.max(rows.length, 1)), data.currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-white/50">Confidence Bands</p>
            <p className="text-xl font-bold mt-0.5">+/- 1.5 sigma</p>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-3">
          3-Month Forecast
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {rows.map((r, i) => (
            <ForecastCard
              key={r.month}
              index={i}
              month={r.month}
              value={r.forecast}
              low={r.low}
              high={r.high}
              currency={data.currency}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold text-ink">Forecast Overview</h2>
            <p className="text-xs text-ink-faint mt-0.5">Aggregate branch spending projection</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={data.avg_monthly_historic} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="forecast" fill="#6366f1" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-ink-faint mt-3">
          Reference line shows historical average across the branch.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
        <h2 className="text-sm font-bold text-ink mb-4">Confidence Bands</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-soft uppercase tracking-wide border-b border-line">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Forecast</th>
                <th className="py-2 pr-4">Low</th>
                <th className="py-2 pr-4">High</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-medium text-ink">{r.month}</td>
                  <td className="py-2 pr-4 text-ink-soft">{fmt(r.forecast, data.currency)}</td>
                  <td className="py-2 pr-4 text-ink-soft">{fmt(r.low, data.currency)}</td>
                  <td className="py-2 pr-4 text-ink-soft">{fmt(r.high, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
