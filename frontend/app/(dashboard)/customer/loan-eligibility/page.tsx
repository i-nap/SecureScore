"use client";
import { useEffect, useState } from "react";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { customerLoanEligibility, type LoanEligibilityResult, type LoanProduct } from "@/lib/api";
import { CreditCard, CheckCircle2, XCircle, TrendingUp, Calendar } from "lucide-react";

const LOAN_ICONS: Record<string, string> = { "Home Loan": "🏠", "Business Loan": "🏢", "Education Loan": "🎓", "Vehicle Loan": "🚗", "Personal Loan": "💳", "Agriculture Loan": "🌾" };

function ProductCard({ p }: { p: LoanProduct }) {
  return (
    <div className={`rounded-xl border-2 p-4 transition-all ${p.eligible ? "border-emerald-200 bg-emerald-50" : "border-line bg-canvas opacity-70"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{LOAN_ICONS[p.name] ?? "💰"}</span>
          <div>
            <p className="font-bold text-ink text-sm">{p.name}</p>
            <p className="text-xs text-ink-faint">Min score: {(p.min_score * 100).toFixed(0)}%</p>
          </div>
        </div>
        {p.eligible ? <Badge variant="success">Eligible</Badge> : <Badge variant="default">Not Eligible</Badge>}
      </div>
      {p.eligible ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center bg-white rounded-lg p-2">
            <p className="text-xs text-ink-faint">Max</p>
            <p className="text-xs font-bold text-ink">NPR {(p.max_amount / 1000000).toFixed(1)}M</p>
          </div>
          <div className="text-center bg-white rounded-lg p-2">
            <p className="text-xs text-ink-faint">Rate</p>
            <p className="text-xs font-bold text-ink">{p.min_rate.toFixed(1)}%</p>
          </div>
          <div className="text-center bg-white rounded-lg p-2">
            <p className="text-xs text-ink-faint">Tenure</p>
            <p className="text-xs font-bold text-ink">{p.max_tenure_months / 12}yr</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-red-600 flex items-center gap-1"><XCircle size={11} />{p.reason}</p>
      )}
    </div>
  );
}

export default function LoanEligibilityPage() {
  const [data, setData] = useState<LoanEligibilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(1000000);
  const [error, setError] = useState("");

  const load = (amt: number) => {
    setLoading(true);
    customerLoanEligibility(amt).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(amount); }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><CreditCard size={22} className="text-teal" />Loan Eligibility Checker</h1>
        <p className="text-sm text-ink-soft mt-1">See which loan products you qualify for based on your AI credit profile.</p>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3">Loan Amount to Check</h2>
        <div className="flex items-center gap-4">
          <input type="range" min={100000} max={10000000} step={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="flex-1" />
          <div className="text-right shrink-0">
            <p className="text-lg font-black text-ink">NPR {amount.toLocaleString()}</p>
            <button onClick={() => load(amount)} className="text-xs text-teal hover:text-teal-deep font-medium mt-0.5">Check →</button>
          </div>
        </div>
        <div className="flex justify-between text-xs text-ink-faint mt-1"><span>NPR 100k</span><span>NPR 10M</span></div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : error || !data ? (
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error || "No data"}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Credit Score" value={`${data.credit_score_pct.toFixed(1)}%`} icon={<TrendingUp size={18} />} color={data.credit_score_pct >= 65 ? "green" : data.credit_score_pct >= 50 ? "amber" : "red"} />
            <StatCard label="Products Eligible" value={`${data.eligible_count} / ${data.products.length}`} icon={<CheckCircle2 size={18} />} color={data.eligible_count >= 3 ? "green" : "amber"} />
            <StatCard label="Requested Amount" value={`NPR ${(data.requested_amount / 1000000).toFixed(1)}M`} icon={<Calendar size={18} />} color="blue" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.products.map((p) => <ProductCard key={p.name} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
