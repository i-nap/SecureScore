"use client";
import { useEffect, useState } from "react";
import { Card, Badge, Spinner } from "@/components/ui";
import { branchPAR, type PARResult, type PARMetric } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ReferenceLine, Legend } from "recharts";
import { TrendingUp, Info } from "lucide-react";

function PARCard({ m }: { m: PARMetric }) {
  const color = m.status === "good" ? "green" : m.status === "warning" ? "amber" : "red";
  const bgColor = m.status === "good" ? "bg-emerald-50 border-emerald-200" : m.status === "warning" ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";
  return (
    <div className={`rounded-xl border-2 p-5 ${bgColor}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide">PAR{m.period}</p>
          <p className="text-2xl font-black mt-1" style={{ color: m.status === "critical" ? "#ef4444" : m.status === "warning" ? "#f59e0b" : "#10b981" }}>{m.portfolio_at_risk.toFixed(2)}%</p>
        </div>
        <div className="text-right">
          <Badge variant={color as "success" | "warning" | "danger"}>{m.status.toUpperCase()}</Badge>
          <p className="text-xs text-ink-faint mt-1">NRB: ≤{m.nrb_benchmark}%</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white/70 rounded-lg p-2 text-center">
          <p className="text-ink-faint">Amount at Risk</p>
          <p className="font-bold text-ink">NPR {(m.amount_at_risk/1000000).toFixed(1)}M</p>
        </div>
        <div className="bg-white/70 rounded-lg p-2 text-center">
          <p className="text-ink-faint">Loan Count</p>
          <p className="font-bold text-ink">{m.loan_count} loans</p>
        </div>
      </div>
    </div>
  );
}

export default function PARPage() {
  const [data, setData] = useState<PARResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { branchPAR().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (error || !data) return <div className="bg-red-50 text-red-600 rounded-xl p-4">{error || "No data"}</div>;

  const trendData = data.monthly_trend.map((t) => ({ month: t.Month, PAR30: t.PAR30, PAR60: t.PAR60, PAR90: t.PAR90 }));
  const typeData = data.by_loan_type.map((t) => ({ name: t.Type, par: t.PAR, amount: t.Amount }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><TrendingUp size={22} className="text-teal" />Portfolio at Risk (PAR)</h1>
        <p className="text-sm text-ink-soft mt-1">NRB-standard PAR metrics · Total portfolio NPR {(data.total_portfolio_npr/1000000).toFixed(1)}M · As of {data.as_of}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.par_metrics.map((m) => <PARCard key={m.period} m={m} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">6-Month PAR Trend</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(2)}%`, ""]} />
              <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="4 3" label={{ value: "NRB PAR30 limit", fontSize: 9, fill: "#ef4444" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="PAR30" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="PAR60" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="PAR90" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">PAR by Loan Type</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={typeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} unit="%" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={75} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(2)}%`, "PAR"]} />
              <ReferenceLine x={5} stroke="#ef4444" strokeDasharray="4 3" />
              <Bar dataKey="par" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            <strong>NRB Directive:</strong> PAR30 must stay below 5%, PAR90 below 2% per Nepal Rastra Bank prudential norms. Loans overdue by 30+ days are classified as Watchlist; 90+ days as Substandard. Regular monitoring and provisioning is mandatory.
          </p>
        </div>
      </Card>
    </div>
  );
}
