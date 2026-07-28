"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { branchAMLScan, branchAmlNetwork, type AMLScanResult, type AMLNetworkData, type AMLNetworkNode, type AMLNetworkEdge } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { ShieldAlert, FileText, Activity, AlertOctagon, CheckCircle2, Network } from "lucide-react";

// ─── Force simulation types ───────────────────────────────────────────────────

interface SimNode extends AMLNetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ─── Run simple spring force simulation ──────────────────────────────────────

function runForceSimulation(
  nodes: AMLNetworkNode[],
  edges: AMLNetworkEdge[],
  width: number,
  height: number,
  iterations = 120,
): SimNode[] {
  const sim: SimNode[] = nodes.map((n, i) => ({
    ...n,
    x: width / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * (Math.min(width, height) * 0.3),
    y: height / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * (Math.min(width, height) * 0.3),
    vx: 0,
    vy: 0,
  }));

  const kr = 8000;    // repulsion constant
  const ks = 0.08;    // spring constant
  const rest = 120;   // rest length
  const damping = 0.85;
  const margin = 40;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const dx = sim[i].x - sim[j].x;
        const dy = sim[i].y - sim[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = kr / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        sim[i].vx += fx;
        sim[i].vy += fy;
        sim[j].vx -= fx;
        sim[j].vy -= fy;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const si = sim.find((n) => n.id === edge.source);
      const ti = sim.find((n) => n.id === edge.target);
      if (!si || !ti) continue;
      const dx = ti.x - si.x;
      const dy = ti.y - si.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = ks * (dist - rest);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      si.vx += fx;
      si.vy += fy;
      ti.vx -= fx;
      ti.vy -= fy;
    }

    // Center gravity
    for (const n of sim) {
      n.vx += (width / 2 - n.x) * 0.003;
      n.vy += (height / 2 - n.y) * 0.003;
    }

    // Apply velocity + damping + bounds
    for (const n of sim) {
      n.vx *= damping;
      n.vy *= damping;
      n.x = Math.max(margin, Math.min(width - margin, n.x + n.vx));
      n.y = Math.max(margin, Math.min(height - margin, n.y + n.vy));
    }
  }
  return sim;
}

// ─── Risk colours ─────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6b7280",
  unknown: "#94a3b8",
};

const RISK_FILL: Record<string, string> = {
  high: "#fef2f2",
  medium: "#fffbeb",
  low: "#f9fafb",
  unknown: "#f8fafc",
};

const NODE_ICON: Record<string, string> = {
  customer: "👤",
  account: "🏦",
  external: "🌐",
};

// ─── Tooltip state ────────────────────────────────────────────────────────────

interface NodeTooltip { node: SimNode; x: number; y: number }
interface EdgeTooltip { edge: AMLNetworkEdge; x: number; y: number }

// ─── Network Graph Component ──────────────────────────────────────────────────

function AMLNetworkGraph({ data }: { data: AMLNetworkData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [nodeTooltip, setNodeTooltip] = useState<NodeTooltip | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltip | null>(null);
  // Pan / zoom
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 480 });
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const W = 800;
  const H = 480;

  useEffect(() => {
    const nodes = runForceSimulation(data.nodes, data.edges, W, H);
    setSimNodes(nodes);
  }, [data]);

  const nodeById = useCallback(
    (id: string) => simNodes.find((n) => n.id === id),
    [simNodes],
  );

  // Zoom via scroll
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    setViewBox((vb) => {
      const nw = Math.max(200, Math.min(1600, vb.w * factor));
      const nh = Math.max(120, Math.min(960, vb.h * factor));
      return { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh };
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName === "circle" || (e.target as SVGElement).tagName === "text") return;
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    const scaleX = viewBox.w / (containerRef.current?.clientWidth || W);
    const scaleY = viewBox.h / (containerRef.current?.clientHeight || H);
    setViewBox((vb) => ({ ...vb, x: vb.x - dx * scaleX, y: vb.y - dy * scaleY }));
  };
  const onMouseUp = () => { dragging.current = false; };

  if (simNodes.length === 0) return (
    <div className="flex items-center justify-center h-60"><Spinner size="lg" /></div>
  );

  const vbStr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Nodes", value: data.summary.total_nodes, color: "text-teal" },
          { label: "Suspicious Links", value: data.summary.suspicious_links, color: "text-red-600" },
          { label: "High Risk", value: data.summary.high_risk_customers, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="bg-canvas rounded-xl px-4 py-3 border border-line">
            <p className="text-xs text-ink-soft">{s.label}</p>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Graph */}
      <div
        ref={containerRef}
        className="relative bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 cursor-grab active:cursor-grabbing"
        style={{ userSelect: "none" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <svg
          width="100%"
          viewBox={vbStr}
          style={{ display: "block", minHeight: 380 }}
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="16" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#6b7280" />
            </marker>
            <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="16" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
            </marker>
            <filter id="glow-red">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Edges */}
          {data.edges.map((edge, i) => {
            const src = nodeById(edge.source);
            const tgt = nodeById(edge.target);
            if (!src || !tgt) return null;
            const thickness = Math.max(1, Math.min(5, Math.log10(edge.amount / 10000 + 1) * 2));
            const midX = (src.x + tgt.x) / 2;
            const midY = (src.y + tgt.y) / 2;
            return (
              <g key={i}>
                <line
                  x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke={edge.suspicious ? "#ef4444" : "#334155"}
                  strokeWidth={thickness}
                  strokeDasharray={edge.suspicious ? "6 3" : undefined}
                  strokeOpacity={edge.suspicious ? 0.85 : 0.5}
                  markerEnd={edge.suspicious ? "url(#arrow-red)" : "url(#arrow)"}
                  filter={edge.suspicious ? "url(#glow-red)" : undefined}
                />
                {/* Invisible wider hit target */}
                <line
                  x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => {
                    setEdgeTooltip({ edge, x: midX, y: midY });
                    setNodeTooltip(null);
                  }}
                  onMouseLeave={() => setEdgeTooltip(null)}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {simNodes.map((node) => {
            const r = 20;
            const color = RISK_COLOR[node.risk] ?? "#94a3b8";
            const fill = RISK_FILL[node.risk] ?? "#f8fafc";
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => {
                  setNodeTooltip({ node, x: node.x, y: node.y });
                  setEdgeTooltip(null);
                }}
                onMouseLeave={() => setNodeTooltip(null)}
              >
                <circle
                  r={r + 4}
                  fill={color}
                  opacity={0.15}
                />
                <circle
                  r={r}
                  fill={fill}
                  stroke={color}
                  strokeWidth={2.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="13"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {NODE_ICON[node.type] ?? "?"}
                </text>
                <text
                  y={r + 13}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="9"
                  fontFamily="monospace"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {node.id}
                </text>
              </g>
            );
          })}

          {/* Node tooltip */}
          {nodeTooltip && (() => {
            const { node, x, y } = nodeTooltip;
            const tw = 140;
            const th = 70;
            const tx = Math.min(W - tw - 10, Math.max(10, x - tw / 2));
            const ty = y - th - 32;
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={tx} y={ty} width={tw} height={th} rx={8} fill="#1e293b" opacity={0.95} />
                <text x={tx + 8} y={ty + 16} fill="white" fontSize="10" fontWeight="bold">{node.label}</text>
                <text x={tx + 8} y={ty + 30} fill="#94a3b8" fontSize="9">Type: {node.type}</text>
                <text x={tx + 8} y={ty + 43} fill="#94a3b8" fontSize="9">Risk: <tspan fill={RISK_COLOR[node.risk]}>{node.risk}</tspan></text>
                {node.branch && <text x={tx + 8} y={ty + 56} fill="#94a3b8" fontSize="9">Branch: {node.branch}</text>}
              </g>
            );
          })()}

          {/* Edge tooltip */}
          {edgeTooltip && (() => {
            const { edge, x, y } = edgeTooltip;
            const tw = 155;
            const th = 60;
            const tx = Math.min(W - tw - 10, Math.max(10, x - tw / 2));
            const ty = y - th - 10;
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={tx} y={ty} width={tw} height={th} rx={8} fill="#1e293b" opacity={0.95} />
                <text x={tx + 8} y={ty + 16} fill={edge.suspicious ? "#ef4444" : "#94a3b8"} fontSize="10" fontWeight="bold">
                  {edge.suspicious ? "⚠ Suspicious" : "Normal"} · {edge.type}
                </text>
                <text x={tx + 8} y={ty + 30} fill="#94a3b8" fontSize="9">
                  NPR {edge.amount.toLocaleString()}
                </text>
                <text x={tx + 8} y={ty + 44} fill="#94a3b8" fontSize="9">
                  {edge.count} transaction{edge.count !== 1 ? "s" : ""}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* Zoom hint */}
        <div className="absolute bottom-3 right-3 text-[10px] text-ink-soft bg-slate-900/70 rounded px-2 py-1">
          Scroll to zoom · drag to pan
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-2 text-xs text-ink-soft">
        <span className="font-semibold text-ink-faint">Nodes:</span>
        {Object.entries(NODE_ICON).map(([type, icon]) => (
          <span key={type} className="flex items-center gap-1">{icon} {type}</span>
        ))}
        <span className="w-px h-4 bg-slate-300" />
        <span className="font-semibold text-ink-faint">Risk:</span>
        {Object.entries(RISK_COLOR).map(([risk, color]) => (
          <span key={risk} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
            {risk}
          </span>
        ))}
        <span className="w-px h-4 bg-slate-300" />
        <span className="flex items-center gap-1">
          <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 2" /></svg>
          suspicious
        </span>
        <span className="flex items-center gap-1">
          <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#334155" strokeWidth="2" /></svg>
          normal
        </span>
      </div>
    </div>
  );
}

type AlertItem = Record<string, unknown>;

type TabKey = "combined" | "structuring" | "round" | "anomaly";

function SeverityBadge({ sev }: { sev: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-100 text-red-700 border border-red-200",
    medium: "bg-amber-100 text-amber-700 border border-amber-200",
    low: "bg-slate-100 text-ink-soft border border-line",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[sev] ?? styles.low}`}>
      {sev}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.round(score * 100), 100);
  const color = score >= 0.6 ? "bg-red-500" : score >= 0.3 ? "bg-amber-400" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-ink-soft w-10 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "combined",    label: "All Alerts",    icon: <Activity size={14} />,     color: "text-teal border-purple-500" },
  { key: "structuring", label: "Structuring",   icon: <AlertOctagon size={14} />, color: "text-red-600 border-red-500" },
  { key: "round",       label: "Round Amounts", icon: <FileText size={14} />,     color: "text-amber-600 border-amber-500" },
  { key: "anomaly",     label: "Anomalies",     icon: <ShieldAlert size={14} />,  color: "text-teal border-blue-500" },
];

export default function AMLPage() {
  const [data, setData] = useState<AMLScanResult | null>(null);
  const [tab, setTab] = useState<TabKey>("combined");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [networkData, setNetworkData] = useState<AMLNetworkData | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [showNetwork, setShowNetwork] = useState(false);

  useEffect(() => {
    branchAMLScan()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadNetwork = () => {
    if (networkData) { setShowNetwork(true); return; }
    setNetworkLoading(true);
    setShowNetwork(true);
    branchAmlNetwork()
      .then(setNetworkData)
      .catch((e) => setNetworkError(e.message))
      .finally(() => setNetworkLoading(false));
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <Spinner size="lg" />
      <p className="text-ink-soft text-sm">Running AML compliance scan…</p>
    </div>
  );

  if (error) return (
    <div className="m-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
  );

  if (!data) return null;

  const tabs = [
    { key: "combined" as const,    alerts: data.combined_alerts },
    { key: "structuring" as const, alerts: data.structuring_flags },
    { key: "round" as const,       alerts: data.round_amount_flags },
    { key: "anomaly" as const,     alerts: data.anomaly_flags },
  ];

  const activeAlerts = tabs.find((t) => t.key === tab)?.alerts ?? [];
  const flagRate = (data.total_customers_scanned ?? 0) > 0
    ? ((data.total_flagged ?? 0) / (data.total_customers_scanned ?? 1) * 100).toFixed(1)
    : "0";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">NRB Compliance · Anti-Money Laundering</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">AML Monitor</h1>
            <p className="mt-1 text-purple-200 text-sm">
              Threshold: NPR {(data.nrb_threshold_npr ?? 0).toLocaleString()} · {(data.total_customers_scanned ?? 0).toLocaleString()} customers scanned
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black">{flagRate}%</p>
            <p className="text-purple-200 text-xs mt-0.5">Alert rate</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-3">
          {[
            { label: "Total Flagged",     value: data.total_flagged },
            { label: "High Severity",     value: data.high_severity_count },
            { label: "Medium Severity",   value: data.medium_severity_count },
            { label: "Structuring Flags", value: data.structuring_flags?.length ?? 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 rounded-xl px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-purple-200 mb-1">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* NRB info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <FileText size={16} className="text-amber-600 shrink-0" />
        <p className="text-amber-800 text-sm">
          <span className="font-semibold">NRB Directive:</span> Transactions above NPR 10,00,000 require Suspicious Activity Report (SAR) filing.
          Structuring detection identifies attempts to split transactions below this threshold.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
        <div className="flex border-b border-line bg-canvas/50">
          {TAB_CONFIG.map((t) => {
            const count = tabs.find((x) => x.key === t.key)?.alerts?.length ?? 0;
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all ${
                  isActive
                    ? `${t.color} bg-white`
                    : "border-transparent text-ink-soft hover:text-ink hover:bg-white/60"
                }`}
              >
                {t.icon}
                {t.label}
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  isActive ? "bg-slate-100 text-ink-soft" : "bg-slate-200/50 text-ink-faint"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        {(activeAlerts as AlertItem[]).length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2">
            <CheckCircle2 size={36} className="text-emerald-300" />
            <p className="text-ink-faint text-sm">No alerts in this category</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-line">
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Severity</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Alert Type</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">AML Score</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide">Note</th>
                </tr>
              </thead>
              <tbody>
                {(activeAlerts as AlertItem[]).map((a, i) => {
                  const sev = (a.severity as string) || "low";
                  const score = typeof a.aml_score === "number" ? a.aml_score : 0;
                  return (
                    <tr key={i} className="border-b border-slate-50 hover:bg-canvas/70 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-ink-soft">{a.customer_id as string}</td>
                      <td className="px-5 py-3"><SeverityBadge sev={sev} /></td>
                      <td className="px-5 py-3 text-xs text-ink-soft capitalize">{String(a.alert_type ?? "").replace(/_/g, " ")}</td>
                      <td className="px-5 py-3 w-36"><ScoreBar score={score} /></td>
                      <td className="px-5 py-3 text-xs text-ink-soft max-w-[220px] truncate">{String(a.note ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Network Graph */}
      <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Network size={18} className="text-teal" />
            <div>
              <h2 className="text-sm font-bold text-ink">Transaction Network</h2>
              <p className="text-xs text-ink-faint">Force-directed suspicious relationship graph</p>
            </div>
          </div>
          <button
            onClick={showNetwork ? () => setShowNetwork(false) : loadNetwork}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-soft text-teal-deep text-xs font-semibold hover:bg-indigo-100 transition-colors border border-indigo-200"
          >
            <Network size={13} />
            {showNetwork ? "Hide Graph" : "Show Network Graph"}
          </button>
        </div>

        {showNetwork && (
          <div className="p-5">
            {networkLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Spinner size="lg" />
                <p className="text-ink-faint text-sm">Building transaction network…</p>
              </div>
            )}
            {networkError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{networkError}</div>
            )}
            {networkData && !networkLoading && (
              <AMLNetworkGraph data={networkData} />
            )}
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs text-ink-faint text-center">
        AML scan uses IsolationForest anomaly detection + NRB structuring thresholds. Alerts are for review — not automatic flagging.
      </p>
    </div>
  );
}
