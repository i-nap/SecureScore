"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { customerRoboAdvice, type RoboAdvice } from "@/lib/api";
import { Card, StatCard, Button, Spinner, Badge } from "@/components/ui";
import { TrendingUp, DollarSign, PieChart as PieIcon } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

const PROFILES = [
  { key: "conservative", label: "Conservative", desc: "Lower risk, stable returns" },
  { key: "balanced", label: "Balanced", desc: "Moderate risk, diversified" },
  { key: "aggressive", label: "Aggressive", desc: "Higher risk, higher potential returns" },
];

export default function RoboAdvisorPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState("balanced");
  const [amount, setAmount] = useState(1000000);
  const [advice, setAdvice] = useState<RoboAdvice | null>(null);
  const [loading, setLoading] = useState(false);

  const getAdvice = async () => {
    setLoading(true);
    try {
      const res = await customerRoboAdvice(profile, amount);
      setAdvice(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const pieData = advice
    ? Object.entries(advice.portfolio).map(([name, value]) => ({
        name: name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        value: Math.round(value * 100),
      }))
    : [];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Robo Advisor</h1>
        <p className="text-sm text-ink-soft mt-1">
          Region-aware investment recommendations for{" "}
          <span className="capitalize">{user?.branch_type}</span> customers
        </p>
      </div>

      {/* Input form */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Configure Your Portfolio</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PROFILES.map((p) => (
            <button
              key={p.key}
              onClick={() => setProfile(p.key)}
              className={`rounded-xl border-2 px-4 py-4 text-left transition-all ${
                profile === p.key
                  ? "border-blue-500 bg-teal-soft"
                  : "border-line hover:border-gray-300"
              }`}
            >
              <p className="font-semibold text-ink text-sm">{p.label}</p>
              <p className="text-xs text-ink-soft mt-1">{p.desc}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-ink mb-1">
              Investment Amount (NPR)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              min={10000}
              step={100000}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <Button onClick={getAdvice} disabled={loading}>
            {loading ? <Spinner size="sm" /> : "Get Advice"}
          </Button>
        </div>
      </Card>

      {/* Results */}
      {advice && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="5-Year Projected (Mean)"
              value={`NPR ${(advice.projected_5yr.mean / 1000).toFixed(0)}K`}
              icon={<TrendingUp size={24} className="text-emerald-500" />}
              color="green"
            />
            <StatCard
              label="Optimistic (P90)"
              value={`NPR ${(advice.projected_5yr.p90 / 1000).toFixed(0)}K`}
              icon={<DollarSign size={24} className="text-blue-500" />}
              color="blue"
            />
            <StatCard
              label="Conservative (P10)"
              value={`NPR ${(advice.projected_5yr.p10 / 1000).toFixed(0)}K`}
              icon={<PieIcon size={24} className="text-amber-500" />}
              color="amber"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie chart */}
            <Card>
              <h2 className="text-sm font-semibold text-ink mb-3">Portfolio Allocation</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    label={({ name, value }) => `${name} ${value}%`}
                    labelLine
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `${Number(v)}%`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* Recommendations */}
            <Card>
              <h2 className="text-sm font-semibold text-ink mb-3">
                Recommendations{" "}
                <Badge variant="default">{advice.branch_type.replace(/_/g, " ")}</Badge>
              </h2>
              <ul className="space-y-3">
                {advice.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex gap-3 text-sm">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-teal flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-ink">{rec}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
