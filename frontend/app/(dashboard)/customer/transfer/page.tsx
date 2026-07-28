"use client";

import { useEffect, useState } from "react";
import {
  getAccounts, fundTransfer, listBeneficiaries, addBeneficiary,
  type BankAccount, type Beneficiary,
} from "@/lib/api";
import { Card, Button, Spinner } from "@/components/ui";
import { Send, CheckCircle, AlertCircle, Users, BookmarkPlus } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

interface TransferResult {
  status: string;
  reference_number: string;
  amount: number;
  fee: number;
  from_balance_after: number;
  message: string;
}

export default function TransferPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [fromAcc, setFromAcc] = useState("");
  const [toAcc, setToAcc] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState("");

  const loadBeneficiaries = () => listBeneficiaries().then(r => setBeneficiaries(r.beneficiaries)).catch(() => {});

  useEffect(() => {
    getAccounts()
      .then(r => { setAccounts(r.accounts); if (r.accounts.length) setFromAcc(r.accounts[0].account_number); })
      .finally(() => setLoading(false));
    loadBeneficiaries();
  }, []);

  const selectedAccount = accounts.find(a => a.account_number === fromAcc);
  const isSaved = beneficiaries.some(b => b.account_number === toAcc.trim());

  async function savePayee() {
    const acc = toAcc.trim();
    if (!acc) return;
    const nickname = window.prompt("Save this account as a payee. Nickname:", "");
    if (!nickname) return;
    try {
      await addBeneficiary({ nickname, account_number: acc });
      await loadBeneficiaries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save payee");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setResult(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (!toAcc.trim()) { setError("Enter a destination account number"); return; }
    setSubmitting(true);
    try {
      const res = await fundTransfer({ from_account_number: fromAcc, to_account_number: toAcc.trim(), amount: amt, description: desc });
      setResult(res);
      // Refresh balance
      const updated = await getAccounts();
      setAccounts(updated.accounts);
      setAmount(""); setToAcc(""); setDesc("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Fund Transfer</h1>
        <p className="text-sm text-ink-soft mt-0.5">Transfer money between accounts instantly</p>
      </div>

      {result && (
        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle size={20} className="text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-emerald-800">{result.message}</p>
            <p className="text-xs text-emerald-600 mt-0.5">Ref: {result.reference_number} · Fee: {fmt(result.fee)}</p>
            <p className="text-xs text-emerald-600">Balance after: {fmt(result.from_balance_after)}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">From Account</label>
            <select
              value={fromAcc}
              onChange={e => setFromAcc(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.account_number}>
                  {a.account_number} — {a.account_type.toUpperCase()} ({fmt(a.balance)})
                </option>
              ))}
            </select>
            {selectedAccount && (
              <p className="text-xs text-ink-faint mt-1">Available: {fmt(selectedAccount.balance)}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-ink">To Account Number</label>
              {toAcc.trim() && !isSaved && (
                <button type="button" onClick={savePayee}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal hover:opacity-70">
                  <BookmarkPlus size={13} /> Save payee
                </button>
              )}
            </div>

            {/* Saved-payee quick pick */}
            {beneficiaries.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint"><Users size={11} />Payees:</span>
                {beneficiaries.map(b => (
                  <button key={b.id} type="button" onClick={() => setToAcc(b.account_number)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      toAcc.trim() === b.account_number ? "bg-teal text-white border-teal" : "border-line text-ink-soft hover:bg-canvas"}`}>
                    {b.nickname}
                  </button>
                ))}
              </div>
            )}

            <input
              value={toAcc}
              onChange={e => setToAcc(e.target.value)}
              placeholder="e.g. NB12345678901234"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Amount (NPR)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
            {amount && parseFloat(amount) > 10000 && (
              <p className="text-xs text-amber-600 mt-1">0.1% service fee applies on amounts above NPR 10,000</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Payment for..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Spinner size="sm" /> : <><Send size={15} className="mr-2" />Transfer Now</>}
          </Button>
        </form>
      </Card>

      <Card>
        <h3 className="font-semibold text-ink mb-3 text-sm">Transfer Limits & Fees</h3>
        <ul className="space-y-1.5 text-xs text-ink-soft">
          <li>• Daily limit: NPR 5,00,000 per account</li>
          <li>• Transfers within bank: instant</li>
          <li>• Fee: 0.1% on amounts above NPR 10,000</li>
          <li>• Minimum balance NPR 1,000 must be maintained</li>
        </ul>
      </Card>
    </div>
  );
}
