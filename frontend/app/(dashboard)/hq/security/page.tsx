"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, Badge, Spinner, StatCard } from "@/components/ui";
import { Shield, AlertTriangle, Lock, UserX, RefreshCw, CheckCircle, Ban, Zap, ChevronDown } from "lucide-react";
import { apiFetch, byzantineDemo, type ByzantineDemoResult } from "@/lib/api";

const ALL_BRANCHES = [
  "Kathmandu", "Lalitpur", "Pokhara",
  "Bharatpur", "Biratnagar", "Butwal",
  "Hetauda", "Itahari", "Dharan",
  "Janakpur", "Birgunj", "Nepalgunj", "Sarlahi",
];

const ATTACK_TYPES = [
  { value: "label_flip",       label: "Label Flip" },
  { value: "weight_poisoning", label: "Weight Poisoning" },
  { value: "gradient_scaling", label: "Gradient Scaling" },
];

interface DemoLogEntry {
  id: number;
  branch: string;
  attackType: string;
  result: ByzantineDemoResult;
  timestamp: string;
}

function ByzantineSimulator() {
  const [branch, setBranch]         = useState("Sarlahi");
  const [attackType, setAttackType] = useState("label_flip");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<ByzantineDemoResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [log, setLog]               = useState<DemoLogEntry[]>([]);
  const [logSeq, setLogSeq]         = useState(0);

  const handleInject = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await byzantineDemo(branch, attackType);
      setResult(res);
      setLog((prev) => [
        {
          id: logSeq + 1,
          branch,
          attackType,
          result: res,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 19),
      ]);
      setLogSeq((n) => n + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <AlertTriangle size={16} className="shrink-0 text-red-500" />
        <span><strong>Demo Only</strong> — Educational use. No real model weights are modified.</span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Branch selector */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink-soft uppercase tracking-wide">Target Branch</label>
          <div className="relative">
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full appearance-none border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300 pr-8"
            >
              {ALL_BRANCHES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          </div>
        </div>

        {/* Attack type selector */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink-soft uppercase tracking-wide">Attack Type</label>
          <div className="relative">
            <select
              value={attackType}
              onChange={(e) => setAttackType(e.target.value)}
              className="w-full appearance-none border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300 pr-8"
            >
              {ATTACK_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          </div>
        </div>

        {/* Inject button */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-transparent uppercase tracking-wide select-none">Action</label>
          <button
            onClick={handleInject}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <Spinner size="sm" />
                <span>Injecting…</span>
              </>
            ) : (
              <>
                <Zap size={15} />
                <span>Inject Malicious Node</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-xl border-2 p-5 ${result.detected ? "border-emerald-400 bg-emerald-50" : "border-red-400 bg-red-50"}`}>
          <div className="flex items-start gap-3">
            <div className={`text-3xl font-black shrink-0 ${result.detected ? "text-emerald-600" : "text-red-600"}`}>
              {result.detected ? "✓" : "✗"}
            </div>
            <div className="flex-1 space-y-2">
              <p className={`text-lg font-bold ${result.detected ? "text-emerald-700" : "text-red-700"}`}>
                Byzantine node {result.detected ? "DETECTED" : "EVADED"}{" "}
                {result.detected ? "✓" : "✗"}
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="bg-white/70 rounded-lg px-3 py-1.5 font-medium text-ink">
                  Branch: <strong>{result.branch}</strong>
                </span>
                <span className="bg-white/70 rounded-lg px-3 py-1.5 font-medium text-ink">
                  Cosine similarity: <strong>{result.cosine_similarity.toFixed(4)}</strong>
                </span>
                <span className="bg-white/70 rounded-lg px-3 py-1.5 font-medium text-ink">
                  &sigma; threshold: <strong>{result.sigma_threshold}</strong>
                </span>
              </div>
              <p className="text-xs text-ink-soft leading-relaxed">{result.reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Session injection log */}
      {log.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Session Injection Log</p>
          <div className="rounded-xl border border-line divide-y divide-gray-100 text-xs overflow-hidden">
            {log.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                <span className={`font-bold shrink-0 text-base ${entry.result.detected ? "text-emerald-500" : "text-red-500"}`}>
                  {entry.result.detected ? "✓" : "✗"}
                </span>
                <span className="font-mono text-ink-soft shrink-0 w-5 text-center">{entry.id}</span>
                <span className="font-semibold text-ink shrink-0">{entry.branch}</span>
                <span className="text-ink-faint shrink-0">
                  {ATTACK_TYPES.find((a) => a.value === entry.attackType)?.label ?? entry.attackType}
                </span>
                <span className="text-ink-faint shrink-0">sim={entry.result.cosine_similarity.toFixed(3)}</span>
                <span className={`ml-auto shrink-0 font-semibold ${entry.result.detected ? "text-emerald-600" : "text-red-600"}`}>
                  {entry.result.detected ? "DETECTED" : "EVADED"}
                </span>
                <span className="text-gray-300 shrink-0">{entry.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ThreatUser {
  user_id: string;
  threat_score: number;
  suspended: boolean;
  last_seen?: string;
  event_count?: number;
  events?: ThreatEvent[];
}

interface ThreatEvent {
  user_id: string;
  endpoint: string;
  method: string;
  status: number;
  delta: number;
  score: number;
  reason: string;
  timestamp: string;
}

interface ThreatStats {
  tracked_users: number;
  suspended_users: number;
  high_risk_users: number;
  total_events: number;
  auto_threshold: number;
}

interface IpBan {
  ip: string;
  seconds_remaining: number;
  unban_at: string;
}

function threatColor(score: number): string {
  if (score >= 80) return "text-red-600";
  if (score >= 50) return "text-orange-500";
  if (score >= 25) return "text-yellow-600";
  return "text-green-600";
}

function threatBadge(score: number, suspended: boolean) {
  if (suspended) return <Badge variant="danger">Suspended</Badge>;
  if (score >= 80) return <Badge variant="danger">Critical</Badge>;
  if (score >= 50) return <Badge variant="warning">High Risk</Badge>;
  if (score >= 25) return <Badge variant="default">Elevated</Badge>;
  return <Badge variant="success">Normal</Badge>;
}

function ThreatBar({ score }: { score: number }) {
  const pct = Math.min(100, score);
  const color = score >= 80 ? "bg-red-500" : score >= 50 ? "bg-orange-400" : score >= 25 ? "bg-yellow-400" : "bg-green-400";
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function SecurityPage() {
  useAuth();
  const [threats, setThreats] = useState<ThreatUser[]>([]);
  const [stats, setStats] = useState<ThreatStats | null>(null);
  const [threatLog, setThreatLog] = useState<ThreatEvent[]>([]);
  const [ipBans, setIpBans] = useState<IpBan[]>([]);
  const [selectedUser, setSelectedUser] = useState<ThreatUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<"threats" | "events" | "ipbans">("threats");

  const refresh = useCallback(async () => {
    try {
      const [td, tlog, bans] = await Promise.all([
        apiFetch<{ users: ThreatUser[]; stats: ThreatStats }>("/api/hq/security/threats").catch(() => null),
        apiFetch<{ events: ThreatEvent[] }>("/api/hq/security/threat_log?last_n=50").catch(() => null),
        apiFetch<{ active_bans: IpBan[] }>("/api/hq/security/active_bans").catch(() => null),
      ]);
      if (td) { setThreats(td.users); setStats(td.stats); }
      if (tlog) setThreatLog(tlog.events);
      if (bans) setIpBans(bans.active_bans || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSuspend = async (userId: string) => {
    setActionLoading(userId);
    try {
      await apiFetch(`/api/hq/security/suspend/${userId}`, { method: "POST" });
      await refresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnsuspend = async (userId: string) => {
    setActionLoading(userId);
    try {
      await apiFetch(`/api/hq/security/unsuspend/${userId}`, { method: "POST" });
      await refresh();
    } finally {
      setActionLoading(null);
    }
  };

  const loadUserDetail = async (userId: string) => {
    const detail = await apiFetch<ThreatUser>(`/api/hq/security/threats/${userId}`).catch(() => null);
    if (detail) setSelectedUser(detail);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Shield className="text-red-500" size={24} />
            Security &amp; Threat Management
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Real-time behavioural threat detection — suspicious users are auto-suspended
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-line rounded-lg hover:bg-canvas"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <StatCard label="Tracked Users" value={stats.tracked_users} icon={<Shield size={16} />} />
          <StatCard label="Suspended" value={stats.suspended_users} icon={<Ban size={16} />} color="red" />
          <StatCard label="High Risk" value={stats.high_risk_users} icon={<AlertTriangle size={16} />} color="amber" />
          <StatCard label="Threat Events" value={stats.total_events} icon={<AlertTriangle size={16} />} />
          <StatCard label="Auto-Suspend at" value={`${stats.auto_threshold}pts`} icon={<Lock size={16} />} />
        </div>
      )}

      {/* How it works banner */}
      <div className="bg-teal-soft border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">How automatic threat detection works</p>
        <ul className="list-disc ml-4 space-y-0.5 text-teal-deep">
          <li>Every authenticated API call is monitored for suspicious patterns</li>
          <li><strong>+15 pts</strong> — Request burst (&gt;30 req in 60 s)</li>
          <li><strong>+20 pts</strong> — Bulk data harvest (&gt;15 export calls in 2 min)</li>
          <li><strong>+25 pts</strong> — Privilege probing (&gt;8 forbidden errors in 60 s)</li>
          <li><strong>+30 pts</strong> — Cross-user data access attempt</li>
          <li><strong>+20 pts</strong> — Branch manager hitting HQ write endpoints</li>
          <li>Score decays 5 pts/min when user is quiet — auto-suspend at 80 pts</li>
        </ul>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {(["threats", "events", "ipbans"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? "border-blue-500 text-teal" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t === "threats" ? "User Threats" : t === "events" ? "Event Log" : "IP Bans"}
            {t === "threats" && threats.length > 0 && (
              <span className="ml-2 bg-gray-100 text-ink-soft text-xs px-1.5 py-0.5 rounded-full">{threats.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* User Threats tab */}
      {tab === "threats" && (
        <Card>
          {threats.length === 0 ? (
            <div className="py-12 text-center text-ink-faint">
              <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
              <p className="font-medium">No threats detected</p>
              <p className="text-sm">All users are behaving normally</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {threats.map((u) => (
                <div key={u.user_id} className="flex items-center gap-4 p-4 hover:bg-canvas">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold text-ink">{u.user_id}</span>
                      {threatBadge(u.threat_score, u.suspended)}
                    </div>
                    <ThreatBar score={u.threat_score} />
                    <div className="flex items-center gap-3 mt-1 text-xs text-ink-faint">
                      <span className={`font-bold ${threatColor(u.threat_score)}`}>{u.threat_score} pts</span>
                      {u.last_seen && <span>Last seen: {new Date(u.last_seen).toLocaleTimeString()}</span>}
                      {u.event_count != null && <span>{u.event_count} events</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => loadUserDetail(u.user_id)}
                      className="text-xs px-2 py-1 border border-line rounded hover:bg-gray-100"
                    >
                      Details
                    </button>
                    {u.suspended ? (
                      <button
                        onClick={() => handleUnsuspend(u.user_id)}
                        disabled={actionLoading === u.user_id}
                        className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {actionLoading === u.user_id ? <Spinner size="sm" /> : <CheckCircle size={12} />}
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSuspend(u.user_id)}
                        disabled={actionLoading === u.user_id}
                        className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {actionLoading === u.user_id ? <Spinner size="sm" /> : <UserX size={12} />}
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Event Log tab */}
      {tab === "events" && (
        <Card>
          {threatLog.length === 0 ? (
            <div className="py-12 text-center text-ink-faint">No threat events recorded yet</div>
          ) : (
            <div className="divide-y divide-gray-100 text-sm">
              {[...threatLog].reverse().map((ev, i) => (
                <div key={i} className="flex items-start gap-3 p-3">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-ink">{ev.user_id}</span>
                      <span className="text-ink-faint">→</span>
                      <span className="font-mono text-xs text-teal">{ev.method} {ev.endpoint}</span>
                      <span className={`text-xs font-bold ${ev.status >= 400 ? "text-red-500" : "text-ink-faint"}`}>
                        {ev.status}
                      </span>
                    </div>
                    <p className="text-xs text-orange-600 mt-0.5">{ev.reason}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-ink-faint">
                      <span>Score: {ev.score} pts (+{ev.delta})</span>
                      <span>{new Date(ev.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* IP Bans tab */}
      {tab === "ipbans" && (
        <Card>
          {ipBans.length === 0 ? (
            <div className="py-12 text-center text-ink-faint">
              <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
              <p>No active IP bans</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 text-sm">
              {ipBans.map((ban, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div>
                    <span className="font-mono font-semibold text-red-600">{ban.ip}</span>
                    <p className="text-xs text-ink-faint mt-0.5">Unban at: {new Date(ban.unban_at).toLocaleTimeString()}</p>
                  </div>
                  <Badge variant="danger">{ban.seconds_remaining}s remaining</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Byzantine Attack Simulator ───────────────────── */}
      <div className="pt-2">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Zap size={20} className="text-red-500" />
            <h2 className="text-lg font-bold text-ink">Live Attack Simulator</h2>
          </div>
          <ByzantineSimulator />
        </Card>
      </div>

      {/* User detail modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Threat Detail: {selectedUser.user_id}</h2>
              <button onClick={() => setSelectedUser(null)} className="text-ink-faint hover:text-ink-soft text-xl leading-none">&times;</button>
            </div>
            <div className="flex items-center gap-3">
              <ThreatBar score={selectedUser.threat_score} />
              <span className={`font-bold text-sm shrink-0 ${threatColor(selectedUser.threat_score)}`}>
                {selectedUser.threat_score} pts
              </span>
            </div>
            {threatBadge(selectedUser.threat_score, selectedUser.suspended)}
            <div>
              <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Recent Events</p>
              {selectedUser.events && selectedUser.events.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {[...(selectedUser.events || [])].reverse().map((ev, i) => (
                    <div key={i} className="bg-orange-50 border border-orange-100 rounded-lg p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-teal">{ev.method} {ev.endpoint}</span>
                        <span className="text-red-500 font-bold">+{ev.delta} pts</span>
                      </div>
                      <p className="text-orange-700 mt-0.5">{ev.reason}</p>
                      <p className="text-ink-faint">{new Date(ev.timestamp).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No events recorded</p>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              {selectedUser.suspended ? (
                <button
                  onClick={() => { handleUnsuspend(selectedUser.user_id); setSelectedUser(null); }}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Restore Access
                </button>
              ) : (
                <button
                  onClick={() => { handleSuspend(selectedUser.user_id); setSelectedUser(null); }}
                  className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                >
                  Suspend User
                </button>
              )}
              <button onClick={() => setSelectedUser(null)} className="px-4 py-2 border border-line rounded-lg text-sm hover:bg-canvas">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
