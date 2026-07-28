"use client";

import { useEffect, useState } from "react";
import { listBranchChequeBooks, advanceChequeBook, type BranchChequeBook } from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { BookText, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";

const nextLabel: Record<string, string> = { REQUESTED: "Approve", APPROVED: "Mark dispatched" };

export default function ServiceRequestsPage() {
  const [items, setItems] = useState<BranchChequeBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => listBranchChequeBooks().then((r) => setItems(r.cheque_books)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const advance = async (id: string) => {
    setBusy(id); setError(null); setNotice(null);
    try { const r = await advanceChequeBook(id); setNotice(`Request moved to ${r.request_status}.`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  };

  if (!items) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  const pending = items.filter((q) => q.status !== "DISPATCHED");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <BookText size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Branch operations</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Service Requests</h1>
        <p className="mt-1 text-white/55 text-sm">Approve and dispatch customer cheque-book requests.</p>
      </div>

      {notice && <div className="rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{notice}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}

      <Card>
        <h2 className="font-display text-lg font-semibold text-ink mb-3">Cheque-book requests <Badge variant="info">{pending.length} pending</Badge></h2>
        {items.length === 0 ? (
          <EmptyState message="No cheque-book requests." />
        ) : (
          <ul className="space-y-2">
            {items.map((q) => (
              <li key={q.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink">{q.customer || q.account_number}</p>
                  <p className="text-xs text-ink-faint font-mono">{q.account_number} · {q.leaves} leaves · {q.requested_at?.slice(0, 10)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={q.status === "DISPATCHED" ? "success" : q.status === "APPROVED" ? "info" : "warning"}>{q.status}</Badge>
                  {nextLabel[q.status] && (
                    <Button size="sm" onClick={() => advance(q.id)} loading={busy === q.id}>
                      {nextLabel[q.status]}<ArrowRight size={13} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
