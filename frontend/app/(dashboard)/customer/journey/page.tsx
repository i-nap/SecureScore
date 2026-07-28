"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { customerScoreHistory, type ScoreHistoryPoint } from "@/lib/api";
import { Card, StatCard, Badge } from "@/components/ui";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Award, Calendar } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────

function gradeVariant(grade: string): "success" | "warning" | "danger" | "default" {
  if (grade === "A" || grade === "B") return "success";
  if (grade === "C") return "warning";
  if (grade === "D") return "warning";
  return "danger";
}

function deltaVariant(delta: number): "success" | "danger" | "default" {
  if (delta > 0.003) return "success";
  if (delta < -0.003) return "danger";
  return "default";
}

function deltaIcon(delta: number) {
  if (delta > 0.003) return <TrendingUp size={13} />;
  if (delta < -0.003) return <TrendingDown size={13} />;
  return <Minus size={13} />;
}

function borderColor(delta: number): string {
  if (delta > 0.003) return "border-l-emerald-500";
  if (delta < -0.003) return "border-l-red-400";
  return "border-l-gray-300";
}

function cardBg(delta: number): string {
  if (delta > 0.003) return "bg-emerald-50/40";
  if (delta < -0.003) return "bg-red-50/40";
  return "bg-canvas/40";
}

// Custom dot for the line chart
const CustomDot = (props: {
  cx?: number;
  cy?: number;
  payload?: ScoreHistoryPoint;
}) => {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const color =
    payload.delta > 0.003 ? "#10b981" : payload.delta < -0.003 ? "#ef4444" : "#6b7280";
  return (
    <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={2} />
  );
};

// Custom tooltip
const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: ScoreHistoryPoint }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-line shadow-md rounded-xl px-3 py-2.5 text-xs">
      <p className="font-semibold text-ink mb-1">Round {d.round} — {label}</p>
      <p className="text-ink-soft">Score: <span className="font-bold text-ink">{(d.score * 100).toFixed(1)}%</span></p>
      <p className={d.delta >= 0 ? "text-emerald-600" : "text-red-600"}>
        Change: {d.delta >= 0 ? "+" : ""}{(d.delta * 100).toFixed(1)}%
      </p>
      <p className="text-ink-faint mt-1 max-w-48 leading-snug">{d.reason}</p>
    </div>
  );
};

// ── Skeleton ─────────────────────────────────────────────────

function JourneySkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <div>
        <div className="h-7 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-80" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="rounded-xl bg-gray-100 h-20" />)}
      </div>
      <div className="rounded-2xl bg-gray-100 h-64" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="rounded-xl bg-gray-100 h-16" />)}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function JourneyPage() {
  const { user } = useAuth();
  const [history, setHistory] = useState<ScoreHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerScoreHistory()
      .then((d) => setHistory(d.history))
      .catch((e) => setError(e.message ?? "Failed to load journey"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <JourneySkeleton />;

  if (error || !history.length) {
    return (
      <Card className="max-w-xl">
        <p className="text-red-600 text-sm text-center py-6">
          {error || "No journey data available."}
        </p>
      </Card>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];
  const totalImprovement = last.score - first.score;
  const improving = last.score >= first.score;

  // Chart data
  const chartData = history.map((h) => ({
    ...h,
    scorePercent: parseFloat((h.score * 100).toFixed(1)),
    label: h.date.slice(5), // MM-DD
  }));

  // Overall trend — majority of deltas
  const positiveRounds = history.filter((h) => h.delta > 0.003).length;
  const trendColor = positiveRounds >= history.length / 2 ? "#3b82f6" : "#f59e0b";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">Credit Journey</h1>
        <p className="text-sm text-ink-soft mt-1">
          Your score evolution across federated learning rounds
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Starting Score"
          value={`${(first.score * 100).toFixed(1)}%`}
          sub={`Grade ${first.grade}`}
          icon={<Calendar size={22} className="text-blue-400" />}
          color="blue"
        />
        <StatCard
          label="Current Score"
          value={`${(last.score * 100).toFixed(1)}%`}
          sub={`Grade ${last.grade}`}
          icon={<Award size={22} className={improving ? "text-emerald-500" : "text-amber-500"} />}
          color={improving ? "green" : "amber"}
        />
        <StatCard
          label="Total Improvement"
          value={`${totalImprovement >= 0 ? "+" : ""}${(totalImprovement * 100).toFixed(1)}%`}
          sub={`across ${history.length} rounds`}
          icon={
            totalImprovement >= 0
              ? <TrendingUp size={22} className="text-emerald-500" />
              : <TrendingDown size={22} className="text-red-500" />
          }
          color={totalImprovement >= 0 ? "green" : "red"}
        />
        <StatCard
          label="Rounds Included"
          value={history.length}
          sub={`${positiveRounds} improving`}
          color="purple"
        />
      </div>

      {/* Line / Area chart */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-1">Score Over Time</h2>
        <p className="text-xs text-ink-faint mb-4">
          Each dot represents one federated learning round. Hover for details.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={trendColor} stopOpacity={0.15} />
                <stop offset="95%" stopColor={trendColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={50} stroke="#d1d5db" strokeDasharray="4 4" label={{ value: "50%", position: "right", fontSize: 10, fill: "#9ca3af" }} />
            <Area
              type="monotone"
              dataKey="scorePercent"
              stroke={trendColor}
              strokeWidth={2.5}
              fill="url(#scoreGrad)"
              dot={<CustomDot />}
              activeDot={{ r: 6, fill: trendColor, stroke: "white", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Event timeline */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Round-by-Round Timeline</h2>
        <div className="relative space-y-3">
          {/* Vertical line */}
          <div className="absolute left-5 top-2 bottom-2 w-0.5 bg-gray-100" />

          {[...history].reverse().map((h) => (
            <div
              key={h.round}
              className={`relative ml-11 rounded-xl border-l-4 ${borderColor(h.delta)} ${cardBg(h.delta)} border border-line px-4 py-3`}
            >
              {/* Timeline dot */}
              <div className={`absolute -left-[26px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow ${
                h.delta > 0.003 ? "bg-emerald-500" : h.delta < -0.003 ? "bg-red-400" : "bg-gray-300"
              }`} />

              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink-soft">Round {h.round}</span>
                  <span className="text-xs text-ink-faint">{h.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={gradeVariant(h.grade)} className="text-xs">
                    {h.grade} · {(h.score * 100).toFixed(1)}%
                  </Badge>
                  <Badge variant={deltaVariant(h.delta)} className="text-xs flex items-center gap-1">
                    {deltaIcon(h.delta)}
                    {h.delta >= 0 ? "+" : ""}{(h.delta * 100).toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-ink-soft mt-1 leading-snug">{h.reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <p className="text-xs text-ink-faint text-center pb-2">
        Scores are computed by the {user?.branch_id?.replace(/_/g, " ")} branch federated model, updated each aggregation round.
      </p>
    </div>
  );
}
