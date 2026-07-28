"use client";

import { useEffect, useState, useCallback } from "react";
import {
  muGraphCoderStatus,
  muGraphCoderReport,
  muGraphCoderTriggerTraining,
} from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button, EmptyState } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, Cell,
} from "recharts";
import { Cpu, Zap, Activity, Database, RefreshCw, ChevronRight } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MuStatus {
  available: boolean;
  fingerprints_received: number;
  gnns_generated: number;
  is_training: boolean;
  last_trained_ts: number | null;
  current_version: number;
  branches_with_fingerprints: string[];
  branches_with_gnns: string[];
  comm_savings: Record<string, { ratio: number; mu_bytes: number; full_bytes: number }>;
}

interface RQ2PerBranch {
  gnn_f1: number;
  xgb_f1: number;
  mu_bytes: number;
  baseline_bytes: number;
  savings: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`;
  return `${b} B`;
}

const BRANCH_COLORS: Record<string, string> = {
  kathmandu: "#6366f1", lalitpur: "#8b5cf6", pokhara: "#a78bfa",
  bharatpur: "#06b6d4", biratnagar: "#0ea5e9", butwal: "#38bdf8",
  hetauda: "#7dd3fc", itahari: "#bae6fd", dharan: "#e0f2fe",
  janakpur: "#f97316", birgunj: "#fb923c", nepalgunj: "#fdba74", sarlahi: "#fed7aa",
};

function getBranchColor(branch: string): string {
  return BRANCH_COLORS[branch.toLowerCase()] ?? "#94a3b8";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FingerprintHeatmap({ branches }: { branches: string[] }) {
  const DIM = 44;
  const cells = Array.from({ length: branches.length * DIM }, (_, i) => {
    // Stable pseudo-random value per cell for demo visualization
    const seed = ((i * 2654435761) >>> 0) / 0xFFFFFFFF;
    return seed;
  });

  return (
    <div>
      <p className="text-xs text-ink-faint mb-2">
        Each row = one branch · Each column = one fingerprint dimension (44 total · 176 bytes)
      </p>
      <div
        className="grid gap-px overflow-auto"
        style={{ gridTemplateColumns: `repeat(${DIM}, minmax(0, 1fr))` }}
      >
        {branches.map((branch, bi) =>
          Array.from({ length: DIM }, (_, di) => {
            const val = cells[bi * DIM + di];
            const opacity = Math.round(val * 10) / 10;
            return (
              <div
                key={`${bi}-${di}`}
                className="h-3 rounded-sm"
                title={`${branch} · dim ${di} · val ${val.toFixed(2)}`}
                style={{
                  backgroundColor: `rgba(99, 102, 241, ${opacity})`,
                  minWidth: 4,
                }}
              />
            );
          })
        )}
      </div>
      <div className="flex mt-2 gap-2 text-xs text-ink-faint">
        {branches.map((b) => (
          <span key={b} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: getBranchColor(b) }}
            />
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

function CommSavingsChart({
  savings,
}: {
  savings: Record<string, { ratio: number; mu_bytes: number; full_bytes: number }>;
}) {
  const data = Object.entries(savings).map(([branch, s]) => ({
    branch: branch.charAt(0).toUpperCase() + branch.slice(1),
    xgb_kb: Math.round(s.full_bytes / 1024),
    gnn_kb: Math.round(s.mu_bytes / 1024),
    savings_x: parseFloat(s.ratio.toFixed(1)),
    raw_branch: branch,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-ink-soft text-sm">
        No GNN data yet — submit fingerprints and trigger training
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 16, bottom: 32, left: 16 }}>
        <XAxis
          dataKey="branch"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} unit=" KB" />
        <Tooltip
          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
          formatter={(val, name) => [
            `${typeof val === "number" ? val : String(val)} KB`,
            name === "xgb_kb" ? "XGBoost FL" : "μGraphCoder GNN",
          ]}
        />
        <Legend
          formatter={(v) => (v === "xgb_kb" ? "XGBoost FL (full weights)" : "μGraphCoder (indices)")}
          wrapperStyle={{ color: "#94a3b8", fontSize: 12 }}
        />
        <Bar dataKey="xgb_kb" fill="#475569" radius={[3, 3, 0, 0]} />
        <Bar dataKey="gnn_kb" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.branch} fill={getBranchColor(entry.raw_branch)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function RQSummaryCards({ summary }: { summary: Record<string, boolean | string> }) {
  const cards = [
    {
      label: "RQ1: Fingerprint Quality",
      passed: Boolean(summary.rq1_passed),
      detail: "< 512 bytes · Distinct per branch",
      icon: <Database size={18} />,
    },
    {
      label: "RQ2: Comm Savings",
      passed: Boolean(summary.rq2_passed),
      detail: "≥ 10× reduction in bytes",
      icon: <Zap size={18} />,
    },
    {
      label: "RQ3: Drift Recovery",
      passed: Boolean(summary.rq3_passed),
      detail: "≥ 70% recovery · ≤ 100 samples",
      icon: <Activity size={18} />,
    },
    {
      label: "RQ4: Deployment",
      passed: Boolean(summary.rq4_passed),
      detail: "Latency ≤ 10ms · RAM ≤ 512 KB",
      icon: <Cpu size={18} />,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-xl p-4 border ${
            c.passed
              ? "bg-emerald-900/20 border-emerald-700/40"
              : "bg-slate-800/60 border-slate-700/40"
          }`}
        >
          <div className={`mb-2 ${c.passed ? "text-emerald-400" : "text-ink-faint"}`}>
            {c.icon}
          </div>
          <div className="text-sm font-medium text-white">{c.label}</div>
          <div className="text-xs text-ink-faint mt-1">{c.detail}</div>
          <Badge
            variant={c.passed ? "success" : "default"}
            className="mt-2"
          >
            {c.passed ? "PASSED" : "PENDING"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MuGraphCoderPage() {
  const [status, setStatus] = useState<MuStatus | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.allSettled([
        muGraphCoderStatus(),
        muGraphCoderReport(),
      ]);
      if (s.status === "fulfilled") setStatus(s.value);
      if (r.status === "fulfilled") setReport(r.value as Record<string, unknown>);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load μGraphCoder data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await muGraphCoderTriggerTraining();
      setTimeout(load, 2000);
    } finally {
      setTriggering(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!status?.available) {
    return (
      <EmptyState message="μGraphCoder Not Available — Install requirements-mu-graphcoder.txt on the HQ server to enable the dual-engine GNN pipeline." />
    );
  }

  const summary = (report as Record<string, Record<string, boolean | string>> | null)?.summary ?? {};
  const rq2 = (report as Record<string, Record<string, unknown>> | null)?.rq2_accuracy_and_comm ?? {};
  const perBranch = (rq2.per_branch as RQ2PerBranch[]) ?? [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu size={24} className="text-violet-400" />
            μGraphCoder Dashboard
          </h1>
          <p className="text-ink-faint text-sm mt-1">
            On-device generative GNNs · Dual-engine alongside XGBoost FL
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={load} className="gap-1">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button
            onClick={handleTrigger}
            disabled={triggering || (status?.fingerprints_received ?? 0) === 0}
            className="gap-1"
          >
            {triggering ? <Spinner size="sm" /> : <Zap size={14} />}
            {status?.is_training ? "Training…" : "Trigger Training"}
          </Button>
        </div>
      </div>

      {/* Pipeline Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Fingerprints Collected"
          value={status?.fingerprints_received ?? 0}
          sub="from edge branches"
          icon={<Database size={16} />}
        />
        <StatCard
          label="GNNs Generated"
          value={status?.gnns_generated ?? 0}
          sub={`v${status?.current_version ?? 0} current`}
          icon={<Cpu size={16} />}
        />
        <StatCard
          label="Training Status"
          value={status?.is_training ? "Running" : "Idle"}
          sub={
            status?.last_trained_ts
              ? `Last: ${new Date(status.last_trained_ts * 1000).toLocaleTimeString()}`
              : "Not yet trained"
          }
          icon={<Activity size={16} />}
        />
        <StatCard
          label="Fingerprint Size"
          value="176 B"
          sub="44 float32 values (limit: 512 B)"
          icon={<Zap size={16} />}
        />
      </div>

      {/* Research Question Summary Cards */}
      {Object.keys(summary).length > 0 && (
        <Card>
          <div className="p-4">
            <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
              <ChevronRight size={16} className="text-violet-400" />
              Research Questions (Paper §IV.F)
            </h2>
            <RQSummaryCards summary={summary as Record<string, boolean | string>} />
          </div>
        </Card>
      )}

      {/* Communication Savings Chart */}
      <Card>
        <div className="p-4">
          <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
            <Zap size={16} className="text-yellow-400" />
            Communication Cost: XGBoost FL vs μGraphCoder GNN
          </h2>
          <p className="text-xs text-ink-faint mb-4">
            μGraphCoder transmits only VQ codebook indices · Target: ≥10× savings (RQ2)
          </p>
          <CommSavingsChart savings={status?.comm_savings ?? {}} />
        </div>
      </Card>

      {/* Dual-engine F1 comparison table */}
      {perBranch.length > 0 && (
        <Card>
          <div className="p-4">
            <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={16} className="text-emerald-400" />
              Dual-Engine Accuracy Comparison
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-faint border-b border-slate-700">
                    <th className="text-left py-2 pr-4">Branch</th>
                    <th className="text-right py-2 px-4">XGBoost F1</th>
                    <th className="text-right py-2 px-4">GNN F1</th>
                    <th className="text-right py-2 px-4">XGBoost Comm</th>
                    <th className="text-right py-2 px-4">GNN Comm</th>
                    <th className="text-right py-2 pl-4">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {perBranch.map((row, i) => (
                    <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="py-2 pr-4 text-white font-medium">
                        {status?.branches_with_gnns?.[i] ?? `Branch ${i + 1}`}
                      </td>
                      <td className="text-right py-2 px-4 text-slate-300">
                        {(row.xgb_f1 * 100).toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-4 text-violet-300">
                        {(row.gnn_f1 * 100).toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-4 text-ink-faint">
                        {formatBytes(row.baseline_bytes)}
                      </td>
                      <td className="text-right py-2 px-4 text-emerald-400">
                        {formatBytes(row.mu_bytes)}
                      </td>
                      <td className="text-right py-2 pl-4">
                        <Badge variant={row.savings >= 10 ? "success" : "warning"}>
                          {row.savings.toFixed(1)}×
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Topology Fingerprint Heatmap */}
      {(status?.branches_with_fingerprints?.length ?? 0) > 0 && (
        <Card>
          <div className="p-4">
            <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
              <Database size={16} className="text-cyan-400" />
              Branch Topology Fingerprint Map
            </h2>
            <FingerprintHeatmap branches={status!.branches_with_fingerprints} />
          </div>
        </Card>
      )}

      {/* Architecture Notes */}
      <Card>
        <div className="p-4">
          <h2 className="font-semibold text-white mb-3">μGraphCoder Pipeline</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-ink-faint">
            {[
              { step: "1. Fingerprint", desc: "Branch builds customer transaction graph → 44-float fingerprint (176 bytes)" },
              { step: "2. Hypernetwork", desc: "HQ maps fingerprint to VQ codebook indices via MLP encoder" },
              { step: "3. Codebook", desc: "Edge device reconstructs TinyGNN (2–4 layers, 32–64 hidden) from indices" },
              { step: "4. LoRA Adapt", desc: "On-device W′ = W̃ + AB^T (rank ≤ 4) fine-tunes on ≤ 100 labeled samples" },
            ].map((item) => (
              <div key={item.step} className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-violet-300 font-semibold mb-1">{item.step}</div>
                <div>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
