"use client";

import { useEffect, useState } from "react";
import { getAccounts, getStatement, type BankAccount, type StatementEntry } from "@/lib/api";
import { Card, StatCard, Spinner, Button } from "@/components/ui";
import { FileText, ArrowDownLeft, ArrowUpRight, Download } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

function TxRow({ tx }: { tx: StatementEntry; accId: string }) {
  const isDebit = tx.direction === "debit";
  return (
    <tr className="hover:bg-canvas">
      <td className="py-2.5 px-4 text-xs text-ink-soft">
        {tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-NP", { day: "2-digit", month: "short", year: "numeric" }) : "--"}
      </td>
      <td className="py-2.5 px-4">
        <p className="text-sm font-medium text-ink">{tx.description || tx.type}</p>
        <p className="text-xs text-ink-faint">{tx.reference_number}</p>
      </td>
      <td className="py-2.5 px-4 text-center">
        <div className="flex items-center justify-center gap-1">
          {isDebit
            ? <ArrowUpRight size={13} className="text-red-400" />
            : <ArrowDownLeft size={13} className="text-emerald-400" />}
          <span className="text-xs text-ink-soft capitalize">{tx.direction}</span>
        </div>
      </td>
      <td className={`py-2.5 px-4 text-right font-semibold text-sm ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
        {isDebit ? "-" : "+"}{fmt(tx.amount)}
      </td>
      <td className="py-2.5 px-4 text-right text-sm text-ink-soft">
        {tx.balance_after != null ? fmt(tx.balance_after) : "--"}
      </td>
    </tr>
  );
}

export default function StatementPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAcc, setSelectedAcc] = useState("");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [stmt, setStmt] = useState<Awaited<ReturnType<typeof getStatement>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [accsLoading, setAccsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getAccounts()
      .then(r => { setAccounts(r.accounts); if (r.accounts.length) setSelectedAcc(r.accounts[0].account_number); })
      .finally(() => setAccsLoading(false));
  }, []);

  const fetchStatement = async () => {
    if (!selectedAcc) return;
    setLoading(true); setError(""); setStmt(null);
    try {
      const data = await getStatement(selectedAcc, fromDate, toDate);
      setStmt(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  if (accsLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">Account Statement</h1>
          <p className="text-sm text-ink-soft mt-0.5">Detailed transaction history for any period</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1">Account</label>
            <select
              value={selectedAcc}
              onChange={e => setSelectedAcc(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.account_number}>
                  {a.account_number} ({a.account_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
          <div className="flex items-end">
            <Button onClick={fetchStatement} disabled={loading || !selectedAcc} className="w-full">
              {loading ? <Spinner size="sm" /> : <><FileText size={14} className="mr-1.5" />Generate</>}
            </Button>
          </div>
        </div>
      </Card>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {stmt && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Transactions" value={String(stmt.total_count)} />
            <StatCard label="Total Credit" value={fmt(stmt.total_credit)} color="emerald" />
            <StatCard label="Total Debit" value={fmt(stmt.total_debit)} color="red" />
            <StatCard label="Closing Balance" value={fmt(stmt.closing_balance)} color="violet" />
          </div>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-ink">Statement</h2>
                <p className="text-xs text-ink-faint">{stmt.account_number} &bull; {stmt.from} to {stmt.to}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Download size={13} className="mr-1" />Print / Export
              </Button>
            </div>
            {stmt.transactions.length === 0 ? (
              <p className="text-center text-ink-faint py-10">No transactions in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="pb-2 px-4 text-xs font-medium text-ink-faint uppercase">Date</th>
                      <th className="pb-2 px-4 text-xs font-medium text-ink-faint uppercase">Description</th>
                      <th className="pb-2 px-4 text-xs font-medium text-ink-faint uppercase text-center">Type</th>
                      <th className="pb-2 px-4 text-xs font-medium text-ink-faint uppercase text-right">Amount</th>
                      <th className="pb-2 px-4 text-xs font-medium text-ink-faint uppercase text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stmt.transactions.map(tx => <TxRow key={tx.id} tx={tx} accId={selectedAcc} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
