"use client";

import { useEffect, useMemo, useState } from "react";
import {
  hqLoanDecisions,
  hqFingerprintDecisions,
  hqFraudAlerts,
  type LoanDecisionRecord,
  type HQFingerprintDecisionRecord,
  type FraudAlertRecord,
} from "@/lib/api";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";
import { RefreshCw, CreditCard, Fingerprint, AlertTriangle } from "lucide-react";

const GRADES = ["A", "B", "C", "D", "F"];
const SEVERITIES = ["low", "medium", "high"];

function formatDate(value: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function gradeBadge(grade?: string) {
  if (!grade) return <Badge>NA</Badge>;
  const variant = grade === "A" || grade === "B" ? "success" : grade === "C" ? "warning" : "danger";
  return <Badge variant={variant}>{grade}</Badge>;
}

function severityBadge(sev?: string) {
  if (!sev) return <Badge>NA</Badge>;
  const variant = sev === "high" ? "danger" : sev === "medium" ? "warning" : "success";
  return <Badge variant={variant}>{sev.toUpperCase()}</Badge>;
}

export default function HqRecordsPage() {
  const [branch, setBranch] = useState("");
  const [grade, setGrade] = useState("");
  const [severity, setSeverity] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loanRows, setLoanRows] = useState<LoanDecisionRecord[]>([]);
  const [hqRows, setHqRows] = useState<HQFingerprintDecisionRecord[]>([]);
  const [fraudRows, setFraudRows] = useState<FraudAlertRecord[]>([]);
  const [error, setError] = useState("");

  const loanFilters = useMemo(() => ({ branch, grade, date_from: dateFrom, date_to: dateTo, limit: 200 }), [
    branch,
    grade,
    dateFrom,
    dateTo,
  ]);
  const hqFilters = useMemo(() => ({ branch, grade, date_from: dateFrom, date_to: dateTo, limit: 200 }), [
    branch,
    grade,
    dateFrom,
    dateTo,
  ]);
  const fraudFilters = useMemo(() => ({ branch, severity, date_from: dateFrom, date_to: dateTo, limit: 200 }), [
    branch,
    severity,
    dateFrom,
    dateTo,
  ]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [loan, hq, fraud] = await Promise.all([
        hqLoanDecisions(loanFilters),
        hqFingerprintDecisions(hqFilters),
        hqFraudAlerts(fraudFilters),
      ]);
      setLoanRows(loan.records || []);
      setHqRows(hq.records || []);
      setFraudRows(fraud.records || []);
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to load records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanFilters, hqFilters, fraudFilters]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">HQ Records</h1>
          <p className="text-sm text-ink-soft mt-1">Cross-branch decision logs and fraud events.</p>
        </div>
        <Button variant="secondary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-ink-soft">Branch</label>
            <input
              type="text"
              placeholder="kathmandu"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-ink-soft">Grade</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              <option value="">All grades</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-soft">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-soft">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-ink-soft">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard size={16} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-ink">Loan Decisions</h2>
            </div>
            <span className="text-xs text-ink-faint">{loanRows.length} records</span>
          </div>
          {loading ? (
            <div className="py-10 flex justify-center"><Spinner /></div>
          ) : loanRows.length === 0 ? (
            <EmptyState message="No loan decisions found for the selected filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-ink-soft text-xs uppercase">
                  <tr>
                    <th className="text-left py-2">Time</th>
                    <th className="text-left py-2">Branch</th>
                    <th className="text-left py-2">Customer</th>
                    <th className="text-left py-2">Grade</th>
                    <th className="text-left py-2">Default Prob</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loanRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 text-ink-soft">{formatDate(row.requested_at)}</td>
                      <td className="py-2 text-ink capitalize">{row.branch}</td>
                      <td className="py-2 font-mono text-xs text-ink">{row.customer_id || "-"}</td>
                      <td className="py-2">{gradeBadge(row.risk_grade)}</td>
                      <td className="py-2 text-ink">{row.default_probability ? `${Math.round(row.default_probability * 100)}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Fingerprint size={16} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-ink">HQ Fingerprints</h2>
            </div>
            <span className="text-xs text-ink-faint">{hqRows.length} records</span>
          </div>
          {loading ? (
            <div className="py-10 flex justify-center"><Spinner /></div>
          ) : hqRows.length === 0 ? (
            <EmptyState message="No HQ fingerprints found for the selected filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-ink-soft text-xs uppercase">
                  <tr>
                    <th className="text-left py-2">Time</th>
                    <th className="text-left py-2">Branch</th>
                    <th className="text-left py-2">Fingerprint</th>
                    <th className="text-left py-2">HQ Grade</th>
                    <th className="text-left py-2">Branch Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {hqRows.map((row) => (
                    <tr key={row.fingerprint_id}>
                      <td className="py-2 text-ink-soft">{formatDate(row.created_at)}</td>
                      <td className="py-2 text-ink capitalize">{row.branch_id}</td>
                      <td className="py-2 font-mono text-xs text-ink">{row.fingerprint_id}</td>
                      <td className="py-2">{gradeBadge(row.hq_grade)}</td>
                      <td className="py-2">{gradeBadge(row.branch_adjusted_grade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <h2 className="text-sm font-semibold text-ink">Fraud Alerts</h2>
            </div>
            <span className="text-xs text-ink-faint">{fraudRows.length} records</span>
          </div>
          {loading ? (
            <div className="py-10 flex justify-center"><Spinner /></div>
          ) : fraudRows.length === 0 ? (
            <EmptyState message="No fraud alerts found for the selected filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-ink-soft text-xs uppercase">
                  <tr>
                    <th className="text-left py-2">Time</th>
                    <th className="text-left py-2">Branch</th>
                    <th className="text-left py-2">Customer</th>
                    <th className="text-left py-2">Severity</th>
                    <th className="text-left py-2">Metric</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fraudRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 text-ink-soft">{formatDate(row.detected_at)}</td>
                      <td className="py-2 text-ink capitalize">{row.branch}</td>
                      <td className="py-2 font-mono text-xs text-ink">{row.customer_id || "-"}</td>
                      <td className="py-2">{severityBadge(row.severity)}</td>
                      <td className="py-2 text-ink">{row.metric || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
