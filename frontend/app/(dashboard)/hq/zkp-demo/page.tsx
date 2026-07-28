"use client";
import { useEffect, useState } from "react";
import { Card, StatCard, Button, Spinner } from "@/components/ui";
import { hqZKPDemo, type ZKPDemoResult, type ZKPStep } from "@/lib/api";
import { Lock, User, Building2, CheckCircle2, XCircle, ChevronRight, ShieldCheck } from "lucide-react";

const ACTOR_STYLES: Record<string, { bg: string; icon: React.ReactNode; label: string }> = {
  customer: { bg: "bg-teal-soft border-indigo-200", icon: <User size={16} className="text-indigo-500" />, label: "Customer (Prover)" },
  bank: { bg: "bg-emerald-50 border-emerald-200", icon: <Building2 size={16} className="text-emerald-500" />, label: "Bank (Verifier)" },
  both: { bg: "bg-canvas border-line", icon: <ShieldCheck size={16} className="text-ink-soft" />, label: "Both Parties" },
};

function StepCard({ step, active, done, idx }: { step: ZKPStep; active: boolean; done: boolean; idx: number }) {
  const style = ACTOR_STYLES[step.actor] ?? ACTOR_STYLES.both;
  return (
    <div className={`rounded-xl border-2 p-4 transition-all ${active ? style.bg + " ring-2 ring-offset-1 ring-blue-400" : done ? "border-emerald-200 bg-emerald-50/40" : "border-line bg-white"}`}>
      <div className="flex items-start gap-3 mb-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${done ? "bg-emerald-500 text-white" : active ? "bg-teal text-white" : "bg-gray-200 text-ink-soft"}`}>
          {done ? "✓" : idx + 1}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">{step.title}</p>
            <span className="flex items-center gap-1 text-xs text-ink-faint">{style.icon}{style.label}</span>
          </div>
          <p className="text-xs text-ink-soft mt-0.5">{step.description}</p>
        </div>
      </div>
      {(active || done) && (
        <div className="ml-9 space-y-1 mt-2">
          {Object.entries(step.data).map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 text-xs">
              <span className="font-semibold text-ink-soft capitalize shrink-0 w-28">{k.replace(/_/g, " ")}:</span>
              <span className={`font-mono break-all ${k === "verified" ? (v ? "text-emerald-600 font-bold" : "text-red-600 font-bold") : "text-ink"}`}>
                {typeof v === "boolean" ? (v ? "✓ TRUE" : "✗ FALSE") : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ZKPDemoPage() {
  const [data, setData] = useState<ZKPDemoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState(400000);
  const [activeStep, setActiveStep] = useState(-1);
  const [running, setRunning] = useState(false);

  const load = (t: number) => {
    setLoading(true); setActiveStep(-1);
    hqZKPDemo(t).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(threshold); }, []);

  const runDemo = async () => {
    if (!data) return;
    setRunning(true);
    for (let i = 0; i < data.steps.length; i++) {
      setActiveStep(i);
      await new Promise((r) => setTimeout(r, 1500));
    }
    setRunning(false);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Lock size={22} className="text-teal" />Zero-Knowledge Proof Demo
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          A customer proves their income exceeds a threshold — without revealing the actual figure.
          Based on Schnorr Sigma Protocol + Bulletproof range proofs.
        </p>
      </div>

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-xs font-semibold text-ink-soft mb-1 block">Income Threshold (NPR)</label>
            <input type="range" min={100000} max={1000000} step={50000} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full" />
            <div className="flex justify-between text-xs text-ink-faint mt-1"><span>100k</span><span className="font-bold text-ink">NPR {threshold.toLocaleString()}</span><span>1M</span></div>
          </div>
          <Button onClick={() => load(threshold)} disabled={loading} className="shrink-0">Apply</Button>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : error || !data ? (
        <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Claim" value={data.claim_valid ? "TRUE ✓" : "FALSE ✗"} icon={data.claim_valid ? <CheckCircle2 size={18} /> : <XCircle size={18} />} color={data.claim_valid ? "green" : "red"} />
            <StatCard label="Protocol" value="Schnorr" icon={<Lock size={18} />} color="blue" />
            <StatCard label="Privacy" value="Zero-Knowledge" icon={<ShieldCheck size={18} />} color="green" />
            <StatCard label="Threshold" value={`NPR ${(threshold/1000).toFixed(0)}k`} icon={<ChevronRight size={18} />} color="blue" />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Protocol Steps</h2>
            <Button onClick={runDemo} disabled={running} className="text-sm">
              {running ? <><Spinner size="sm" />Running&hellip;</> : "▶ Run Protocol"}
            </Button>
          </div>

          <div className="space-y-3">
            {data.steps.map((step, i) => (
              <StepCard key={step.phase} step={step} active={i === activeStep} done={i < activeStep} idx={i} />
            ))}
          </div>

          <Card className="bg-teal-soft border-purple-200">
            <p className="text-xs font-bold text-purple-800 mb-1">Why this matters for banking</p>
            <p className="text-xs text-teal-deep">
              <strong>{data.privacy_guarantee}.</strong> The bank learns only whether income &ge; threshold — not the customer&apos;s salary, not their employer, not any other financial detail.
              This can replace income certificate requirements in digital KYC.
              <br/><strong>Soundness:</strong> {data.soundness}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
