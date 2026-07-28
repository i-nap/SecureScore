"use client";

import { useState, useEffect, useCallback } from "react";
import { listCards, cardControls, setCardPIN, setCardChannel, cardPurchase, type DebitCard, type CardControls } from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { CreditCard, Lock, Store } from "lucide-react";

export default function CardControlsPage() {
  const [cards, setCards] = useState<DebitCard[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [ctrl, setCtrl] = useState<CardControls | null>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // POS simulator
  const [posAmount, setPosAmount] = useState("");
  const [posMerchant, setPosMerchant] = useState("Bhatbhateni Supermarket");
  const [posPin, setPosPin] = useState("");
  const [posChannel, setPosChannel] = useState<"pos" | "atm">("pos");
  const [posResult, setPosResult] = useState<string>("");
  const [posDecline, setPosDecline] = useState<string>("");

  useEffect(() => {
    listCards().then((r) => { setCards(r.cards); if (r.cards[0]) setSelected(r.cards[0].id); }).catch((e) => setError(e.message));
  }, []);

  const loadCtrl = useCallback((id: string) => {
    if (!id) return;
    cardControls(id).then(setCtrl).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { loadCtrl(selected); }, [selected, loadCtrl]);

  const toggle = async (channel: "online" | "pos" | "atm", enabled: boolean) => {
    setError(""); setMsg("");
    try { await setCardChannel(selected, channel, enabled); loadCtrl(selected); }
    catch (e) { setError((e as Error).message); }
  };

  const savePin = async () => {
    setError(""); setMsg("");
    try { await setCardPIN(selected, pin); setPin(""); setMsg("PIN updated"); loadCtrl(selected); }
    catch (e) { setError((e as Error).message); }
  };

  const runPurchase = async () => {
    setPosResult(""); setPosDecline("");
    try {
      const r = await cardPurchase(selected, posPin, Number(posAmount), posMerchant, posChannel);
      setPosResult(`Approved · NPR ${r.amount.toLocaleString()} · ref ${r.reference_number} · balance NPR ${r.balance_after.toLocaleString()}`);
      setPosPin(""); setPosAmount("");
    } catch (e) { setPosDecline((e as Error).message); }
  };

  if (!cards) return <div className="flex justify-center p-12"><Spinner /></div>;
  if (cards.length === 0) return <EmptyState message="No cards yet. Issue a card first." />;

  return (
    <div className="space-y-6 max-w-xl">
      {error && <div className="text-danger text-sm p-3 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
      {msg && <div className="text-emerald-600 text-sm">{msg}</div>}

      <Card>
        <label className="text-xs text-ink-soft flex items-center gap-1"><CreditCard size={14} /> Card</label>
        <select className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.masked_number} · {c.network} · {c.status}</option>)}
        </select>
      </Card>

      {ctrl && (
        <>
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3">Channels</h2>
            {(["online", "pos", "atm"] as const).map((ch) => {
              const on = ctrl[ch];
              return (
                <div key={ch} className="flex items-center justify-between py-2 border-b border-line/50 last:border-0">
                  <span className="text-sm capitalize">{ch.toUpperCase()}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={on ? "success" : "default"}>{on ? "On" : "Off"}</Badge>
                    <Button size="sm" variant={on ? "outline" : "primary"} onClick={() => toggle(ch, !on)}>{on ? "Disable" : "Enable"}</Button>
                  </div>
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><Lock size={16} /> {ctrl.pin_set ? "Reset PIN" : "Set PIN"}</h2>
            <div className="flex gap-2">
              <input className="rounded-lg border border-line px-3 py-2 text-sm w-40" type="password" inputMode="numeric" maxLength={6} placeholder="4–6 digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
              <Button onClick={savePin} disabled={pin.length < 4}>Save PIN</Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2"><Store size={16} /> Simulate a purchase</h2>
            <p className="text-xs text-ink-faint mb-3">PIN-verified card-present transaction. Requires the channel enabled, the correct PIN, and sufficient balance.</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg border border-line px-3 py-2 text-sm col-span-2" placeholder="Merchant" value={posMerchant} onChange={(e) => setPosMerchant(e.target.value)} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" type="number" placeholder="Amount (NPR)" value={posAmount} onChange={(e) => setPosAmount(e.target.value)} />
              <select className="rounded-lg border border-line px-3 py-2 text-sm" value={posChannel} onChange={(e) => setPosChannel(e.target.value as "pos" | "atm")}>
                <option value="pos">POS</option>
                <option value="atm">ATM</option>
              </select>
              <input className="rounded-lg border border-line px-3 py-2 text-sm" type="password" inputMode="numeric" maxLength={6} placeholder="PIN" value={posPin} onChange={(e) => setPosPin(e.target.value)} />
              <Button onClick={runPurchase} disabled={!posAmount || posPin.length < 4}>Pay</Button>
            </div>
            {posResult && <div className="mt-3 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{posResult}</div>}
            {posDecline && <div className="mt-3 text-sm text-danger bg-red-50 border border-red-200 rounded-lg p-3">Declined — {posDecline}</div>}
          </Card>
        </>
      )}
    </div>
  );
}
