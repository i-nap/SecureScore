"use client";

import { useState, useEffect, useCallback } from "react";
import { listApprovals, approveRequest, rejectRequest, type ApprovalRequest } from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { ShieldCheck, RefreshCw } from "lucide-react";

export default function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    listApprovals().then((r) => setItems(r.approvals)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id); setError("");
    try {
      await (approve ? approveRequest(id) : rejectRequest(id));
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  if (error && !items) return <div className="text-danger p-6">{error}</div>;
  if (!items) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><ShieldCheck size={16} /> Pending approvals ({items.length})</h2>
        <button onClick={load} className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink"><RefreshCw size={14} /> Refresh</button>
      </div>
      {error && <p className="text-danger text-xs mb-3">{error}</p>}
      {items.length === 0 ? <EmptyState message="No requests awaiting approval." /> : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border border-line rounded-lg p-3">
              <div>
                <p className="font-medium text-ink">{a.kind.replace(/_/g, " ")} <Badge variant="warning">NPR {a.amount.toLocaleString()}</Badge></p>
                <p className="text-xs text-ink-soft">by {a.requested_by} · {a.branch_id} · {new Date(a.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy === a.id} onClick={() => decide(a.id, true)}>Approve</Button>
                <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => decide(a.id, false)}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
