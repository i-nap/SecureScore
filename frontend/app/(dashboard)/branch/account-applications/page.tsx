"use client";

import { useEffect, useState } from "react";
import {
  getBranchApplications, approveBranchApplication, rejectBranchApplication,
  type AccountApplication,
} from "@/lib/api";
import { Card, Badge, Spinner, Button } from "@/components/ui";
import { CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";

function statusBadge(status: string) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

function fmtNPR(n: number) {
  return n > 0 ? `NPR ${n.toLocaleString("en-NP")}` : "—";
}

export default function AccountApplicationsPage() {
  const [apps, setApps] = useState<AccountApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [noteMap, setNoteMap] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = (f: typeof filter) => {
    setLoading(true);
    getBranchApplications(f === "all" ? undefined : f)
      .then(r => setApps(r.applications))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(filter); }, [filter]);

  const approve = async (id: number) => {
    setActionLoading(id);
    try {
      const res = await approveBranchApplication(id, noteMap[id]);
      setApps(prev => prev.map(a => a.id === id ? { ...a, status: "approved" as const, review_note: noteMap[id] || "" } : a));
      alert(`Account opened: ${res.account_number}`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const reject = async (id: number) => {
    if (!noteMap[id]?.trim()) {
      alert("Please enter a rejection reason.");
      return;
    }
    setActionLoading(id);
    try {
      await rejectBranchApplication(id, noteMap[id]);
      setApps(prev => prev.map(a => a.id === id ? { ...a, status: "rejected" as const, review_note: noteMap[id] } : a));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Account Applications</h1>
        <p className="text-sm text-ink-soft mt-0.5">Review and approve customer account opening requests</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["pending", "all", "approved", "rejected"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === f ? "bg-teal text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200"}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : apps.length === 0 ? (
        <Card><p className="text-center text-ink-faint py-10">No {filter} applications.</p></Card>
      ) : (
        <div className="space-y-3">
          {apps.map(app => (
            <Card key={app.id} className="p-0 overflow-hidden">
              <div
                className="p-4 cursor-pointer hover:bg-canvas transition-colors"
                onClick={() => setExpanded(expanded === app.id ? null : app.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <Clock size={16} className="text-ink-soft" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-ink capitalize">{app.account_type} Account</p>
                        {statusBadge(app.status)}
                      </div>
                      <p className="text-xs text-ink-faint">
                        App #{app.id} &bull; Customer: <span className="font-mono">{app.customer_id}</span>
                        &bull; {app.created_at ? new Date(app.created_at).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-ink-soft">Initial Deposit</p>
                      <p className="text-sm font-bold text-ink">{fmtNPR(app.initial_deposit)}</p>
                    </div>
                    <ChevronDown size={16} className={`text-ink-faint transition-transform ${expanded === app.id ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </div>

              {expanded === app.id && (
                <div className="border-t border-line p-4 bg-canvas">
                  <div className="grid sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-ink-faint">Customer ID</p>
                      <p className="text-sm font-mono font-medium text-ink">{app.customer_id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">Initial Deposit</p>
                      <p className="text-sm font-bold text-ink">{fmtNPR(app.initial_deposit)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">Purpose</p>
                      <p className="text-sm text-ink">{app.purpose || "Not specified"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">Applied</p>
                      <p className="text-sm text-ink">
                        {app.created_at ? new Date(app.created_at).toLocaleString("en-NP") : "--"}
                      </p>
                    </div>
                  </div>

                  {app.status === "pending" ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-soft mb-1">
                          Note / Remarks (required for rejection)
                        </label>
                        <textarea
                          rows={2}
                          value={noteMap[app.id] ?? ""}
                          onChange={e => setNoteMap(p => ({ ...p, [app.id]: e.target.value }))}
                          placeholder="Add a note for the customer..."
                          className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button
                          onClick={() => approve(app.id)}
                          disabled={actionLoading === app.id}
                          className="flex-1"
                        >
                          {actionLoading === app.id ? <Spinner size="sm" /> : <><CheckCircle2 size={14} className="mr-1.5" />Approve & Open Account</>}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => reject(app.id)}
                          disabled={actionLoading === app.id}
                          className="flex-1"
                        >
                          <XCircle size={14} className="mr-1.5" />Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={`p-3 rounded-lg text-sm ${app.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      <span className="font-medium">{app.status === "approved" ? "Approved" : "Rejected"}</span>
                      {app.reviewed_by && <span> by {app.reviewed_by}</span>}
                      {app.reviewed_at && <span> on {new Date(app.reviewed_at).toLocaleDateString()}</span>}
                      {app.review_note && <p className="mt-1">Note: {app.review_note}</p>}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
