"use client";

import { useState, useEffect, useCallback } from "react";
import { forexCard, forexIssue, forexLoad, forexUnload, type ForexCard } from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { CreditCard, ArrowDownCircle, ArrowUpCircle } from "lucide-react";

export default function DollarCardPage() {
  const [card, setCard] = useState<ForexCard | null>(null);
  const [account, setAccount] = useState("");
  const [usd, setUsd] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    forexCard().then(setCard).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, tag: string) => {
    setBusy(tag); setError(""); setMsg("");
    try { await fn(); setMsg("Done."); setUsd(""); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  if (!card) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6 max-w-xl">
      {error && <div className="text-danger text-sm p-3 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
      {msg && <div className="text-emerald-600 text-sm">{msg}</div>}

      <Card className="bg-gradient-to-br from-[#1e3a5f] to-[#0f5132] text-white">
        <div className="flex items-center justify-between mb-6">
          <CreditCard size={28} />
          <Badge variant="info">USD · VISA</Badge>
        </div>
        {card.has_card ? (
          <>
            <p className="font-mono text-lg tracking-widest">{card.masked_number}</p>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-xs opacity-70">Balance</p>
                <p className="text-2xl font-semibold">${card.usd_balance?.toLocaleString()}</p>
              </div>
              <p className="text-xs opacity-70">≈ NPR {card.npr_equivalent?.toLocaleString()}</p>
            </div>
          </>
        ) : (
          <p className="text-sm opacity-90">No dollar card yet. Issue one to spend abroad and online in USD.</p>
        )}
      </Card>

      <Card>
        <label className="text-xs text-ink-soft">NPR account number</label>
        <input className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Funding account" value={account} onChange={(e) => setAccount(e.target.value)} />

        {!card.has_card ? (
          <Button className="mt-3" loading={busy === "issue"} disabled={!account} onClick={() => run(() => forexIssue(account), "issue")}>
            Issue dollar card
          </Button>
        ) : (
          <>
            <label className="text-xs text-ink-soft mt-3 block">USD amount (rate: NPR {card.rate}/USD)</label>
            <input className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" type="number" placeholder="USD" value={usd} onChange={(e) => setUsd(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <Button loading={busy === "load"} disabled={!account || !usd} onClick={() => run(() => forexLoad(account, parseFloat(usd)), "load")}>
                <ArrowDownCircle size={14} /> Load
              </Button>
              <Button variant="outline" loading={busy === "unload"} disabled={!account || !usd} onClick={() => run(() => forexUnload(account, parseFloat(usd)), "unload")}>
                <ArrowUpCircle size={14} /> Unload
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
