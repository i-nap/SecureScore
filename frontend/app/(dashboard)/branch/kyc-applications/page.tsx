"use client";

import { useEffect, useState } from "react";
import { Card, Badge, Spinner, Button } from "@/components/ui";
import {
  branchKYCApplications, branchKYCReview,
  type KYCAppRecord,
} from "@/lib/api";
import {
  UserCheck, CheckCircle2, XCircle, Clock, ShieldCheck,
  AlertTriangle, ChevronDown, ChevronUp, Phone, CreditCard,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  if (status === "approved")    return <Badge variant="success">Approved</Badge>;
  if (status === "rejected")    return <Badge variant="danger">Rejected</Badge>;
  if (status === "under_review") return <Badge variant="warning">Under Review</Badge>;
  if (status === "pending_ai")  return <Badge variant="default">Pending AI Verify</Badge>;
  return <Badge variant="default">{status}</Badge>;
}

function AIBadge({ app }: { app: KYCAppRecord }) {
  if (!app.ai_verified) return (
    <span className="flex items-center gap-1 text-xs text-ink-faint"><AlertTriangle size={11} /> Pending AI</span>
  );
  return (
    <div className="space-y-0.5">
      <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
        <ShieldCheck size={11} /> Live: {(app.face_profile_live * 100).toFixed(0)}%
      </span>
      <span className="text-xs text-ink-faint">ID: {(app.face_profile_id * 100).toFixed(0)}%</span>
    </div>
  );
}

function AppRow({ app, onReview }: { app: KYCAppRecord; onReview: (id: number, action: "approve" | "reject", note: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  const act = async (action: "approve" | "reject") => {
    if (action === "reject" && !note.trim()) { alert("Enter a rejection reason."); return; }
    setActing(true);
    await onReview(app.id, action, note);
    setActing(false);
  };

  const canAct = app.status === "pending_ai" || app.status === "under_review";

  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-canvas transition-colors cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="py-3 px-4">
          <div className="font-semibold text-ink text-sm">{app.full_name || "—"}</div>
          <div className="text-xs text-ink-faint font-mono">{app.reference}</div>
        </td>
        <td className="py-3 px-4 text-xs text-ink-soft">
          <div className="flex items-center gap-1"><Phone size={10} />{app.phone || "—"}</div>
          <div className="flex items-center gap-1 mt-0.5"><CreditCard size={10} />{app.loan_purpose || "—"}</div>
        </td>
        <td className="py-3 px-4 text-sm text-ink">
          {app.loan_amount > 0 ? `NPR ${app.loan_amount.toLocaleString()}` : "—"}
        </td>
        <td className="py-3 px-4"><AIBadge app={app} /></td>
        <td className="py-3 px-4"><StatusBadge status={app.status} /></td>
        <td className="py-3 px-4 text-xs text-ink-faint">
          {new Date(app.submitted_at).toLocaleDateString("en-NP")}
        </td>
        <td className="py-3 px-4 text-ink-faint">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-teal-soft/40 border-b border-teal/20">
          <td colSpan={7} className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Verification detail */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">AI Verification</p>
                {app.ai_verified ? (
                  <div className="space-y-1.5">
                    {[
                      { label: "Selfie ↔ Live", value: `${(app.face_profile_live * 100).toFixed(1)}%`, ok: app.face_profile_live >= 0.70 },
                      { label: "Selfie ↔ ID", value: `${(app.face_profile_id * 100).toFixed(1)}%`, ok: app.face_profile_id >= 0.65 },
                      { label: "Liveness", value: app.liveness_passed ? "Passed" : "Failed", ok: app.liveness_passed },
                      { label: "Signature", value: `${(app.sig_match * 100).toFixed(1)}%`, ok: app.sig_match >= 0.75 },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center gap-2">
                        {r.ok ? <CheckCircle2 size={13} className="text-emerald-500" /> : <XCircle size={13} className="text-red-500" />}
                        <span className="text-xs text-ink-soft w-24">{r.label}</span>
                        <span className={`text-xs font-bold ${r.ok ? "text-emerald-600" : "text-red-600"}`}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} />
                    Customer has not completed AI biometric verification yet.
                  </div>
                )}
              </div>

              {/* Review actions */}
              {canAct && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Review Decision</p>
                  {!app.ai_verified && (
                    <p className="text-xs text-amber-600 mb-2">⚠ AI verification not complete — manual review required.</p>
                  )}
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Review notes (required for rejection)…"
                    rows={2}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => act("approve")}
                      disabled={acting}
                      className="flex-1 text-xs py-2"
                    >
                      {acting ? <Spinner size="sm" /> : <CheckCircle2 size={13} />}
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => act("reject")}
                      disabled={acting}
                      className="flex-1 text-xs py-2 text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <XCircle size={13} /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {!canAct && app.review_note && (
                <div>
                  <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Review Note</p>
                  <p className="text-sm text-ink bg-white rounded-lg px-3 py-2 border border-line">{app.review_note}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const STATUS_FILTERS = ["all", "pending_ai", "under_review", "approved", "rejected"] as const;
type Filter = typeof STATUS_FILTERS[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All", pending_ai: "Pending AI", under_review: "Under Review", approved: "Approved", rejected: "Rejected",
};

export default function BranchKYCApplicationsPage() {
  const [apps, setApps] = useState<KYCAppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = () => {
    setLoading(true);
    branchKYCApplications()
      .then((r) => setApps(r.applications))
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleReview = async (id: number, action: "approve" | "reject", note: string) => {
    try {
      await branchKYCReview(id, action, note);
      setApps((prev) => prev.map((a) => a.id === id ? { ...a, status: action === "approve" ? "approved" : "rejected", review_note: note } : a));
    } catch (e: unknown) {
      alert((e as Error).message || "Action failed");
    }
  };

  const filtered = filter === "all" ? apps : apps.filter((a) => a.status === filter);

  const counts = STATUS_FILTERS.reduce((acc, f) => {
    acc[f] = f === "all" ? apps.length : apps.filter((a) => a.status === f).length;
    return acc;
  }, {} as Record<Filter, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <UserCheck size={22} className="text-teal" />
            KYC Applications
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Review customer KYC submissions. AI-verified applications are pre-screened biometrically.
          </p>
        </div>
        <button onClick={load} className="px-4 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total", value: counts.all, color: "text-ink" },
          { label: "Pending AI", value: counts.pending_ai, color: "text-amber-600" },
          { label: "Under Review", value: counts.under_review, color: "text-teal" },
          { label: "Approved", value: counts.approved, color: "text-emerald-600" },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-ink-faint">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filter === f ? "bg-teal text-white border-teal" : "border-line text-ink-soft hover:border-teal/40"
            }`}
          >
            {FILTER_LABELS[f]} {counts[f] > 0 && <span className="ml-1 opacity-70">({counts[f]})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Clock size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-ink-faint text-sm">No {filter === "all" ? "" : FILTER_LABELS[filter].toLowerCase()} applications</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-faint border-b border-line bg-canvas">
                <th className="text-left py-3 px-4">Applicant</th>
                <th className="text-left py-3 px-4">Contact / Purpose</th>
                <th className="text-left py-3 px-4">Loan Amount</th>
                <th className="text-left py-3 px-4">AI Verify</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Submitted</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <AppRow key={app.id} app={app} onReview={handleReview} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="bg-teal-soft border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <ShieldCheck size={16} className="text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800">
          <strong>AI-verified applications</strong> have passed biometric face matching, randomised liveness detection, and signature verification.
          These can be fast-tracked for approval. Applications showing &ldquo;Pending AI Verify&rdquo; require the customer to complete the AI KYC verification step.
        </p>
      </div>
    </div>
  );
}
