"use client";

import { useEffect, useState } from "react";
import { getSecurityAudit, type SecurityAudit } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { ShieldCheck, AlertTriangle, Info, RefreshCw, CheckCircle } from "lucide-react";

export default function SecurityAuditPage() {
  const [audit, setAudit] = useState<SecurityAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    getSecurityAudit()
      .then(setAudit)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const statusColor: Record<string, "success" | "warning" | "danger"> = {
    CLEAN: "success", MEDIUM_RISK: "warning", HIGH_RISK: "danger",
  };

  const alertIcon = (level: string) => {
    if (level === "warning") return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
    return <Info size={16} className="text-blue-500 shrink-0" />;
  };

  const alertBg = (level: string) =>
    level === "warning" ? "bg-amber-50 border-amber-200" : "bg-teal-soft border-blue-200";

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <div className="text-red-600 text-center py-10">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">Security Audit</h1>
          <p className="text-sm text-ink-soft mt-0.5">30-day account activity security review</p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw size={14} className="mr-1.5" />Refresh
        </Button>
      </div>

      {audit && (
        <>
          <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed
            {audit.status === 'CLEAN' ? 'border-emerald-300 bg-emerald-50' : audit.status === 'HIGH_RISK' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}">
            <div className={`p-2 rounded-full ${audit.status === "CLEAN" ? "bg-emerald-100" : audit.status === "HIGH_RISK" ? "bg-red-100" : "bg-amber-100"}`}>
              <ShieldCheck size={22} className={audit.status === "CLEAN" ? "text-emerald-600" : audit.status === "HIGH_RISK" ? "text-red-600" : "text-amber-600"} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-ink">Overall Status</p>
              <p className="text-xs text-ink-soft">Audited {audit.summary.accounts_reviewed} account(s) as of {new Date(audit.summary.audit_date).toLocaleString("en-NP")}</p>
            </div>
            <Badge variant={statusColor[audit.status]}>{audit.status.replace("_", " ")}</Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Transactions (30d)" value={String(audit.summary.total_transactions_30d)} />
            <StatCard label="Total Debits" value={`NPR ${(audit.summary.total_debits_30d / 1000).toFixed(1)}K`} color="red" />
            <StatCard label="Large Txns (>1L)" value={String(audit.summary.large_transactions)} color={audit.summary.large_transactions > 0 ? "amber" : "green"} />
            <StatCard label="Failed Txns" value={String(audit.summary.failed_transactions)} color={audit.summary.failed_transactions > 0 ? "red" : "green"} />
          </div>

          <Card>
            <h2 className="font-bold text-ink mb-4">Security Alerts</h2>
            {audit.alerts.length === 0 ? (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl">
                <CheckCircle size={20} className="text-emerald-600" />
                <p className="text-sm text-emerald-800 font-medium">No security concerns detected in the last 30 days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {audit.alerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${alertBg(a.level)}`}>
                    {alertIcon(a.level)}
                    <div>
                      <p className="text-sm font-medium text-ink">{a.message}</p>
                      <p className="text-xs text-ink-soft capitalize mt-0.5">{a.type.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="font-bold text-ink mb-3">Activity Breakdown</h2>
            <div className="space-y-3">
              {[
                { label: "Total Transactions", value: audit.summary.total_transactions_30d, icon: "📊" },
                { label: "Off-Hours Activity", value: audit.summary.off_hours_transactions, icon: "🌙" },
                { label: "Large Transactions", value: audit.summary.large_transactions, icon: "💰" },
                { label: "Failed Transactions", value: audit.summary.failed_transactions, icon: "❌" },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-line last:border-0">
                  <span className="text-sm text-ink-soft">{row.icon} {row.label}</span>
                  <span className="font-semibold text-ink">{row.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold text-ink mb-3 text-sm">Security Recommendations</h3>
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>• Enable two-factor authentication for added security</li>
              <li>• Review all large transactions — if not authorised, report immediately</li>
              <li>• Never share your OTP, password, or account number over phone or email</li>
              <li>• Contact branch if you notice any unfamiliar transactions</li>
              <li>• Helpline: 1800-100-0000 (24×7) or visit your nearest branch</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
