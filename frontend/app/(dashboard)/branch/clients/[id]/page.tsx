"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getBranchClientDetail, verifyClientKYC, type ClientDetail } from "@/lib/api";
import { Card, Badge, Spinner, Button } from "@/components/ui";
import { User, CheckCircle, XCircle, Wallet, Clock, ArrowLeft } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string) {
  if (!s) return "--";
  try { return new Date(s).toLocaleDateString("en-NP", { day: "numeric", month: "short", year: "numeric" }); } catch { return s; }
}

function kycStatusColor(status: string) {
  if (status === "verified") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "rejected") return "bg-red-100 text-red-700 border-red-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

function accStatusBadge(status: string, isActive: boolean) {
  if (!isActive || status === "dormant") return <Badge variant="danger">Dormant</Badge>;
  return <Badge variant="success">Active</Badge>;
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kycNote, setKycNote] = useState("");
  const [kycLoading, setKycLoading] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    getBranchClientDetail(customerId)
      .then(setDetail)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  const handleKYC = async (status: "verified" | "rejected") => {
    setKycLoading(true);
    try {
      await verifyClientKYC(customerId, { status, notes: kycNote });
      setDetail(prev => prev ? { ...prev, kyc: { ...prev.kyc, kyc_status: status, notes: kycNote, verified_at: new Date().toISOString() } } : prev);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setKycLoading(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <div className="text-red-600 text-center py-10">{error}</div>;
  if (!detail) return null;

  const p = detail.profile;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => window.history.back()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-ink-soft" />
        </button>
        <div>
          <h1 className="text-2xl font-black text-ink">{p.full_name}</h1>
          <p className="text-sm text-ink-soft font-mono">{customerId}</p>
        </div>
      </div>

      {/* Profile + KYC row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Profile */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-violet-500" />
            <h2 className="font-bold text-ink">Profile</h2>
          </div>
          <div className="space-y-2">
            {[
              ["Full Name", p.full_name],
              ["Username", p.username],
              ["Date of Birth", fmtDate(p.date_of_birth)],
              ["Gender", p.gender || "--"],
              ["Nationality", p.nationality],
              ["National ID", p.national_id || "--"],
              ["Address", p.address || "--"],
              ["District", p.district || "--"],
              ["Province", p.province || "--"],
              ["Occupation", p.occupation || "--"],
              ["Annual Income", p.annual_income ? fmt(p.annual_income) : "--"],
              ["Member Since", fmtDate(p.created_at)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-xs text-ink-faint">{label}</span>
                <span className="text-sm text-ink font-medium text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* KYC */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-violet-500" />
              <h2 className="font-bold text-ink">KYC Verification</h2>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${kycStatusColor(detail.kyc.kyc_status)}`}>
              {detail.kyc.kyc_status.toUpperCase()}
            </span>
          </div>
          {detail.kyc.verified_at && (
            <div className="text-sm text-ink-soft mb-3">
              Last updated: {fmtDate(detail.kyc.verified_at)}
              {detail.kyc.verified_by && <span> by {detail.kyc.verified_by}</span>}
            </div>
          )}
          {detail.kyc.notes && (
            <div className="bg-canvas rounded-lg p-3 mb-4 text-sm text-ink-soft">{detail.kyc.notes}</div>
          )}
          <div className="space-y-3">
            <textarea
              rows={3}
              value={kycNote}
              onChange={e => setKycNote(e.target.value)}
              placeholder="KYC verification notes (optional)..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <div className="flex gap-2">
              <Button onClick={() => handleKYC("verified")} disabled={kycLoading} className="flex-1">
                {kycLoading ? <Spinner size="sm" /> : <><CheckCircle size={14} className="mr-1.5" />Verify KYC</>}
              </Button>
              <Button variant="danger" onClick={() => handleKYC("rejected")} disabled={kycLoading} className="flex-1">
                <XCircle size={14} className="mr-1.5" />Reject
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Accounts */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={16} className="text-violet-500" />
          <h2 className="font-bold text-ink">Accounts ({detail.accounts.length})</h2>
        </div>
        {detail.accounts.length === 0 ? (
          <p className="text-sm text-ink-faint py-4 text-center">No accounts at this branch.</p>
        ) : (
          <div className="space-y-3">
            {detail.accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between p-3 bg-canvas rounded-xl">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-mono text-sm font-medium text-ink">{acc.account_number}</p>
                    {accStatusBadge(acc.account_status ?? "active", acc.is_active ?? true)}
                  </div>
                  <p className="text-xs text-ink-faint capitalize">{acc.account_type} &bull; {acc.interest_rate}% p.a. &bull; Opened {fmtDate(acc.opened_at ?? "")}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-ink">{fmt(acc.balance)}</p>
                  <p className="text-xs text-ink-faint">{acc.currency}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Fixed Deposits */}
      {detail.fixed_deposits.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-violet-500" />
            <h2 className="font-bold text-ink">Fixed Deposits ({detail.fixed_deposits.length})</h2>
          </div>
          <div className="space-y-3">
            {detail.fixed_deposits.map(fd => {
              const isActive = fd.status === "ACTIVE";
              const maturity = fd.maturity_date ? new Date(fd.maturity_date) : null;
              const isOverdue = maturity && maturity < new Date() && isActive;
              return (
                <div key={fd.id} className={`p-3 rounded-xl border ${isOverdue ? "bg-red-50 border-red-200" : isActive ? "bg-teal-soft border-teal/20" : "bg-canvas border-line"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-medium text-ink">{fd.fd_number}</p>
                      <Badge variant={isActive ? "success" : "default"}>{fd.status}</Badge>
                      {isOverdue && <Badge variant="danger">Overdue</Badge>}
                    </div>
                    <p className="text-sm font-bold text-ink">{fmt(fd.principal)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-ink-soft">
                    <span>Rate: <strong>{fd.interest_rate}%</strong></span>
                    <span>Tenure: <strong>{fd.tenure_months}m</strong></span>
                    <span>Matures: <strong>{fmtDate(fd.maturity_date ?? "")}</strong></span>
                  </div>
                  <p className="text-xs text-ink-soft mt-1">Maturity Amount: <strong>{fmt(fd.maturity_amount)}</strong></p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
