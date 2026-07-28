"use client";

import { useEffect, useState } from "react";
import { getAccounts, getFDs, createFD, breakFD, type BankAccount, type FixedDeposit } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { PiggyBank, Plus, Trash2, CheckCircle, AlertCircle } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

const FD_RATES: Record<number, number> = { 3: 6.5, 6: 7.0, 12: 8.0, 24: 8.5, 36: 9.0, 60: 9.5 };
const TENURES = [3, 6, 12, 24, 36, 60];

function FDCard({ fd, onBreak }: { fd: FixedDeposit; onBreak: () => void }) {
  const statusColor: Record<string, string> = { ACTIVE: "success", MATURED: "default", BROKEN: "danger" };
  const daysLeft = fd.maturity_date
    ? Math.max(0, Math.ceil((new Date(fd.maturity_date).getTime() - Date.now()) / 86400000))
    : 0;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PiggyBank size={18} className="text-amber-600" />
          <span className="font-mono text-xs text-ink-soft">{fd.fd_number}</span>
        </div>
        <Badge variant={statusColor[fd.status] as "success" | "default" | "danger"}>{fd.status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-ink-faint">Principal</p><p className="font-bold text-ink">{fmt(fd.principal)}</p></div>
        <div><p className="text-xs text-ink-faint">Maturity</p><p className="font-bold text-amber-700">{fmt(fd.maturity_amount)}</p></div>
        <div><p className="text-xs text-ink-faint">Rate</p><p className="font-semibold">{fd.interest_rate}% p.a.</p></div>
        <div><p className="text-xs text-ink-faint">Tenure</p><p className="font-semibold">{fd.tenure_months} months</p></div>
      </div>
      {fd.maturity_date && (
        <p className="text-xs text-ink-soft">
          Matures: {new Date(fd.maturity_date).toLocaleDateString("en-NP")}
          {fd.status === "ACTIVE" && <span className="ml-2 text-amber-600">({daysLeft} days left)</span>}
        </p>
      )}
      {fd.status === "ACTIVE" && (
        <Button variant="outline" size="sm" onClick={onBreak} className="w-full text-red-600 border-red-200 hover:bg-red-50">
          <Trash2 size={13} className="mr-1" />Break FD (1% penalty)
        </Button>
      )}
    </div>
  );
}

export default function FDPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [fds, setFDs] = useState<FixedDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [fdAcc, setFdAcc] = useState("");
  const [principal, setPrincipal] = useState("");
  const [tenure, setTenure] = useState(12);
  const [autoRenew, setAutoRenew] = useState(false);

  const load = () =>
    Promise.all([getAccounts(), getFDs()])
      .then(([a, f]) => { setAccounts(a.accounts); setFDs(f.fixed_deposits); if (a.accounts.length) setFdAcc(a.accounts[0].account_number); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const selectedAcc = accounts.find(a => a.account_number === fdAcc);
  const previewInterest = principal ? parseFloat(principal) * (FD_RATES[tenure] / 100) * (tenure / 12) : 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSubmitting(true);
    try {
      const r = await createFD({ account_number: fdAcc, principal: parseFloat(principal), tenure_months: tenure, auto_renew: autoRenew });
      setMsg({ ok: true, text: `FD ${r.fd_number} opened. Maturity: ${fmt(r.maturity_amount)} on ${new Date(r.maturity_date).toLocaleDateString("en-NP")}` });
      setPrincipal(""); setShowForm(false);
      load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to create FD" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBreak(fdNumber: string) {
    if (!confirm("Break this FD? A 1% penalty will be deducted.")) return;
    try {
      const r = await breakFD(fdNumber);
      setMsg({ ok: true, text: r.message });
      load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    }
  }

  const activeFDs = fds.filter(f => f.status === "ACTIVE");
  const totalDeposited = activeFDs.reduce((s, f) => s + f.principal, 0);
  const totalMaturity  = activeFDs.reduce((s, f) => s + f.maturity_amount, 0);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">Fixed Deposits</h1>
          <p className="text-sm text-ink-soft mt-0.5">Earn higher interest with fixed term deposits</p>
        </div>
        <Button onClick={() => setShowForm(s => !s)}>
          <Plus size={15} className="mr-1" />{showForm ? "Cancel" : "Open FD"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Active FDs" value={String(activeFDs.length)} />
        <StatCard label="Total Deposited" value={fmt(totalDeposited)} color="amber" />
        <StatCard label="Total at Maturity" value={fmt(totalMaturity)} color="green" />
      </div>

      {msg && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${msg.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          {msg.ok ? <CheckCircle size={18} className="text-emerald-600 shrink-0" /> : <AlertCircle size={18} className="text-red-500 shrink-0" />}
          <p className={`text-sm ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>
        </div>
      )}

      {showForm && (
        <Card>
          <h2 className="font-bold text-ink mb-4">Open New Fixed Deposit</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Debit Account</label>
              <select value={fdAcc} onChange={e => setFdAcc(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                {accounts.map(a => (
                  <option key={a.id} value={a.account_number}>{a.account_number} ({fmt(a.balance)})</option>
                ))}
              </select>
              {selectedAcc && <p className="text-xs text-ink-faint mt-1">Available: {fmt(selectedAcc.balance)}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Principal (NPR)</label>
                <input type="number" min="1000" step="100" value={principal} onChange={e => setPrincipal(e.target.value)}
                  placeholder="Min. 1,000"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Tenure</label>
                <select value={tenure} onChange={e => setTenure(Number(e.target.value))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  {TENURES.map(t => <option key={t} value={t}>{t} months — {FD_RATES[t]}%</option>)}
                </select>
              </div>
            </div>
            {principal && parseFloat(principal) >= 1000 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-amber-800">Projected Returns</p>
                <p className="text-amber-700 text-xs mt-1">
                  Interest earned: {fmt(previewInterest)} · Maturity amount: {fmt(parseFloat(principal) + previewInterest)}
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} className="rounded" />
              Auto-renew on maturity
            </label>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner size="sm" /> : "Open Fixed Deposit"}
            </Button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fds.length === 0
          ? <p className="text-ink-faint col-span-3 text-center py-10">No fixed deposits yet.</p>
          : fds.map(f => <FDCard key={f.id} fd={f} onBreak={() => handleBreak(f.fd_number)} />)}
      </div>

      <Card>
        <h3 className="font-semibold text-ink mb-3 text-sm">FD Interest Rates</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {TENURES.map(t => (
            <div key={t} className="text-center p-3 bg-amber-50 rounded-lg border border-amber-100">
              <p className="text-lg font-black text-amber-700">{FD_RATES[t]}%</p>
              <p className="text-[11px] text-ink-soft">{t} months</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
