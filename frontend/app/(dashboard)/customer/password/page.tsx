"use client";

import { useState } from "react";
import { changePassword } from "@/lib/api";
import { Card, Button, Spinner } from "@/components/ui";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, ShieldCheck } from "lucide-react";

function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-line rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

function strength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["", "Weak", "Fair", "Good", "Strong", "Very Strong"];
  const colors = ["", "text-red-500", "text-orange-500", "text-amber-500", "text-emerald-500", "text-emerald-600"];
  return { score, label: labels[score] || "", color: colors[score] || "" };
}

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pw = strength(next);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setMsg({ ok: false, text: "Passwords do not match" }); return; }
    if (next.length < 8) { setMsg({ ok: false, text: "Password must be at least 8 characters" }); return; }
    setLoading(true); setMsg(null);
    try {
      const r = await changePassword({ current_password: current, new_password: next });
      setMsg({ ok: true, text: r.message });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to change password" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Change Password</h1>
        <p className="text-sm text-ink-soft mt-0.5">Update your account password securely</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-3 p-3 rounded-xl border ${msg.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          {msg.ok ? <CheckCircle size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-red-500" />}
          <p className={`text-sm ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>
        </div>
      )}

      <Card>
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-line">
          <div className="p-2 bg-teal-soft rounded-lg"><Lock size={18} className="text-teal" /></div>
          <div>
            <p className="font-semibold text-ink">Password Security</p>
            <p className="text-xs text-ink-soft">Choose a strong, unique password</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput label="Current Password" value={current} onChange={setCurrent} />
          <PasswordInput label="New Password" value={next} onChange={setNext} />

          {next.length > 0 && (
            <div>
              <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i <= pw.score ? (pw.score <= 2 ? "bg-red-400" : pw.score <= 3 ? "bg-amber-400" : "bg-emerald-500") : "bg-gray-200"}`} />
                ))}
              </div>
              <p className={`text-xs ${pw.color}`}>{pw.label}</p>
            </div>
          )}

          <PasswordInput label="Confirm New Password" value={confirm} onChange={setConfirm} />
          {mismatch && <p className="text-xs text-red-500">Passwords do not match</p>}

          <Button type="submit" className="w-full" disabled={loading || mismatch}>
            {loading ? <Spinner size="sm" /> : "Update Password"}
          </Button>
        </form>
      </Card>

      <Card>
        <h3 className="font-semibold text-ink mb-3 text-sm flex items-center gap-2">
          <ShieldCheck size={15} className="text-violet-500" />Password Tips
        </h3>
        <ul className="space-y-1.5 text-xs text-ink-soft">
          <li>• Use at least 8 characters</li>
          <li>• Mix uppercase, lowercase, numbers, and symbols</li>
          <li>• Avoid using your name, birthday, or phone number</li>
          <li>• Use a unique password not used elsewhere</li>
          <li>• Change your password every 90 days</li>
        </ul>
      </Card>
    </div>
  );
}
