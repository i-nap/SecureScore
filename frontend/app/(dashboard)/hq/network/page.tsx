"use client";

import { useEffect, useState, useRef } from "react";
import { Card, Spinner, Badge } from "@/components/ui";
import { hqNetworkTopology, type NetworkTopologyResult, type TopologyNode, type TopologyEdge } from "@/lib/api";
import { Network } from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  hq: "#1e293b",
  urban: "#6366f1",
  semi_urban: "#f59e0b",
  rural: "#10b981",
};

const TYPE_LABELS: Record<string, string> = {
  hq: "HQ Aggregator",
  urban: "Urban Branch",
  semi_urban: "Semi-Urban",
  rural: "Rural",
};

function NodeCircle({ node, selected, onClick }: { node: TopologyNode; selected: boolean; onClick: () => void }) {
  const r = node.type === "hq" ? 26 : 18;
  const color = node.byzantine ? "#ef4444" : TYPE_COLORS[node.type] ?? "#6366f1";
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {/* Glow ring for active/selected */}
      {(node.active_round || selected) && (
        <circle cx={node.x} cy={node.y} r={r + 8} fill="none" stroke={selected ? "#ffffff" : color} strokeWidth={2} strokeOpacity={0.4}>
          <animate attributeName="r" values={`${r + 6};${r + 12};${r + 6}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Byzantine warning ring */}
      {node.byzantine && (
        <circle cx={node.x} cy={node.y} r={r + 5} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeDasharray="4 3" />
      )}
      {/* Main circle */}
      <circle cx={node.x} cy={node.y} r={r} fill={color} fillOpacity={0.9} stroke={selected ? "#fff" : "rgba(255,255,255,0.2)"} strokeWidth={selected ? 3 : 1.5} />
      {/* Icon text */}
      <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize={node.type === "hq" ? 10 : 8} fill="white" fontWeight="bold">
        {node.type === "hq" ? "HQ" : node.label.slice(0, 3).toUpperCase()}
      </text>
      {/* Label below */}
      <text x={node.x} y={node.y + r + 14} textAnchor="middle" fontSize={9} fill="#94a3b8" fontWeight="500">
        {node.label}
      </text>
    </g>
  );
}

export default function NetworkTopologyPage() {
  const [data, setData] = useState<NetworkTopologyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TopologyNode | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const animRef = useRef<number>(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    hqNetworkTopology()
      .then((d) => { setData(d); })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Animate edges (packet travel)
  useEffect(() => {
    let t = 0;
    const animate = () => {
      t++;
      if (t % 30 === 0) setTick((prev) => prev + 1);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const filteredNodes = data.nodes.filter((n) => filter === "all" || n.type === filter || n.type === "hq");
  const filteredEdges = data.edges.filter((e) => {
    const srcNode = data.nodes.find((n) => n.id === e.source);
    return filter === "all" || srcNode?.type === filter;
  });

  const alertCount = data.nodes.filter((n) => n.byzantine).length;
  const avgParticipation = data.nodes.filter((n) => n.type !== "hq").reduce((a, b) => a + b.participation, 0) / (data.nodes.length - 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Network size={22} className="text-teal" />
          Federated Learning Network
        </h1>
        <p className="text-sm text-ink-soft mt-1">Live topology of the FL network — branch nodes, communication edges, and Byzantine detection.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-line p-3">
          <p className="text-xs text-ink-faint">Total Nodes</p>
          <p className="text-xl font-black text-ink">{data.nodes.length - 1}</p>
          <p className="text-xs text-ink-faint">branches</p>
        </div>
        <div className="bg-white rounded-xl border border-line p-3">
          <p className="text-xs text-ink-faint">Current Round</p>
          <p className="text-xl font-black text-teal">R{data.current_round}</p>
        </div>
        <div className={`rounded-xl border p-3 ${alertCount > 0 ? "bg-red-50 border-red-200" : "bg-white border-line"}`}>
          <p className="text-xs text-ink-faint">Byzantine Nodes</p>
          <p className={`text-xl font-black ${alertCount > 0 ? "text-red-600" : "text-ink"}`}>{alertCount}</p>
          <p className="text-xs text-ink-faint">{alertCount > 0 ? "under scrutiny" : "all clean"}</p>
        </div>
        <div className="bg-white rounded-xl border border-line p-3">
          <p className="text-xs text-ink-faint">Avg Participation</p>
          <p className="text-xl font-black text-emerald-600">{(avgParticipation * 100).toFixed(1)}%</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-soft">Filter:</span>
        {["all", "urban", "semi_urban", "rural"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${filter === f ? "text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}
            style={{ background: filter === f ? (TYPE_COLORS[f] ?? "#6366f1") : undefined }}>
            {f === "all" ? "All" : f.replace("_", "-")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SVG Network Graph */}
        <div className="lg:col-span-2">
          <Card className="p-0 overflow-hidden">
            <svg width="100%" viewBox="0 0 1000 600" style={{ background: "linear-gradient(135deg, #0f1117 0%, #1e293b 100%)", display: "block" }}>
              {/* Grid lines */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="1000" height="600" fill="url(#grid)" />

              {/* Edges */}
              {filteredEdges.map((e: TopologyEdge, i: number) => {
                const src = data.nodes.find((n) => n.id === e.source);
                const tgt = data.nodes.find((n) => n.id === e.target);
                if (!src || !tgt) return null;
                const isRecent = e.round >= data.current_round - 1;
                return (
                  <line key={i}
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke={isRecent ? "#6366f1" : "#334155"}
                    strokeWidth={isRecent ? 1.5 : 0.8}
                    strokeOpacity={isRecent ? 0.6 : 0.3}
                    strokeDasharray={isRecent ? undefined : "4 4"}
                  />
                );
              })}

              {/* Animated data packets on active edges */}
              {filteredEdges.filter((e) => e.round === data.current_round).map((e: TopologyEdge, i: number) => {
                const src = data.nodes.find((n) => n.id === e.source);
                const tgt = data.nodes.find((n) => n.id === e.target);
                if (!src || !tgt) return null;
                const progress = ((tick * 3 + i * 17) % 100) / 100;
                const px = src.x + (tgt.x - src.x) * progress;
                const py = src.y + (tgt.y - src.y) * progress;
                return (
                  <circle key={`pkt-${i}`} cx={px} cy={py} r={3} fill="#a5b4fc" fillOpacity={0.9} />
                );
              })}

              {/* Nodes */}
              {filteredNodes.map((n: TopologyNode) => (
                <NodeCircle key={n.id} node={n} selected={selected?.id === n.id} onClick={() => setSelected(n)} />
              ))}

              {/* Legend */}
              <g transform="translate(16, 16)">
                {Object.entries(TYPE_LABELS).filter(([k]) => k !== "hq").map(([type, label], i) => (
                  <g key={type} transform={`translate(0, ${i * 20})`}>
                    <circle cx={6} cy={6} r={5} fill={TYPE_COLORS[type]} />
                    <text x={16} y={10} fontSize={10} fill="#94a3b8">{label}</text>
                  </g>
                ))}
                <g transform={`translate(0, ${3 * 20})`}>
                  <circle cx={6} cy={6} r={5} fill="#ef4444" />
                  <text x={16} y={10} fontSize={10} fill="#94a3b8">Byzantine (detected)</text>
                </g>
              </g>
            </svg>
          </Card>
        </div>

        {/* Node detail panel */}
        <Card>
          {selected ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-ink">{selected.label}</h3>
                {selected.byzantine && <Badge variant="danger">Byzantine</Badge>}
                {!selected.byzantine && selected.type !== "hq" && <Badge variant="success">Clean</Badge>}
              </div>
              <div className="space-y-3">
                {[
                  { label: "Type", value: TYPE_LABELS[selected.type] ?? selected.type },
                  { label: "Participation", value: `${(selected.participation * 100).toFixed(0)}%` },
                  { label: "Drift Score", value: selected.drift_score > 0 ? `${(selected.drift_score * 100).toFixed(1)}%` : "—" },
                  { label: "Active This Round", value: selected.active_round ? "Yes" : "No" },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs text-ink-faint">{r.label}</span>
                    <span className="text-sm font-semibold text-ink">{r.value}</span>
                  </div>
                ))}
                {selected.type !== "hq" && (
                  <div className="mt-3">
                    <p className="text-xs text-ink-faint mb-1">Drift Risk</p>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min(100, selected.drift_score / 0.25 * 100)}%`,
                        background: selected.drift_score > 0.20 ? "#ef4444" : selected.drift_score > 0.12 ? "#f59e0b" : "#10b981",
                      }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-ink-faint">
              <Network size={32} className="mb-2 opacity-30" />
              <p className="text-sm">Click a node to inspect</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
