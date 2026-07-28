"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, StatCard } from "@/components/ui";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from "recharts";
import { Cpu, Play, RotateCcw, AlertTriangle, Shield, Loader2 } from "lucide-react";
import { hqFLSimulate, type FLSimulateResult } from "@/lib/api";

function computeConvergence(params: { branches: number; byzantine: number; dpEpsilon: number; learningRate: number; rounds: number }) {
  const { branches, byzantine, dpEpsilon, learningRate, rounds } = params;
  const healthyFraction = (branches - byzantine) / branches;
  const dpPenalty = Math.max(0, 1 - 0.08 / dpEpsilon);
  const branchBonus = Math.min(1, Math.log(branches) / Math.log(13));
  const lrFactor = 1 - Math.abs(learningRate - 0.01) * 20;

  const data = [];
  for (let r = 1; r <= rounds; r++) {
    const t = r / rounds;
    const base = 0.68 + 0.19 * (1 - Math.exp(-4 * t * branchBonus * lrFactor));

    // Byzantine disruption during rounds 3-5 (or proportional)
    const byzRound = r >= Math.floor(rounds * 0.25) && r <= Math.floor(rounds * 0.45);
    const byzDrop = byzantine > 0 && byzRound ? (byzantine / branches) * 0.15 : 0;

    const fl = Math.min(0.96, Math.max(0.55, (base - byzDrop) * healthyFraction * dpPenalty));
    const central = Math.min(0.98, Math.max(0.6, 0.70 + 0.20 * (1 - Math.exp(-5 * t))));
    const dp = Math.min(0.94, fl * dpPenalty * 0.98);

    data.push({
      round: `R${r}`,
      "Federated": Math.round(fl * 1000) / 1000,
      "Centralised": Math.round(central * 1000) / 1000,
      "FL + DP": Math.round(dp * 1000) / 1000,
      byzantine_active: byzantine > 0 && byzRound,
    });
  }
  return data;
}

export default function FLSimulatorPage() {
  const [branches, setBranches] = useState(8);
  const [byzantine, setByzantine] = useState(1);
  const [dpEpsilon, setDpEpsilon] = useState(1.0);
  const [learningRate, setLearningRate] = useState(0.01);
  const [rounds, setRounds] = useState(12);
  const [show, setShow] = useState({ fl: true, central: true, dp: true });

  // Instant client-side preview so the chart never feels laggy while dragging sliders.
  const previewData = useMemo(() => computeConvergence({ branches, byzantine, dpEpsilon, learningRate, rounds }), [branches, byzantine, dpEpsilon, learningRate, rounds]);

  // Authoritative backend simulation — runs the real cosine-similarity Byzantine
  // filter and Gaussian DP noise from the BFF, debounced so it fires once
  // sliders settle rather than on every drag tick.
  const [backend, setBackend] = useState<FLSimulateResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSimulating(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      hqFLSimulate({ branches, byzantine, dp_epsilon: dpEpsilon, learning_rate: learningRate, rounds })
        .then(setBackend)
        .catch(() => setBackend(null))
        .finally(() => setSimulating(false));
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [branches, byzantine, dpEpsilon, learningRate, rounds]);

  const chartData = backend?.data ?? previewData;
  const final = chartData[chartData.length - 1];
  const byzStartRound = `R${Math.floor(rounds * 0.25)}`;
  const byzEndRound = `R${Math.floor(rounds * 0.45)}`;

  const reset = () => { setBranches(8); setByzantine(1); setDpEpsilon(1.0); setLearningRate(0.01); setRounds(12); };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Cpu size={22} className="text-teal" />Federated Training Simulator
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Adjust parameters and watch how they affect FL convergence in real-time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {simulating ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-teal-soft text-teal rounded-full">
              <Loader2 size={12} className="animate-spin" />Simulating...
            </span>
          ) : backend ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-full" title={`${backend.algorithm.byzantine_detection} · ${backend.algorithm.dp_mechanism}`}>
              <Shield size={12} />Backend-verified
            </span>
          ) : null}
          <button onClick={reset} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-xl text-ink-soft transition-all">
            <RotateCcw size={12} />Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Final FL Accuracy" value={`${((final?.Federated ?? 0) * 100).toFixed(1)}%`} icon={<Cpu size={18} />} color="blue" />
        <StatCard label="vs Centralised" value={`${(((final?.["FL + DP"] ?? 0) - (final?.Centralised ?? 0)) * 100).toFixed(1)}%`} icon={<AlertTriangle size={18} />} color={((final?.["FL + DP"] ?? 0) - (final?.Centralised ?? 0)) > -0.05 ? "green" : "amber"} />
        <StatCard label="DP Privacy Cost" value={`ε = ${dpEpsilon.toFixed(1)}`} icon={<Shield size={18} />} color="amber" />
        <StatCard label="Healthy Branches" value={`${branches - byzantine}/${branches}`} icon={<Play size={18} />} color={byzantine === 0 ? "green" : byzantine <= 2 ? "amber" : "red"} />
      </div>

      {/* Controls */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Simulation Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: "Branches", value: branches, set: setBranches, min: 2, max: 13, step: 1, fmt: (v: number) => `${v}` },
            { label: "Byzantine Nodes", value: byzantine, set: setByzantine, min: 0, max: Math.min(5, branches - 1), step: 1, fmt: (v: number) => `${v} (${((v/branches)*100).toFixed(0)}%)` },
            { label: "DP Epsilon (ε)", value: dpEpsilon, set: setDpEpsilon, min: 0.1, max: 2.0, step: 0.1, fmt: (v: number) => v.toFixed(1) },
            { label: "Learning Rate", value: learningRate, set: setLearningRate, min: 0.001, max: 0.1, step: 0.001, fmt: (v: number) => v.toFixed(3) },
          ].map((ctrl) => (
            <div key={ctrl.label}>
              <div className="flex justify-between mb-1">
                <label className="text-xs font-semibold text-ink-soft">{ctrl.label}</label>
                <span className="text-xs font-bold text-teal">{ctrl.fmt(ctrl.value)}</span>
              </div>
              <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.value}
                onChange={(e) => ctrl.set(Number(e.target.value))} className="w-full" />
              <div className="flex justify-between text-[10px] text-ink-faint mt-0.5"><span>{ctrl.min}</span><span>{ctrl.max}</span></div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-line">
          <label className="text-xs font-semibold text-ink-soft">Training Rounds: {rounds}</label>
          <input type="range" min={5} max={20} step={1} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="w-full mt-1" />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Convergence Curves</h2>
          <div className="flex gap-2">
            {[{ key: "fl", label: "Federated" }, { key: "central", label: "Centralised" }, { key: "dp", label: "FL + DP" }].map((s) => (
              <button key={s.key} onClick={() => setShow((p) => ({ ...p, [s.key]: !p[s.key as keyof typeof p] }))}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${show[s.key as keyof typeof show] ? "bg-blue-100 text-teal-deep" : "bg-gray-100 text-ink-faint"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {byzantine > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-700">
            <AlertTriangle size={12} /><strong>{byzantine} Byzantine node{byzantine > 1 ? "s" : ""}</strong> — disruption visible during rounds {byzStartRound}–{byzEndRound}
          </div>
        )}

        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="round" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0.5, 1.0]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${((v ?? 0) * 100).toFixed(1)}%`, ""]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {byzantine > 0 && <ReferenceArea x1={byzStartRound} x2={byzEndRound} fill="#fecaca" fillOpacity={0.5} label={{ value: "Byzantine", position: "insideTop", fontSize: 10, fill: "#dc2626" }} />}
            {show.fl && <Line type="monotone" dataKey="Federated" stroke="#3b82f6" strokeWidth={2.5} dot={false} />}
            {show.central && <Line type="monotone" dataKey="Centralised" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="6 3" />}
            {show.dp && <Line type="monotone" dataKey="FL + DP" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="3 3" />}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-teal-soft border-blue-200 text-xs">
          <p className="font-bold text-blue-800 mb-1">More Branches</p>
          <p className="text-teal-deep">Adding branches improves generalization and resilience. FL benefits from data diversity across geographic regions.</p>
        </Card>
        <Card className="bg-red-50 border-red-200 text-xs">
          <p className="font-bold text-red-800 mb-1">Byzantine Nodes</p>
          <p className="text-red-700">Malicious nodes inject corrupted gradients. Our cosine-similarity detection quarantines outliers — watch the accuracy recover.</p>
        </Card>
        <Card className="bg-amber-50 border-amber-200 text-xs">
          <p className="font-bold text-amber-800 mb-1">Low ε (High Privacy)</p>
          <p className="text-amber-700">More differential privacy noise (lower ε) means stronger formal guarantees but slower convergence — the privacy-utility trade-off.</p>
        </Card>
      </div>
    </div>
  );
}
