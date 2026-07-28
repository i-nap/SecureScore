"use client";

import { useEffect, useState } from "react";
import { getEODPreview, runEOD, runBOD, getEODLogs, type EODPreview, type EODResult, type EODLog } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { Sunrise, Sunset, Clock, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 }).format(n);
}

function fmtDT(s: string) {
  if (!s) return "--";
  try { return new Date(s).toLocaleString("en-NP"); } catch { return s; }
}

export default function EODPage() {
  const [preview, setPreview] = useState<EODPreview | null>(null);
  const [logs, setLogs] = useState<EODLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [eodRunning, setEodRunning] = useState(false);
  const [bodRunning, setBodRunning] = useState(false);
  const [lastResult, setLastResult] = useState<EODResult | null>(null);
  const [confirmEOD, setConfirmEOD] = useState(false);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([getEODPreview(), getEODLogs(20)]);
      setPreview(p);
      setLogs(l.logs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleEOD = async () => {
    setEodRunning(true); setError(""); setLastResult(null);
    try {
      const res = await runEOD();
      setLastResult(res);
      setConfirmEOD(false);
      loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "EOD failed");
    } finally {
      setEodRunning(false);
    }
  };

  const handleBOD = async () => {
    setBodRunning(true); setError(""); setLastResult(null);
    try {
      const res = await runBOD();
      setLastResult(res);
      loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "BOD failed");
    } finally {
      setBodRunning(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">EOD / BOD Processing</h1>
          <p className="text-sm text-ink-soft mt-0.5">End-of-Day and Beginning-of-Day banking operations</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw size={13} className="mr-1.5" />Refresh Preview
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Last result banner */}
      {lastResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <p className="font-bold text-emerald-800">{lastResult.process_type} Completed Successfully</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-emerald-700">
            {lastResult.process_type === "EOD" && (
              <>
                <span>Interest posted: <strong>{lastResult.interest_posted_count} accounts</strong></span>
                <span>Total interest: <strong>{fmt(lastResult.interest_posted_total)}</strong></span>
                <span>Dormant marked: <strong>{lastResult.dormant_marked_count}</strong></span>
                <span>FDs matured: <strong>{lastResult.fd_matured_count}</strong></span>
              </>
            )}
            {lastResult.process_type === "BOD" && (
              <>
                <span>Pending applications: <strong>{lastResult.pending_applications}</strong></span>
                <span>FDs due this week: <strong>{lastResult.fds_maturing_7_days?.length ?? 0}</strong></span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <Card>
          <h2 className="font-bold text-ink mb-4">EOD Preview &mdash; {preview.as_of}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard label="Accounts for Interest" value={String(preview.interest_eligible_accounts)} />
            <StatCard label="Projected Interest" value={fmt(preview.projected_interest_npr)} color="emerald" />
            <StatCard label="Dormant Candidates" value={String(preview.dormant_candidates)} color="amber" />
            <StatCard label="FDs Maturing Today" value={String(preview.fds_maturing_today)} color={preview.fds_maturing_today > 0 ? "red" : "default"} />
          </div>
          {preview.fds_maturing_today > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700">
                <strong>{preview.fds_maturing_today} FD(s)</strong> worth <strong>{fmt(preview.fds_maturing_today_value)}</strong> are due for maturity today. EOD will credit these automatically.
              </p>
            </div>
          )}
          {preview.fds_maturing_next_7_days > 0 && (
            <p className="text-xs text-ink-faint mt-2">
              <strong>{preview.fds_maturing_next_7_days}</strong> FD(s) maturing in the next 7 days.
            </p>
          )}
        </Card>
      )}

      {/* Action buttons */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* EOD Card */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-orange-100 rounded-xl">
              <Sunset size={22} className="text-orange-500" />
            </div>
            <div>
              <h3 className="font-bold text-ink">End-of-Day (EOD)</h3>
              <p className="text-xs text-ink-soft">Run after close of business</p>
            </div>
          </div>
          <ul className="text-sm text-ink-soft space-y-1 mb-4">
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Post daily interest on savings &amp; salary accounts</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Mark dormant accounts (no activity &gt; 12 months)</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Process matured fixed deposits</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Generate process log</li>
          </ul>

          {!confirmEOD ? (
            <Button onClick={() => setConfirmEOD(true)} className="w-full">
              <Sunset size={15} className="mr-1.5" />Run EOD Process
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-sm text-amber-700">
                <AlertTriangle size={14} className="inline mr-1.5" />
                <strong>Confirm:</strong> This will post interest and mature FDs. Cannot be undone.
              </div>
              <div className="flex gap-2">
                <Button onClick={handleEOD} disabled={eodRunning} className="flex-1">
                  {eodRunning ? <><Spinner size="sm" className="mr-2" />Running...</> : "Confirm & Run EOD"}
                </Button>
                <Button variant="outline" onClick={() => setConfirmEOD(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          )}
        </Card>

        {/* BOD Card */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-blue-100 rounded-xl">
              <Sunrise size={22} className="text-blue-500" />
            </div>
            <div>
              <h3 className="font-bold text-ink">Beginning-of-Day (BOD)</h3>
              <p className="text-xs text-ink-soft">Run at start of business</p>
            </div>
          </div>
          <ul className="text-sm text-ink-soft space-y-1 mb-4">
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Preview FDs maturing this week</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Check pending account applications</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Generate opening position report</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" />Log BOD run for audit trail</li>
          </ul>
          <Button variant="outline" onClick={handleBOD} disabled={bodRunning} className="w-full">
            {bodRunning ? <><Spinner size="sm" className="mr-2" />Running...</> : <><Sunrise size={15} className="mr-1.5" />Run BOD Process</>}
          </Button>

          {lastResult?.process_type === "BOD" && lastResult.fds_maturing_7_days && lastResult.fds_maturing_7_days.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-ink-soft uppercase">FDs Maturing This Week</p>
              {lastResult.fds_maturing_7_days.map(fd => (
                <div key={fd.fd_number} className="flex justify-between items-center p-2 bg-canvas rounded-lg text-sm">
                  <div>
                    <p className="font-mono font-medium text-ink">{fd.fd_number}</p>
                    <p className="text-xs text-ink-faint">{fd.customer} &bull; Due {fd.maturity_date?.split("T")[0]}</p>
                  </div>
                  <p className="font-bold text-ink">{fmt(fd.maturity_amount)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* EOD/BOD History */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-ink-soft" />
          <h2 className="font-bold text-ink">Process History</h2>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-ink-faint text-center py-6">No EOD/BOD runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-canvas border-b border-line">
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase">Type</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase">Run By</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase">Date &amp; Time</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase text-right">Interest</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase text-right">Dormant</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase text-right">FD Matured</th>
                  <th className="py-2 px-3 text-xs font-medium text-ink-faint uppercase text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-canvas">
                    <td className="py-2.5 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${log.process_type === "EOD" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-teal-deep"}`}>
                        {log.process_type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-sm text-ink-soft">{log.run_by || "--"}</td>
                    <td className="py-2.5 px-3 text-xs text-ink-soft">{fmtDT(log.started_at)}</td>
                    <td className="py-2.5 px-3 text-right text-sm text-ink">
                      {log.interest_posted_count > 0 ? <>{log.interest_posted_count} &bull; {fmt(log.interest_posted_total)}</> : "--"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-sm text-ink">{log.dormant_marked_count || "--"}</td>
                    <td className="py-2.5 px-3 text-right text-sm text-ink">
                      {log.fd_matured_count > 0 ? <>{log.fd_matured_count} &bull; {fmt(log.fd_matured_total)}</> : "--"}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant={log.status === "success" ? "success" : "warning"}>{log.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
