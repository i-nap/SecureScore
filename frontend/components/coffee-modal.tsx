"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Coffee, Heart, X } from "lucide-react";

// Return here, not to origin (origin = login page).
const returnUrl = () => window.location.origin + window.location.pathname;

// eSewa ePay v2 test gateway (public sandbox creds). Swap for live merchant code + secret in prod.
// ponytail: hardcoded test creds — donation demo. Move signing server-side for real money.
const ESEWA_URL    = "https://rc-epay.esewa.com.np/api/epay/main/v2/form";
const ESEWA_CODE   = "EPAYTEST";
const ESEWA_SECRET = "8gBm/:&EnhH.1/q";

const AMOUNTS = [50, 100, 200, 500];

async function payEsewa(amount: number) {
  const uuid  = `coffee-${Date.now()}`;
  const total = String(amount);
  const message = `total_amount=${total},transaction_uuid=${uuid},product_code=${ESEWA_CODE}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(ESEWA_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const signature = btoa(String.fromCharCode(...Array.from(new Uint8Array(sig))));

  const fields: Record<string, string> = {
    amount: total, tax_amount: "0", total_amount: total,
    transaction_uuid: uuid, product_code: ESEWA_CODE,
    product_service_charge: "0", product_delivery_charge: "0",
    success_url: returnUrl(), failure_url: returnUrl(),
    signed_field_names: "total_amount,transaction_uuid,product_code", signature,
  };

  const form = document.createElement("form");
  form.method = "POST";
  form.action = ESEWA_URL;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden"; input.name = name; input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

async function payKhalti(amount: number) {
  const res = await fetch("/api/khalti/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, origin: returnUrl() }),
  });
  const data = await res.json();
  if (data.payment_url) window.location.href = data.payment_url;
  else throw new Error(JSON.stringify(data.error ?? data));
}

// Reads the gateway's return params and thanks the user. Mount next to CoffeeModal.
// ponytail: trusts the redirect params, no server-side lookup/verify call. Donation
// demo with test creds — anyone can fake ?status=Completed. Verify server-side (Khalti
// /epayment/lookup, eSewa status check) before this moves real money.
export function CoffeeThanks() {
  const [paid, setPaid] = useState<boolean | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    let ok: boolean | null = null;

    if (q.has("status")) ok = q.get("status") === "Completed"; // khalti
    else if (q.has("data")) {
      // esewa: base64 json
      try { ok = JSON.parse(atob(q.get("data")!)).status === "COMPLETE"; } catch { ok = false; }
    }
    if (ok === null) return;

    setPaid(ok);
    window.history.replaceState({}, "", window.location.pathname); // don't re-fire on refresh
  }, []);

  if (paid === null) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => setPaid(null)}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-surface border border-line shadow-2xl px-6 py-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto w-14 h-14 rounded-full bg-gold-soft flex items-center justify-center mb-3">
          <Coffee size={26} className="text-gold" />
        </div>
        <h2 className="font-display text-xl font-semibold text-ink">
          {paid ? "Thank you! ☕" : "Payment didn't go through"}
        </h2>
        <p className="text-[13px] text-ink-soft mt-1.5">
          {paid ? "Your coffee is much appreciated." : "Nothing was charged. Try again anytime."}
        </p>
        <button
          onClick={() => setPaid(null)}
          className="mt-5 w-full py-2.5 rounded-xl bg-teal text-white font-semibold text-sm hover:brightness-105 transition-all"
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function CoffeeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState<"esewa" | "khalti" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = (gw: "esewa" | "khalti") => async () => {
    setErr(null); setBusy(gw);
    try {
      if (gw === "esewa") await payEsewa(amount);
      else await payKhalti(amount);
    } catch (e) {
      setErr(gw === "khalti" ? "Khalti unavailable — set KHALTI_SECRET_KEY." : "Payment failed. Try again.");
      setBusy(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-surface border border-line shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-ink-faint hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="px-6 pt-7 pb-5 text-center bg-gradient-to-b from-gold-soft to-transparent">
          <div className="mx-auto w-14 h-14 rounded-full bg-gold-soft flex items-center justify-center mb-3">
            <Coffee size={26} className="text-gold" />
          </div>
          <h2 className="font-display text-xl font-semibold text-ink">Buy me a coffee ☕</h2>
          <p className="text-[13px] text-ink-soft mt-1.5 flex items-center justify-center gap-1">
            Thank you for the support <Heart size={13} className="text-danger fill-danger" />
          </p>
        </div>

        {/* Amount picker */}
        <div className="px-6 pb-6">
          <p className="text-[11px] font-bold text-ink-faint uppercase tracking-wide mb-2">Choose amount (NPR)</p>
          <div className="grid grid-cols-4 gap-2 mb-5">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                className={
                  "py-2 rounded-lg text-sm font-semibold border transition-colors " +
                  (amount === a
                    ? "bg-teal text-white border-teal"
                    : "bg-canvas text-ink-soft border-line hover:border-teal")
                }
              >
                {a}
              </button>
            ))}
          </div>

          {err && <p className="text-[12px] text-danger mb-3 text-center">{err}</p>}

          <div className="space-y-2.5">
            <button
              onClick={go("esewa")}
              disabled={!!busy}
              className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#60bb46] shadow-sm hover:shadow-md hover:brightness-105 disabled:opacity-60 transition-all"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/esewa-logo.png" alt="eSewa" className="h-5 w-auto shrink-0" />
              <span className="flex-1 text-left font-semibold text-[14px] text-white">
                {busy === "esewa" ? "Redirecting…" : "Pay with eSewa"}
              </span>
              <span className="font-bold text-[13px] text-white/90 group-hover:translate-x-0.5 transition-transform">Rs. {amount} →</span>
            </button>

            <button
              onClick={go("khalti")}
              disabled={!!busy}
              className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-line shadow-sm hover:shadow-md hover:border-[#e2136e]/40 disabled:opacity-60 transition-all"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/khalti-logo.png" alt="Khalti" className="h-6 w-auto shrink-0" />
              <span className="flex-1 text-left font-semibold text-[14px] text-ink">
                {busy === "khalti" ? "Redirecting…" : "Pay with Khalti"}
              </span>
              <span className="font-bold text-[13px] text-[#e2136e] group-hover:translate-x-0.5 transition-transform">Rs. {amount} →</span>
            </button>
          </div>

          <p className="text-[10px] text-ink-faint text-center mt-4">Secure checkout</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
