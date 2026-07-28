"use client";

import { useState, useRef, useEffect } from "react";
import { submitKYC, type KYCSubmitPayload, type KYCSubmitResult } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";
import { CheckCircle2, Upload, ChevronRight, ChevronLeft, Edit2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepData {
  // Step 1 — Personal Info
  full_name: string;
  date_of_birth: string;
  gender: string;
  citizenship_number: string;
  phone: string;
  email: string;
  // Step 2 — Documents (file names only; no actual upload)
  doc_citizenship_front: string;
  doc_citizenship_back: string;
  doc_passport_photo: string;
  // Step 3 — Address & Employment
  province: string;
  district: string;
  municipality: string;
  ward: string;
  employer_name: string;
  employment_type: string;
  monthly_income: string;
  years_employed: string;
  // Step 4 — Financial
  annual_income: string;
  existing_loans: string;
  collateral_description: string;
  collateral_value: string;
  loan_purpose: string;
  loan_amount_requested: string;
}

const EMPTY: StepData = {
  full_name: "", date_of_birth: "", gender: "", citizenship_number: "", phone: "", email: "",
  doc_citizenship_front: "", doc_citizenship_back: "", doc_passport_photo: "",
  province: "", district: "", municipality: "", ward: "",
  employer_name: "", employment_type: "", monthly_income: "", years_employed: "",
  annual_income: "", existing_loans: "0", collateral_description: "", collateral_value: "",
  loan_purpose: "", loan_amount_requested: "",
};

const STEP_LABELS = [
  "Personal Info",
  "Documents",
  "Address & Employment",
  "Financial Profile",
  "Review & Submit",
];

const NEPAL_PROVINCES = [
  "Koshi Province", "Madhesh Province", "Bagmati Province",
  "Gandaki Province", "Lumbini Province", "Karnali Province", "Sudurpashchim Province",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function required(val: string) { return val.trim().length > 0; }

function validateStep(step: number, data: StepData): string[] {
  const errs: string[] = [];
  if (step === 0) {
    if (!required(data.full_name)) errs.push("Full name is required");
    if (!required(data.date_of_birth)) errs.push("Date of birth is required");
    if (!required(data.gender)) errs.push("Gender is required");
    if (!required(data.citizenship_number)) errs.push("Citizenship number is required");
    if (!required(data.phone)) errs.push("Phone is required");
    if (!required(data.email)) errs.push("Email is required");
    if (data.email && !/\S+@\S+\.\S+/.test(data.email)) errs.push("Email format is invalid");
  }
  if (step === 1) {
    if (!required(data.doc_citizenship_front)) errs.push("Citizenship front photo is required");
    if (!required(data.doc_citizenship_back)) errs.push("Citizenship back photo is required");
    if (!required(data.doc_passport_photo)) errs.push("Passport photo is required");
  }
  if (step === 2) {
    if (!required(data.province)) errs.push("Province is required");
    if (!required(data.district)) errs.push("District is required");
    if (!required(data.municipality)) errs.push("Municipality is required");
    if (!required(data.ward)) errs.push("Ward is required");
    if (!required(data.employment_type)) errs.push("Employment type is required");
    if (!required(data.monthly_income) || isNaN(Number(data.monthly_income))) errs.push("Valid monthly income is required");
  }
  if (step === 3) {
    if (!required(data.loan_purpose)) errs.push("Loan purpose is required");
    if (!required(data.loan_amount_requested) || isNaN(Number(data.loan_amount_requested))) errs.push("Valid loan amount is required");
  }
  return errs;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center shrink-0">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${done ? "bg-emerald-500 border-emerald-500 text-white" : active ? "bg-teal border-teal text-white" : "bg-white border-gray-300 text-ink-faint"}
              `}>
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium mt-1 hidden sm:block text-center ${active ? "text-teal" : done ? "text-emerald-600" : "text-ink-faint"}`}>
                {label}
              </span>
            </div>
            {i < total - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-16px] sm:mt-[-20px] transition-all ${done ? "bg-emerald-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Document upload row ──────────────────────────────────────────────────────

function DocUploadRow({
  label,
  fieldKey,
  value,
  onChange,
}: {
  label: string;
  fieldKey: keyof StepData;
  value: string;
  onChange: (key: keyof StepData, val: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange(fieldKey, file.name);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-4 p-4 border border-line rounded-xl hover:border-teal/40 transition-colors">
      {/* Preview */}
      <div className="w-14 h-14 rounded-lg border border-line bg-canvas flex items-center justify-center overflow-hidden shrink-0">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="preview" className="w-full h-full object-cover" />
        ) : (
          <Upload size={20} className="text-gray-300" />
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-faint mt-0.5 truncate">{value || "No file selected"}</p>
      </div>
      {/* Actions */}
      <div className="flex items-center gap-2">
        {value && <CheckCircle2 size={16} className="text-emerald-500" />}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium bg-teal-soft text-teal-deep rounded-lg hover:bg-blue-100 transition-colors"
        >
          {value ? "Change" : "Upload"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = "text", placeholder, required: req, hint,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-soft mb-1">
        {label} {req && <span className="text-red-500">*</span>}
      </label>
      {children ? children : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        />
      )}
      {hint && <p className="text-[11px] text-ink-faint mt-1">{hint}</p>}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, required: req,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-soft mb-1">
        {label} {req && <span className="text-red-500">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white transition-all"
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── Review row ───────────────────────────────────────────────────────────────

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-2.5 pr-4 text-xs font-semibold text-ink-soft whitespace-nowrap w-48">{label}</td>
      <td className="py-2.5 text-sm text-ink">{value || <span className="text-gray-300 italic">—</span>}</td>
    </tr>
  );
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function Confetti() {
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
  const pieces = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((i) => {
        const color = colors[i % colors.length];
        const left = `${(i / pieces.length) * 100 + (Math.sin(i) * 3)}%`;
        const delay = `${(i % 8) * 0.15}s`;
        const duration = `${1.8 + (i % 5) * 0.3}s`;
        const size = `${8 + (i % 4) * 3}px`;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left,
              top: "-10px",
              width: size,
              height: size,
              backgroundColor: color,
              borderRadius: i % 3 === 0 ? "50%" : "2px",
              animation: `confetti-fall ${duration} ${delay} ease-in forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KYCOnboardingPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<StepData>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KYCSubmitResult | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Auto-calc annual income when monthly changes
  useEffect(() => {
    const monthly = parseFloat(data.monthly_income);
    if (!isNaN(monthly) && monthly > 0) {
      setData((d) => ({ ...d, annual_income: String(Math.round(monthly * 12)) }));
    }
  }, [data.monthly_income]);

  // Calc DTI live
  const dti = (() => {
    const income = parseFloat(data.annual_income);
    const loans = parseFloat(data.existing_loans);
    if (!isNaN(income) && income > 0 && !isNaN(loans) && loans > 0) {
      return ((loans * 12000) / income * 100).toFixed(1);
    }
    return "—";
  })();

  const update = (key: keyof StepData, val: string) =>
    setData((d) => ({ ...d, [key]: val }));

  const goNext = () => {
    const errs = validateStep(step, data);
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setStep((s) => s + 1);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const goBack = () => {
    setErrors([]);
    setStep((s) => s - 1);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const goToStep = (s: number) => {
    setErrors([]);
    setStep(s);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSubmit = async () => {
    const errs = validateStep(step, data);
    if (errs.length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const payload: KYCSubmitPayload = {
        full_name: data.full_name,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        citizenship_number: data.citizenship_number,
        phone: data.phone,
        email: data.email,
        province: data.province,
        district: data.district,
        municipality: data.municipality,
        ward: data.ward,
        employer_name: data.employer_name,
        employment_type: data.employment_type,
        monthly_income: parseFloat(data.monthly_income) || 0,
        years_employed: parseFloat(data.years_employed) || 0,
        annual_income: parseFloat(data.annual_income) || 0,
        existing_loans: parseInt(data.existing_loans) || 0,
        dti_ratio: parseFloat(dti) || 0,
        collateral_description: data.collateral_description,
        collateral_value: parseFloat(data.collateral_value) || 0,
        loan_purpose: data.loan_purpose,
        loan_amount_requested: parseFloat(data.loan_amount_requested) || 0,
      };
      const res = await submitKYC(payload);
      setResult(res);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3500);
    } catch (e: unknown) {
      setErrors([(e as Error).message || "Submission failed. Please try again."]);
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────
  if (result) {
    return (
      <>
        {showConfetti && <Confetti />}
        <div className="max-w-lg mx-auto mt-12 space-y-4">
          <Card className="text-center py-10 px-8">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-black text-ink mb-2">Application Submitted!</h2>
            <p className="text-ink-soft mb-6">Your KYC application has been received and is under review.</p>
            <div className="bg-teal-soft border border-blue-200 rounded-xl px-6 py-4 mb-4">
              <p className="text-xs text-teal font-semibold uppercase tracking-wide mb-1">Reference Number</p>
              <p className="text-2xl font-black text-teal-deep tracking-wider">{result.reference}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div className="bg-canvas rounded-xl p-3">
                <p className="text-xs text-ink-soft">Status</p>
                <p className="font-semibold text-amber-600 capitalize">{result.status.replace(/_/g, " ")}</p>
              </div>
              <div className="bg-canvas rounded-xl p-3">
                <p className="text-xs text-ink-soft">Processing Time</p>
                <p className="font-semibold text-ink">{result.estimated_processing}</p>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              Save your reference number. You will be notified when your application is processed.
            </p>
          </Card>

          {/* AI KYC next step */}
          <div className="bg-teal rounded-2xl px-6 py-5 text-white">
            <div className="flex items-start gap-4">
              <div className="text-3xl shrink-0">🛡️</div>
              <div className="flex-1">
                <p className="font-black text-lg mb-1">Complete AI Verification</p>
                <p className="text-indigo-200 text-sm mb-4">
                  Skip the branch visit entirely. Complete a 2-minute biometric check to fast-track your application to{" "}
                  <strong className="text-white">Under Review</strong> instantly.
                </p>
                <a
                  href={`/customer/kyc-verify?ref=${result.reference}`}
                  className="inline-flex items-center gap-2 bg-white text-teal-deep font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-teal-soft transition-colors"
                >
                  Start AI Verification →
                </a>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" ref={topRef}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-ink">KYC Onboarding</h1>
        <p className="text-ink-soft text-sm mt-1">Complete your Know Your Customer verification to apply for banking services.</p>
      </div>

      {/* AI KYC Verify banner */}
      <div className="mb-5 flex items-center justify-between gap-4 bg-teal-soft border border-indigo-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <p className="text-sm font-bold text-indigo-900">Skip the branch visit — try AI Verification</p>
            <p className="text-xs text-teal">Verify your identity instantly with our camera-based biometric system.</p>
          </div>
        </div>
        <a href="/customer/kyc-verify"
          className="shrink-0 px-4 py-2 bg-teal text-white text-xs font-bold rounded-xl hover:bg-teal-deep transition-colors whitespace-nowrap">
          AI Verify →
        </a>
      </div>

      <Card>
        <StepIndicator current={step} total={STEP_LABELS.length} />

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-xs font-bold text-red-700 mb-1">Please fix the following:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {errors.map((e, i) => <li key={i} className="text-xs text-red-600">{e}</li>)}
            </ul>
          </div>
        )}

        {/* ── Step 1: Personal Info ── */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-ink mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="Full Name" value={data.full_name} onChange={(v) => update("full_name", v)} placeholder="As on citizenship" required />
              </div>
              <Field label="Date of Birth" value={data.date_of_birth} onChange={(v) => update("date_of_birth", v)} type="date" required />
              <SelectField label="Gender" value={data.gender} onChange={(v) => update("gender", v)} options={["Male", "Female", "Other"]} required />
              <Field label="Citizenship Number" value={data.citizenship_number} onChange={(v) => update("citizenship_number", v)} placeholder="e.g. 12-345-6789" required />
              <Field label="Phone Number" value={data.phone} onChange={(v) => update("phone", v)} type="tel" placeholder="+977 98XXXXXXXX" required />
              <div className="sm:col-span-2">
                <Field label="Email Address" value={data.email} onChange={(v) => update("email", v)} type="email" placeholder="you@example.com" required />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Documents ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-base font-bold text-ink">Document Upload</h2>
              <p className="text-xs text-ink-faint mt-1">Files are processed locally and not stored on our servers.</p>
            </div>
            <DocUploadRow label="Citizenship — Front" fieldKey="doc_citizenship_front" value={data.doc_citizenship_front} onChange={update} />
            <DocUploadRow label="Citizenship — Back" fieldKey="doc_citizenship_back" value={data.doc_citizenship_back} onChange={update} />
            <DocUploadRow label="Passport Photo" fieldKey="doc_passport_photo" value={data.doc_passport_photo} onChange={update} />
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <Upload size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">Please ensure photos are clear and all text is readable. Blurry or cropped images may cause rejection.</p>
            </div>
          </div>
        )}

        {/* ── Step 3: Address & Employment ── */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-ink mb-4">Address &amp; Employment</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <SelectField label="Province" value={data.province} onChange={(v) => update("province", v)} options={NEPAL_PROVINCES} required />
              </div>
              <Field label="District" value={data.district} onChange={(v) => update("district", v)} placeholder="e.g. Kathmandu" required />
              <Field label="Municipality / VDC" value={data.municipality} onChange={(v) => update("municipality", v)} placeholder="e.g. Kathmandu Metro" required />
              <Field label="Ward No." value={data.ward} onChange={(v) => update("ward", v)} placeholder="e.g. 10" required />
              <Field label="Employer Name" value={data.employer_name} onChange={(v) => update("employer_name", v)} placeholder="Company or business name" />
              <SelectField label="Employment Type" value={data.employment_type} onChange={(v) => update("employment_type", v)} options={["Salaried", "Self-Employed", "Business", "Agriculture"]} required />
              <Field label="Monthly Income (NPR)" value={data.monthly_income} onChange={(v) => update("monthly_income", v)} type="number" placeholder="e.g. 50000" required />
              <Field label="Years Employed" value={data.years_employed} onChange={(v) => update("years_employed", v)} type="number" placeholder="e.g. 3.5" />
            </div>
          </div>
        )}

        {/* ── Step 4: Financial Profile ── */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-ink mb-4">Financial Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Annual Income (NPR)"
                value={data.annual_income}
                onChange={(v) => update("annual_income", v)}
                type="number"
                hint="Auto-calculated from monthly income. You may edit."
              />
              <Field label="Existing Loans (count)" value={data.existing_loans} onChange={(v) => update("existing_loans", v)} type="number" placeholder="0" />
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between px-4 py-3 bg-canvas rounded-xl border border-line">
                  <span className="text-xs font-semibold text-ink-soft">Estimated Debt-to-Income Ratio</span>
                  <span className={`text-sm font-bold ${dti !== "—" && parseFloat(dti) > 40 ? "text-red-600" : "text-emerald-600"}`}>{dti}{dti !== "—" ? "%" : ""}</span>
                </div>
              </div>
              <div className="sm:col-span-2">
                <Field label="Collateral Description" value={data.collateral_description} onChange={(v) => update("collateral_description", v)} placeholder="e.g. Residential land in Baneshwor, Kathmandu" />
              </div>
              <Field label="Collateral Value (NPR)" value={data.collateral_value} onChange={(v) => update("collateral_value", v)} type="number" placeholder="e.g. 5000000" />
              <SelectField label="Loan Purpose" value={data.loan_purpose} onChange={(v) => update("loan_purpose", v)} options={["Home", "Business", "Education", "Vehicle", "Personal", "Agriculture"]} required />
              <div className="sm:col-span-2">
                <Field label="Loan Amount Requested (NPR)" value={data.loan_amount_requested} onChange={(v) => update("loan_amount_requested", v)} type="number" placeholder="e.g. 2500000" required />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 5: Review ── */}
        {step === 4 && (
          <div>
            <h2 className="text-base font-bold text-ink mb-5">Review Your Application</h2>

            {[
              {
                title: "Personal Information",
                stepIdx: 0,
                rows: [
                  ["Full Name", data.full_name],
                  ["Date of Birth", data.date_of_birth],
                  ["Gender", data.gender],
                  ["Citizenship No.", data.citizenship_number],
                  ["Phone", data.phone],
                  ["Email", data.email],
                ],
              },
              {
                title: "Documents",
                stepIdx: 1,
                rows: [
                  ["Citizenship Front", data.doc_citizenship_front],
                  ["Citizenship Back", data.doc_citizenship_back],
                  ["Passport Photo", data.doc_passport_photo],
                ],
              },
              {
                title: "Address & Employment",
                stepIdx: 2,
                rows: [
                  ["Province", data.province],
                  ["District", data.district],
                  ["Municipality", data.municipality],
                  ["Ward", data.ward],
                  ["Employer", data.employer_name],
                  ["Employment Type", data.employment_type],
                  ["Monthly Income", data.monthly_income ? `NPR ${Number(data.monthly_income).toLocaleString()}` : ""],
                  ["Years Employed", data.years_employed],
                ],
              },
              {
                title: "Financial Profile",
                stepIdx: 3,
                rows: [
                  ["Annual Income", data.annual_income ? `NPR ${Number(data.annual_income).toLocaleString()}` : ""],
                  ["Existing Loans", data.existing_loans],
                  ["Est. DTI Ratio", dti !== "—" ? `${dti}%` : "—"],
                  ["Collateral", data.collateral_description],
                  ["Collateral Value", data.collateral_value ? `NPR ${Number(data.collateral_value).toLocaleString()}` : ""],
                  ["Loan Purpose", data.loan_purpose],
                  ["Loan Requested", data.loan_amount_requested ? `NPR ${Number(data.loan_amount_requested).toLocaleString()}` : ""],
                ],
              },
            ].map((section) => (
              <div key={section.title} className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">{section.title}</p>
                  <button
                    onClick={() => goToStep(section.stepIdx)}
                    className="flex items-center gap-1 text-xs text-teal hover:text-teal-deep font-medium"
                  >
                    <Edit2 size={11} />Edit
                  </button>
                </div>
                <div className="bg-canvas rounded-xl overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {section.rows.map(([label, value]) => (
                        <ReviewRow key={label} label={label} value={value} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-5 border-t border-line">
          <div>
            {step > 0 && (
              <Button variant="outline" onClick={goBack}>
                <ChevronLeft size={14} />Back
              </Button>
            )}
          </div>
          <div>
            {step < STEP_LABELS.length - 1 ? (
              <Button onClick={goNext}>
                Continue<ChevronRight size={14} />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? <><Spinner size="sm" />Submitting…</> : "Submit Application"}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
