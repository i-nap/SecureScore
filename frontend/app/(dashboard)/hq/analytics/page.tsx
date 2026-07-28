"use client";

import { useMemo, useState, useEffect } from "react";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { BarChart3, Activity, TrendingUp, SlidersHorizontal, Medal, Trophy, Info } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from "recharts";
import { hqBranchContributions, type BranchContribution } from "@/lib/api";

function formatPct(v: number) {
  return `${v.toFixed(1)}%`;
}

const BRANCH_TYPE_LABELS: Record<string, string> = {
  urban: "Urban",
  semi_urban: "Semi-Urban",
  rural: "Rural",
};

const TYPE_COLORS: Record<string, string> = {
  urban: "#6366f1",
  semi_urban: "#f59e0b",
  rural: "#10b981",
};

function MedalBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-500 font-black text-lg">🥇</span>;
  if (rank === 2) return <span className="text-ink-faint font-black text-lg">🥈</span>;
  if (rank === 3) return <span className="text-amber-700 font-black text-lg">🥉</span>;
  return <span className="text-ink-faint text-sm font-bold">#{rank}</span>;
}

export default function HqAnalyticsPage() {
  const [stress, setStress] = useState(20);
  const [macro, setMacro] = useState(0.0);
  const [fraudSpike, setFraudSpike] = useState(10);

  // Branch Contribution Leaderboard state
  const [contributions, setContributions] = useState<BranchContribution[]>([]);
  const [contribMeta, setContribMeta] = useState({ method: "", rounds_analyzed: 0 });
  const [contribLoading, setContribLoading] = useState(true);
  const [contribError, setContribError] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    hqBranchContributions()
      .then((r) => {
        setContributions(r.contributions);
        setContribMeta({ method: r.method, rounds_analyzed: r.rounds_analyzed });
      })
      .catch((e) => setContribError(e.message || "Failed to load branch contributions"))
      .finally(() => setContribLoading(false));
  }, []);

  const trend = useMemo(() => {
    const base = Array.from({ length: 12 }, (_, i) => {
      const month = new Date(2026, i, 1).toLocaleString("en-US", { month: "short" });
      const baseRisk = 22 + i * 0.6 + Math.sin(i / 2) * 2;
      return { month, baseRisk };
    });

    return base.map((m) => {
      const stressImpact = stress * 0.35;
      const macroImpact = macro * 12;
      const fraudImpact = fraudSpike * 0.2;
      const combined = Math.min(100, Math.max(0, m.baseRisk + stressImpact + macroImpact + fraudImpact));
      return {
        month: m.month,
        baseline: Number(m.baseRisk.toFixed(1)),
        stressed: Number(combined.toFixed(1)),
      };
    });
  }, [stress, macro, fraudSpike]);

  const segment = useMemo(() => {
    const retail = 38 + macro * 10 - stress * 0.1;
    const sme = 26 + stress * 0.2 + fraudSpike * 0.1;
    const agri = 18 + macro * 5 + stress * 0.15;
    const corporate = 12 + macro * 6;
    return [
      { name: "Retail", value: Math.max(5, Math.min(60, retail)) },
      { name: "SME", value: Math.max(5, Math.min(50, sme)) },
      { name: "Agriculture", value: Math.max(5, Math.min(40, agri)) },
      { name: "Corporate", value: Math.max(5, Math.min(35, corporate)) },
    ];
  }, [stress, macro, fraudSpike]);

  const earlyWarnings = useMemo(() => {
    return [
      { label: "Delinquency Signal", score: Math.min(100, 35 + stress * 1.2 + macro * 8) },
      { label: "Liquidity Pressure", score: Math.min(100, 30 + macro * 15 + fraudSpike * 0.4) },
      { label: "Fraud Volatility", score: Math.min(100, 25 + fraudSpike * 2.5) },
    ];
  }, [stress, macro, fraudSpike]);

  const portfolioHealth = Math.max(5, 100 - stress - fraudSpike * 0.8 - macro * 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">HQ Scenario Lab</h1>
        <p className="text-sm text-ink-soft mt-1">
          Stress-test portfolio resilience and simulate macro shocks across the network.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Portfolio Health" value={`${Math.round(portfolioHealth)}/100`} icon={<Activity size={24} />} color={portfolioHealth > 70 ? "green" : portfolioHealth > 45 ? "amber" : "red"} />
        <StatCard label="Stress Index" value={`${stress}/100`} icon={<SlidersHorizontal size={24} />} color={stress < 35 ? "green" : stress < 60 ? "amber" : "red"} />
        <StatCard label="Fraud Spike" value={formatPct(fraudSpike)} icon={<TrendingUp size={24} />} color={fraudSpike < 20 ? "green" : fraudSpike < 35 ? "amber" : "red"} />
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Scenario Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-ink-soft">Stress Level</label>
            <input
              type="range"
              min={0}
              max={100}
              value={stress}
              onChange={(e) => setStress(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-ink-faint mt-1">{stress}/100</p>
          </div>
          <div>
            <label className="text-xs text-ink-soft">Macro Shock</label>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.1}
              value={macro}
              onChange={(e) => setMacro(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-ink-faint mt-1">{macro.toFixed(1)}</p>
          </div>
          <div>
            <label className="text-xs text-ink-soft">Fraud Spike</label>
            <input
              type="range"
              min={0}
              max={60}
              value={fraudSpike}
              onChange={(e) => setFraudSpike(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-ink-faint mt-1">{fraudSpike}%</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">12-Month Risk Trajectory</h2>
            <span className="text-xs text-ink-faint">Baseline vs stressed</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area dataKey="baseline" stroke="#60a5fa" fill="#93c5fd" fillOpacity={0.4} name="Baseline" />
              <Area dataKey="stressed" stroke="#f97316" fill="#fed7aa" fillOpacity={0.5} name="Stressed" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Exposure by Segment</h2>
            <span className="text-xs text-ink-faint">Dynamic under stress</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={segment}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-blue-500" />
          <h2 className="text-sm font-semibold text-ink">Early Warning Signals</h2>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={earlyWarnings}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="score" stroke="#0f172a" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── Branch Contribution Leaderboard (Federated Shapley) ── */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <Trophy size={20} className="text-yellow-500" />
              Branch Contribution Leaderboard
            </h2>
            <p className="text-sm text-ink-soft mt-0.5">
              {contribMeta.method} · {contribMeta.rounds_analyzed} rounds analyzed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-soft">Filter by type:</span>
            {["all", "urban", "semi_urban", "rural"].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === t
                    ? "bg-teal text-white"
                    : "bg-gray-100 text-ink-soft hover:bg-gray-200"
                }`}
              >
                {t === "all" ? "All" : BRANCH_TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>
        </div>

        {contribLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : contribError ? (
          <div className="text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm">{contribError}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Leaderboard table */}
            <Card>
              <div className="flex items-center gap-1.5 mb-4">
                <Medal size={15} className="text-yellow-500" />
                <h3 className="text-sm font-semibold text-ink">Ranked Contributions</h3>
                <div className="ml-auto flex items-center gap-1 text-xs text-ink-faint bg-canvas rounded-lg px-2 py-1 cursor-default group relative">
                  <Info size={11} />
                  <span className="hidden group-hover:block absolute right-0 top-6 z-10 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                    Contribution score approximates how much model quality would drop if this branch were excluded (Leave-One-Out Shapley)
                  </span>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ink-faint border-b border-line">
                      <th className="text-left py-2 pr-3">Rank</th>
                      <th className="text-left py-2 pr-3">Branch</th>
                      <th className="text-right py-2 pr-3">Score</th>
                      <th className="text-right py-2 pr-3">Part. Rate</th>
                      <th className="text-right py-2 pr-3">Avg F1</th>
                      <th className="text-right py-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributions
                      .filter((c) => typeFilter === "all" || c.branch_type === typeFilter)
                      .map((c) => (
                        <tr key={c.branch} className="border-b border-gray-50 hover:bg-canvas transition-colors">
                          <td className="py-2 pr-3 w-10">
                            <MedalBadge rank={c.rank} />
                          </td>
                          <td className="py-2 pr-3 font-medium text-ink">{c.branch}</td>
                          <td className="py-2 pr-3 text-right font-mono text-teal-deep font-bold">
                            {c.contribution_score.toFixed(5)}
                          </td>
                          <td className="py-2 pr-3 text-right text-ink-soft">
                            {(c.participation_rate * 100).toFixed(0)}%
                          </td>
                          <td className="py-2 pr-3 text-right text-ink-soft">
                            {c.avg_local_f1.toFixed(3)}
                          </td>
                          <td className="py-2 text-right">
                            <Badge
                              variant={
                                c.branch_type === "urban"
                                  ? "default"
                                  : c.branch_type === "semi_urban"
                                  ? "warning"
                                  : "success"
                              }
                            >
                              {BRANCH_TYPE_LABELS[c.branch_type] ?? c.branch_type}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Contribution bar chart */}
            <Card>
              <h3 className="text-sm font-semibold text-ink mb-4">Contribution Scores by Branch</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={contributions
                    .filter((c) => typeFilter === "all" || c.branch_type === typeFilter)
                    .slice(0, 13)}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(4)} />
                  <YAxis dataKey="branch" type="category" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    formatter={((value: number | undefined, _: string, props: { payload?: BranchContribution }) => [
                      (value ?? 0).toFixed(6),
                      `Contribution (${props.payload?.branch_type ?? ""})`,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ]) as any}
                  />
                  <Bar dataKey="contribution_score" radius={[0, 4, 4, 0]}>
                    {contributions
                      .filter((c) => typeFilter === "all" || c.branch_type === typeFilter)
                      .slice(0, 13)
                      .map((c) => (
                        <Cell key={c.branch} fill={TYPE_COLORS[c.branch_type] ?? "#6366f1"} />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 justify-center">
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
                    {BRANCH_TYPE_LABELS[type]}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
