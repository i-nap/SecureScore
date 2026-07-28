"use client";

import { useEffect, useState } from "react";
import {
  hqGLTrialBalance, hqGLBalanceSheet, hqGLJournal,
  type GLTrialBalance, type GLBalanceSheet, type GLJournalEntry,
} from "@/lib/api";
import { Card, Badge, Spinner } from "@/components/ui";
import { BookOpenCheck, Scale, CheckCircle2, AlertTriangle, ArrowRightLeft } from "lucide-react";

const npr = (n: number) => {
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return n.toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const typeColor: Record<string, string> = {
  ASSET: "text-teal", LIABILITY: "text-gold", EQUITY: "text-ink", INCOME: "text-teal-deep", EXPENSE: "text-danger",
};

export default function GLPage() {
  const [tb, setTb] = useState<GLTrialBalance | null>(null);
  const [bs, setBs] = useState<GLBalanceSheet | null>(null);
  const [journal, setJournal] = useState<GLJournalEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([hqGLTrialBalance(), hqGLBalanceSheet(), hqGLJournal()])
      .then(([t, b, j]) => { setTb(t); setBs(b); setJournal(j.entries); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!tb || !bs) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <BookOpenCheck size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Double-entry accounting</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">General Ledger</h1>
        <p className="mt-1 text-white/55 text-sm">Every movement booked as balanced debits and credits — reconciled from the transaction ledger.</p>
      </div>

      {/* Integrity banner */}
      <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${tb.balanced ? "bg-teal-soft border-teal/20" : "bg-red-50 border-red-200"}`}>
        {tb.balanced ? <CheckCircle2 size={22} className="text-teal" /> : <AlertTriangle size={22} className="text-danger" />}
        <div className="flex-1">
          <p className={`font-semibold ${tb.balanced ? "text-teal-deep" : "text-danger"}`}>
            {tb.balanced ? "Books balanced — debits equal credits" : "Out of balance — investigate"}
          </p>
          <p className="text-xs text-ink-soft nums">Σ Debits NPR {npr(tb.total_debit)} &nbsp;=&nbsp; Σ Credits NPR {npr(tb.total_credit)}</p>
        </div>
        <Badge variant={tb.balanced ? "success" : "danger"}>{tb.balanced ? "RECONCILED" : "ERROR"}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Trial balance */}
        <Card>
          <h2 className="font-display text-lg font-semibold text-ink mb-3">Trial Balance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm nums">
              <thead>
                <tr className="text-ink-faint text-xs uppercase tracking-wide text-left border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Account</th>
                  <th className="py-2 pr-3 font-semibold text-right">Debit</th>
                  <th className="py-2 font-semibold text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {tb.accounts.map((a) => (
                  <tr key={a.code} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-ink-faint mr-2">{a.code}</span>
                      <span className="text-ink">{a.name}</span>
                      <span className={`ml-2 text-[10px] font-semibold ${typeColor[a.type] ?? "text-ink-faint"}`}>{a.type}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-ink">{a.debit ? npr(a.debit) : "—"}</td>
                    <td className="py-2 text-right text-ink">{a.credit ? npr(a.credit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink/20 font-bold text-ink">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right">{npr(tb.total_debit)}</td>
                  <td className="py-2 text-right">{npr(tb.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {/* Balance sheet */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Scale size={18} className="text-teal" />
            <h2 className="font-display text-lg font-semibold text-ink">Balance Sheet</h2>
          </div>
          <div className="space-y-2">
            <BSRow label="Assets" value={bs.assets} bold />
            <p className="text-[11px] text-ink-faint pl-1">Cash & vault, loans receivable</p>
            <div className="h-px bg-line my-2" />
            <BSRow label="Liabilities" value={bs.liabilities} bold />
            <p className="text-[11px] text-ink-faint pl-1">Customer deposits, fixed deposits</p>
            <BSRow label="Equity (incl. net profit)" value={bs.equity} bold />
            <BSRow label="  · Income" value={bs.income} muted />
            <BSRow label="  · Expense" value={-bs.expense} muted />
            <BSRow label="  · Net profit" value={bs.net_profit} muted />
          </div>

          <div className={`mt-4 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${bs.balanced ? "bg-teal-soft text-teal-deep" : "bg-red-50 text-danger"}`}>
            {bs.balanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="nums">
              Assets {npr(bs.assets)} = Liabilities {npr(bs.liabilities)} + Equity {npr(bs.equity)}
            </span>
          </div>
        </Card>
      </div>

      {/* Journal */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <ArrowRightLeft size={18} className="text-teal" />
          <h2 className="font-display text-lg font-semibold text-ink">Journal — recent postings</h2>
        </div>
        {journal.length === 0 ? (
          <p className="text-sm text-ink-faint">No postings yet. They appear as transactions occur.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm nums">
              <thead>
                <tr className="text-ink-faint text-xs uppercase tracking-wide text-left border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Ref</th>
                  <th className="py-2 pr-3 font-semibold">Account</th>
                  <th className="py-2 pr-3 font-semibold">Memo</th>
                  <th className="py-2 pr-3 font-semibold text-right">Debit</th>
                  <th className="py-2 font-semibold text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((e, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-ink-faint">{e.txn_ref === "OPENING" ? "OPENING" : e.txn_ref.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3 text-ink"><span className="font-mono text-xs text-ink-faint mr-1">{e.account_code}</span>{e.account_name}</td>
                    <td className="py-1.5 pr-3 text-ink-soft text-xs">{e.memo}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{e.debit ? npr(e.debit) : ""}</td>
                    <td className="py-1.5 text-right text-ink">{e.credit ? npr(e.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function BSRow({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold text-ink" : muted ? "text-ink-soft text-sm" : "text-ink"}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="nums">NPR {npr(value)}</span>
    </div>
  );
}
