"use client";

import { useEffect, useState } from "react";
import { hqAuditLog, hqAuditVerify, type AuditEntry } from "@/lib/api";
import { Card, Badge, Spinner, Button, EmptyState } from "@/components/ui";
import { ShieldCheck, ShieldX, RotateCcw, Link, Unlink } from "lucide-react";

// ── helpers ──────────────────────────────────────────────

function shortHash(h: string | undefined): string {
  if (!h || h.length < 12) return h ?? "—";
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

type EventCategory = "submission" | "aggregation" | "byzantine" | "registration" | "other";

function categorize(event: string): EventCategory {
  const e = event.toUpperCase();
  if (e.includes("SUBMISSION") || e.includes("WEIGHT")) return "submission";
  if (e.includes("AGGREGAT")) return "aggregation";
  if (e.includes("BYZANTIN") || e.includes("QUARANTIN") || e.includes("REJECT")) return "byzantine";
  if (e.includes("REGISTRAT") || e.includes("AUTH")) return "registration";
  return "other";
}

const CATEGORY_COLORS: Record<EventCategory, { bg: string; text: string; border: string; badge: string }> = {
  submission:   { bg: "bg-teal-soft",   text: "text-teal-deep",   border: "border-blue-200",  badge: "bg-blue-100 text-teal-deep" },
  aggregation:  { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200",badge: "bg-emerald-100 text-emerald-700" },
  byzantine:    { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",   badge: "bg-red-100 text-red-700" },
  registration: { bg: "bg-teal-soft", text: "text-teal-deep", border: "border-purple-200",badge: "bg-purple-100 text-teal-deep" },
  other:        { bg: "bg-canvas",   text: "text-ink-soft",   border: "border-line",  badge: "bg-gray-100 text-ink-soft" },
};

// ── Block Chain Visualizer ────────────────────────────────

interface BlockState {
  tampered: boolean;
  cascade: boolean;
}

function ChainBlock({
  entry,
  index,
  blockState,
  onTamper,
  isLast,
}: {
  entry: AuditEntry;
  index: number;
  blockState: BlockState;
  onTamper: (index: number) => void;
  isLast: boolean;
}) {
  const cat = categorize(entry.event);
  const colors = CATEGORY_COLORS[cat];

  const blockBg = blockState.tampered
    ? "bg-red-100 border-red-500"
    : blockState.cascade
    ? "bg-orange-50 border-orange-400"
    : `${colors.bg} ${colors.border}`;

  const seq = entry.seq ?? index + 1;

  return (
    <div className="flex items-center gap-0 shrink-0">
      {/* The block itself */}
      <div
        className={`relative rounded-xl border-2 p-3 w-44 flex flex-col gap-1.5 transition-all select-none ${blockBg}`}
      >
        {/* Block number */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wide">
            #{seq}
          </span>
          {blockState.tampered ? (
            <Unlink size={12} className="text-red-500" />
          ) : blockState.cascade ? (
            <Unlink size={12} className="text-orange-400" />
          ) : (
            <Link size={12} className="text-gray-300" />
          )}
        </div>

        {/* Event type badge */}
        <span
          className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md truncate max-w-full ${colors.badge}`}
          title={entry.event}
        >
          {entry.event.replace(/_/g, " ")}
        </span>

        {/* Branch */}
        <p className="text-[11px] text-ink-soft truncate font-medium">{entry.branch || "—"}</p>

        {/* Hash preview */}
        <p
          className="font-mono text-[9px] text-ink-faint truncate"
          title={entry.hash}
        >
          {shortHash(entry.hash)}
        </p>

        {/* Tamper button */}
        {!blockState.tampered && !blockState.cascade && (
          <button
            onClick={() => onTamper(index)}
            className="mt-1 text-[10px] px-2 py-0.5 bg-white border border-line rounded-md text-ink-soft hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors font-medium"
          >
            TAMPER
          </button>
        )}
        {blockState.tampered && (
          <p className="text-[10px] font-bold text-red-600 text-center mt-1">✗ TAMPERED</p>
        )}
        {blockState.cascade && !blockState.tampered && (
          <p className="text-[10px] font-bold text-orange-500 text-center mt-1">⚠ INVALID</p>
        )}
      </div>

      {/* Arrow connector */}
      {!isLast && (
        <div className="flex items-center px-1 shrink-0">
          <div className="w-4 h-px bg-gray-300" />
          <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-gray-300" />
        </div>
      )}
    </div>
  );
}

function BlockChainVisualizer({ entries }: { entries: AuditEntry[] }) {
  const display = entries.slice(0, 20); // show up to 20 blocks
  const [blockStates, setBlockStates] = useState<BlockState[]>(() =>
    display.map(() => ({ tampered: false, cascade: false })),
  );
  const [tamperedAt, setTamperedAt] = useState<number | null>(null);

  // Keep blockStates in sync when entries change
  useEffect(() => {
    setBlockStates(display.map(() => ({ tampered: false, cascade: false })));
    setTamperedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const handleTamper = (index: number) => {
    setTamperedAt(index);
    setBlockStates((prev) =>
      prev.map((_s, i) => ({
        tampered: i === index,
        cascade: i > index,
      })),
    );
  };

  const handleReset = () => {
    setTamperedAt(null);
    setBlockStates(display.map(() => ({ tampered: false, cascade: false })));
  };

  if (display.length === 0) return null;

  return (
    <Card className="!p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Link size={16} className="text-blue-500" />
            Blockchain Block View
          </h2>
          <p className="text-xs text-ink-soft mt-0.5">
            Showing {display.length} most-recent blocks — click TAMPER to simulate a chain break
          </p>
        </div>
        {tamperedAt !== null && (
          <Button variant="secondary" size="sm" onClick={handleReset}>
            <RotateCcw size={13} /> Reset
          </Button>
        )}
      </div>

      {/* Compromise banner */}
      {tamperedAt !== null && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-sm text-red-800">
          <ShieldX size={18} className="shrink-0 text-red-500" />
          <span>
            Chain integrity compromised at block{" "}
            <strong>#{display[tamperedAt]?.seq ?? tamperedAt + 1}</strong> —{" "}
            {display.length - tamperedAt - 1} downstream{" "}
            {display.length - tamperedAt - 1 === 1 ? "hash is" : "hashes are"} invalid
          </span>
        </div>
      )}

      {/* Scrollable chain */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-center min-w-max gap-0">
          {display.map((entry, i) => (
            <ChainBlock
              key={`${entry.hash ?? i}-${i}`}
              entry={entry}
              index={i}
              blockState={blockStates[i] ?? { tampered: false, cascade: false }}
              onTamper={handleTamper}
              isLast={i === display.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {(Object.entries(CATEGORY_COLORS) as [EventCategory, typeof CATEGORY_COLORS[EventCategory]][]).map(
          ([cat, c]) => (
            <span key={cat} className={`px-2 py-0.5 rounded-md font-medium ${c.badge}`}>
              {cat}
            </span>
          ),
        )}
        <span className="px-2 py-0.5 rounded-md font-medium bg-red-100 text-red-700">tampered</span>
        <span className="px-2 py-0.5 rounded-md font-medium bg-orange-100 text-orange-700">cascade-invalid</span>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    hqAuditLog(100)
      .then((res) => setEntries((res as { entries?: AuditEntry[]; audit_log?: AuditEntry[] }).entries ?? (res as { audit_log?: AuditEntry[] }).audit_log ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const verifyChain = async () => {
    setVerifying(true);
    try {
      const res = await hqAuditVerify();
      setChainValid(res.valid);
    } catch {
      setChainValid(false);
    }
    setVerifying(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Audit Log</h1>
          <p className="text-sm text-ink-soft mt-1">
            Tamper-evident SHA-256 hash-chained event log &middot; {entries.length} entries
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={verifyChain} disabled={verifying}>
            {verifying ? <Spinner size="sm" /> : <><ShieldCheck size={16} /> Verify Chain</>}
          </Button>
        </div>
      </div>

      {/* Chain verification status */}
      {chainValid !== null && (
        <Card className={`!p-4 border-l-4 ${chainValid ? "border-l-emerald-500" : "border-l-red-500"}`}>
          <div className="flex items-center gap-3">
            {chainValid ? (
              <>
                <ShieldCheck size={24} className="text-emerald-500" />
                <div>
                  <p className="font-medium text-emerald-700">Hash Chain Verified</p>
                  <p className="text-xs text-ink-soft">All {entries.length} entries are intact and unmodified.</p>
                </div>
              </>
            ) : (
              <>
                <ShieldX size={24} className="text-red-500" />
                <div>
                  <p className="font-medium text-red-700">Chain Integrity Failure</p>
                  <p className="text-xs text-ink-soft">The audit log may have been tampered with!</p>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Block chain visualizer — shown above the raw table */}
      {entries.length > 0 && <BlockChainVisualizer entries={entries} />}

      {/* Raw Audit Log table */}
      <div>
        <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-3">Raw Audit Log</h2>
        {entries.length === 0 ? (
          <EmptyState message="No audit entries yet." />
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-xs font-medium text-ink-soft uppercase tracking-wide">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Detail</th>
                    <th className="px-4 py-3">Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry, idx) => {
                    const cat = categorize(entry.event);
                    const badgeVariant: Record<EventCategory, "success" | "danger" | "warning" | "default"> = {
                      submission:   "default",
                      aggregation:  "success",
                      byzantine:    "danger",
                      registration: "success",
                      other:        "default",
                    };
                    const detail =
                      entry.detail ||
                      (entry.details_summary
                        ? Object.entries(entry.details_summary)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(", ")
                        : "—");
                    return (
                      <tr key={`${entry.hash ?? idx}-${idx}`} className="hover:bg-canvas">
                        <td className="px-4 py-3 text-xs text-ink-faint font-mono">
                          {entry.seq ?? idx + 1}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-soft whitespace-nowrap">
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={badgeVariant[cat]}>{entry.event}</Badge>
                        </td>
                        <td className="px-4 py-3 text-ink">{entry.branch || "—"}</td>
                        <td className="px-4 py-3 text-ink-soft text-xs max-w-xs truncate">{detail}</td>
                        <td
                          className="px-4 py-3 font-mono text-[10px] text-ink-faint max-w-[120px] truncate"
                          title={entry.hash}
                        >
                          {shortHash(entry.hash)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
