"use client";

import { useState } from "react";
import { applyForAccount } from "@/lib/api";
import { Card, Button, Spinner } from "@/components/ui";
import { CheckCircle, Wallet, Building2, DollarSign } from "lucide-react";

const ACCOUNT_TYPES = [
  {
    id: "savings",
    label: "Savings Account",
    description: "Earn 5% p.a. interest. Minimum balance NPR 1,000.",
    icon: Wallet,
    color: "violet",
    rate: "5.0%",
    minBal: "NPR 1,000",
  },
  {
    id: "current",
    label: "Current Account",
    description: "No interest. No minimum balance. Unlimited transactions.",
    icon: Building2,
    color: "blue",
    rate: "0%",
    minBal: "None",
  },
  {
    id: "salary",
    label: "Salary Account",
    description: "Earn 4.5% p.a. Interest. Designed for salaried employees.",
    icon: DollarSign,
    color: "emerald",
    rate: "4.5%",
    minBal: "None",
  },
] as const;

function fmt(n: number) {
  return new Intl.NumberFormat("ne-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 0 }).format(n);
}

export default function ApplyAccountPage() {
  const [step, setStep] = useState<"type" | "details" | "success">("type");
  const [selectedType, setSelectedType] = useState<"savings" | "current" | "salary" | null>(null);
  const [purpose, setPurpose] = useState("");
  const [initialDeposit, setInitialDeposit] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ application_id: number; message: string } | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!selectedType) return;
    setLoading(true);
    setError("");
    try {
      const deposit = parseFloat(initialDeposit) || 0;
      if (selectedType === "savings" && deposit < 1000) {
        setError("Savings account requires a minimum initial deposit of NPR 1,000.");
        return;
      }
      const res = await applyForAccount({ account_type: selectedType, purpose, initial_deposit: deposit });
      setResult(res);
      setStep("success");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setLoading(false);
    }
  };

  if (step === "success" && result) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <div className="text-center py-8">
            <CheckCircle size={56} className="text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-ink mb-2">Application Submitted!</h2>
            <p className="text-ink-soft mb-4">{result.message}</p>
            <div className="bg-canvas rounded-xl p-4 mb-6">
              <p className="text-xs text-ink-faint mb-1">Application Reference</p>
              <p className="text-2xl font-mono font-bold text-teal">#{result.application_id}</p>
            </div>
            <p className="text-sm text-ink-faint mb-6">
              A branch officer will review your application and you&apos;ll receive your account number once approved.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => window.location.href = "/customer/applications"}>
                Track Application
              </Button>
              <Button onClick={() => { setStep("type"); setSelectedType(null); setResult(null); setPurpose(""); setInitialDeposit(""); }}>
                Apply for Another
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Open a New Account</h1>
        <p className="text-sm text-ink-soft mt-0.5">Choose an account type and submit your application for branch review.</p>
      </div>

      {/* Step 1: Select type */}
      <Card>
        <h2 className="font-bold text-ink mb-4 flex items-center gap-2">
          <span className="w-6 h-6 bg-teal text-white rounded-full flex items-center justify-center text-xs font-black">1</span>
          Select Account Type
        </h2>
        <div className="grid gap-3">
          {ACCOUNT_TYPES.map(t => {
            const Icon = t.icon;
            const isSelected = selectedType === t.id;
            const colorMap: Record<string, string> = {
              violet: "border-violet-400 bg-teal-soft ring-violet-300",
              blue:   "border-blue-400 bg-teal-soft ring-blue-300",
              emerald:"border-emerald-400 bg-emerald-50 ring-emerald-300",
            };
            return (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all ${isSelected ? colorMap[t.color] + " ring-2" : "border-line bg-white hover:border-gray-300"}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${isSelected ? "bg-white" : "bg-gray-100"}`}>
                    <Icon size={20} className={isSelected ? "text-teal" : "text-ink-soft"} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-ink">{t.label}</p>
                      {isSelected && <CheckCircle size={18} className="text-emerald-500" />}
                    </div>
                    <p className="text-sm text-ink-soft mt-0.5">{t.description}</p>
                    <div className="flex gap-4 mt-2">
                      <span className="text-xs text-ink-faint">Interest: <strong>{t.rate}</strong></span>
                      <span className="text-xs text-ink-faint">Min Balance: <strong>{t.minBal}</strong></span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Step 2: Details */}
      {selectedType && (
        <Card>
          <h2 className="font-bold text-ink mb-4 flex items-center gap-2">
            <span className="w-6 h-6 bg-teal text-white rounded-full flex items-center justify-center text-xs font-black">2</span>
            Account Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Purpose / Reason (optional)</label>
              <input
                type="text"
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. Personal savings, Business operations..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Initial Deposit (NPR)
                {selectedType === "savings" && <span className="text-red-500 ml-1">*minimum 1,000</span>}
              </label>
              <input
                type="number"
                value={initialDeposit}
                onChange={e => setInitialDeposit(e.target.value)}
                placeholder={selectedType === "savings" ? "Minimum 1,000" : "Optional"}
                min={selectedType === "savings" ? 1000 : 0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              {initialDeposit && !isNaN(parseFloat(initialDeposit)) && parseFloat(initialDeposit) > 0 && (
                <p className="text-xs text-ink-faint mt-1">= {fmt(parseFloat(initialDeposit))}</p>
              )}
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

            <div className="pt-2">
              <Button onClick={handleSubmit} disabled={loading} className="w-full">
                {loading ? <><Spinner size="sm" className="mr-2" />Submitting...</> : "Submit Application"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm font-medium text-amber-800 mb-1">What happens next?</p>
        <ol className="text-sm text-amber-700 space-y-1 list-decimal list-inside">
          <li>Your application is sent to the branch manager for review.</li>
          <li>Branch verifies your KYC and application details.</li>
          <li>Upon approval, your account number is generated instantly.</li>
          <li>Visit &apos;My Applications&apos; to track the status.</li>
        </ol>
      </div>
    </div>
  );
}
