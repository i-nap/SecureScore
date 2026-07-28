"use client";

import { useEffect, useState } from "react";
import {
  getAccounts,
  listBeneficiaries, addBeneficiary, deleteBeneficiary,
  listStandingInstructions, createStandingInstruction, cancelStandingInstruction,
  type BankAccount, type Beneficiary, type StandingInstruction,
} from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { Users, Repeat, Plus, Trash2, CalendarClock, AlertTriangle, CheckCircle2 } from "lucide-react";

const npr = (n: number) =>
  "NPR " + n.toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayeesPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bens, setBens] = useState<Beneficiary[] | null>(null);
  const [sis, setSis] = useState<StandingInstruction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    Promise.all([getAccounts(), listBeneficiaries(), listStandingInstructions()])
      .then(([a, b, s]) => {
        setAccounts(a.accounts);
        setBens(b.beneficiaries);
        setSis(s.standing_instructions);
      })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  if (error && !bens) return <div className="text-danger p-6">{error}</div>;
  if (!bens || !sis) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <Repeat size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Saved payees · Recurring auto-pay</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Payees &amp; Auto-pay</h1>
        <p className="mt-1 text-white/55 text-sm">Save people you pay often, and schedule payments that run automatically at start-of-day.</p>
      </div>

      {notice && <div className="rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{notice}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Beneficiaries items={bens} onChange={load} setNotice={setNotice} setError={setError} />
        <Standing items={sis} accounts={accounts} onChange={load} setNotice={setNotice} setError={setError} />
      </div>
    </div>
  );
}

function Beneficiaries({ items, onChange, setNotice, setError }: {
  items: Beneficiary[]; onChange: () => void; setNotice: (s: string) => void; setError: (s: string) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [account, setAccount] = useState("");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!nickname.trim() || !account.trim()) { setError("Nickname and account number are required."); return; }
    setBusy(true); setError("");
    try {
      await addBeneficiary({ nickname, account_number: account, bank_name: bank });
      setNickname(""); setAccount(""); setBank("");
      setNotice(`${nickname} saved to payees.`);
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to add"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, name: string) => {
    try { await deleteBeneficiary(id); setNotice(`${name} removed.`); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to remove"); }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Users size={18} className="text-teal" />
        <h2 className="font-display text-lg font-semibold text-ink">Beneficiaries</h2>
        <Badge variant="info">{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <EmptyState message="No saved payees yet." />
      ) : (
        <ul className="space-y-2 mb-4">
          {items.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-ink">{b.nickname}</p>
                <p className="text-xs text-ink-faint font-mono">{b.account_number} · {b.bank_name}</p>
              </div>
              <button onClick={() => remove(b.id, b.nickname)} className="text-ink-faint hover:text-danger transition-colors p-1.5" title="Remove">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname (e.g. Aama)" className="pinput" />
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account number" className="pinput font-mono" />
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Bank (optional)" className="pinput sm:col-span-2" />
      </div>
      <div className="mt-3"><Button onClick={add} loading={busy} size="sm"><Plus size={14} />Add payee</Button></div>
      <PInputStyle />
    </Card>
  );
}

function Standing({ items, accounts, onChange, setNotice, setError }: {
  items: StandingInstruction[]; accounts: BankAccount[]; onChange: () => void; setNotice: (s: string) => void; setError: (s: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(0);
  const [freq, setFreq] = useState<"monthly" | "weekly">("monthly");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!from && accounts.length) setFrom(accounts[0].account_number); }, [accounts, from]);

  const create = async () => {
    if (!from || !to.trim()) { setError("Choose a source account and a destination."); return; }
    if (amount <= 0) { setError("Enter an amount."); return; }
    setBusy(true); setError("");
    try {
      const r = await createStandingInstruction({ from_account_number: from, to_account_number: to, amount, frequency: freq, description: desc });
      setNotice(`Auto-pay scheduled — first run ${r.next_run}.`);
      setTo(""); setAmount(0); setDesc("");
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to schedule"); }
    finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    try { await cancelStandingInstruction(id); setNotice("Auto-pay cancelled."); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to cancel"); }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Repeat size={18} className="text-teal" />
        <h2 className="font-display text-lg font-semibold text-ink">Standing instructions</h2>
        <Badge variant="info">{items.filter((s) => s.status === "ACTIVE").length} active</Badge>
      </div>

      {items.length === 0 ? (
        <EmptyState message="No recurring payments scheduled." />
      ) : (
        <ul className="space-y-2 mb-4">
          {items.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-ink nums">{npr(s.amount)} → <span className="font-mono">{s.to_account_number}</span></p>
                <p className="text-xs text-ink-faint flex items-center gap-1">
                  <CalendarClock size={11} /> {s.frequency} · next {s.next_run}{s.description ? ` · ${s.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={s.status === "ACTIVE" ? "success" : "default"}>{s.status}</Badge>
                {s.status === "ACTIVE" && (
                  <button onClick={() => cancel(s.id)} className="text-ink-faint hover:text-danger transition-colors p-1.5" title="Cancel">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="pinput">
          {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number}</option>)}
        </select>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Pay to account no." className="pinput font-mono" />
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(+e.target.value)} placeholder="Amount" className="pinput" />
        <select value={freq} onChange={(e) => setFreq(e.target.value as "monthly" | "weekly")} className="pinput">
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" className="pinput sm:col-span-2" />
      </div>
      <div className="mt-3"><Button onClick={create} loading={busy} size="sm"><Plus size={14} />Schedule auto-pay</Button></div>
      <PInputStyle />
    </Card>
  );
}

function PInputStyle() {
  return (
    <style jsx global>{`
      .pinput { width: 100%; border: 1px solid #e6e9ef; border-radius: 0.75rem; background: #fff; padding: 0.55rem 0.7rem; font-size: 0.875rem; color: #11203a; outline: none; }
      .pinput:focus { border-color: #0e7c66; box-shadow: 0 0 0 2px rgba(14,124,102,0.25); }
    `}</style>
  );
}
