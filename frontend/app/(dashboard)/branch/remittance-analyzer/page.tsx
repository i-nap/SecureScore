"use client";

import { useEffect, useState } from "react";
import { branchRemittanceAnalyze, type RemittanceAnalyzeResult } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  ArrowLeftRight,
  AlertTriangle,
  ShieldCheck,
  Activity,
  Info,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function fmtNpr(v: number) {
  if (v >= 1_000_000) return `NPR ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `NPR ${(v / 1_000).toFixed(1)}K`;
  return `NPR ${Math.round(v).toLocaleString()}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-ink-soft">{label}</label>
        {hint && <span className="text-[10px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-line bg-canvas py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition px-3"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default function RemittanceAnalyzerPage() {
  const [customerId, setCustomerId] = useState("cust001");
  const [frequency, setFrequency] = useState(4);
  const [avgAmount, setAvgAmount] = useState(45000);
  const [channel, setChannel] = useState("bank");
  const [corridor, setCorridor] = useState("India");
  const [senderCount, setSenderCount] = useState(1);
  const [cashoutDays, setCashoutDays] = useState(4);
  const [analysis, setAnalysis] = useState<RemittanceAnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    branchRemittanceAnalyze({
      customer_id: customerId,
      frequency,
      avg_amount: avgAmount,
      channel,
      corridor,
      sender_count: senderCount,
      cashout_days: cashoutDays,
    })
      .then((res) => {
        if (active) setAnalysis(res);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, frequency, avgAmount, channel, corridor, senderCount, cashoutDays]);

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-rose-600 to-pink-700 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">Remittance Analyzer</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Cross Border Flow Monitor</h1>
            <p className="mt-1 text-rose-100 text-sm">
              LSTM plus IsolationForest signals for remittance anomalies and hawala indicators.
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
              <ShieldCheck size={14} className="text-rose-100" />
              <span className="text-xs font-semibold text-white">Available</span>
            </div>
            <p className="text-[11px] text-rose-200 mt-1">Compliance ready</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-4">Inputs</p>
            <div className="space-y-4">
              <Field label="Customer ID">
                <input
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </Field>
              <Field label="Monthly Frequency" hint="transactions">
                <NumInput value={frequency} onChange={setFrequency} min={0} max={12} />
              </Field>
              <Field label="Avg Amount" hint="NPR">
                <NumInput value={avgAmount} onChange={setAvgAmount} min={0} step={1000} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Channel">
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <option value="bank">Bank</option>
                    <option value="digital">Digital Wallet</option>
                    <option value="cash">Cash</option>
                    <option value="hundi">Hundi</option>
                  </select>
                </Field>
                <Field label="Corridor">
                  <select
                    value={corridor}
                    onChange={(e) => setCorridor(e.target.value)}
                    className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <option value="India">India</option>
                    <option value="Gulf">Gulf</option>
                    <option value="USA">USA</option>
                    <option value="UK">UK</option>
                    <option value="Australia">Australia</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sender Count" hint="unique senders">
                  <NumInput value={senderCount} onChange={setSenderCount} min={1} max={10} />
                </Field>
                <Field label="Cash-out Speed" hint="days">
                  <NumInput value={cashoutDays} onChange={setCashoutDays} min={0} max={30} />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wider">Risk Score</p>
                <p className="text-3xl font-black text-ink mt-1">
                  {analysis ? `${analysis.risk_score.toFixed(0)} / 100` : "--"}
                </p>
                <p className="text-xs text-ink-soft mt-1">Severity: {analysis?.severity ?? "--"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink-faint">Recommended Action</p>
                <p className="text-sm font-semibold text-rose-700 mt-1">{analysis?.action ?? "--"}</p>
              </div>
            </div>

            {loading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
                <Spinner size="sm" /> Updating analysis...
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600">{error}</div>
            )}

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Avg Monthly</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {analysis ? fmtNpr(analysis.avg_monthly) : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Peak Month</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {analysis ? fmtNpr(analysis.peak_monthly) : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Baseline</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {analysis ? fmtNpr(analysis.base_monthly) : "--"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={16} className="text-rose-600" />
              <h2 className="text-sm font-semibold text-ink">Remittance Trend</h2>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={analysis?.series ?? []} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => (typeof v === "number" ? fmtNpr(v) : String(v))} />
                <Line type="monotone" dataKey="total" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              {(analysis?.flags?.length ?? 0) > 0 ? (
                <AlertTriangle size={16} className="text-amber-500" />
              ) : (
                <ShieldCheck size={16} className="text-emerald-500" />
              )}
              <h2 className="text-sm font-semibold text-ink">Anomaly Flags</h2>
            </div>
            {(analysis?.flags?.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-soft">No anomalies detected in this scenario.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(analysis?.flags ?? []).map((f, idx) => (
                  <span key={idx} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              <Info size={16} className="text-rose-600" />
              <h2 className="text-sm font-semibold text-ink">Analyst Notes</h2>
            </div>
            <p className="text-sm text-ink-soft">
              Use remittance consistency, corridor risk, and cash-out velocity to guide SAR decisions.
              Cross-check with AML Monitor for transaction level anomalies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
