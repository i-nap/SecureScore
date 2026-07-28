"use client";

import { useState } from "react";
import {
  tellerDeposit,
  tellerWithdraw,
  tellerChequeDeposit,
  tellerEnquiry,
  type TellerTxnResult,
  type AccountEnquiry,
} from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { ArrowDownCircle, ArrowUpCircle, FileCheck, Search } from "lucide-react";

type Tab = "deposit" | "withdraw" | "cheque" | "enquiry";

export default function TellerPage() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [acct, setAcct] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [drawer, setDrawer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TellerTxnResult | null>(null);
  const [enquiry, setEnquiry] = useState<AccountEnquiry | null>(null);
  const [error, setError] = useState("");

  const reset = () => { setResult(null); setEnquiry(null); setError(""); };

  const run = async () => {
    setBusy(true);
    reset();
    try {
      const amt = parseFloat(amount);
      if (tab === "deposit") setResult(await tellerDeposit(acct, amt, remarks));
      else if (tab === "withdraw") setResult(await tellerWithdraw(acct, amt, remarks));
      else if (tab === "cheque") setResult(await tellerChequeDeposit({ account_number: acct, amount: amt, cheque_number: chequeNo, drawer_bank: drawer }));
      else if (tab === "enquiry") setEnquiry(await tellerEnquiry(acct));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "deposit", label: "Cash Deposit", icon: <ArrowDownCircle size={16} /> },
    { id: "withdraw", label: "Cash Withdrawal", icon: <ArrowUpCircle size={16} /> },
    { id: "cheque", label: "Cheque Deposit", icon: <FileCheck size={16} /> },
    { id: "enquiry", label: "Account Enquiry", icon: <Search size={16} /> },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); reset(); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${tab === t.id ? "bg-teal text-white border-teal" : "border-line text-ink-soft hover:bg-canvas"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="space-y-3">
          <input className="w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Account number" value={acct} onChange={(e) => setAcct(e.target.value)} />
          {tab !== "enquiry" && (
            <input className="w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Amount (NPR)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
          {tab === "cheque" && (
            <div className="grid grid-cols-2 gap-3">
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Cheque number" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Drawer bank" value={drawer} onChange={(e) => setDrawer(e.target.value)} />
            </div>
          )}
          {(tab === "deposit" || tab === "withdraw") && (
            <input className="w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          )}
          <Button onClick={run} loading={busy} disabled={!acct || (tab !== "enquiry" && !amount)}>
            {tabs.find((t) => t.id === tab)?.label}
          </Button>
        </div>
      </Card>

      {error && <div className="text-danger text-sm p-3 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

      {busy && <div className="flex justify-center p-4"><Spinner /></div>}

      {result && (
        <Card>
          <div className="flex items-center gap-2 mb-2"><Badge variant="success">{result.status}</Badge><span className="text-sm font-medium">{result.message}</span></div>
          <div className="text-sm text-ink-soft space-y-1">
            <p>Reference: <span className="font-mono">{result.reference_number}</span></p>
            <p>Amount: NPR {result.amount.toLocaleString()}</p>
            <p>Balance after: NPR {result.balance_after.toLocaleString()}</p>
          </div>
        </Card>
      )}

      {enquiry && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-2">{enquiry.holder}</h3>
          <div className="text-sm text-ink-soft space-y-1 mb-3">
            <p>Account: <span className="font-mono">{enquiry.account_number}</span> ({enquiry.account_type})</p>
            <p>Balance: <span className="font-semibold text-ink">NPR {enquiry.balance.toLocaleString()}</span></p>
            <p>Branch: {enquiry.branch_id || "—"}</p>
          </div>
          <h4 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Mini statement</h4>
          {enquiry.mini_statement.length === 0 ? <p className="text-xs text-ink-soft">No recent transactions.</p> : (
            <table className="w-full text-xs">
              <tbody>
                {enquiry.mini_statement.map((t) => (
                  <tr key={t.reference_number} className="border-b border-line/50">
                    <td className="py-1.5">{t.type}</td>
                    <td className="py-1.5 text-right">NPR {t.amount.toLocaleString()}</td>
                    <td className="py-1.5 text-right text-ink-soft">{t.balance_after.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
