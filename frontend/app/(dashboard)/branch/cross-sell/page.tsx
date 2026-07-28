"use client";

import { useEffect, useState } from "react";
import { branchCrossSell, type CrossSellRec } from "@/lib/api";
import { Card, Badge, Spinner, EmptyState, StatCard } from "@/components/ui";
import { Sparkles, Target, TrendingUp } from "lucide-react";

const npr = (n: number) => {
  if (n >= 1e7) return `NPR ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `NPR ${(n / 1e5).toFixed(1)} L`;
  return "NPR " + n.toLocaleString("en-NP");
};

function propColor(p: number) {
  if (p >= 75) return "text-teal";
  if (p >= 55) return "text-gold";
  return "text-ink-soft";
}

export default function CrossSellPage() {
  const [recs, setRecs] = useState<CrossSellRec[] | null>(null);
  const [method, setMethod] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    branchCrossSell()
      .then((r) => { setRecs(r.recommendations); setMethod(r.method); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!recs) return null;

  const totalValue = recs.reduce((s, r) => s + r.est_value, 0);
  const hot = recs.filter((r) => r.propensity >= 75).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <Sparkles size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Next-best-product · Branch-local</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Cross-Sell Opportunities</h1>
        <p className="mt-1 text-white/55 text-sm">Ranked product recommendations from this branch&apos;s own holdings — no customer data leaves the branch.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Opportunities" value={recs.length} icon={<Target size={18} />} color="teal" />
        <StatCard label="High propensity" value={hot} sub="≥ 75% likely" icon={<TrendingUp size={18} />} color="gold" />
        <StatCard label="Indicative value" value={npr(totalValue)} icon={<Sparkles size={18} />} color="teal" />
      </div>

      <Card>
        {recs.length === 0 ? (
          <EmptyState message="No cross-sell opportunities — customers already hold the relevant products." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint text-xs uppercase tracking-wide text-left border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Customer</th>
                  <th className="py-2 pr-3 font-semibold">Recommended product</th>
                  <th className="py-2 pr-3 font-semibold">Why</th>
                  <th className="py-2 pr-3 font-semibold text-right">Propensity</th>
                  <th className="py-2 font-semibold text-right">Est. value</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.customer_id} className="border-b border-line/60">
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold text-ink">{r.name}</p>
                      <p className="text-xs text-ink-faint font-mono">{r.customer_id}</p>
                    </td>
                    <td className="py-2.5 pr-3"><Badge variant="info">{r.product}</Badge></td>
                    <td className="py-2.5 pr-3 text-ink-soft text-xs max-w-xs">{r.reason}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className={`font-semibold nums ${propColor(r.propensity)}`}>{r.propensity}%</span>
                    </td>
                    <td className="py-2.5 text-right nums text-ink">{r.est_value > 0 ? npr(r.est_value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-ink-faint border-t border-line pt-3">{method}</p>
      </Card>
    </div>
  );
}
