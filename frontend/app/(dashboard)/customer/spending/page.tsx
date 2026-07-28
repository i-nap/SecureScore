"use client";
import { useEffect, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { customerSpendingAnalytics, type SpendingResult } from "@/lib/api";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899"];

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp size={12} className="text-red-500" />;
  if (trend === "down") return <TrendingDown size={12} className="text-emerald-500" />;
  return <Minus size={12} className="text-ink-faint" />;
}

export default function SpendingPage() {
  const [data, setData] = useState<SpendingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerSpendingAnalytics().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>;

  const pieData = data.categories.slice(0, 6).map((c) => ({ name: c.name, value: c.amount }));
  const barData = data.months.map((m, i) => ({ month: m, total: data.monthly_totals[i] }));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-ink">Spending Analytics</h1>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            data.source === "ledger" ? "bg-teal-soft text-teal-deep" : "bg-gold-soft text-gold"
          }`}>
            {data.source === "ledger" ? "Live ledger" : "Illustrative"}
          </span>
        </div>
        <p className="text-sm text-ink-soft mt-1">{data.period} · Total avg NPR {data.total_monthly_avg.toLocaleString()}/month</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Spending Breakdown</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`NPR ${(v ?? 0).toLocaleString()}`, ""]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Monthly Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`NPR ${(v ?? 0).toLocaleString()}`, "Spending"]} />
              <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Category Details</h2>
        <div className="space-y-3">
          {data.categories.map((c, i) => (
            <div key={c.name} className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-sm text-ink w-36 shrink-0">{c.name}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${c.percent}%`, background: COLORS[i % COLORS.length] }} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0 w-32 justify-end">
                <TrendIcon trend={c.trend} />
                <span className="text-xs text-ink-soft">NPR {c.amount.toLocaleString()}</span>
                <span className="text-xs font-bold text-ink">{c.percent.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
