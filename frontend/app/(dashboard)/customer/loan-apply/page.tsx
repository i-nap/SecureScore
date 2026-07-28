"use client";

import { useState } from "react";
import { Card, Button, Spinner, Badge } from "@/components/ui";
import { customerLoanApply, customerLoanHistory, type LoanApplyResult, type LoanRecord } from "@/lib/api";
import { CreditCard, Clock, CheckCircle2, XCircle, FileText, ChevronRight } from "lucide-react";
import { useEffect } from "react";

const PURPOSES = ["Home", "Business", "Education", "Vehicle", "Personal", "Agriculture"];
const COLLATERAL_TYPES = ["Land/Property", "Vehicle", "Gold/Jewelry", "Fixed Deposit", "None"];

function StatusBadge({ s }: { s: string }) {
  if (s === "approved" || s === "conditionally_approved") return <Badge variant="success">{s.replace(/_/g," ")}</Badge>;
  if (s === "under_review") return <Badge variant="warning">Under Review</Badge>;
  if (s === "rejected") return <Badge variant="danger">Rejected</Badge>;
  if (s === "disbursed") return <Badge variant="default">Disbursed</Badge>;
  if (s === "closed") return <Badge variant="default">Closed</Badge>;
  return <Badge variant="default">{s}</Badge>;
}

export default function LoanApplyPage() {
  const [form, setForm] = useState({ loan_purpose: "", loan_amount: "", tenure_months: "36", collateral_type: "Land/Property", collateral_value: "", monthly_income: "", notes: "" });
  const [result, setResult] = useState<LoanApplyResult | null>(null);
  const [history, setHistory] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    customerLoanHistory()
      .then((r) => setHistory(r.loans))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, []);

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    const errs: string[] = [];
    if (!form.loan_purpose) errs.push("Select a loan purpose");
    if (!form.loan_amount || isNaN(Number(form.loan_amount))) errs.push("Enter a valid loan amount");
    if (!form.monthly_income || isNaN(Number(form.monthly_income))) errs.push("Enter your monthly income");
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setLoading(true);
    try {
      const res = await customerLoanApply({
        loan_purpose: form.loan_purpose,
        loan_amount: Number(form.loan_amount),
        tenure_months: Number(form.tenure_months),
        collateral_type: form.collateral_type,
        collateral_value: Number(form.collateral_value) || 0,
        monthly_income: Number(form.monthly_income),
        notes: form.notes,
      });
      setResult(res);
    } catch (e: unknown) {
      setErrors([(e as Error).message || "Submission failed"]);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    const rejected = result.status === "rejected";
    return (
      <div className="max-w-lg mx-auto mt-8">
        <Card className="text-center py-10 px-8">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${rejected ? "bg-red-100" : result.status.includes("approved") ? "bg-emerald-100" : "bg-amber-100"}`}>
            {rejected ? <XCircle size={32} className="text-red-500" /> : result.status.includes("approved") ? <CheckCircle2 size={32} className="text-emerald-500" /> : <Clock size={32} className="text-amber-500" />}
          </div>
          <h2 className="text-xl font-black text-ink mb-2">{rejected ? "Application Not Approved" : "Application Submitted"}</h2>
          <p className="text-sm text-ink-soft mb-6">{result.decision_note}</p>

          {result.rejection_reason && result.rejection_reason.length > 0 && (
            <div className="text-left bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">Why & how to improve</p>
              <ul className="space-y-2">
                {result.rejection_reason.map((r, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-semibold text-ink">{r.impact}</span>
                    <span className="block text-xs text-ink-soft mt-0.5">→ {r.improvement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="bg-teal-soft rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-blue-500 font-semibold">Reference</p>
            <p className="text-xl font-black text-teal-deep">{result.reference}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-left">
            <div className="bg-canvas rounded-xl p-3"><p className="text-xs text-ink-faint">Amount</p><p className="font-bold">NPR {result.loan_amount.toLocaleString()}</p></div>
            <div className="bg-canvas rounded-xl p-3"><p className="text-xs text-ink-faint">EMI Estimate</p><p className="font-bold">NPR {result.emi_estimate.toLocaleString()}/mo</p></div>
            <div className="bg-canvas rounded-xl p-3"><p className="text-xs text-ink-faint">Credit Score Used</p><p className="font-bold">{result.credit_score_used}</p></div>
            <div className="bg-canvas rounded-xl p-3"><p className="text-xs text-ink-faint">LTV Ratio</p><p className={`font-bold ${result.ltv_ratio > 80 ? "text-red-600" : "text-emerald-600"}`}>{result.ltv_ratio}%</p></div>
          </div>
          <p className="text-xs text-ink-faint mt-5">Decision in {result.estimated_decision}</p>
          <Button className="mt-4" variant="outline" onClick={() => setResult(null)}>Apply for Another</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><CreditCard size={22} className="text-teal" />Loan Application</h1>
        <p className="text-sm text-ink-soft mt-1">Apply for a loan with instant AI credit assessment.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <h2 className="text-sm font-bold text-ink mb-5">Loan Details</h2>
            {errors.length > 0 && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3">
                {errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-ink-soft mb-1 block">Loan Purpose *</label>
                <div className="grid grid-cols-3 gap-2">
                  {PURPOSES.map((p) => (
                    <button key={p} onClick={() => update("loan_purpose", p)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${form.loan_purpose === p ? "bg-teal text-white border-teal" : "border-line text-ink-soft hover:border-teal/40"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {[
                { label: "Loan Amount (NPR) *", key: "loan_amount", type: "number", placeholder: "e.g. 1500000" },
                { label: "Monthly Income (NPR) *", key: "monthly_income", type: "number", placeholder: "e.g. 60000" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">{f.label}</label>
                  <input type={f.type} value={form[f.key as keyof typeof form]} onChange={(e) => update(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2.5 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Tenure (months)</label>
                  <select value={form.tenure_months} onChange={(e) => update("tenure_months", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-line text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {[12,24,36,48,60,84,120,180,240].map((t) => <option key={t} value={t}>{t} months</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Collateral Type</label>
                  <select value={form.collateral_type} onChange={(e) => update("collateral_type", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-line text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {COLLATERAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {form.collateral_type !== "None" && (
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Collateral Value (NPR)</label>
                  <input type="number" value={form.collateral_value} onChange={(e) => update("collateral_value", e.target.value)}
                    placeholder="e.g. 3000000"
                    className="w-full px-3 py-2.5 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-ink-soft mb-1 block">Additional Notes</label>
                <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} placeholder="Any additional information..."
                  className="w-full px-3 py-2.5 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <Button onClick={handleSubmit} disabled={loading} className="w-full">
                {loading ? <><Spinner size="sm" />Submitting…</> : <>Submit Application <ChevronRight size={14} /></>}
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {form.loan_amount && form.monthly_income && (
            <Card className="bg-teal-soft border-blue-200">
              <p className="text-xs font-bold text-teal uppercase tracking-wide mb-3">Quick Estimate</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-ink-soft">EMI ~</span><span className="font-bold">NPR {Math.round(Number(form.loan_amount)*0.0105).toLocaleString()}/mo</span></div>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">Income ratio</span><span className={`font-bold ${Number(form.loan_amount)*0.0105 / Number(form.monthly_income) > 0.5 ? "text-red-600" : "text-emerald-600"}`}>{Math.round(Number(form.loan_amount)*0.0105 / Number(form.monthly_income)*100)}%</span></div>
              </div>
            </Card>
          )}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <FileText size={14} className="text-ink-soft" />
              <h3 className="text-sm font-semibold text-ink">Previous Applications</h3>
            </div>
            {histLoading ? <Spinner /> : history.length === 0 ? <p className="text-xs text-ink-faint">No previous applications</p> : (
              <div className="space-y-2">
                {history.map((l) => (
                  <div key={l.reference} className="p-3 bg-canvas rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-ink">{l.purpose}</span>
                      <StatusBadge s={l.status} />
                    </div>
                    <p className="text-xs text-ink-soft">NPR {l.amount.toLocaleString()} · {l.applied_date}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
