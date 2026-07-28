"use client";

import { useEffect, useRef, useState } from "react";
import {
  hqRoundHistory,
  hqStatus,
  hqTriggerAggregation,
  subscribeToRoundEvents,
  type HqStatus,
  type RoundEvent,
  type RoundEventType,
  type RoundHistory,
} from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button, EmptyState } from "@/components/ui";
import { Globe, Play, Layers, Users, TrendingUp, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

const BRANCH_TYPE: Record<string, "urban" | "semi_urban" | "rural"> = {
  kathmandu: "urban",
  lalitpur: "urban",
  pokhara: "urban",
  bharatpur: "semi_urban",
  biratnagar: "semi_urban",
  butwal: "semi_urban",
  hetauda: "semi_urban",
  itahari: "semi_urban",
  dharan: "semi_urban",
  janakpur: "rural",
  birgunj: "rural",
  nepalgunj: "rural",
  sarlahi: "rural",
};

// ── Round lifecycle stages ────────────────────────────────

type StageStatus = "pending" | "active" | "complete" | "error";

interface Stage {
  id: string;
  label: string;
  detail: string;
  status: StageStatus;
}

const INITIAL_STAGES: Stage[] = [
  { id: "round_started",      label: "Round Started",        detail: "", status: "pending" },
  { id: "branches_submitting",label: "Branches Submitting",  detail: "", status: "pending" },
  { id: "validation",         label: "Validation",           detail: "", status: "pending" },
  { id: "aggregating",        label: "FedAvg Aggregation",   detail: "", status: "pending" },
  { id: "round_complete",     label: "Model Published",      detail: "", status: "pending" },
];

function applyEvent(stages: Stage[], event: RoundEvent): Stage[] {
  const next = stages.map((s) => ({ ...s }));

  const set = (id: string, status: StageStatus, detail: string) => {
    const s = next.find((x) => x.id === id);
    if (s) { s.status = status; s.detail = detail; }
  };

  switch (event.type) {
    case "round_started":
      set("round_started", "complete",
        `Round ${event.round} — ${(event.data.n_submissions as number) ?? 0} submissions`);
      set("branches_submitting", "active", "Waiting for branch weights…");
      break;

    case "branch_submitted": {
      const soFar = event.data.submissions_so_far as number ?? 0;
      const needed = event.data.min_needed as number ?? 0;
      const branch = event.data.branch as string ?? "Unknown";
      set("branches_submitting", soFar >= needed ? "complete" : "active",
        `${branch} submitted (${soFar}/${needed})`);
      if (soFar >= needed) set("validation", "active", "Checking integrity…");
      break;
    }

    case "validation_passed":
      set("validation", "complete", `Passed — ${event.data.branch as string}`);
      break;

    case "validation_failed":
      set("validation", "error", `Failed — ${event.data.branch as string}: ${event.data.reason as string}`);
      break;

    case "byzantine_detected":
      set("validation", "error",
        `Byzantine reject — ${event.data.branch as string}`);
      break;

    case "aggregating":
      set("branches_submitting", "complete", `${(event.data.n_submissions as number) ?? 0} branches`);
      set("validation", "complete", "All checks passed");
      set("aggregating", "active", "Running FedAvg…");
      break;

    case "round_complete":
      set("aggregating", "complete",
        `${(event.data.branches_included as string[])?.length ?? 0} branches, ${(event.data.total_training_samples as number)?.toLocaleString() ?? 0} samples`);
      set("round_complete", "complete", `v${event.data.version as number} published`);
      break;

    default:
      break;
  }

  return next;
}

// ── Stage icon component ──────────────────────────────────

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "complete")
    return <CheckCircle2 size={22} className="text-green-500" />;
  if (status === "active")
    return (
      <span className="inline-flex items-center justify-center w-5 h-5">
        <span className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </span>
    );
  if (status === "error")
    return <AlertTriangle size={22} className="text-red-500" />;
  return <Circle size={22} className="text-gray-300" />;
}

// ── Main page ─────────────────────────────────────────────

export default function FederationPage() {
  const [status, setStatus]       = useState<HqStatus | null>(null);
  const [rounds, setRounds]       = useState<RoundHistory["rounds"]>([]);
  const [loading, setLoading]     = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [stages, setStages]       = useState<Stage[]>(INITIAL_STAGES);
  const [eventLog, setEventLog]   = useState<RoundEvent[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch initial data ──────────────────────────────────
  useEffect(() => {
    Promise.all([
      hqStatus().catch(() => null),
      hqRoundHistory().catch(() => null),
    ]).then(([s, r]) => {
      if (s) { setStatus(s); setCurrentRound(s.current_round ?? 0); }
      if (r) setRounds(r.rounds || []);
      setLoading(false);
    });
  }, []);

  // ── Subscribe to SSE stream ─────────────────────────────
  useEffect(() => {
    const cleanup = subscribeToRoundEvents(
      (event) => {
        if (event.type === "connected") {
          setConnected(true);
          return;
        }

        // Update round number from stream
        if (event.round) setCurrentRound(event.round);

        // Rebuild stage state
        setStages((prev) => applyEvent(prev, event));

        // Append to scrollable log
        setEventLog((prev) => [event, ...prev].slice(0, 100));

        // If round completed, refresh round history
        if (event.type === "round_complete") {
          hqRoundHistory().then((r) => {
            if (r) setRounds(r.rounds || []);
          }).catch(() => {});
          hqStatus().then((s) => {
            if (s) setStatus(s);
          }).catch(() => {});
          // Reset stages after 3 s for the next round
          setTimeout(() => setStages(INITIAL_STAGES), 3000);
        }
      },
      () => setConnected(false),
    );

    return cleanup;
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLog]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await hqTriggerAggregation();
      const s = await hqStatus();
      setStatus(s);
      const r = await hqRoundHistory();
      setRounds(r.rounds || []);
    } catch {
      // ignore
    }
    setTriggering(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const normalizedRounds = rounds.map((r) => ({
    round: r.round,
    participants: r.participants ?? r.branches ?? [],
    timestamp: r.timestamp ?? r.aggregated_at ?? "",
    method: r.method ?? "FedAvg",
    branch_metrics: r.branch_metrics ?? {},
  }));

  const trendData = normalizedRounds
    .slice()
    .sort((a, b) => a.round - b.round)
    .map((r) => {
      const metrics = Object.values(r.branch_metrics || {});
      const avgAcc = metrics.length
        ? metrics.reduce((sum, m) => sum + (m.accuracy ?? 0), 0) / metrics.length
        : 0;
      const avgF1 = metrics.length
        ? metrics.reduce((sum, m) => sum + (m.f1 ?? 0), 0) / metrics.length
        : 0;
      return {
        round: r.round,
        accuracy: Number((avgAcc * 100).toFixed(2)),
        f1: Number((avgF1 * 100).toFixed(2)),
      };
    });

  const latestRound = normalizedRounds.slice().sort((a, b) => b.round - a.round)[0];
  const regionTotals: Record<string, { count: number; f1Sum: number }> = {
    urban: { count: 0, f1Sum: 0 },
    semi_urban: { count: 0, f1Sum: 0 },
    rural: { count: 0, f1Sum: 0 },
  };
  if (latestRound?.branch_metrics) {
    Object.entries(latestRound.branch_metrics).forEach(([branch, metrics]) => {
      const key = branch.toLowerCase();
      const region = BRANCH_TYPE[key];
      if (!region) return;
      regionTotals[region].count += 1;
      regionTotals[region].f1Sum += metrics.f1 ?? 0;
    });
  }
  const regionData = Object.entries(regionTotals).map(([region, v]) => ({
    region: region.replace(/_/g, " "),
    f1: v.count ? Number(((v.f1Sum / v.count) * 100).toFixed(2)) : 0,
  }));

  // Event type label colours
  const eventTypeColor: Record<RoundEventType, string> = {
    connected:         "text-ink-faint",
    round_started:     "text-teal",
    branch_submitted:  "text-teal",
    validation_passed: "text-green-600",
    validation_failed: "text-red-600",
    byzantine_detected:"text-orange-600",
    aggregating:       "text-teal",
    round_complete:    "text-emerald-600",
    error:             "text-red-500",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Federation Status</h1>
          <p className="text-sm text-ink-soft mt-1">FedAvg aggregation rounds and weight submissions</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-green-600" : "text-ink-faint"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
            {connected ? "Live" : "Connecting…"}
          </span>
          <Button onClick={handleTrigger} disabled={triggering}>
            {triggering ? <Spinner size="sm" /> : <><Play size={16} /> Trigger FedAvg</>}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Current Round" value={status?.current_round ?? currentRound} icon={<Globe size={24} />} color="blue" />
        <StatCard label="Registered Branches" value={status?.registered_branches?.length ?? 0} icon={<Users size={24} />} color="green" />
        <StatCard
          label="Submissions This Round"
          value={status?.submissions_this_round?.length ?? 0}
          sub={`min ${status?.min_branches ?? 0} needed`}
          icon={<Layers size={24} />}
          color="purple"
        />
      </div>

      {/* ── Live Round Tracker ─────────────────────────────── */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-blue-500 animate-pulse" : "bg-gray-300"}`} />
          Live Round Tracker
          {currentRound > 0 && (
            <span className="ml-auto text-xs text-ink-faint font-normal">Round {currentRound}</span>
          )}
        </h2>

        {/* Vertical timeline */}
        <div className="relative pl-8">
          {/* Connector line */}
          <div className="absolute left-[18px] top-3 bottom-3 w-0.5 bg-gray-100" />

          <div className="space-y-4">
            {stages.map((stage) => (
              <div key={stage.id} className="relative flex items-start gap-3">
                {/* Icon positioned over the connector line */}
                <div className="absolute -left-8 mt-0.5">
                  <StageIcon status={stage.status} />
                </div>

                <div className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                  stage.status === "active"    ? "bg-teal-soft border border-blue-200" :
                  stage.status === "complete"  ? "bg-green-50 border border-green-100" :
                  stage.status === "error"     ? "bg-red-50 border border-red-200" :
                  "bg-canvas border border-line"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${
                      stage.status === "active"   ? "text-teal-deep" :
                      stage.status === "complete" ? "text-green-700" :
                      stage.status === "error"    ? "text-red-700" :
                      "text-ink-faint"
                    }`}>
                      {stage.label}
                    </span>
                    {stage.status === "active" && (
                      <span className="text-xs text-blue-500 font-medium">In progress</span>
                    )}
                    {stage.status === "complete" && (
                      <span className="text-xs text-green-600 font-medium">Done</span>
                    )}
                    {stage.status === "error" && (
                      <span className="text-xs text-red-500 font-medium">Failed</span>
                    )}
                  </div>
                  {stage.detail && (
                    <p className="text-xs text-ink-soft mt-0.5">{stage.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Scrollable event log ─────────────────────────── */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          Raw Event Log
          <span className="ml-auto text-xs text-ink-faint font-normal">{eventLog.length} events</span>
        </h2>

        {eventLog.length === 0 ? (
          <p className="text-xs text-ink-faint text-center py-6">Waiting for federation events…</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
            {/* newest at top — already ordered that way */}
            {eventLog.map((ev, i) => (
              <div
                key={`${ev.ts}-${ev.type}-${i}`}
                className="flex items-start gap-2 py-0.5 border-b border-gray-50 last:border-0"
              >
                <span className="text-gray-300 shrink-0 tabular-nums">
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
                <span className={`shrink-0 font-semibold w-36 ${eventTypeColor[ev.type] ?? "text-ink-soft"}`}>
                  {ev.type}
                </span>
                <span className="text-ink-soft truncate">
                  {JSON.stringify(ev.data)}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </Card>

      {/* Round history */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Aggregation Round History</h2>
        {normalizedRounds.length === 0 ? (
          <EmptyState message="No aggregation rounds completed yet." />
        ) : (
          <div className="space-y-3">
            {normalizedRounds
              .sort((a, b) => b.round - a.round)
              .map((round) => (
                <div
                  key={round.round}
                  className="flex items-start justify-between p-4 rounded-xl bg-canvas border border-line"
                >
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 text-teal flex items-center justify-center font-bold text-sm">
                      R{round.round}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink">Round {round.round}</p>
                      <p className="text-xs text-ink-soft mt-0.5">
                        Method: <span className="font-medium">{round.method}</span>
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {round.participants.map((p) => (
                          <Badge key={p} variant="success">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-ink-faint">
                    {round.timestamp ? new Date(round.timestamp).toLocaleString() : ""}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Global Accuracy Trend</h2>
            <span className="text-xs text-ink-faint flex items-center gap-1">
              <TrendingUp size={12} /> Avg per round
            </span>
          </div>
          {trendData.length === 0 ? (
            <EmptyState message="No round metrics yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="accuracy" stroke="#2563eb" strokeWidth={2} dot={false} name="Accuracy" />
                <Line type="monotone" dataKey="f1" stroke="#10b981" strokeWidth={2} dot={false} name="F1" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Latest Round: Regional F1</h2>
            <span className="text-xs text-ink-faint">{latestRound ? `Round ${latestRound.round}` : "No rounds"}</span>
          </div>
          {latestRound ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={regionData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="region" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="f1" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No regional metrics available." />
          )}
        </Card>
      </div>
    </div>
  );
}
