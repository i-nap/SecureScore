"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Spinner, Badge } from "@/components/ui";
import { customerCounterfactual, type CounterfactualResult, type CounterfactualScenario } from "@/lib/api";
import { Target, TrendingUp, Lightbulb, CheckCircle2, ArrowUpRight } from "lucide-react";

function FeasibilityBadge({ f }: { f: string }) {
  if (f === "easy") return <Badge variant="success">Easy</Badge>;
  if (f === "medium") return <Badge variant="warning">Moderate</Badge>;
  return <Badge variant="danger">Difficult</Badge>;
}

function ScenarioCard({ s, rank }: { s: CounterfactualScenario; rank: number }) {
  const colors = ["from-teal to-teal-deep", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600"];
  const color = colors[rank % colors.length];
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${color}`} />
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-ink-faint uppercase tracking-wide">Option {rank + 1}</p>
          <h3 className="text-base font-bold text-ink mt-0.5">{s.title}</h3>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-black text-emerald-600">+{s.delta}</p>
          <p className="text-xs text-ink-faint">score points</p>
        </div>
      </div>
      <p className="text-sm text-ink-soft mb-4">{s.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-xs text-ink-faint">New Score</p>
            <p className="text-lg font-black text-ink">{s.new_score}</p>
          </div>
          <ArrowUpRight size={18} className="text-emerald-500" />
        </div>
        <FeasibilityBadge f={s.feasibility} />
      </div>
    </Card>
  );
}

export default function CounterfactualPage() {
  const [data, setData] = useState<CounterfactualResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    customerCounterfactual()
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>;

  const gap = data.target_score - data.current_score;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Target size={22} className="text-teal" />
          Counterfactual Explanations
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          AI-generated pathways showing the minimal changes needed to improve your credit score.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Current Score" value={String(data.current_score)} icon={<TrendingUp size={18} />} color={data.current_score >= 650 ? "green" : data.current_score >= 550 ? "amber" : "red"} />
        <StatCard label="Target Score" value={String(data.target_score)} icon={<Target size={18} />} color="blue" />
        <StatCard label="Gap to Target" value={gap > 0 ? `+${gap} needed` : "Already met!"} icon={<CheckCircle2 size={18} />} color={gap <= 0 ? "green" : "amber"} />
      </div>

      {gap <= 0 && (
        <Card className="bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-800">Your score already meets the approval threshold!</p>
              <p className="text-sm text-emerald-600 mt-0.5">The scenarios below show further improvement paths.</p>
            </div>
          </div>
        </Card>
      )}

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb size={16} className="text-amber-500" />
          <h2 className="text-base font-semibold text-ink">Improvement Pathways</h2>
          <span className="text-xs text-ink-faint ml-1">Ranked by impact</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.scenarios.map((s, i) => (
            <ScenarioCard key={s.id} s={s} rank={i} />
          ))}
        </div>
      </div>

      <Card className="bg-teal-soft border-blue-200">
        <p className="text-xs font-semibold text-teal-deep uppercase tracking-wide mb-1">How counterfactuals work</p>
        <p className="text-sm text-blue-800">
          The AI model finds the <strong>smallest possible changes</strong> to your financial profile that would result in a higher credit score.
          These are not guarantees — they show what direction to focus your efforts.
          Each scenario assumes all other factors remain constant.
        </p>
      </Card>
    </div>
  );
}
