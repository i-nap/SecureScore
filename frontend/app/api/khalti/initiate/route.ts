import { NextResponse } from "next/server";

// Khalti KPG-2. Secret stays server-side; sandbox by default.
// Set KHALTI_SECRET_KEY (+ optional KHALTI_BASE) in env for live.
const BASE   = process.env.KHALTI_BASE || "https://dev.khalti.com/api/v2";
const SECRET = process.env.KHALTI_SECRET_KEY || "test_secret_key_your_key_here";

export async function POST(req: Request) {
  const { amount, origin } = await req.json(); // amount in NPR
  const rupees = Math.max(10, Number(amount) || 100);

  const r = await fetch(`${BASE}/epayment/initiate/`, {
    method: "POST",
    headers: { Authorization: `Key ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      return_url: origin,
      website_url: origin,
      amount: rupees * 100, // paisa
      purchase_order_id: `coffee-${Date.now()}`,
      purchase_order_name: "Buy me a coffee",
    }),
  });

  const data = await r.json();
  if (!r.ok) return NextResponse.json({ error: data }, { status: r.status });
  return NextResponse.json({ payment_url: data.payment_url });
}
