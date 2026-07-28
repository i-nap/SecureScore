"use client";

import { useState, useCallback } from "react";
import {
  hqPrivacyGradientInversion,
  hqPrivacyMembershipInference,
  hqPrivacyModelInversion,
  type GradientInversionResult,
  type MembershipInferenceResult,
  type ModelInversionResult,
} from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { ShieldCheck, ShieldAlert, FlaskConical, Eye, Users } from "lucide-react";

const BRANCHES = [
  "kathmandu", "lalitpur", "pokhara", "bharatpur", "biratnagar",
  "butwal", "hetauda", "itahari", "dharan", "janakpur",
  "birgunj", "nepalgunj", "sarlahi",
];

// ── SVG Semicircle Gauge ─────────────────────────────────────────────────────

function SemiGauge({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const angle = (pct / 100) * 180 - 90; // -90 to +90 deg
  const rad = (angle * Math.PI) / 180;
  const cx = 100; const cy = 90; const r = 72;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);

  const trackColor = pct > 60 ? "#ef4444" : pct > 30 ? "#f59e0b" : "#10b981";
  const bgArc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fillEndRad = ((pct / 100) * 180 - 90) * (Math.PI / 180);
  const fillX = cx + r * Math.cos(fillEndRad);
  const fillY = cy + r * Math.sin(fillEndRad);
  const large = pct > 50 ? 1 : 0;
  const fillArc = `M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${fillX} ${fillY}`;

  return (
    <div className="flex flex-col items-center">
      <svg width={200} height={110} viewBox="0 0 200 110">
        <path d={bgArc} fill="none" stroke="#e5e7eb" strokeWidth={14} strokeLinecap="round" />
        {pct > 0 && (
          <path d={fillArc} fill="none" stroke={trackColor} strokeWidth={14} strokeLinecap="round" />
        )}
        <line
          x1={cx} y1={cy}
          x2={nx} y2={ny}
          stroke="#1f2937" strokeWidth={3} strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill="#1f2937" />
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize={22} fontWeight={700} fill={trackColor}>
          {pct.toFixed(1)}%
        </text>
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#6b7280">
          {label}
        </text>
        <text x={cx - r - 4} y={cy + 16} fontSize={10} fill="#9ca3af">0</text>
        <text x={cx + r - 4} y={cy + 16} fontSize={10} fill="#9ca3af">100</text>
      </svg>
    </div>
  );
}

// ── Confusion Matrix ─────────────────────────────────────────────────────────

function ConfusionMatrix({ tp, fp, tn, fn }: { tp: number; fp: number; tn: number; fn: number }) {
  return (
    <div className="inline-grid grid-cols-3 gap-1 text-xs font-medium">
      <div />
      <div className="text-center text-ink-soft pb-1">Pred +</div>
      <div className="text-center text-ink-soft pb-1">Pred -</div>
      <div className="text-ink-soft pr-2 flex items-center">Actual +</div>
      <div className="bg-green-100 text-green-800 rounded p-3 text-center">
        <div className="text-lg font-bold">{tp}</div>
        <div className="text-[10px]">TP</div>
      </div>
      <div className="bg-red-100 text-red-800 rounded p-3 text-center">
        <div className="text-lg font-bold">{fn}</div>
        <div className="text-[10px]">FN</div>
      </div>
      <div className="text-ink-soft pr-2 flex items-center">Actual -</div>
      <div className="bg-red-100 text-red-800 rounded p-3 text-center">
        <div className="text-lg font-bold">{fp}</div>
        <div className="text-[10px]">FP</div>
      </div>
      <div className="bg-green-100 text-green-800 rounded p-3 text-center">
        <div className="text-lg font-bold">{tn}</div>
        <div className="text-[10px]">TN</div>
      </div>
    </div>
  );
}

// ── DP Banner ────────────────────────────────────────────────────────────────

function DpBlockedBanner() {
  return (
    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-green-700 mt-3">
      <ShieldCheck size={16} />
      Differential Privacy BLOCKED this attack
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PrivacyAttacksPage() {
  const [dpOn, setDpOn] = useState(true);

  // Panel 1 — Gradient Inversion
  const [gisBranch, setGiBranch] = useState("kathmandu");
  const [giResult, setGiResult] = useState<GradientInversionResult | null>(null);
  const [giLoading, setGiLoading] = useState(false);
  const [giError, setGiError] = useState("");

  // Panel 2 — Membership Inference
  const [miBranch, setMiBranch] = useState("kathmandu");
  const [miQueries, setMiQueries] = useState(100);
  const [miResult, setMiResult] = useState<MembershipInferenceResult | null>(null);
  const [miLoading, setMiLoading] = useState(false);
  const [miError, setMiError] = useState("");

  // Panel 3 — Model Inversion
  const [mvResult, setMvResult] = useState<ModelInversionResult | null>(null);
  const [mvLoading, setMvLoading] = useState(false);
  const [mvError, setMvError] = useState("");

  const runGI = useCallback(async () => {
    setGiLoading(true); setGiError("");
    try { setGiResult(await hqPrivacyGradientInversion(gisBranch, dpOn)); }
    catch (e: unknown) { setGiError(e instanceof Error ? e.message : "Failed"); }
    finally { setGiLoading(false); }
  }, [gisBranch, dpOn]);

  const runMI = useCallback(async () => {
    setMiLoading(true); setMiError("");
    try { setMiResult(await hqPrivacyMembershipInference(miBranch, dpOn, miQueries)); }
    catch (e: unknown) { setMiError(e instanceof Error ? e.message : "Failed"); }
    finally { setMiLoading(false); }
  }, [miBranch, dpOn, miQueries]);

  const runMV = useCallback(async () => {
    setMvLoading(true); setMvError("");
    try { setMvResult(await hqPrivacyModelInversion(dpOn)); }
    catch (e: unknown) { setMvError(e instanceof Error ? e.message : "Failed"); }
    finally { setMvLoading(false); }
  }, [dpOn]);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <FlaskConical size={24} className="text-rose-500" />
          Privacy Attack Simulator
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Demonstrate real federated learning attacks and show how Differential Privacy defends against them
        </p>
      </div>

      {/* Global DP Toggle */}
      <Card className="flex items-center justify-between py-4">
        <div>
          <p className="font-semibold text-ink">Differential Privacy</p>
          <p className="text-xs text-ink-soft mt-0.5">
            Toggle to see how DP protects against all three attacks simultaneously
          </p>
        </div>
        <button
          onClick={() => setDpOn((v) => !v)}
          className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors focus:outline-none ${
            dpOn ? "bg-green-500" : "bg-red-500"
          }`}
        >
          <span
            className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
              dpOn ? "translate-x-9" : "translate-x-1"
            }`}
          />
        </button>
        <span className={`ml-3 text-sm font-bold ${dpOn ? "text-green-600" : "text-red-600"}`}>
          {dpOn ? "ON" : "OFF"}
        </span>
      </Card>

      {/* ── Panel 1: Gradient Inversion ─────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Eye size={18} className="text-rose-500" />
          <h2 className="text-base font-bold text-ink">Gradient Inversion Attack</h2>
        </div>
        <p className="text-sm text-ink-soft mb-4">
          Can an attacker reconstruct training data from weight updates?
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Branch</label>
            <select
              value={gisBranch}
              onChange={(e) => setGiBranch(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none"
            >
              {BRANCHES.map((b) => (
                <option key={b} value={b}>{capitalize(b)}</option>
              ))}
            </select>
          </div>
          <Button onClick={runGI} disabled={giLoading}>
            {giLoading ? <Spinner size="sm" /> : "Run Attack"}
          </Button>
        </div>

        {giError && <p className="text-sm text-red-600 mb-2">{giError}</p>}

        {giResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <SemiGauge value={giResult.fidelity_score * 100} label="Fidelity Score" />
              <div className="space-y-2">
                {giResult.attack_success ? (
                  <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 font-bold px-3 py-1.5 rounded-lg text-sm">
                    <ShieldAlert size={15} /> ATTACK SUCCESS ✗
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 font-bold px-3 py-1.5 rounded-lg text-sm">
                    <ShieldCheck size={15} /> ATTACK BLOCKED ✓
                  </span>
                )}
                <p className="text-xs text-ink-soft max-w-xs">{giResult.interpretation}</p>
                <Badge variant="default">{giResult.dp_protection}</Badge>
              </div>
            </div>

            {giResult.real_vs_reconstructed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-ink-soft mb-2">Real vs Reconstructed Features</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={giResult.real_vs_reconstructed} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="feature" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={((v: number | undefined, name: string) => [(v ?? 0).toFixed(3), name]) as any}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="real_mean" name="Real" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="reconstructed_mean" name="Reconstructed" fill="#f87171" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {dpOn && <DpBlockedBanner />}
          </div>
        )}
      </Card>

      {/* ── Panel 2: Membership Inference ───────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Users size={18} className="text-amber-500" />
          <h2 className="text-base font-bold text-ink">Membership Inference Attack</h2>
        </div>
        <p className="text-sm text-ink-soft mb-4">
          Can an attacker tell if a customer was in a branch&#39;s training set?
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Branch</label>
            <select
              value={miBranch}
              onChange={(e) => setMiBranch(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none"
            >
              {BRANCHES.map((b) => (
                <option key={b} value={b}>{capitalize(b)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">
              Queries: <span className="text-teal font-bold">{miQueries}</span>
            </label>
            <input
              type="range" min={50} max={200} step={10}
              value={miQueries}
              onChange={(e) => setMiQueries(Number(e.target.value))}
              className="w-36 accent-blue-500"
            />
          </div>
          <Button onClick={runMI} disabled={miLoading}>
            {miLoading ? <Spinner size="sm" /> : "Run Attack"}
          </Button>
        </div>

        {miError && <p className="text-sm text-red-600 mb-2">{miError}</p>}

        {miResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="text-center">
                <p className="text-xs text-ink-soft mb-1">Attack Accuracy</p>
                <p className={`text-3xl font-black ${miResult.attack_success ? "text-red-600" : "text-green-600"}`}>
                  {(miResult.attack_accuracy * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-ink-faint">vs 50% baseline</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-ink-soft mb-1">Advantage over Random</p>
                <p className={`text-3xl font-black ${Math.abs(miResult.advantage) > 0.05 ? "text-red-600" : "text-green-600"}`}>
                  {(miResult.advantage * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-soft mb-2">Confusion Matrix</p>
                <ConfusionMatrix {...miResult.confusion} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {miResult.attack_success ? (
                <Badge variant="danger">ATTACK SUCCESS ✗</Badge>
              ) : (
                <Badge variant="success">ATTACK BLOCKED ✓</Badge>
              )}
              <p className="text-xs text-ink-soft">{miResult.interpretation}</p>
            </div>

            {dpOn && <DpBlockedBanner />}
          </div>
        )}
      </Card>

      {/* ── Panel 3: Model Inversion ─────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical size={18} className="text-purple-500" />
          <h2 className="text-base font-bold text-ink">Model Inversion Attack</h2>
        </div>
        <p className="text-sm text-ink-soft mb-4">
          Can an attacker reconstruct the average customer profile from the model?
        </p>

        <Button onClick={runMV} disabled={mvLoading} className="mb-4">
          {mvLoading ? <Spinner size="sm" /> : "Run Attack"}
        </Button>

        {mvError && <p className="text-sm text-red-600 mb-2">{mvError}</p>}

        {mvResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 mb-2">
              {mvResult.attack_success ? (
                <Badge variant="danger">ATTACK SUCCESS ✗</Badge>
              ) : (
                <Badge variant="success">ATTACK BLOCKED ✓</Badge>
              )}
              <Badge variant={mvResult.similarity_to_real > 0.6 ? "danger" : "success"}>
                Similarity to real: {(mvResult.similarity_to_real * 100).toFixed(1)}%
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-green-700 mb-2 uppercase tracking-wide">
                  Creditworthy Prototype
                </p>
                <div className="rounded-lg overflow-hidden border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-canvas">
                      <tr>
                        <th className="px-3 py-2 text-left text-ink-soft font-medium">Feature</th>
                        <th className="px-3 py-2 text-right text-ink-soft font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {Object.entries(mvResult.creditworthy_prototype).map(([k, v]) => (
                        <tr key={k} className="hover:bg-canvas">
                          <td className="px-3 py-2 text-ink">{k.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-right font-mono text-ink">
                            {typeof v === "number" ? v.toFixed(3) : v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-red-700 mb-2 uppercase tracking-wide">
                  Default Prototype
                </p>
                <div className="rounded-lg overflow-hidden border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-canvas">
                      <tr>
                        <th className="px-3 py-2 text-left text-ink-soft font-medium">Feature</th>
                        <th className="px-3 py-2 text-right text-ink-soft font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {Object.entries(mvResult.default_prototype).map(([k, v]) => (
                        <tr key={k} className="hover:bg-canvas">
                          <td className="px-3 py-2 text-ink">{k.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-right font-mono text-ink">
                            {typeof v === "number" ? v.toFixed(3) : v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <p className="text-xs text-ink-soft">{mvResult.interpretation}</p>

            {dpOn && <DpBlockedBanner />}
          </div>
        )}
      </Card>
    </div>
  );
}
