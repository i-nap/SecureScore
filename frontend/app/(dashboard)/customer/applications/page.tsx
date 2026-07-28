"use client";

import { useEffect, useState } from "react";
import { getMyApplications, type AccountApplication } from "@/lib/api";
import { Card, Badge, Spinner, Button } from "@/components/ui";
import { Clock, CheckCircle2, XCircle, PlusCircle } from "lucide-react";

function statusBadge(status: string) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Pending Review</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={20} className="text-emerald-500" />;
  if (status === "rejected") return <XCircle size={20} className="text-red-500" />;
  return <Clock size={20} className="text-amber-500" />;
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<AccountApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getMyApplications()
      .then(r => setApps(r.applications))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">My Applications</h1>
          <p className="text-sm text-ink-soft mt-0.5">Track your account opening requests</p>
        </div>
        <Button onClick={() => window.location.href = "/customer/apply-account"}>
          <PlusCircle size={15} className="mr-1.5" />New Application
        </Button>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {apps.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Clock size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-ink-faint font-medium">No applications yet</p>
            <p className="text-sm text-ink-faint mt-1 mb-4">Apply for a savings, current, or salary account</p>
            <Button onClick={() => window.location.href = "/customer/apply-account"}>
              Apply Now
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {apps.map(app => (
            <Card key={app.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <StatusIcon status={app.status} />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-ink capitalize">{app.account_type} Account</p>
                      {statusBadge(app.status)}
                    </div>
                    <p className="text-xs text-ink-faint">
                      Application #{app.id} &bull; Applied {app.created_at ? new Date(app.created_at).toLocaleDateString("en-NP", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                    </p>
                    {app.purpose && <p className="text-sm text-ink-soft mt-1">Purpose: {app.purpose}</p>}
                    {app.initial_deposit > 0 && (
                      <p className="text-sm text-ink-soft">
                        Initial deposit: <span className="font-medium">NPR {app.initial_deposit.toLocaleString()}</span>
                      </p>
                    )}
                    {app.review_note && (
                      <div className={`mt-2 p-2 rounded-lg text-sm ${app.status === "rejected" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                        <span className="font-medium">Branch note: </span>{app.review_note}
                      </div>
                    )}
                    {app.status === "approved" && app.reviewed_at && (
                      <p className="text-xs text-ink-faint mt-1">
                        Approved {new Date(app.reviewed_at).toLocaleDateString("en-NP")}
                        {app.reviewed_by ? ` by ${app.reviewed_by}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                {app.status === "pending" && (
                  <div className="text-right">
                    <p className="text-xs text-amber-600 font-medium">Under Review</p>
                    <p className="text-xs text-ink-faint mt-0.5">Typically 1-2 business days</p>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
