"use client";

import { useEffect, useRef, useState } from "react";
import {
  getAccounts,
  scanCheque,
  depositCheque,
  type BankAccount,
  type ChequeFields,
} from "@/lib/api";
import { Card, Button, Spinner, EmptyState } from "@/components/ui";
import { ScanLine, Upload, CheckCircle, AlertCircle, FileCheck } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 2,
  }).format(n);
}

export default function ChequeDepositPage() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [account, setAccount] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fields, setFields] = useState<ChequeFields | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [needsReview, setNeedsReview] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const [depositing, setDepositing] = useState(false);
  const [done, setDone] = useState<{ reference: string; amount: number; balance: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAccounts()
      .then(({ accounts: a }) => {
        setAccounts(a);
        if (a.length) setAccount(a[0].account_number);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function onPick(f: File | null) {
    setFile(f);
    setFields(null);
    setDone(null);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function onScan() {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const res = await scanCheque(file);
      setFields(res.fields);
      setConfidence(res.overall_confidence);
      setNeedsReview(res.needs_review);
      setReasons(res.review_reasons ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function onDeposit() {
    if (!fields || !account || !fields.amount) return;
    setDepositing(true);
    setError(null);
    try {
      const res = await depositCheque({
        account_number: account,
        amount: fields.amount,
        cheque_number: fields.cheque_number ?? undefined,
        payee: fields.payee ?? undefined,
        drawer_bank: fields.bank_name ?? undefined,
      });
      setDone({ reference: res.reference_number, amount: res.amount, balance: res.balance_after });
      setFields(null);
      setFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setDepositing(false);
    }
  }

  function setField<K extends keyof ChequeFields>(k: K, v: ChequeFields[K]) {
    setFields((f) => (f ? { ...f, [k]: v } : f));
  }

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error && !accounts) return <div className="text-red-400 p-6">{error}</div>;
  if (!accounts || accounts.length === 0) return <EmptyState message="No accounts available for deposit." />;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <ScanLine className="text-teal" size={22} />
        <h1 className="text-xl font-black text-ink">Cheque Deposit</h1>
      </div>
      <p className="text-sm text-ink-soft">
        Upload a photo of your cheque. It is read on your branch&apos;s device — the image never leaves the branch.
      </p>

      {done ? (
        <Card>
          <div className="text-center py-8">
            <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3" />
            <h2 className="text-lg font-black text-ink">Cheque Deposited</h2>
            <p className="text-sm text-ink-soft mt-1">Ref {done.reference}</p>
            <p className="text-2xl font-black text-emerald-600 mt-3">{fmt(done.amount)}</p>
            <p className="text-sm text-ink-soft mt-1">New balance: {fmt(done.balance)}</p>
            <Button className="mt-6" onClick={() => setDone(null)}>Deposit another</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <label className="block text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">Deposit into</label>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
            >
              {accounts.map((a) => (
                <option key={a.account_number} value={a.account_number}>
                  {a.account_type} · {a.account_number} · {fmt(a.balance)}
                </option>
              ))}
            </select>

            <div
              onClick={() => fileInput.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="cheque preview" className="max-h-56 mx-auto rounded-lg" />
              ) : (
                <div className="text-ink-faint py-6">
                  <Upload size={28} className="mx-auto mb-2" />
                  <p className="text-sm">Click to choose a cheque image</p>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
            </div>

            {file && !fields && (
              <Button className="mt-4 w-full" onClick={onScan} loading={scanning} disabled={scanning}>
                <ScanLine size={16} className="mr-1.5" />
                {scanning ? "Reading cheque…" : "Scan cheque"}
              </Button>
            )}
          </Card>

          {fields && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-ink flex items-center gap-1.5">
                  <FileCheck size={16} className="text-teal" /> Review extracted details
                </h3>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${needsReview ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {Math.round(confidence * 100)}% confidence
                </span>
              </div>
              {/* Amount words↔digits cross-verification — the trust signal. */}
              {fields.amount_match !== null && (
                <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-3 ${
                  fields.amount_match ? "bg-teal-soft text-teal-deep" : "bg-red-50 text-danger"}`}>
                  {fields.amount_match ? <FileCheck size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                  <span>
                    {fields.amount_match
                      ? <>Amount verified — words match digits ({fields.amount_in_words}).</>
                      : <>Mismatch: words say <b>{fields.amount_in_words_value?.toLocaleString("en-NP")}</b> but digits say <b>{fields.amount?.toLocaleString("en-NP")}</b>. Confirm before depositing.</>}
                  </span>
                </div>
              )}
              {reasons.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <ul className="list-disc list-inside space-y-0.5">
                    {reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Labeled label="Amount (NPR)">
                  <input
                    type="number"
                    value={fields.amount ?? ""}
                    onChange={(e) => setField("amount", e.target.value === "" ? null : Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold"
                  />
                </Labeled>
                <Labeled label="Cheque No. (MICR)">
                  <input value={fields.cheque_number ?? ""} onChange={(e) => setField("cheque_number", e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                </Labeled>
                {fields.routing_number && (
                  <Labeled label="Routing / branch code">
                    <input value={fields.routing_number ?? ""} onChange={(e) => setField("routing_number", e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                  </Labeled>
                )}
                <Labeled label="Payee">
                  <input value={fields.payee ?? ""} onChange={(e) => setField("payee", e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </Labeled>
                <Labeled label="Date">
                  <input value={fields.date ?? ""} onChange={(e) => setField("date", e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </Labeled>
                <Labeled label="Drawer bank">
                  <input value={fields.bank_name ?? ""} onChange={(e) => setField("bank_name", e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm col-span-2" />
                </Labeled>
              </div>
              <Button className="mt-4 w-full" onClick={onDeposit} loading={depositing} disabled={depositing || !fields.amount}>
                {depositing ? "Depositing…" : `Deposit ${fields.amount ? fmt(fields.amount) : ""}`}
              </Button>
            </Card>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">{label}</label>
      {children}
    </div>
  );
}
