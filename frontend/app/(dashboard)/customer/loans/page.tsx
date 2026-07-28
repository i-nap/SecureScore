"use client";

import { useEffect, useState } from "react";
import {
  listLoans, getLoan, disburseLoan, repayLoan, prepayLoan, forecloseLoan,
  getAccounts,
  type LoanSummary, type LoanDetail, type BankAccount,
} from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { Landmark, CreditCard, CalendarClock, CheckCircle2, AlertTriangle, ChevronDown, ShieldCheck } from "lucide-react";

const LOAN_TYPES = [
  { value: "home_loan", label: "Home Loan", rate: 10.0 },
  { value: "business_loan", label: "Business Loan", rate: 12.5 },
  { value: "personal_loan", label: "Personal Loan", rate: 16.0 },
  { value: "microfinance", label: "Microfinance", rate: 20.0 },
  { value: "agricultural", label: "Agricultural", rate: 8.0 },
];

const npr = (n: number) =>
  "NPR " + n.toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function statusVariant(s: string): "success" | "warning" | "danger" | "default" {
  if (s === "CLOSED" || s === "PAID") return "success";
  if (s === "OVERDUE") return "danger";
  if (s === "ACTIVE" || s === "PENDING") return "default";
  return "warning";
}

export default function LoansPage() {
  const [loans, setLoans] = useState<LoanSummary[] | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    Promise.all([listLoans(), getAccounts()])
      .then(([l, a]) => {
        setLoans(l.loans);
        setAccounts(a.accounts);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const runAction = async (loanNumber: string, action: () => Promise<{ message: string }>) => {
    setBusy(loanNumber);
    setNotice(null);
    setError(null);
    try {
      const r = await action();
      setNotice(r.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };
  const onRepay = (loanNumber: string, installmentNo?: number) => runAction(loanNumber, () => repayLoan(loanNumber, installmentNo));
  const onPrepay = (loanNumber: string, amount: number) => runAction(loanNumber, () => prepayLoan(loanNumber, amount));
  const onForeclose = (loanNumber: string) => {
    if (!confirm("Foreclose this loan? The full remaining balance will be debited now and the loan closed.")) return;
    runAction(loanNumber, () => forecloseLoan(loanNumber));
  };

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error && !loans) return <div className="text-danger p-6">{error}</div>;

  const active = (loans ?? []).filter((l) => l.status === "ACTIVE");
  const totalOutstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const totalOverdue = active.reduce((s, l) => s + l.overdue_installments, 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-teal">
              <Landmark size={18} />
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Loan accounts · Servicing</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">My Loans</h1>
            <p className="mt-1 text-white/55 text-sm">Disbursement, EMI schedule, and repayments — all on your branch ledger.</p>
          </div>
          <div className="text-right">
            <p className="font-display text-3xl font-semibold nums">{npr(totalOutstanding).replace("NPR ", "₨")}</p>
            <p className="text-white/50 text-xs mt-1">Outstanding across {active.length} active loan{active.length === 1 ? "" : "s"}</p>
            {totalOverdue > 0 && (
              <p className="text-red-300 text-xs mt-1 font-semibold">{totalOverdue} overdue installment{totalOverdue === 1 ? "" : "s"}</p>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
      {error && loans && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-danger px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Active loans */}
      {(loans ?? []).length === 0 ? (
        <EmptyState message="No loans yet. Apply for one below." />
      ) : (
        <div className="space-y-4">
          {loans!.map((l) => (
            <LoanRow key={l.loan_number} loan={l} busy={busy === l.loan_number}
              onRepay={(inst?: number) => onRepay(l.loan_number, inst)}
              onPrepay={(amt: number) => onPrepay(l.loan_number, amt)}
              onForeclose={() => onForeclose(l.loan_number)} />
          ))}
        </div>
      )}

      <NewLoan accounts={accounts} onDone={(msg) => { setNotice(msg); load(); }} onError={setError} />
    </div>
  );
}

function LoanRow({ loan, busy, onRepay, onPrepay, onForeclose }: {
  loan: LoanSummary; busy: boolean;
  onRepay: (installmentNo?: number) => void; onPrepay: (amount: number) => void; onForeclose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [prepayAmt, setPrepayAmt] = useState(0);
  const progress = loan.tenure_months > 0 ? (loan.paid_installments / loan.tenure_months) * 100 : 0;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try { setDetail(await getLoan(loan.loan_number)); } catch { /* schedule stays collapsed */ }
    }
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-teal-soft text-teal flex items-center justify-center"><CreditCard size={20} /></div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-ink">{titleCase(loan.loan_type)}</h3>
                <Badge variant={statusVariant(loan.status)}>{loan.status}</Badge>
                {loan.overdue_installments > 0 && <Badge variant="danger">{loan.overdue_installments} overdue</Badge>}
              </div>
              <p className="text-xs text-ink-faint font-mono mt-0.5">{loan.loan_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Outstanding</p>
              <p className="font-semibold text-ink nums">{npr(loan.outstanding)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">EMI</p>
              <p className="font-semibold text-ink nums">{npr(loan.emi)}</p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-soft mb-1.5">
            <span>{loan.paid_installments} / {loan.tenure_months} paid · {loan.interest_rate}% p.a.</span>
            {loan.next_due_date && loan.status === "ACTIVE" && (
              <span className="flex items-center gap-1"><CalendarClock size={12} /> Next due {loan.next_due_date}</span>
            )}
          </div>
          <div className="h-2 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-teal rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {loan.status === "ACTIVE" && (
            <>
              <Button onClick={() => onRepay()} loading={busy} size="sm">Pay next EMI</Button>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} value={prepayAmt || ""} onChange={(e) => setPrepayAmt(+e.target.value)}
                  placeholder="Prepay NPR" className="w-32 border border-line rounded-lg px-2.5 py-1.5 text-sm nums" />
                <Button onClick={() => prepayAmt > 0 && onPrepay(prepayAmt)} disabled={busy || prepayAmt <= 0} variant="secondary" size="sm">Prepay</Button>
              </div>
              <Button onClick={onForeclose} disabled={busy} variant="outline" size="sm">Foreclose</Button>
            </>
          )}
          <button onClick={toggle} className="inline-flex items-center gap-1 text-sm font-semibold text-teal hover:opacity-70 transition-opacity">
            Schedule <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-canvas/60 px-5 py-4 animate-fade-in">
          {!detail ? (
            <div className="flex justify-center py-4"><Spinner size="sm" /></div>
          ) : (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Term label="Purpose" value={detail.purpose || "—"} />
              <Term label="Total interest" value={npr(detail.total_interest)} />
              <Term label="Collateral" value={detail.collateral_value > 0 ? npr(detail.collateral_value) : "Unsecured"} />
              <Term label="Guarantor" value={detail.has_guarantor ? "Yes" : "No"} icon={detail.has_guarantor ? <ShieldCheck size={13} className="text-teal" /> : undefined} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm nums">
                <thead>
                  <tr className="text-ink-faint text-xs uppercase tracking-wide text-left">
                    <th className="py-1.5 pr-3 font-semibold">#</th>
                    <th className="py-1.5 pr-3 font-semibold">Due</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">EMI</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Principal</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Interest</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Balance</th>
                    <th className="py-1.5 pr-3 font-semibold">Status</th>
                    <th className="py-1.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.schedule.map((r) => (
                    <tr key={r.installment_no} className="border-t border-line/70 text-ink-soft">
                      <td className="py-1.5 pr-3">{r.installment_no}</td>
                      <td className="py-1.5 pr-3">{r.due_date}</td>
                      <td className="py-1.5 pr-3 text-right">{r.emi.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.principal.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.interest.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.balance_after.toFixed(2)}</td>
                      <td className="py-1.5 pr-3"><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
                      <td className="py-1.5 text-right">
                        {loan.status === "ACTIVE" && r.status !== "PAID" && (
                          <button onClick={() => onRepay(r.installment_no)} disabled={busy}
                            className="text-xs font-semibold text-teal hover:opacity-70 disabled:opacity-40">Pay</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Term({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="text-sm font-semibold text-ink flex items-center gap-1 mt-0.5">{icon}{value}</p>
    </div>
  );
}

function NewLoan({ accounts, onDone, onError }: { accounts: BankAccount[]; onDone: (msg: string) => void; onError: (e: string) => void }) {
  const [account, setAccount] = useState("");
  const [principal, setPrincipal] = useState(500000);
  const [tenure, setTenure] = useState(60);
  const [loanType, setLoanType] = useState("personal_loan");
  const [purpose, setPurpose] = useState("");
  const [collateral, setCollateral] = useState(0);
  const [guarantor, setGuarantor] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account && accounts.length) setAccount(accounts[0].account_number);
  }, [accounts, account]);

  const rate = LOAN_TYPES.find((t) => t.value === loanType)?.rate ?? 12;
  // Live EMI estimate (reducing-balance) so the figure matches the server.
  const r = rate / 12 / 100;
  const estEmi = r === 0 ? principal / tenure : (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);

  const submit = async () => {
    if (!account) { onError("Choose a disbursement account."); return; }
    setBusy(true);
    try {
      const res = await disburseLoan({
        account_number: account, principal, tenure_months: tenure, loan_type: loanType,
        purpose, collateral_value: collateral, has_guarantor: guarantor,
      });
      onDone(res.message);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Disbursement failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold text-ink mb-1">Apply for a loan</h2>
      <p className="text-sm text-ink-soft mb-4">Approved instantly for the demo and disbursed to your account. Repay from the schedule above.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Loan type">
          <select value={loanType} onChange={(e) => setLoanType(e.target.value)} className="input">
            {LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} · {t.rate}% p.a.</option>)}
          </select>
        </Field>
        <Field label="Disbursement account">
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="input">
            {accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.account_type} · {a.account_number}</option>)}
          </select>
        </Field>
        <Field label={`Amount — ${npr(principal)}`}>
          <input type="range" min={10000} max={5000000} step={10000} value={principal} onChange={(e) => setPrincipal(+e.target.value)} className="w-full accent-teal" />
        </Field>
        <Field label={`Tenure — ${tenure} months`}>
          <input type="range" min={3} max={240} step={3} value={tenure} onChange={(e) => setTenure(+e.target.value)} className="w-full accent-teal" />
        </Field>
        <Field label="Purpose">
          <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Home renovation" className="input" />
        </Field>
        <Field label="Collateral value (NPR)">
          <input type="number" min={0} step={50000} value={collateral} onChange={(e) => setCollateral(+e.target.value)} className="input" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
        <input type="checkbox" checked={guarantor} onChange={(e) => setGuarantor(e.target.checked)} className="accent-teal w-4 h-4" />
        Guarantor provided
      </label>
      <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-ink-soft">
          Estimated EMI <span className="font-semibold text-ink nums">{npr(estEmi)}</span> · Total <span className="font-semibold text-ink nums">{npr(estEmi * tenure)}</span>
        </div>
        <Button onClick={submit} loading={busy}>Disburse loan</Button>
      </div>
      <style jsx>{`
        .input { width: 100%; border: 1px solid var(--line, #e6e9ef); border-radius: 0.75rem; background: #fff; padding: 0.625rem 0.75rem; font-size: 0.875rem; color: var(--ink, #11203a); outline: none; }
      `}</style>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-ink-soft mb-1.5">{label}</span>
      {children}
    </label>
  );
}
