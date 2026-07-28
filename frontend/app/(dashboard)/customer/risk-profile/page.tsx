"use client";

import { useEffect, useState } from "react";
import { customerRiskProfile, type UnifiedRisk } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { Shield, AlertCircle, CheckCircle2, Info } from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";

const GRADE_CONFIG: Record<string, { label: string; bg: string; text: string; ring: string; bar: string; glow: string }> = {
  A: { label: "Excellent",     bg: "bg-emerald-500", text: "text-emerald-600", ring: "ring-emerald-400", bar: "bg-emerald-500", glow: "shadow-emerald-200" },
  B: { label: "Good",          bg: "bg-blue-500",    text: "text-teal",    ring: "ring-blue-400",    bar: "bg-blue-500",    glow: "shadow-blue-200"   },
  C: { label: "Standard",      bg: "bg-amber-500",   text: "text-amber-600",   ring: "ring-amber-400",   bar: "bg-amber-500",   glow: "shadow-amber-200"  },
  D: { label: "Elevated Risk",  bg: "bg-orange-500",  text: "text-orange-600",  ring: "ring-orange-400",  bar: "bg-orange-500",  glow: "shadow-orange-200" },
  F: { label: "High Risk",      bg: "bg-red-500",     text: "text-red-600",     ring: "ring-red-400",     bar: "bg-red-500",     glow: "shadow-red-200"    },
};

const DIM_COLORS: Record<string, string> = {
  credit:   "#3b82f6",
  fraud:    "#ef4444",
  aml:      "#8b5cf6",
  churn:    "#f59e0b",
  cashflow: "#10b981",
};

const RadarTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { axis: string; value: number } }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-line rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-ink">{payload[0].payload.axis}</p>
      <p className="text-ink-soft">Risk score: {payload[0].payload.value.toFixed(1)}</p>
    </div>
  );
};

export default function RiskProfilePage() {
  const [data, setData] = useState<UnifiedRisk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerRiskProfile()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <Spinner size="lg" />
      <p className="text-ink-soft text-sm">Computing your risk profile…</p>
    </div>
  );

  if (error) return (
    <div className="m-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
  );

  if (!data) return null;

  const grade = data.composite_risk_grade ?? "C";
  const cfg = GRADE_CONFIG[grade] ?? GRADE_CONFIG.C;
  const scorePct = Math.round((data.composite_risk_score ?? 0) * 100);
  const healthPct = 100 - scorePct;

  // Build radar data from radar_data or risk_dimensions
  const radarData = (data.radar_data ?? []).length > 0
    ? data.radar_data
    : Object.entries(data.risk_dimensions ?? {}).map(([k, v]) => ({
        axis: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: Math.round((v as number) * 100),
      }));

  const dimensions = Object.entries(data.risk_dimensions ?? {});
  const sortedDrivers = dimensions
    .map(([dim, val]) => ({ dim, score: Math.round((val as number) * 100) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const driverTips: Record<string, string> = {
    credit: "Maintain on-time payments and keep utilization low.",
    fraud: "Avoid unusual spending spikes and verify merchant legitimacy.",
    aml: "Keep large transfers documented and avoid round-number patterns.",
    churn: "Increase account activity to maintain engagement signals.",
    cashflow: "Stabilize monthly inflow with consistent deposits.",
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 text-teal">
              <Shield size={20} />
              <span className="text-sm font-medium text-white/60">Unified Risk Engine · 5 Dimensions</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Your Risk Profile</h1>
            <p className="mt-1 text-white/55 text-sm">
              Credit · Fraud · AML · Churn · Cash Flow — weighted composite score
            </p>
          </div>
          <div className="text-right">
            <div className={`w-20 h-20 rounded-2xl ${cfg.bg} ring-4 ${cfg.ring} shadow-xl ${cfg.glow} flex items-center justify-center`}>
              <span className="text-4xl font-black text-white">{grade}</span>
            </div>
            <p className="text-white/50 text-xs mt-2">{cfg.label}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "Composite Risk Score", value: `${scorePct}/100` },
            { label: "Health Score",          value: `${healthPct}/100` },
            { label: "Primary Concern",        value: (data.primary_concern ?? "None").replace(/_/g, " ") },
          ].map((s) => (
            <div key={s.label} className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-ink-faint mb-1">{s.label}</p>
              <p className="text-lg font-bold capitalize">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action alert */}
      {data.action_required && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-800 font-semibold text-sm">Action Required</p>
            <p className="text-red-700 text-sm mt-0.5">
              Your risk profile has areas that need attention. Review the recommendations below.
            </p>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Radar chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Risk Radar</h2>
          <p className="text-xs text-ink-faint mb-4">Higher values = higher risk in each dimension</p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis
                dataKey="axis"
                tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}
              />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: "#94a3b8" }} tickCount={5} />
              <Radar
                name="Risk"
                dataKey="value"
                stroke="#0E7C66"
                fill="#0E7C66"
                fillOpacity={0.22}
                strokeWidth={2}
                dot={{ r: 4, fill: "#0E7C66" }}
              />
              <Tooltip content={<RadarTooltip />} />
            </RadarChart>
          </ResponsiveContainer>

          {/* Axis legend */}
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            {radarData.map((d) => (
              <div key={d.axis} className="flex items-center gap-1.5 text-xs text-ink-soft">
                <span className="w-2 h-2 rounded-full bg-teal inline-block" />
                <span>{d.axis}</span>
                <span className="font-semibold text-ink">{d.value.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dimension breakdown */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
            <h2 className="text-sm font-semibold text-ink mb-4">Dimension Breakdown</h2>
            <div className="space-y-3.5">
              {dimensions.map(([dim, val]) => {
                const pct = Math.round((val as number) * 100);
                const dimKey = dim.toLowerCase();
                const barColor = pct >= 60 ? "bg-red-500" : pct >= 30 ? "bg-amber-400" : "bg-emerald-500";
                const accentColor = DIM_COLORS[dimKey] ?? "#6366f1";
                const weight = (data.dimension_weights?.[dim] ?? 0) as number;
                return (
                  <div key={dim}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accentColor }} />
                        <span className="font-medium text-ink capitalize">{dim.replace(/_/g, " ")}</span>
                      </div>
                      <div className="flex items-center gap-2 text-ink-faint">
                        <span>weight {Math.round(weight * 100)}%</span>
                        <span className={`font-semibold ${pct >= 60 ? "text-red-600" : pct >= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Composite score gauge */}
          <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Composite Score</h2>
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-xl ${cfg.bg} flex items-center justify-center shadow-lg ${cfg.glow} ring-2 ${cfg.ring} shrink-0`}>
                <span className="text-2xl font-black text-white">{grade}</span>
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-xs text-ink-soft mb-1.5">
                  <span>Risk Score</span>
                  <span className="font-semibold text-ink">{scorePct} / 100</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${cfg.bar} rounded-full transition-all`} style={{ width: `${scorePct}%` }} />
                </div>
                <div className="flex justify-between text-xs text-ink-faint mt-1">
                  <span>Low risk</span>
                  <span>High risk</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {(data.recommendations ?? []).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} className="text-teal" />
            <h2 className="text-sm font-semibold text-ink">Personalized Recommendations</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-3 bg-teal-soft border border-teal/20 rounded-xl px-4 py-3">
                <CheckCircle2 size={15} className="text-teal shrink-0 mt-0.5" />
                <p className="text-sm text-teal-deep">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explainability drivers */}
      {sortedDrivers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">Top Risk Drivers</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sortedDrivers.map((d) => (
              <div key={d.dim} className="rounded-xl border border-line bg-canvas px-4 py-3">
                <p className="text-xs text-ink-faint">{d.dim.replace(/_/g, " ")}</p>
                <p className="text-lg font-semibold text-ink mt-0.5">{d.score}%</p>
                <p className="text-xs text-ink-soft mt-1">
                  {driverTips[d.dim] || "Maintain balanced financial behavior."}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-ink-faint text-center">
        Weights: Credit 35% · Fraud 25% · AML 20% · Churn 15% · Cash Flow 5%. Updated on each login.
      </p>
    </div>
  );
}
