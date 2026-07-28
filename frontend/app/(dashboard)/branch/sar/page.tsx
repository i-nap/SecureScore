"use client";
import { useState } from "react";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { branchGenerateSAR, type SARResult } from "@/lib/api";
import { FileText, AlertTriangle, Printer } from "lucide-react";

const SAMPLE_CUSTOMERS = [
  { id: "cust001", name: "Aarav Thapa", risk: "HIGH" },
  { id: "cust042", name: "Priya Shrestha", risk: "CRITICAL" },
  { id: "cust107", name: "Bikram Rana", risk: "HIGH" },
  { id: "cust231", name: "Sita Gurung", risk: "MEDIUM" },
];

function SARReport({ sar }: { sar: SARResult }) {
  return (
    <div id="sar-report" className="space-y-4 text-sm">
      <div className="border-2 border-gray-800 rounded-xl p-5 print:border-black">
        <div className="text-center mb-4">
          <p className="font-black text-lg">SUSPICIOUS ACTIVITY REPORT (SAR)</p>
          <p className="text-xs text-ink-soft">Nepal Rastra Bank — AMLD Directive 2078</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs border-t pt-4">
          <div><span className="font-bold text-ink-soft">SAR No:</span> {sar.sar_number}</div>
          <div><span className="font-bold text-ink-soft">Date:</span> {sar.report_date}</div>
          <div><span className="font-bold text-ink-soft">Branch:</span> {sar.branch_id}</div>
          <div><span className="font-bold text-ink-soft">Reporting Officer:</span> {sar.reporting_officer}</div>
        </div>
      </div>

      <Card className="border-red-200 bg-red-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-ink">Subject Information</h3>
          <Badge variant={sar.subject.risk_grade === "CRITICAL" ? "danger" : "warning"}>{sar.subject.risk_grade}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-ink-soft">Customer ID:</span> <span className="font-mono font-bold">{sar.subject.customer_id}</span></div>
          <div><span className="text-ink-soft">ML Risk Score:</span> <span className="font-bold text-red-700">{sar.ml_confidence.toFixed(1)}%</span></div>
          <div><span className="text-ink-soft">Detection:</span> {sar.detection_method}</div>
          <div><span className="text-ink-soft">NRB Required:</span> {sar.nrb_reporting_required ? "YES ✓" : "NO"}</div>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold text-ink mb-3 flex items-center gap-2"><AlertTriangle size={14} className="text-red-500" />Suspicious Transactions</h3>
        <table className="w-full text-xs">
          <thead><tr className="text-ink-faint border-b"><th className="text-left py-1.5">Date</th><th className="text-right py-1.5">Amount</th><th className="text-left py-1.5">Type</th><th className="text-left py-1.5">Suspicious Indicator</th></tr></thead>
          <tbody>
            {sar.suspicious_transactions.map((t, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2">{t.date}</td>
                <td className="py-2 text-right font-mono">NPR {t.amount.toLocaleString()}</td>
                <td className="py-2"><Badge variant="default">{t.type}</Badge></td>
                <td className="py-2 text-amber-700">{t.flag}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-bold"><td colSpan={2} className="text-right py-2">Total: NPR {sar.total_suspicious_amount.toLocaleString()}</td><td colSpan={2}></td></tr></tfoot>
        </table>
      </Card>

      <Card>
        <h3 className="font-bold text-ink mb-3">Risk Indicators</h3>
        <ul className="space-y-1.5">
          {sar.indicators.map((ind, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-ink">
              <AlertTriangle size={11} className="text-amber-500 shrink-0" />{ind}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="bg-canvas">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div><span className="font-bold text-ink-soft">Recommended Action:</span><p className="mt-1 text-ink font-medium">{sar.recommended_action}</p></div>
          <div><span className="font-bold text-ink-soft">Regulatory Reference:</span><p className="mt-1 text-ink-soft">{sar.regulatory_ref}</p></div>
        </div>
      </Card>
    </div>
  );
}

export default function SARPage() {
  const [selectedCID, setSelectedCID] = useState("");
  const [sar, setSar] = useState<SARResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!selectedCID) return;
    setLoading(true); setError(""); setSar(null);
    try { setSar(await branchGenerateSAR(selectedCID)); }
    catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><FileText size={22} className="text-teal" />SAR Generator</h1>
        <p className="text-sm text-ink-soft mt-1">Auto-generate Suspicious Activity Reports for flagged customers — NRB AMLD compliant.</p>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Select Customer to Report</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {SAMPLE_CUSTOMERS.map((c) => (
            <button key={c.id} onClick={() => setSelectedCID(c.id)}
              className={`flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all ${selectedCID === c.id ? "border-blue-500 bg-teal-soft" : "border-line hover:border-gray-300"}`}>
              <div>
                <p className="text-sm font-semibold text-ink">{c.name}</p>
                <p className="text-xs text-ink-faint font-mono">{c.id}</p>
              </div>
              <Badge variant={c.risk === "CRITICAL" ? "danger" : c.risk === "HIGH" ? "warning" : "default"}>{c.risk}</Badge>
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <input type="text" placeholder="Or enter customer ID manually…" value={selectedCID} onChange={(e) => setSelectedCID(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <Button onClick={generate} disabled={!selectedCID || loading}>
            {loading ? <><Spinner size="sm" />Generating…</> : <><FileText size={14} />Generate SAR</>}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </Card>

      {sar && (
        <>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => window.print()} className="print:hidden">
              <Printer size={14} /> Print SAR
            </Button>
          </div>
          <SARReport sar={sar} />
        </>
      )}
    </div>
  );
}
