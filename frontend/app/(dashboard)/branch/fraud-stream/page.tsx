"use client";
import { useEffect, useRef, useState } from "react";
import { Card, StatCard } from "@/components/ui";
import { subscribeFraudStream } from "@/lib/api";
import { AlertTriangle, CheckCircle2, Activity, Zap, Shield } from "lucide-react";

interface FraudEvent {
  id: number; customer_id: string; amount: number; merchant: string;
  risk_score: number; flagged: boolean; rule: string; top_feature: string;
  timestamp: string; historical: boolean;
}

function RiskBar({ score }: { score: number }) {
  const color = score >= 0.72 ? "#ef4444" : score >= 0.50 ? "#f59e0b" : "#10b981";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score * 100}%`, background: color }} />
      </div>
      <span className="text-xs font-mono font-bold" style={{ color }}>{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

const RULE_LABELS: Record<string, string> = {
  velocity_spike: "Velocity Spike", off_hours_activity: "Off-Hours", large_cash_deposit: "Large Cash",
  round_number_structuring: "Structuring", unusual_merchant: "Unusual Merchant", geo_anomaly: "Geo Anomaly",
};

export default function FraudStreamPage() {
  const [events, setEvents] = useState<FraudEvent[]>([]);
  const [live, setLive] = useState(false);
  const [stats, setStats] = useState({ total: 0, flagged: 0, avgRisk: 0 });
  const [paused, setPaused] = useState(false);
  const bufRef = useRef<FraudEvent[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setLive(false);
    const unsub = subscribeFraudStream((evt) => {
      if (!evt.historical) setLive(true);
      bufRef.current = [evt, ...bufRef.current].slice(0, 50);
      if (!paused) {
        setEvents([...bufRef.current]);
        setStats((s) => {
          const total = s.total + 1;
          const flagged = s.flagged + (evt.flagged ? 1 : 0);
          const avgRisk = (s.avgRisk * s.total + evt.risk_score) / total;
          return { total, flagged, avgRisk };
        });
      }
    });
    unsubRef.current = unsub;
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Activity size={22} className="text-red-500" />Real-time Fraud Detection
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Live ML-scored transactions · flagged when risk score ≥ 72%
            {live && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-semibold"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />LIVE</span>}
          </p>
        </div>
        <button onClick={() => setPaused((p) => !p)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${paused ? "bg-teal text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Transactions" value={String(stats.total)} icon={<Activity size={18} />} color="blue" />
        <StatCard label="Flagged" value={String(stats.flagged)} icon={<AlertTriangle size={18} />} color={stats.flagged > 0 ? "red" : "green"} />
        <StatCard label="Avg Risk" value={`${(stats.avgRisk * 100).toFixed(1)}%`} icon={<Zap size={18} />} color={stats.avgRisk > 0.5 ? "amber" : "green"} />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-canvas">
          <span className="text-xs font-bold text-ink-soft uppercase tracking-wide">Transaction Feed</span>
          <span className="text-xs text-ink-faint">{events.length} events</span>
        </div>
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-line">
              <tr className="text-xs text-ink-faint">
                <th className="text-left py-2 px-4">Customer</th>
                <th className="text-right py-2 px-4">Amount</th>
                <th className="text-left py-2 px-4">Merchant</th>
                <th className="text-left py-2 px-4 w-36">Risk Score</th>
                <th className="text-left py-2 px-4">Flag</th>
                <th className="text-right py-2 px-4">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.id}-${e.timestamp}`}
                  className={`border-b border-gray-50 transition-all ${e.flagged ? "bg-red-50/40" : ""} ${!e.historical ? "animate-pulse-once" : ""}`}>
                  <td className="py-2.5 px-4 font-mono text-xs text-ink">{e.customer_id}</td>
                  <td className="py-2.5 px-4 text-right font-medium text-ink">NPR {e.amount.toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-xs text-ink-soft">{e.merchant}</td>
                  <td className="py-2.5 px-4 w-36"><RiskBar score={e.risk_score} /></td>
                  <td className="py-2.5 px-4">
                    {e.flagged ? (
                      <span className="flex items-center gap-1 text-xs text-red-600 font-semibold">
                        <AlertTriangle size={11} />{RULE_LABELS[e.rule] ?? e.rule}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 size={11} />Clean
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right text-xs text-ink-faint">
                    {new Date(e.timestamp).toLocaleTimeString("en-NP")}
                    {!e.historical && <span className="ml-1 text-emerald-500 font-bold">●</span>}
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-ink-faint text-sm">Connecting to fraud detection stream…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="bg-teal-soft border-indigo-200">
        <div className="flex items-start gap-3">
          <Shield size={16} className="text-indigo-500 mt-0.5 shrink-0" />
          <p className="text-xs text-indigo-800">
            Each transaction is scored in real-time by the federated ML model. Risk score ≥ 72% triggers a flag with the top contributing feature (SHAP). Events are streamed via Server-Sent Events — no polling.
          </p>
        </div>
      </Card>
    </div>
  );
}
