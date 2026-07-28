"use client";

import { useEffect, useState } from "react";
import { Card, Spinner, Badge, Button } from "@/components/ui";
import { hqHEDemo, type HEDemoResult, type HEStep } from "@/lib/api";
import { Lock, Unlock, Cpu, ShieldCheck } from "lucide-react";

const PHASE_ICONS: Record<string, React.ReactNode> = {
  plaintext: <Unlock size={20} className="text-ink-soft" />,
  encrypt: <Lock size={20} className="text-blue-500" />,
  compute: <Cpu size={20} className="text-purple-500" />,
  decrypt: <ShieldCheck size={20} className="text-emerald-500" />,
};

const PHASE_COLORS: Record<string, string> = {
  plaintext: "border-line bg-canvas",
  encrypt: "border-blue-200 bg-teal-soft",
  compute: "border-purple-200 bg-teal-soft",
  decrypt: "border-emerald-200 bg-emerald-50",
};

function StepCard({ step, active, done, onClick }: { step: HEStep; active: boolean; done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full text-left rounded-xl border-2 p-4 transition-all ${active ? PHASE_COLORS[step.phase] + " ring-2 ring-blue-400" : done ? "border-emerald-200 bg-emerald-50/50" : "border-line bg-white hover:border-line"}`}>
      <div className="flex items-center gap-3 mb-2">
        {PHASE_ICONS[step.phase]}
        <span className="text-sm font-bold text-ink">{step.title}</span>
        {done && <span className="ml-auto text-emerald-500 text-xs font-bold">✓</span>}
        {active && <span className="ml-auto text-xs bg-blue-500 text-white rounded-full px-2 py-0.5">Active</span>}
      </div>
      <p className="text-xs text-ink-soft">{step.description}</p>
    </button>
  );
}

export default function HEDemoPage() {
  const [data, setData] = useState<HEDemoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    hqHEDemo()
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const runDemo = async () => {
    if (!data) return;
    setRunning(true);
    setActiveStep(0);
    for (let i = 0; i < data.steps.length; i++) {
      setActiveStep(i);
      await new Promise((r) => setTimeout(r, 1400));
    }
    setActiveStep(data.steps.length - 1);
    setRunning(false);
  };

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const step = data.steps[activeStep];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Lock size={22} className="text-teal" />
            Homomorphic Encryption Demo
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Visualise how credit scores are computed on encrypted data — HQ never sees raw customer features.
          </p>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <Badge variant="default">{data.scheme}</Badge>
          <span className="text-xs text-ink-faint">{data.security_level}-bit security</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="text-center py-3">
          <p className="text-xs text-ink-faint">Scheme</p>
          <p className="text-sm font-bold text-ink">BFV</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-xs text-ink-faint">Performance Overhead</p>
          <p className="text-sm font-bold text-amber-600">{data.performance_overhead}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-xs text-ink-faint">Privacy Guarantee</p>
          <p className="text-sm font-bold text-emerald-600">Indistinguishable</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Step selector */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Processing Steps</h2>
            <Button onClick={runDemo} disabled={running} className="text-xs py-1 px-3">
              {running ? <><Spinner size="sm" />Running…</> : "▶ Run Demo"}
            </Button>
          </div>
          {data.steps.map((s, i) => (
            <StepCard key={s.phase} step={s} active={i === activeStep} done={i < activeStep} onClick={() => !running && setActiveStep(i)} />
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          <Card className={`transition-all border-2 ${PHASE_COLORS[step.phase]}`}>
            <div className="flex items-center gap-3 mb-4">
              {PHASE_ICONS[step.phase]}
              <div>
                <h3 className="text-base font-bold text-ink">{step.title}</h3>
                <p className="text-xs text-ink-soft">{step.description}</p>
              </div>
            </div>

            <div className="space-y-2">
              {Object.entries(step.data).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 py-2 border-b border-black/5">
                  <span className="text-xs font-semibold text-ink-soft shrink-0">{k.replace(/_/g, " ")}</span>
                  <span className={`text-xs font-mono text-right break-all ${step.phase === "encrypt" || step.phase === "compute" ? "text-teal-deep font-bold" : "text-ink"}`}>
                    {typeof v === "boolean" ? (v ? "✓ Yes" : "✗ No") : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Visual encryption animation */}
          {step.phase === "encrypt" && (
            <Card className="mt-4 bg-gray-900 border-0">
              <p className="text-xs text-ink-soft mb-3 font-mono">{"// Encryption in progress"}</p>
              <div className="space-y-1 font-mono text-xs">
                {["annual_income", "debt_to_income", "credit_history"].map((f, i) => (
                  <div key={f} className="flex items-center gap-2">
                    <span className="text-ink-faint">{f}:</span>
                    <span className="text-green-400">{running ? "encrypting…" : `0x${Math.random().toString(16).slice(2,10)}...`}</span>
                    <span className="text-ink-soft">→</span>
                    <span className="text-blue-400">E(f{i + 1})</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {step.phase === "compute" && (
            <Card className="mt-4 bg-gray-900 border-0">
              <p className="text-xs text-ink-soft mb-3 font-mono">{"// Homomorphic computation"}</p>
              <div className="text-xs font-mono text-purple-300">
                E(score) = Σᵢ E(wᵢ) ⊗ E(fᵢ)
              </div>
              <div className="text-xs text-ink-soft mt-1 font-mono">
                All arithmetic on ciphertexts — no decryption needed
              </div>
            </Card>
          )}

          {step.phase === "decrypt" && (
            <Card className="mt-4 bg-emerald-900/30 border border-emerald-700">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-400" />
                <div>
                  <p className="text-sm font-bold text-emerald-300">Computation Verified</p>
                  <p className="text-xs text-emerald-400">HQ never accessed plaintext features. Privacy preserved.</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
