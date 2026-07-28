"use client";

import { useEffect, useState } from "react";
import {
  branchUnifiedRisk,
  branchRiskDistribution,
  type UnifiedRisk,
  type BranchRiskDistribution,
} from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  Shield, AlertCircle, CheckCircle2, Info, Search,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const GRADE_CONFIG: Record<string, { label: string; bg: string; text: string; ring: string; bar: string; glow: string }> = {
  A: { label: "Excellent",     bg: "bg-emerald-500", text: "text-emerald-600", ring: "ring-emerald-400", bar: "bg-emerald-500", glow: "shadow-emerald-200" },
  B: { label: "Good",          bg: "bg-blue-500",    text: "text-teal",    ring: "ring-blue-400",    bar: "bg-blue-500",    glow: "shadow-blue-200" },
  C: { label: "Standard",      bg: "bg-amber-500",   text: "text-amber-600",   ring: "ring-amber-400",   bar: "bg-amber-500",   glow: "shadow-amber-200" },
  D: { label: "Elevated Risk", bg: "bg-orange-500",  text: "text-orange-600",  ring: "ring-orange-400",  bar: "bg-orange-500",  glow: "shadow-orange-200" },
  F: { label: "High Risk",     bg: "bg-red-500",     text: "text-red-600",     ring: "ring-red-400",     bar: "bg-red-500",     glow: "shadow-red-200" },
};

const DIM_COLORS: Record<string, string> = {
  credit: "#3b82f6",
  fraud: "#ef4444",
  aml: "#8b5cf6",
  churn: "#f59e0b",
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

export default function BranchUnifiedRiskPage() {
  const [distribution, setDistribution] = useState<BranchRiskDistribution | null>(null);
  const [distLoading, setDistLoading] = useState(true);
  const [distError, setDistError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [profile, setProfile] = useState<UnifiedRisk | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    branchRiskDistribution()
      .then(setDistribution)
      .catch((e) => setDistError(e.message))
      .finally(() => setDistLoading(false));
  }, []);

  const loadProfile = async () => {
    const trimmed = customerId.trim();
    if (!trimmed) {
      setProfileError("Enter a customer ID to load a unified risk profile.");
      return;
    }
    setProfileLoading(true);
    setProfileError("");
    setProfile(null);
    try {
      const res = await branchUnifiedRisk(trimmed);
      setProfile(res);
    } catch (e: unknown) {
      const msg = (e as Error).message;
      try { setProfileError(JSON.parse(msg)?.detail ?? msg); } catch { setProfileError(msg); }
    } finally {
      setProfileLoading(false);
    }
  };

  const histogramData = distribution
    ? Object.entries(distribution.histogram_buckets).map(([range, count]) => ({ range, count }))
    : [];

  const gradeCounts = distribution?.grade_distribution ?? { A: 0, B: 0, C: 0, D: 0, F: 0 };

  const profileGrade = profile?.composite_risk_grade ?? "C";
  const profileCfg = GRADE_CONFIG[profileGrade] ?? GRADE_CONFIG.C;

  const radarData = (profile?.radar_data ?? []).length > 0
    ? profile?.radar_data
    : Object.entries(profile?.risk_dimensions ?? {}).map(([k, v]) => ({
        axis: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: Math.round((v as number) * 100),
      }));

  const dimensionRows = Object.entries(profile?.risk_dimensions ?? {});

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">Unified Risk Engine - Branch View</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Composite Risk Distribution</h1>
            <p className="mt-1 text-slate-300 text-sm">
              Credit - Fraud - AML - Churn - Cash Flow - weighted composite score
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black">{distribution?.total_customers ?? 0}</p>
            <p className="text-ink-faint text-xs mt-0.5">Customers profiled</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "Avg Composite Risk", value: distribution ? `${Math.round(distribution.avg_composite_risk * 100)}/100` : "n/a" },
            { label: "High Risk Count", value: distribution?.high_risk_count ?? "n/a" },
            { label: "Grade Mix", value: `A${gradeCounts.A} | B${gradeCounts.B} | C${gradeCounts.C}` },
          ].map((s) => (
            <div key={s.label} className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-ink-faint mb-1">{s.label}</p>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {distLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {distError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {distError}
        </div>
      )}

      {distribution && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white rounded-2xl shadow-sm border border-line p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Risk Histogram</h2>
              <span className="text-xs text-ink-faint">Composite score buckets</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={histogramData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Grade Distribution</h2>
            <div className="space-y-3">
              {(["A", "B", "C", "D", "F"] as const).map((g) => (
                <div key={g} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink-soft">Grade {g}</span>
                  <span className="font-semibold text-ink">{gradeCounts[g]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {distribution && distribution.top_risk_customers?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-3">Top Risk Customers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-ink-soft uppercase tracking-wide border-b border-line">
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Composite Risk</th>
                </tr>
              </thead>
              <tbody>
                {distribution.top_risk_customers.map((c) => (
                  <tr key={c.customer_id} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-mono text-xs text-ink-soft">{c.customer_id}</td>
                    <td className="py-2 pr-4 text-ink">{Math.round(c.composite_risk_score * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Customer Risk Lookup</h2>
            <p className="text-xs text-ink-faint">Load a unified risk profile by customer ID</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="cust001"
              className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={loadProfile}
              disabled={profileLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-teal hover:bg-teal-deep active:bg-teal-deep text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
            >
              {profileLoading ? <Spinner size="sm" /> : <Search size={14} />}
              Load
            </button>
          </div>
        </div>

        {profileError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{profileError}</p>
          </div>
        )}

        {!profile && !profileLoading && !profileError && (
          <div className="text-center text-ink-faint text-sm py-10">
            Enter a customer ID to view their composite risk profile.
          </div>
        )}

        {profile && (
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wider">Customer {profile.customer_id}</p>
                <h3 className="text-lg font-bold text-ink">Unified Risk Profile</h3>
                <p className="text-xs text-ink-soft mt-1">Composite score with SHAP-style dimension weights</p>
              </div>
              <div className="text-right">
                <div className={`w-16 h-16 rounded-2xl ${profileCfg.bg} ring-4 ${profileCfg.ring} shadow-xl ${profileCfg.glow} flex items-center justify-center`}>
                  <span className="text-3xl font-black text-white">{profileGrade}</span>
                </div>
                <p className="text-xs text-ink-faint mt-1">{profileCfg.label}</p>
              </div>
            </div>

            {profile.action_required && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-800 font-semibold text-sm">Action Required</p>
                  <p className="text-red-700 text-sm mt-0.5">This customer has elevated risk indicators.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
                <h4 className="text-sm font-semibold text-ink mb-1">Risk Radar</h4>
                <p className="text-xs text-ink-faint mb-4">Higher values = higher risk</p>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: "#94a3b8" }} tickCount={5} />
                    <Radar name="Risk" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} dot={{ r: 4, fill: "#6366f1" }} />
                    <Tooltip content={<RadarTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
                <h4 className="text-sm font-semibold text-ink mb-4">Dimension Breakdown</h4>
                <div className="space-y-3.5">
                  {dimensionRows.map(([dim, val]) => {
                    const pct = Math.round((val as number) * 100);
                    const dimKey = dim.toLowerCase();
                    const barColor = pct >= 60 ? "bg-red-500" : pct >= 30 ? "bg-amber-400" : "bg-emerald-500";
                    const accentColor = DIM_COLORS[dimKey] ?? "#6366f1";
                    const weight = (profile.dimension_weights?.[dim] ?? 0) as number;
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
            </div>

            {(profile.recommendations ?? []).length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-line p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Info size={16} className="text-blue-500" />
                  <h4 className="text-sm font-semibold text-ink">Recommendations</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 bg-teal-soft border border-teal/20 rounded-xl px-4 py-3">
                      <CheckCircle2 size={15} className="text-blue-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-blue-800">{rec}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
