"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button, Spinner } from "@/components/ui";
import { Shield, Zap, Globe, ArrowRight } from "lucide-react";

const DEMO_ACCOUNTS = [
  { username: "admin", password: "admin123", label: "HQ Admin", description: "Full network oversight" },
  { username: "kathmandu_mgr", password: "branch123", label: "Branch Manager (Kathmandu)", description: "Urban branch" },
  { username: "sarlahi_mgr", password: "branch123", label: "Branch Manager (Sarlahi)", description: "Rural branch" },
  { username: "cust001", password: "customer123", label: "Customer (Kathmandu)", description: "Urban customer" },
  { username: "cust002", password: "customer123", label: "Customer (Sarlahi)", description: "Rural customer" },
];

// Signature element: a federated constellation. Outer nodes = branches that keep
// their data; the centre = HQ that only ever receives model weights.
const NODES = [
  { x: 18, y: 22 }, { x: 78, y: 16 }, { x: 88, y: 52 }, { x: 70, y: 84 },
  { x: 30, y: 80 }, { x: 10, y: 56 }, { x: 50, y: 10 }, { x: 50, y: 90 },
];
const CENTER = { x: 50, y: 50 };

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    if (user) {
      const landing: Record<string, string> = {
        admin: "/hq/dashboard",
        ceo: "/hq/executive",
        it_admin: "/hq/it-console",
        branch_manager: "/branch/dashboard",
        cashier: "/cashier/teller",
        customer: "/customer/dashboard",
        viewer: "/hq/analytics",
      };
      router.push(landing[user.role] ?? "/customer/dashboard");
    }
  }, [user, router]);

  const handleLogin = async (u?: string, p?: string) => {
    const un = u || username;
    const pw = p || password;
    if (!un || !pw) return;
    setLoggingIn(true);
    setError("");
    try {
      await login(un, pw);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Left panel — brand thesis */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-[#0c1626] text-white p-12 flex-col justify-between">
        {/* Constellation signature */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.5]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {NODES.map((n, i) => (
            <line key={i} x1={CENTER.x} y1={CENTER.y} x2={n.x} y2={n.y}
              stroke="#0E7C66" strokeWidth="0.25" strokeOpacity="0.5" />
          ))}
          {NODES.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r="0.9" fill="#3aa589">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="3.2s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
            </circle>
          ))}
          <circle cx={CENTER.x} cy={CENTER.y} r="2.2" fill="#B8860B" />
          <circle cx={CENTER.x} cy={CENTER.y} r="2.2" fill="none" stroke="#B8860B" strokeWidth="0.4">
            <animate attributeName="r" values="2.2;6;2.2" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0;0.7" dur="3.6s" repeatCount="indefinite" />
          </circle>
        </svg>

        <div className="relative">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal/90 bg-teal/10 ring-1 ring-teal/20 rounded-full px-3 py-1">
            Federated · Privacy-preserving
          </span>
          <h1 className="font-display text-5xl font-semibold tracking-tight mt-6 leading-[1.05]">
            Credit scoring<br />that never moves<br />your data.
          </h1>
          <p className="mt-5 text-white/60 text-lg max-w-md leading-relaxed">
            Thirteen branches train locally. Only model weights travel to HQ —
            raw customer records never cross a branch boundary.
          </p>
        </div>

        <div className="relative space-y-5">
          <Feature icon={<Shield size={20} />} title="Privacy-preserving" desc="Differential privacy + mTLS. Data stays on-branch by design." />
          <Feature icon={<Zap size={20} />} title="Real-time scoring" desc="Local XGBoost, aggregated via Byzantine-robust FedAvg." />
          <Feature icon={<Globe size={20} />} title="13 branches" desc="Kathmandu to Sarlahi — urban, semi-urban, and rural." />
        </div>
      </div>

      {/* Right panel — sign in */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-8 animate-fade-up">
          <div>
            <p className="lg:hidden font-display text-2xl font-semibold text-ink">SecureScore</p>
            <h2 className="font-display text-3xl font-semibold text-ink tracking-tight">Welcome back</h2>
            <p className="mt-1.5 text-sm text-ink-soft">Sign in, or pick a demo account below.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
            <Field label="Username">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition-shadow focus:ring-2 focus:ring-teal/40 focus:border-teal"
                placeholder="e.g. admin"
                autoComplete="username"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition-shadow focus:ring-2 focus:ring-teal/40 focus:border-teal"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
            {error && (
              <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>
            )}
            <Button type="submit" disabled={loggingIn} size="lg" className="w-full">
              {loggingIn ? <Spinner size="sm" className="text-white" /> : <>Sign in <ArrowRight size={16} /></>}
            </Button>
          </form>

          <div>
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-[0.1em] mb-3">Demo quick login</p>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  onClick={() => handleLogin(acc.username, acc.password)}
                  disabled={loggingIn}
                  className="group flex items-center justify-between px-4 py-3 rounded-xl border border-line bg-surface hover:border-teal hover:bg-teal-soft/40 transition-colors text-left disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">{acc.label}</p>
                    <p className="text-xs text-ink-faint">{acc.description}</p>
                  </div>
                  <span className="text-xs text-ink-faint font-mono group-hover:text-teal transition-colors">{acc.username}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="shrink-0 w-10 h-10 rounded-xl bg-white/[0.06] ring-1 ring-white/10 flex items-center justify-center text-teal">{icon}</div>
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-sm text-white/55 leading-snug">{desc}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-soft mb-1.5">{label}</span>
      {children}
    </label>
  );
}
