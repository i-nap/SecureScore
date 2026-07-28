"use client";

import { useEffect, useState } from "react";
import {
  getAccounts, listCards, issueCard, blockCard, freezeCard, unblockCard, setCardLimit,
  listChequeBooks, requestChequeBook,
  type BankAccount, type DebitCard, type ChequeBook,
} from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { CreditCard, Snowflake, Ban, Unlock, Sliders, BookText, CheckCircle2, AlertTriangle } from "lucide-react";

export default function CardsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cards, setCards] = useState<DebitCard[] | null>(null);
  const [cheques, setCheques] = useState<ChequeBook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    Promise.all([getAccounts(), listCards(), listChequeBooks()])
      .then(([a, c, q]) => { setAccounts(a.accounts); setCards(c.cards); setCheques(q.cheque_books); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const run = async (key: string, fn: () => Promise<{ status?: string }>, msg: string) => {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); setNotice(msg); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  };

  if (!cards) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;

  const accountsWithoutCard = accounts.filter((a) => !cards.some((c) => c.account_number === a.account_number && c.status !== "CANCELLED"));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <CreditCard size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Debit cards · Cheque books</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Cards &amp; Cheques</h1>
        <p className="mt-1 text-white/55 text-sm">Issue and control your debit cards, and request a cheque book.</p>
      </div>

      {notice && <div className="rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{notice}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <CardTile key={c.id} card={c} busy={busy?.startsWith(c.id) ?? false}
            onBlock={() => run(c.id + "b", () => blockCard(c.id), "Card blocked.")}
            onFreeze={() => run(c.id + "f", () => freezeCard(c.id), "Card frozen.")}
            onUnblock={() => run(c.id + "u", () => unblockCard(c.id), "Card reactivated.")}
            onLimit={(v) => run(c.id + "l", () => setCardLimit(c.id, v), "Daily limit updated.")} />
        ))}
      </div>

      {accountsWithoutCard.length > 0 && (
        <Card>
          <h2 className="font-display text-lg font-semibold text-ink mb-3">Issue a new debit card</h2>
          <IssueForm accounts={accountsWithoutCard} busy={busy === "issue"}
            onIssue={(acc, net) => run("issue", () => issueCard({ account_number: acc, network: net }), "Card issued.")} />
        </Card>
      )}

      {/* Cheque books */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <BookText size={18} className="text-teal" />
          <h2 className="font-display text-lg font-semibold text-ink">Cheque books</h2>
        </div>
        {cheques.length > 0 && (
          <ul className="space-y-2 mb-4">
            {cheques.map((q) => (
              <li key={q.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink">{q.leaves}-leaf book · <span className="font-mono">{q.account_number}</span></p>
                  <p className="text-xs text-ink-faint">Requested {q.requested_at?.slice(0, 10)}</p>
                </div>
                <Badge variant={q.status === "DISPATCHED" ? "success" : q.status === "APPROVED" ? "info" : "warning"}>{q.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <ChequeForm accounts={accounts} busy={busy === "cheque"}
          onRequest={(acc, leaves) => run("cheque", () => requestChequeBook(acc, leaves), "Cheque book requested.")} />
      </Card>
    </div>
  );
}

function CardTile({ card, busy, onBlock, onFreeze, onUnblock, onLimit }: {
  card: DebitCard; busy: boolean;
  onBlock: () => void; onFreeze: () => void; onUnblock: () => void; onLimit: (v: number) => void;
}) {
  const [limit, setLimit] = useState(card.daily_limit);
  const active = card.status === "ACTIVE";
  const statusVar = active ? "success" : card.status === "FROZEN" ? "info" : "danger";

  return (
    <div className="rounded-2xl overflow-hidden border border-line shadow-card">
      {/* Card face */}
      <div className="bg-gradient-to-br from-[#11203A] to-[#0c1626] p-5 text-white relative">
        <div className="flex justify-between items-start">
          <span className="text-xs uppercase tracking-widest text-white/50">{card.network} Debit</span>
          <Badge variant={statusVar}>{card.status}</Badge>
        </div>
        <p className="font-mono text-lg tracking-widest mt-6">{card.masked_number}</p>
        <div className="flex justify-between items-end mt-3 text-xs text-white/60">
          <span className="font-mono">{card.account_number}</span>
          <span>exp {card.expiry}</span>
        </div>
      </div>
      {/* Controls */}
      <div className="bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {active ? (
            <>
              <Button size="sm" variant="outline" onClick={onFreeze} disabled={busy}><Snowflake size={13} />Freeze</Button>
              <Button size="sm" variant="danger" onClick={onBlock} disabled={busy}><Ban size={13} />Block</Button>
            </>
          ) : (
            <Button size="sm" onClick={onUnblock} disabled={busy}><Unlock size={13} />Reactivate</Button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="block text-[11px] font-semibold text-ink-faint mb-1 flex items-center gap-1"><Sliders size={11} />Daily limit (NPR)</span>
            <input type="number" min={0} value={limit} onChange={(e) => setLimit(+e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </label>
          <Button size="sm" variant="secondary" onClick={() => onLimit(limit)} disabled={busy || limit === card.daily_limit}>Set</Button>
        </div>
      </div>
    </div>
  );
}

function IssueForm({ accounts, busy, onIssue }: { accounts: BankAccount[]; busy: boolean; onIssue: (acc: string, net: string) => void }) {
  const [acc, setAcc] = useState(accounts[0]?.account_number ?? "");
  const [net, setNet] = useState("NPI");
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="flex-1 min-w-[180px]">
        <span className="block text-xs font-semibold text-ink-soft mb-1">Account</span>
        <select value={acc} onChange={(e) => setAcc(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
          {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-xs font-semibold text-ink-soft mb-1">Network</span>
        <select value={net} onChange={(e) => setNet(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
          <option value="NPI">NPI (NPS)</option>
          <option value="VISA">VISA</option>
          <option value="MASTERCARD">Mastercard</option>
        </select>
      </label>
      <Button onClick={() => onIssue(acc, net)} loading={busy}><CreditCard size={15} />Issue card</Button>
    </div>
  );
}

function ChequeForm({ accounts, busy, onRequest }: { accounts: BankAccount[]; busy: boolean; onRequest: (acc: string, leaves: number) => void }) {
  const [acc, setAcc] = useState(accounts[0]?.account_number ?? "");
  const [leaves, setLeaves] = useState(25);
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="flex-1 min-w-[180px]">
        <span className="block text-xs font-semibold text-ink-soft mb-1">Account</span>
        <select value={acc} onChange={(e) => setAcc(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
          {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-xs font-semibold text-ink-soft mb-1">Leaves</span>
        <select value={leaves} onChange={(e) => setLeaves(+e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </label>
      <Button onClick={() => onRequest(acc, leaves)} loading={busy} variant="secondary"><BookText size={15} />Request book</Button>
    </div>
  );
}
