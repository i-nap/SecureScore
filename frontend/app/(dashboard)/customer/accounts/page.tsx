"use client";

import { useEffect, useState } from "react";
import { getAccounts, getTransactions, type BankAccount, type BankTransaction } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

function AccountCard({ acc, onSelect, selected }: { acc: BankAccount; onSelect: () => void; selected: boolean }) {
  const typeColor: Record<string, string> = {
    savings: "bg-teal-soft border-violet-200",
    current: "bg-teal-soft border-blue-200",
    salary:  "bg-emerald-50 border-emerald-200",
  };
  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border p-5 cursor-pointer transition-all ${selected ? "ring-2 ring-violet-500" : "hover:shadow-md"} ${typeColor[acc.account_type] ?? "bg-canvas border-line"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet size={18} className="text-ink-soft" />
          <span className="font-mono text-xs text-ink-soft">{acc.account_number}</span>
        </div>
        <Badge variant={acc.account_type === "savings" ? "success" : "default"}>
          {acc.account_type.toUpperCase()}
        </Badge>
      </div>
      <p className="text-2xl font-black text-ink">{fmt(acc.balance)}</p>
      <p className="text-xs text-ink-faint mt-1">Interest: {acc.interest_rate}% p.a.</p>
    </div>
  );
}

function TxRow({ tx }: { tx: BankTransaction }) {
  const isDebit = tx.direction === "debit";
  return (
    <div className="flex items-center justify-between py-3 border-b border-line last:border-0">
      <div className="flex items-center gap-3">
        <div className={`p-1.5 rounded-full ${isDebit ? "bg-red-50" : "bg-emerald-50"}`}>
          {isDebit
            ? <ArrowUpRight size={14} className="text-red-500" />
            : <ArrowDownLeft size={14} className="text-emerald-500" />}
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{tx.description || tx.type}</p>
          <p className="text-xs text-ink-faint">{tx.other_party ?? "—"} · {tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-NP") : "—"}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
          {isDebit ? "-" : "+"}{fmt(tx.amount)}
        </p>
        <p className="text-[11px] text-ink-faint">{tx.reference_number}</p>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selected, setSelected] = useState<BankAccount | null>(null);
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotal, setTxTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAccounts()
      .then(r => {
        setAccounts(r.accounts);
        if (r.accounts.length) setSelected(r.accounts[0]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setTxLoading(true);
    getTransactions(selected.account_number, txPage, 15)
      .then(r => { setTxs(r.transactions); setTxTotal(r.total); })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [selected, txPage]);

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <div className="text-red-600 text-center py-10">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">My Accounts</h1>
        <p className="text-sm text-ink-soft mt-0.5">All your accounts and transaction history</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Balance" value={fmt(totalBalance)} color="violet" />
        <StatCard label="Accounts" value={String(accounts.length)} />
        <StatCard label="Currency" value="NPR" />
      </div>

      {accounts.length === 0 ? (
        <Card><p className="text-center text-ink-faint py-10">No accounts found.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(a => (
              <AccountCard key={a.id} acc={a} selected={selected?.id === a.id} onSelect={() => { setSelected(a); setTxPage(1); }} />
            ))}
          </div>

          {selected && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-bold text-ink">Transactions</h2>
                  <p className="text-xs text-ink-faint">{selected.account_number}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setTxPage(1)}>
                  <RefreshCw size={13} className="mr-1" />Refresh
                </Button>
              </div>
              {txLoading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : txs.length === 0 ? (
                <p className="text-center text-ink-faint py-8">No transactions yet.</p>
              ) : (
                <>
                  {txs.map(t => <TxRow key={t.id} tx={t} />)}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-line">
                    <p className="text-xs text-ink-faint">{txTotal} total transactions</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setTxPage(p => Math.max(1, p - 1))} disabled={txPage === 1}>Prev</Button>
                      <Button variant="outline" size="sm" onClick={() => setTxPage(p => p + 1)} disabled={txs.length < 15}>Next</Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
