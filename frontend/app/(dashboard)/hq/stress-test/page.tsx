"use client";

import { useState } from "react";
import { Card, StatCard, Button, Spinner } from "@/components/ui";
import {
  hqStressTest,
  type StressTestRequest,
  type StressTestResult,
  type StressTestBranchResult,
} from "@/lib/api";
import {
  AlertTriangle,
  TrendingDown,
  Activity,
  Zap,
  Play,
  Building2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const SCENARIOS: { id: StressTestRequest["scenario"]; label: string; description: string; icon: string }[] = [
  { id: "recession", label: "Recession", description: "Income -30%, unemployment +15%, existing loans +20%", icon: "📉" },
  { id: "earthquake", label: "Earthquake", description: "Collateral -40%, rural branches worst hit", icon: "🏚️" },
  { id: "inflation_spike", label: "Inflation Spike", description: "DTI +25%, real income -20%", icon: "📈" },
  { id: "currency_crisis", label: "Currency Crisis", description: "Remittance income -50%, dollar loans stressed", icon: "💱" },
  { id: "custom", label: "Custom", description: "Define your own shock parameters", icon: "⚙️" },
];

function riskColor(level: string) {
  if (level === "high") return "bg-red-100 text-red-700 border-red-200";
  if (level === "medium") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-emerald-100 text-emerald-700 border-emerald-200";
}

function deltaColor(delta: number) {
  if (delta > 0.15) return "text-red-600 font-bold";
  if (delta > 0.05) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function overallDeltaColor(delta: number) {
  if (delta > 0.15) return "red" as const;
  if (delta > 0.05) return "amber" as const;
  return "green" as const;
}

export default function StressTestPage() {
  const [scenario, setScenario] = useState<StressTestRequest["scenario"]>("recession");
  const [severity, setSeverity] = useState(70);
  const [incomeSh, setIncomeSh] = useState(-0.3);
  const [unemploySh, setUnemploySh] = useState(0.1);
  const [loanSh, setLoanSh] = useState(0.0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StressTestResult | null>(null);

  async function runTest() {
    setLoading(true);
    setError("");
    try {
      const req: StressTestRequest = {
        scenario,
        severity: severity / 100,
        custom_params:
          scenario === "custom"
            ? { income_shock: incomeSh, unemployment_delta: unemploySh, existing_loans_shock: loanSh }
            : {},
      };
      const r = await hqStressTest(req);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Stress test failed");
    } finally {
      setLoading(false);
    }
  }

  const chartData =
    result?.branches.map((b: StressTestBranchResult) => ({
      name: b.branch.slice(0, 8),
      fullName: b.branch,
      Baseline: Number((b.baseline * 100).toFixed(1)),
      Stressed: Number((b.stressed * 100).toFixed(1)),
      risk_level: b.risk_level,
    })) ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Zap size={22} className="text-amber-500" />
          Portfolio Stress Test
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Simulate macroeconomic shocks on the loan portfolio and see projected default rate impact across all branches.
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scenario selector */}
        <div className="lg:col-span-2">
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3">Scenario</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScenario(s.id)}
                  className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                    scenario === s.id
                      ? "border-blue-500 bg-teal-soft"
                      : "border-line hover:border-gray-300 bg-white"
                  }`}
                >
                  <span className="text-2xl">{s.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{s.label}</p>
                    <p className="text-xs text-ink-soft mt-0.5">{s.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {scenario === "custom" && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-line pt-4">
                {[
                  { label: "Income Shock", value: incomeSh, set: setIncomeSh, min: -1, max: 0, step: 0.05 },
                  { label: "Unemployment Delta", value: unemploySh, set: setUnemploySh, min: 0, max: 0.5, step: 0.05 },
                  { label: "Existing Loans Shock", value: loanSh, set: setLoanSh, min: 0, max: 1, step: 0.05 },
                ].map(({ label, value, set, min, max, step }) => (
                  <div key={label}>
                    <label className="text-xs text-ink-soft block mb-1">{label}</label>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      onChange={(e) => set(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-xs text-ink-faint">{(value * 100).toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Severity & run */}
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-3">Severity</h2>
          <div className="flex flex-col gap-2 mb-6">
            <div className="flex justify-between text-xs text-ink-soft">
              <span>Mild</span>
              <span className="font-bold text-ink text-lg">{severity}%</span>
              <span>Severe</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              className="w-full"
            />
            <div className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 relative">
              <div
                className="absolute top-0 h-2 w-1 bg-white border border-gray-400 rounded-full -translate-x-1/2"
                style={{ left: `${severity}%` }}
              />
            </div>
          </div>

          <Button onClick={runTest} disabled={loading} className="w-full">
            {loading ? <Spinner size="sm" /> : <Play size={14} />}
            {loading ? "Running..." : "Run Stress Test"}
          </Button>
          {error && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1">{error}</p>
          )}
        </Card>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Big stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Baseline Default Rate"
              value={`${(result.baseline_default_rate * 100).toFixed(1)}%`}
              icon={<Activity size={18} />}
              color="green"
            />
            <StatCard
              label="Stressed Default Rate"
              value={`${(result.stressed_default_rate * 100).toFixed(1)}%`}
              icon={<TrendingDown size={18} />}
              color={overallDeltaColor(result.delta)}
            />
            <StatCard
              label="Delta"
              value={`+${(result.delta * 100).toFixed(1)}%`}
              icon={<AlertTriangle size={18} />}
              color={overallDeltaColor(result.delta)}
            />
            <StatCard
              label="Most at Risk"
              value={result.most_at_risk[0] ?? "—"}
              sub={result.most_at_risk.slice(1).join(", ")}
              icon={<Building2 size={18} />}
              color="red"
            />
          </div>

          {/* Capital impact + recommendation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <h3 className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">
                Capital Adequacy Impact
              </h3>
              <p className="text-sm text-ink font-medium">{result.capital_adequacy_impact}</p>
            </Card>
            <Card>
              <h3 className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">
                NRB Recommendation
              </h3>
              <p className="text-sm text-ink font-medium">{result.recommendation}</p>
            </Card>
          </div>

          {/* Branch-level comparison chart */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-4">
              Baseline vs Stressed Default Rate by Branch
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 60]} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(1)}%`]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullName ?? ""
                  }
                />
                <Legend />
                <Bar dataKey="Baseline" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Stressed" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Branch impact table */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-4">Branch Impact Detail</h3>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-ink-faint border-b border-line">
                    <th className="text-left py-2 pr-4">Branch</th>
                    <th className="text-right py-2 pr-4">Type</th>
                    <th className="text-right py-2 pr-4">Baseline</th>
                    <th className="text-right py-2 pr-4">Stressed</th>
                    <th className="text-right py-2 pr-4">Delta</th>
                    <th className="text-right py-2">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {result.branches.map((b: StressTestBranchResult) => (
                    <tr
                      key={b.branch}
                      className={`border-b border-gray-50 hover:bg-canvas transition-colors ${
                        result.most_at_risk.includes(b.branch) ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium text-ink">
                        {b.branch}
                        {result.most_at_risk.includes(b.branch) && (
                          <span className="ml-1.5 text-xs text-red-600 font-bold">HIGH RISK</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-soft capitalize">
                        {b.branch_type.replace("_", " ")}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-ink-soft">
                        {(b.baseline * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-ink font-semibold">
                        {(b.stressed * 100).toFixed(1)}%
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono ${deltaColor(b.delta)}`}>
                        +{(b.delta * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-right">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${riskColor(b.risk_level)}`}
                        >
                          {b.risk_level.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-ink-faint">
          <Zap size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Select a scenario and severity, then run the stress test.</p>
        </div>
      )}
    </div>
  );
}
