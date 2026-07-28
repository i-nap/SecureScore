"use client";

import { useState, useEffect } from "react";
import { hqBranches, hqRoundHistory, type BranchInfo } from "@/lib/api";
import { Card, Spinner, Badge } from "@/components/ui";
import { MapPin, Wifi, WifiOff, Clock } from "lucide-react";

const BRANCH_COORDS: Record<string, { x: number; y: number; region: string }> = {
  kathmandu:  { x: 700, y: 200, region: "Central" },
  lalitpur:   { x: 720, y: 220, region: "Central" },
  pokhara:    { x: 540, y: 190, region: "Western" },
  bharatpur:  { x: 660, y: 240, region: "Central" },
  biratnagar: { x: 1050, y: 230, region: "Eastern" },
  butwal:     { x: 580, y: 250, region: "Western" },
  hetauda:    { x: 670, y: 255, region: "Central" },
  itahari:    { x: 1020, y: 225, region: "Eastern" },
  dharan:     { x: 1030, y: 210, region: "Eastern" },
  janakpur:   { x: 820, y: 255, region: "Central" },
  birgunj:    { x: 700, y: 275, region: "Central" },
  nepalgunj:  { x: 350, y: 230, region: "Mid-Western" },
  sarlahi:    { x: 760, y: 265, region: "Central" },
};

const MOUNTAIN_PEAKS = [
  { x: 350, label: "Dhaulagiri" }, { x: 530, label: "Annapurna" },
  { x: 700, label: "Langtang" },  { x: 820, label: "Gaurishankar" },
  { x: 950, label: "Kanchenjunga" },
];

type BranchState = "submitted" | "registered" | "offline";

function branchState(branch: BranchInfo): BranchState {
  if (branch.submitted_this_round) return "submitted";
  if (branch.registered) return "registered";
  return "offline";
}

const STATE_COLOR: Record<BranchState, string> = {
  submitted: "#22c55e",
  registered: "#3b82f6",
  offline: "#9ca3af",
};

export default function BranchMapPage() {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [branchF1s, setBranchF1s] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all([hqBranches(), hqRoundHistory()])
      .then(([branchRes, histRes]) => {
        setBranches(branchRes.branches);
        // Extract latest round F1s
        const rounds = histRes.rounds;
        if (rounds.length > 0) {
          const latest = rounds[rounds.length - 1];
          const f1s: Record<string, number> = {};
          if (latest.branch_metrics) {
            for (const [b, m] of Object.entries(latest.branch_metrics)) {
              if (m.f1 !== undefined) f1s[b] = m.f1;
            }
          }
          setBranchF1s(f1s);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-32"><Spinner size="lg" /></div>
  );

  const selectedBranch = branches.find((b) => b.slug === selectedSlug);
  const hoveredBranch = branches.find((b) => b.slug === hoveredSlug);

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <MapPin size={24} className="text-blue-500" />
          Branch Network Map — Nepal
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Real-time federated learning node status
        </p>
      </div>

      {/* Map + Detail */}
      <div className="flex gap-4">
        <Card className="flex-1 p-3 overflow-auto">
          <div className="relative">
            <svg
              viewBox="0 60 1400 280"
              className="w-full border border-line rounded-xl"
              style={{ background: "linear-gradient(180deg, #bfdbfe 0%, #dbeafe 15%, #bbf7d0 45%, #86efac 100%)" }}
            >
              {/* Terai band */}
              <rect x={100} y={270} width={1200} height={60} fill="#65a30d" opacity={0.35} rx={4} />

              {/* Mountain triangles */}
              {MOUNTAIN_PEAKS.map((pk) => (
                <g key={pk.label}>
                  <polygon
                    points={`${pk.x},80 ${pk.x - 40},140 ${pk.x + 40},140`}
                    fill="#e2e8f0"
                    stroke="#cbd5e1"
                    strokeWidth={1}
                  />
                  {/* Snow cap */}
                  <polygon
                    points={`${pk.x},80 ${pk.x - 15},100 ${pk.x + 15},100`}
                    fill="white"
                    opacity={0.8}
                  />
                  <text x={pk.x} y={152} textAnchor="middle" fontSize={9} fill="#64748b">{pk.label}</text>
                </g>
              ))}

              {/* Nepal outline suggestion — simple river lines */}
              <path d="M 150 200 Q 400 180 700 195 Q 900 200 1200 185" fill="none" stroke="#93c5fd" strokeWidth={1.5} opacity={0.4} />
              <path d="M 200 230 Q 500 215 700 225 Q 900 230 1150 218" fill="none" stroke="#93c5fd" strokeWidth={1} opacity={0.3} />

              {/* Branch circles */}
              {Object.entries(BRANCH_COORDS).map(([slug, pos]) => {
                const branch = branches.find((b) => b.slug === slug);
                const state: BranchState = branch ? branchState(branch) : "offline";
                const color = STATE_COLOR[state];
                const isHovered = hoveredSlug === slug;
                const isSelected = selectedSlug === slug;

                return (
                  <g key={slug}
                    onMouseEnter={() => setHoveredSlug(slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                    onClick={() => setSelectedSlug(slug === selectedSlug ? null : slug)}
                    style={{ cursor: "pointer" }}
                  >
                    {/* Pulse ring for submitted */}
                    {state === "submitted" && (
                      <circle cx={pos.x} cy={pos.y} r={26} fill={color} opacity={0.15}>
                        <animate attributeName="r" values="18;28;18" dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.2;0;0.2" dur="2s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* Selection ring */}
                    {isSelected && (
                      <circle cx={pos.x} cy={pos.y} r={22} fill="none" stroke="#7c3aed" strokeWidth={2} />
                    )}

                    {/* Main circle */}
                    <circle
                      cx={pos.x} cy={pos.y}
                      r={isHovered || isSelected ? 13 : 10}
                      fill={color}
                      stroke="white"
                      strokeWidth={2}
                      style={{ transition: "r 0.15s" }}
                    />

                    {/* Label */}
                    <text
                      x={pos.x} y={pos.y + 24}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={isSelected ? 700 : 400}
                      fill="#374151"
                    >
                      {slug.charAt(0).toUpperCase() + slug.slice(1)}
                    </text>
                  </g>
                );
              })}

              {/* Hover tooltip */}
              {hoveredBranch && hoveredSlug && BRANCH_COORDS[hoveredSlug] && (
                <g>
                  <rect
                    x={Math.min(BRANCH_COORDS[hoveredSlug].x - 60, 1280)}
                    y={BRANCH_COORDS[hoveredSlug].y - 75}
                    width={130} height={60}
                    rx={6} fill="white"
                    stroke="#e5e7eb" strokeWidth={1}
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,.1))"
                  />
                  <text
                    x={Math.min(BRANCH_COORDS[hoveredSlug].x - 60, 1280) + 65}
                    y={BRANCH_COORDS[hoveredSlug].y - 56}
                    textAnchor="middle" fontSize={10} fontWeight={700} fill="#111827"
                  >
                    {hoveredBranch.name}
                  </text>
                  <text
                    x={Math.min(BRANCH_COORDS[hoveredSlug].x - 60, 1280) + 65}
                    y={BRANCH_COORDS[hoveredSlug].y - 43}
                    textAnchor="middle" fontSize={9} fill="#6b7280"
                  >
                    {hoveredBranch.type}
                  </text>
                  <text
                    x={Math.min(BRANCH_COORDS[hoveredSlug].x - 60, 1280) + 65}
                    y={BRANCH_COORDS[hoveredSlug].y - 30}
                    textAnchor="middle" fontSize={9}
                    fill={branchState(hoveredBranch) === "submitted" ? "#16a34a" : branchState(hoveredBranch) === "registered" ? "#2563eb" : "#6b7280"}
                  >
                    {branchState(hoveredBranch) === "submitted" ? "Submitted this round" :
                      branchState(hoveredBranch) === "registered" ? "Registered" : "Offline"}
                  </text>
                  {branchF1s[hoveredSlug] && (
                    <text
                      x={Math.min(BRANCH_COORDS[hoveredSlug].x - 60, 1280) + 65}
                      y={BRANCH_COORDS[hoveredSlug].y - 18}
                      textAnchor="middle" fontSize={9} fill="#7c3aed"
                    >
                      F1: {(branchF1s[hoveredSlug] * 100).toFixed(1)}%
                    </text>
                  )}
                </g>
              )}

              {/* Legend */}
              <g transform="translate(1220, 70)">
                <rect x={0} y={0} width={130} height={85} rx={6} fill="white" stroke="#e5e7eb" strokeWidth={1} />
                <text x={65} y={16} textAnchor="middle" fontSize={9} fontWeight={700} fill="#374151">LEGEND</text>
                {[
                  { color: "#22c55e", label: "Submitted" },
                  { color: "#3b82f6", label: "Registered" },
                  { color: "#9ca3af", label: "Offline" },
                ].map((item, i) => (
                  <g key={item.label} transform={`translate(10, ${28 + i * 20})`}>
                    <circle cx={7} cy={7} r={6} fill={item.color} />
                    <text x={18} y={11} fontSize={9} fill="#374151">{item.label}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </Card>

        {/* Detail Panel */}
        {selectedBranch && (
          <Card className="w-56 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-ink text-sm">{selectedBranch.name}</h3>
              <button
                onClick={() => setSelectedSlug(null)}
                className="text-ink-faint hover:text-ink-soft text-lg leading-none"
              >×</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-soft">Type</span>
                <span className="font-medium capitalize">{selectedBranch.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">Region</span>
                <span className="font-medium">{BRANCH_COORDS[selectedBranch.slug]?.region ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">Status</span>
                <Badge variant={
                  branchState(selectedBranch) === "submitted" ? "success" :
                  branchState(selectedBranch) === "registered" ? "default" : "warning"
                }>
                  {branchState(selectedBranch)}
                </Badge>
              </div>
              {branchF1s[selectedBranch.slug] && (
                <div className="flex justify-between">
                  <span className="text-ink-soft">Latest F1</span>
                  <span className="font-bold text-teal">
                    {(branchF1s[selectedBranch.slug] * 100).toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-soft">Registered</span>
                <span className={selectedBranch.registered ? "text-green-600 font-medium" : "text-ink-faint"}>
                  {selectedBranch.registered ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Branch Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {branches.map((branch) => {
          const state = branchState(branch);
          return (
            <button
              key={branch.slug}
              onClick={() => setSelectedSlug(branch.slug === selectedSlug ? null : branch.slug)}
              className={`text-left p-3 rounded-xl border transition-all text-xs ${
                selectedSlug === branch.slug
                  ? "border-violet-400 bg-teal-soft"
                  : "border-line bg-white hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-ink truncate">{branch.name}</span>
                <span
                  className="w-2 h-2 rounded-full shrink-0 ml-1"
                  style={{ background: STATE_COLOR[state] }}
                />
              </div>
              <p className="text-ink-faint capitalize text-[10px]">{branch.type}</p>
              <div className="flex items-center gap-1 mt-1.5">
                {state === "submitted" ? (
                  <><Wifi size={10} className="text-green-500" /><span className="text-green-600">Submitted</span></>
                ) : state === "registered" ? (
                  <><Clock size={10} className="text-blue-400" /><span className="text-blue-500">Waiting</span></>
                ) : (
                  <><WifiOff size={10} className="text-ink-faint" /><span className="text-ink-faint">Offline</span></>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
