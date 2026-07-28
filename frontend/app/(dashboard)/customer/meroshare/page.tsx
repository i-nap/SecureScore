"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getDemat,
  linkDemat,
  listIPOs,
  applyIPO,
  myIPOApplications,
  myPortfolio,
  getAccounts,
  type DematStatus,
  type IPOIssue,
  type IPOApplication,
  type Holding,
  type BankAccount,
} from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { TrendingUp, Link2, CheckCircle2, Briefcase } from "lucide-react";

export default function MeroSharePage() {
  const [demat, setDemat] = useState<DematStatus | null>(null);
  const [issues, setIssues] = useState<IPOIssue[]>([]);
  const [apps, setApps] = useState<IPOApplication[]>([]);
  const [holdings, setHoldings] = useState<{ holdings: Holding[]; total_value: number }>({ holdings: [], total_value: 0 });
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [account, setAccount] = useState("");
  const [units, setUnits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([getDemat(), listIPOs(), myIPOApplications(), myPortfolio(), getAccounts()])
      .then(([d, i, a, p, acc]) => {
        setDemat(d); setIssues(i.issues); setApps(a.applications); setHoldings(p);
        setAccounts(acc.accounts);
        if (acc.accounts.length && !account) setAccount(acc.accounts[0].account_number);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [account]);
  useEffect(() => { load(); }, [load]);

  const link = async () => {
    setBusy("demat"); setError("");
    try { await linkDemat(); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const apply = async (issue: IPOIssue) => {
    setBusy(issue.id); setError("");
    try {
      await applyIPO(issue.id, account, parseInt(units[issue.id] || String(issue.min_units), 10));
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  if (loading) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      {error && <div className="text-danger text-sm p-3 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><Link2 size={16} /> MeroShare / Demat</h2>
        {demat?.linked ? (
          <div className="text-sm space-y-1">
            <p className="flex items-center gap-2 text-emerald-600"><CheckCircle2 size={16} /> Demat linked</p>
            <p className="text-ink-soft">BOID: <span className="font-mono text-ink">{demat.boid}</span></p>
            <p className="text-ink-soft">DP ID: <span className="font-mono text-ink">{demat.dp_id}</span></p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-ink-soft">No demat account linked. Link one to apply for IPOs.</p>
            <Button onClick={link} loading={busy === "demat"}>Link demat</Button>
          </div>
        )}
      </Card>

      {demat?.linked && (
        <Card>
          <label className="text-xs text-ink-soft">Funding account</label>
          {accounts.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">No account found. Open an account first to apply for IPOs.</p>
          ) : (
            <select className="mt-1 w-full md:w-1/2 rounded-lg border border-line px-3 py-2 text-sm" value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.account_number} value={a.account_number}>
                  {a.account_number} · {a.account_type} · NPR {a.balance.toLocaleString()}
                </option>
              ))}
            </select>
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><TrendingUp size={16} /> Open IPOs</h2>
        {issues.length === 0 ? <EmptyState message="No open issues right now." /> : (
          <div className="space-y-3">
            {issues.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border border-line rounded-lg p-3">
                <div>
                  <p className="font-semibold text-ink">{i.symbol} <span className="text-ink-soft font-normal">— {i.company}</span></p>
                  <p className="text-xs text-ink-soft">NPR {i.price}/unit · {i.min_units}–{i.max_units} units · closes {i.close_date}</p>
                </div>
                {i.already_applied ? <Badge variant="success">Applied</Badge> : (
                  <div className="flex items-center gap-2">
                    <input type="number" className="w-24 rounded-lg border border-line px-2 py-1.5 text-sm" placeholder={`${i.min_units} u`}
                      value={units[i.id] ?? ""} onChange={(e) => setUnits({ ...units, [i.id]: e.target.value })} />
                    <Button size="sm" loading={busy === i.id} disabled={!demat?.linked || !account} onClick={() => apply(i)}>Apply</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {holdings.holdings.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            <Briefcase size={16} /> Portfolio <span className="text-ink-soft font-normal">· NPR {holdings.total_value.toLocaleString()}</span>
          </h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft border-b border-line"><th className="py-2 pr-4">Symbol</th><th className="py-2 pr-4">Units</th><th className="py-2 pr-4">Avg price</th><th className="py-2 text-right">Value</th></tr></thead>
            <tbody>
              {holdings.holdings.map((h) => (
                <tr key={h.symbol} className="border-b border-line/50">
                  <td className="py-2 pr-4 font-medium">{h.symbol}</td>
                  <td className="py-2 pr-4">{h.units}</td>
                  <td className="py-2 pr-4">NPR {h.avg_price}</td>
                  <td className="py-2 text-right">NPR {h.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3">My applications</h2>
        {apps.length === 0 ? <EmptyState message="No IPO applications yet." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft border-b border-line"><th className="py-2 pr-4">Symbol</th><th className="py-2 pr-4">Units</th><th className="py-2 pr-4">Blocked</th><th className="py-2">Status</th></tr></thead>
            <tbody>
              {apps.map((a, idx) => (
                <tr key={idx} className="border-b border-line/50">
                  <td className="py-2 pr-4 font-medium">{a.symbol}</td>
                  <td className="py-2 pr-4">{a.units}</td>
                  <td className="py-2 pr-4">NPR {a.amount.toLocaleString()}</td>
                  <td className="py-2"><Badge variant={a.status === "ALLOTTED" ? "success" : a.status === "REFUNDED" ? "danger" : "info"}>{a.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
