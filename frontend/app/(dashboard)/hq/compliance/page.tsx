"use client";

import { useState } from "react";
import { Card, StatCard, Button, Badge, Spinner } from "@/components/ui";
import {
  hqComplianceReport,
  hqStatus,
  type NRBComplianceReport,
} from "@/lib/api";
import {
  Shield,
  FileText,
  CheckCircle2,
  XCircle,
  Download,
  Printer,
  RefreshCw,
  Lock,
  Database,
  AlertTriangle,
  TrendingUp,
  Link2,
} from "lucide-react";
import { useEffect } from "react";

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-line">
      <span className="text-teal">{icon}</span>
      <h3 className="text-sm font-bold text-ink uppercase tracking-wide">{title}</h3>
    </div>
  );
}

function PassFail({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-ink-soft">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
          <CheckCircle2 size={11} /> PASS
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
          <XCircle size={11} /> FAIL
        </span>
      )}
    </div>
  );
}


export default function CompliancePage() {
  const [maxRound, setMaxRound] = useState(5);
  const [selectedRound, setSelectedRound] = useState(1);
  const [report, setReport] = useState<NRBComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    hqStatus()
      .then((s) => {
        const cr = s.current_round || 5;
        setMaxRound(cr);
        setSelectedRound(cr);
      })
      .catch(() => {});
  }, []);

  async function generateReport() {
    setLoading(true);
    setError("");
    try {
      const r = await hqComplianceReport(selectedRound);
      setReport(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  function downloadJSON() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.report_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rounds = Array.from({ length: Math.max(maxRound, 1) }, (_, i) => i + 1);

  return (
    <div className="space-y-6 max-w-5xl">
      <style>{`@media print { aside, nav, .print\\:hidden { display: none !important; } }`}</style>
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">NRB Compliance Reports</h1>
          <p className="text-sm text-ink-soft mt-1">
            Generate Nepal Rastra Bank compliance documentation for each federated round.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Automated</Badge>
          <Badge variant="default">NRB Directive Compliant</Badge>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors print:hidden">
            <Printer size={14} /> Download / Print Report
          </button>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Federated Round</label>
            <select
              value={selectedRound}
              onChange={(e) => setSelectedRound(Number(e.target.value))}
              className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {rounds.map((r) => (
                <option key={r} value={r}>
                  Round {r}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={generateReport} disabled={loading}>
            {loading ? <Spinner size="sm" /> : <RefreshCw size={14} />}
            {loading ? "Generating..." : "Generate Report"}
          </Button>
          {report && (
            <>
              <Button variant="secondary" onClick={downloadJSON}>
                <Download size={14} /> Download JSON
              </Button>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer size={14} /> Print Report
              </Button>
            </>
          )}
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </Card>

      {/* Report document */}
      {report && (
        <div className="print:shadow-none">
          {/* Official document header */}
          <div className="bg-gradient-to-r from-[#0c1626] to-[#11203A] text-white rounded-t-2xl px-8 py-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-blue-200 text-xs font-medium uppercase tracking-widest mb-1">
                  Nepal Rastra Bank — Federated Banking Compliance
                </p>
                <h2 className="text-xl font-black">SecureScore Federated Banking Network</h2>
                <p className="text-blue-300 text-sm mt-1">
                  Compliance Report · Round {report.round_number} · {report.reporting_period}
                </p>
              </div>
              <div className="text-right">
                <p className="text-blue-200 text-xs">Reference Number</p>
                <p className="text-white font-mono font-bold text-sm">{report.report_id}</p>
                <p className="text-blue-300 text-xs mt-1">
                  {new Date(report.generated_at).toLocaleString("en-NP")}
                </p>
              </div>
            </div>
          </div>

          {/* Summary stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-line">
            {[
              {
                label: "Privacy Status",
                value: report.privacy_compliance.compliant ? "COMPLIANT" : "NON-COMPLIANT",
                color: report.privacy_compliance.compliant ? ("green" as const) : ("red" as const),
                icon: <Lock size={18} />,
              },
              {
                label: "Branches Participated",
                value: report.data_governance.branches_count.toString(),
                color: "blue" as const,
                icon: <Database size={18} />,
              },
              {
                label: "Byzantine Events",
                value: report.security_events.byzantine_attempts.toString(),
                color: report.security_events.byzantine_attempts === 0 ? ("green" as const) : ("red" as const),
                icon: <AlertTriangle size={18} />,
              },
              {
                label: "Model F1 Score",
                value: report.model_performance.global_f1.toFixed(3),
                color: "purple" as const,
                icon: <TrendingUp size={18} />,
              },
            ].map((s) => (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                icon={s.icon}
                color={s.color}
              />
            ))}
          </div>

          {/* Detail sections */}
          <div className="bg-white border border-t-0 border-line rounded-b-2xl p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Privacy Compliance */}
              <div>
                <SectionHeader icon={<Lock size={15} />} title="Privacy Compliance" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Mechanism</span>
                    <span className="font-medium text-ink">{report.privacy_compliance.mechanism}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">ε Consumed</span>
                    <span className="font-mono font-medium text-ink">
                      {report.privacy_compliance.epsilon_consumed.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">ε Budget</span>
                    <span className="font-mono font-medium text-ink">
                      {report.privacy_compliance.total_epsilon_budget.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">ε Remaining</span>
                    <span className="font-mono font-medium text-emerald-700">
                      {report.privacy_compliance.epsilon_remaining.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Clip Norm</span>
                    <span className="font-medium text-ink">{report.privacy_compliance.clip_norm}</span>
                  </div>
                  <PassFail ok={report.privacy_compliance.compliant} label="DP Budget Compliance" />
                </div>
              </div>

              {/* Data Governance */}
              <div>
                <SectionHeader icon={<Database size={15} />} title="Data Governance" />
                <div className="space-y-1 text-sm">
                  <PassFail ok={!report.data_governance.raw_data_centralized} label="No Raw Data Centralization" />
                  <PassFail ok={report.data_governance.data_stays_at_branch} label="Data Residency at Branch" />
                  <div className="mt-3">
                    <p className="text-xs text-ink-soft mb-2">
                      Branches Participated ({report.data_governance.branches_count})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {report.data_governance.branches_participated.map((b) => (
                        <span
                          key={b}
                          className="px-2 py-0.5 rounded-full text-xs bg-teal-soft text-teal-deep border border-teal/20 font-medium"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Security Events */}
              <div>
                <SectionHeader icon={<Shield size={15} />} title="Security Events" />
                <div className="space-y-1 text-sm">
                  <PassFail ok={report.security_events.byzantine_attempts === 0} label="Byzantine Attempts" />
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Blocked Submissions</span>
                    <span className="font-medium text-ink">{report.security_events.blocked_submissions}</span>
                  </div>
                  <PassFail ok={report.security_events.integrity_failures === 0} label="Integrity Failures" />
                </div>
              </div>

              {/* Model Performance */}
              <div>
                <SectionHeader icon={<TrendingUp size={15} />} title="Model Performance" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Global F1</span>
                    <span className="font-mono font-bold text-teal-deep">
                      {report.model_performance.global_f1.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Global Accuracy</span>
                    <span className="font-mono font-medium text-ink">
                      {report.model_performance.global_accuracy.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-ink-soft">Improvement vs Previous</span>
                    <span
                      className={`font-mono font-medium ${report.model_performance.improvement_vs_previous >= 0 ? "text-emerald-700" : "text-red-600"}`}
                    >
                      {report.model_performance.improvement_vs_previous >= 0 ? "+" : ""}
                      {report.model_performance.improvement_vs_previous.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Audit Chain */}
              <div className="md:col-span-2">
                <SectionHeader icon={<Link2 size={15} />} title="Audit Chain Integrity" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-xs text-ink-soft mb-1">Latest Hash</p>
                    <p className="font-mono text-xs text-ink truncate">{report.audit_chain.hash}</p>
                  </div>
                  <div className="flex items-center">
                    <PassFail ok={report.audit_chain.chain_valid} label="Chain Integrity" />
                  </div>
                  <div className="flex justify-between items-center bg-canvas rounded-xl px-4 py-3">
                    <span className="text-sm text-ink-soft">Total Events</span>
                    <span className="font-bold text-ink text-lg">{report.audit_chain.total_events}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* NRB Directives */}
            <div>
              <SectionHeader icon={<FileText size={15} />} title="NRB Directives Met" />
              <div className="flex flex-wrap gap-2">
                {report.nrb_directives_met.map((d) => (
                  <span
                    key={d}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                  >
                    <CheckCircle2 size={13} /> {d}
                  </span>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-line pt-4 flex items-center justify-between text-xs text-ink-faint">
              <span>{report.signed_by}</span>
              <span className="font-mono">{report.report_id}</span>
            </div>
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-ink-faint">
          <FileText size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Select a round and click Generate Report to view compliance data.</p>
        </div>
      )}
    </div>
  );
}
