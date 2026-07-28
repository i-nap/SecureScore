"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  getAccounts, fundTransfer, payBill, BILLERS,
  type BankAccount,
} from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { QrCode, Receipt, ScanLine, CheckCircle2, AlertTriangle, Copy, Download, Camera } from "lucide-react";

const npr = (n: number) =>
  "NPR " + n.toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tab = "receive" | "pay" | "bills";

// QR payload: a small JSON envelope. Dynamic = amount fixed; static = amount 0.
interface QRPayload { v: 1; acc: string; name: string; amt: number; note: string }
const encode = (p: QRPayload) => "SECURESCORE:" + btoa(JSON.stringify(p));
function decode(text: string): QRPayload | null {
  try {
    const raw = text.trim().startsWith("SECURESCORE:") ? text.trim().slice(12) : text.trim();
    const obj = JSON.parse(atob(raw));
    if (obj && typeof obj.acc === "string") return obj as QRPayload;
  } catch { /* not a SecureScore QR */ }
  return null;
}

export default function QrPayPage() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("receive");

  useEffect(() => {
    getAccounts().then(({ accounts: a }) => setAccounts(a)).catch((e) => setError(e.message));
  }, []);

  if (error && !accounts) return <div className="text-danger p-6">{error}</div>;
  if (!accounts) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (accounts.length === 0) return <EmptyState message="No accounts available." />;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "receive", label: "Receive (QR)", icon: <QrCode size={15} /> },
    { key: "pay", label: "Pay via QR", icon: <ScanLine size={15} /> },
    { key: "bills", label: "Pay bills", icon: <Receipt size={15} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <QrCode size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">QR payments · Utility bills</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">QR &amp; Bills</h1>
        <p className="mt-1 text-white/55 text-sm">Generate your own payment QR, pay someone by scanning theirs, or clear a utility bill.</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === t.key ? "bg-teal text-white" : "bg-surface border border-line text-ink-soft hover:bg-canvas"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "receive" && <Receive accounts={accounts} />}
      {tab === "pay" && <PayViaQR accounts={accounts} />}
      {tab === "bills" && <Bills accounts={accounts} />}
    </div>
  );
}

function Receive({ accounts }: { accounts: BankAccount[] }) {
  const [acc, setAcc] = useState(accounts[0].account_number);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const payload = useMemo<QRPayload>(
    () => ({ v: 1, acc, name: "SecureScore customer", amt: amount, note }),
    [acc, amount, note],
  );
  const text = encode(payload);

  useEffect(() => {
    QRCode.toDataURL(text, { width: 320, margin: 1, color: { dark: "#11203a", light: "#ffffff" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [text]);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <h2 className="font-display text-lg font-semibold text-ink mb-1">Your payment QR</h2>
        <p className="text-sm text-ink-soft mb-4">
          {amount > 0 ? "Dynamic QR — the amount is fixed." : "Static QR — the payer enters the amount."}
        </p>
        <Field label="Receive into">
          <select value={acc} onChange={(e) => setAcc(e.target.value)} className="input">
            {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number}</option>)}
          </select>
        </Field>
        <div className="mt-3">
          <Field label={amount > 0 ? `Amount — ${npr(amount)}` : "Amount — payer decides"}>
            <input type="range" min={0} max={100000} step={500} value={amount} onChange={(e) => setAmount(+e.target.value)} className="w-full accent-teal" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Note (optional)">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lunch split" className="input" maxLength={40} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col items-center justify-center text-center">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Payment QR code" className="w-56 h-56 rounded-xl border border-line" />
        ) : (
          <div className="w-56 h-56 flex items-center justify-center"><Spinner /></div>
        )}
        <p className="mt-3 text-sm text-ink-soft">{accounts.find((a) => a.account_number === acc)?.account_type} · {acc}</p>
        {amount > 0 && <p className="font-semibold text-ink nums">{npr(amount)}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}><Copy size={14} />{copied ? "Copied" : "Copy code"}</Button>
          {dataUrl && (
            <a href={dataUrl} download={`securescore-qr-${acc}.png`}>
              <Button variant="outline" size="sm"><Download size={14} />PNG</Button>
            </a>
          )}
        </div>
        <p className="mt-3 text-[11px] text-ink-faint break-all max-w-xs">{text}</p>
      </Card>
    </div>
  );
}

function PayViaQR({ accounts }: { accounts: BankAccount[] }) {
  const [from, setFrom] = useState(accounts[0].account_number);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => decode(code), [code]);
  const payAmount = parsed && parsed.amt > 0 ? parsed.amt : amount;

  const pay = async () => {
    if (!parsed) { setError("That doesn't look like a SecureScore QR code."); return; }
    if (parsed.acc === from) { setError("Source and destination accounts must differ."); return; }
    if (payAmount <= 0) { setError("Enter an amount to pay."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fundTransfer({
        from_account_number: from, to_account_number: parsed.acc,
        amount: payAmount, description: parsed.note ? `QR: ${parsed.note}` : "QR payment",
      });
      setResult(r.message);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <h2 className="font-display text-lg font-semibold text-ink mb-1">Pay via QR</h2>
      <p className="text-sm text-ink-soft mb-4">Paste a SecureScore QR code (from the Receive tab) to send money.</p>

      <Field label="Pay from">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="input">
          {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number} · {npr(a.balance)}</option>)}
        </select>
      </Field>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-ink-soft">QR code</span>
          <button type="button" onClick={() => setScanning((s) => !s)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal hover:opacity-70">
            <Camera size={13} />{scanning ? "Close camera" : "Scan with camera"}
          </button>
        </div>
        {scanning && (
          <CameraScan
            onResult={(t) => { setCode(t); setScanning(false); setError(null); }}
            onError={(m) => { setError(m); setScanning(false); }}
          />
        )}
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={3}
          placeholder="SECURESCORE:... or scan a QR" className="input font-mono text-xs" />
      </div>

      {parsed && (
        <div className="mt-3 rounded-xl bg-teal-soft border border-teal/20 px-4 py-3 text-sm">
          <p className="text-ink">Paying to <span className="font-mono font-semibold">{parsed.acc}</span></p>
          {parsed.note && <p className="text-ink-soft">Note: {parsed.note}</p>}
          {parsed.amt > 0
            ? <p className="font-semibold text-teal-deep mt-1">{npr(parsed.amt)} (fixed)</p>
            : (
              <div className="mt-2">
                <Field label="Amount to pay">
                  <input type="number" min={0} value={amount} onChange={(e) => setAmount(+e.target.value)} className="input" />
                </Field>
              </div>
            )}
        </div>
      )}

      {result && <div className="mt-3 rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{result}</div>}
      {error && <div className="mt-3 rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}

      <div className="mt-4"><Button onClick={pay} loading={busy} disabled={!parsed}>Pay {payAmount > 0 ? npr(payAmount) : ""}</Button></div>
    </Card>
  );
}

function Bills({ accounts }: { accounts: BankAccount[] }) {
  const [acc, setAcc] = useState(accounts[0].account_number);
  const [biller, setBiller] = useState(BILLERS[0].key);
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = BILLERS.find((b) => b.key === biller)!;

  const pay = async () => {
    if (!identifier.trim()) { setError(`${current.field} is required.`); return; }
    if (amount <= 0) { setError("Enter an amount."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await payBill({ account_number: acc, biller, identifier, amount });
      setResult(r.message);
      setIdentifier(""); setAmount(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <h2 className="font-display text-lg font-semibold text-ink mb-3">Pay a utility bill</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {BILLERS.map((b) => (
          <button key={b.key} onClick={() => setBiller(b.key)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors text-center ${
              biller === b.key ? "bg-teal text-white border-teal" : "border-line text-ink-soft hover:bg-canvas"}`}>
            {b.label}
          </button>
        ))}
      </div>

      <Field label="Pay from">
        <select value={acc} onChange={(e) => setAcc(e.target.value)} className="input">
          {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number} · {npr(a.balance)}</option>)}
        </select>
      </Field>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={current.field}>
          <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={current.field} className="input" />
        </Field>
        <Field label="Amount (NPR)">
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(+e.target.value)} className="input" />
        </Field>
      </div>

      {result && <div className="mt-3 rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{result}</div>}
      {error && <div className="mt-3 rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}

      <div className="mt-4 flex items-center justify-between">
        <Badge variant="info">{current.label}</Badge>
        <Button onClick={pay} loading={busy}>Pay bill</Button>
      </div>
    </Card>
  );
}

function CameraScan({ onResult, onError }: { onResult: (text: string) => void; onError: (msg: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement("canvas");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (done) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const found = jsQR(img.data, img.width, img.height);
              if (found?.data) { done = true; onResult(found.data); return; }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        onError("Camera unavailable — paste the code instead.");
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, onError]);

  return (
    <div className="relative mb-2 rounded-xl overflow-hidden border border-line bg-black aspect-video">
      <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
      <div className="absolute inset-6 border-2 border-teal/70 rounded-lg pointer-events-none" />
      <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[11px] text-white/90 bg-black/40 rounded-full px-2 py-0.5">
        <Camera size={11} /> Point at a SecureScore QR
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-ink-soft mb-1.5">{label}</span>
      {children}
      <style jsx>{`
        :global(.input) { width: 100%; border: 1px solid #e6e9ef; border-radius: 0.75rem; background: #fff; padding: 0.625rem 0.75rem; font-size: 0.875rem; color: #11203a; outline: none; }
      `}</style>
    </label>
  );
}
