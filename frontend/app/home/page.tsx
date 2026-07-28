"use client";

import Link from "next/link";
import {
  Shield,
  Zap,
  Globe,
  Lock,
  Network,
  LineChart,
  ArrowRight,
  Check,
  Building2,
  Landmark,
  User,
  ShieldCheck,
  FileCheck,
  ServerCog,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui";

// Reuse the federated constellation motif from the sign-in screen so the
// marketing page and the product feel like one identity.
const NODES = [
  { x: 18, y: 22 }, { x: 78, y: 16 }, { x: 88, y: 52 }, { x: 70, y: 84 },
  { x: 30, y: 80 }, { x: 10, y: 56 }, { x: 50, y: 10 }, { x: 50, y: 90 },
];
const CENTER = { x: 50, y: 50 };

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-xl font-semibold tracking-tight">SecureScore</span>
          <nav className="hidden items-center gap-8 text-sm text-ink-soft md:flex">
            <a href="#how" className="hover:text-ink transition-colors">How it works</a>
            <a href="#features" className="hover:text-ink transition-colors">Features</a>
            <a href="#network" className="hover:text-ink transition-colors">Network</a>
          </nav>
          <Link href="/">
            <Button size="sm">Sign in <ArrowRight size={15} /></Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0c1626] text-white">
        <svg className="absolute inset-0 h-full w-full opacity-[0.55]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {NODES.map((n, i) => (
            <line key={`l${i}`} x1={CENTER.x} y1={CENTER.y} x2={n.x} y2={n.y} stroke="#0E7C66" strokeWidth="0.2" strokeOpacity="0.5" />
          ))}
          {NODES.map((n, i) => (
            <circle key={`c${i}`} cx={n.x} cy={n.y} r="0.9" fill="#3aa589">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="3.2s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
            </circle>
          ))}
          <circle cx={CENTER.x} cy={CENTER.y} r="2.2" fill="#B8860B" />
          <circle cx={CENTER.x} cy={CENTER.y} r="2.2" fill="none" stroke="#B8860B" strokeWidth="0.4">
            <animate attributeName="r" values="2.2;6;2.2" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0;0.7" dur="3.6s" repeatCount="indefinite" />
          </circle>
        </svg>

        <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="max-w-2xl animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-teal/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal/90 ring-1 ring-teal/20">
              Federated · Privacy-preserving
            </span>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Credit scoring that never moves your data.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/60">
              Thirteen branches across Nepal train credit models locally. Only model
              weights travel to HQ — raw customer records never cross a branch boundary.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/">
                <Button size="lg">Get started <ArrowRight size={16} /></Button>
              </Link>
              <a href="#how">
                <Button size="lg" variant="ghost" className="text-white ring-1 ring-white/20 hover:bg-white/10">
                  See how it works
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section id="network" className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 md:grid-cols-4">
          {[
            { k: "13", v: "Bank branches" },
            { k: "0", v: "Records leave branch" },
            { k: "< 200ms", v: "Scoring latency" },
            { k: "ε-DP", v: "Differential privacy" },
          ].map((s) => (
            <div key={s.v} className="py-10 text-center">
              <p className="nums font-display text-4xl font-semibold text-ink">{s.k}</p>
              <p className="mt-1 text-sm text-ink-faint">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Bank-grade lending, without the data-sharing risk.
        </h2>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            { icon: <Shield size={22} />, t: "Privacy-preserving", d: "Differential privacy plus mutual-TLS. Customer data stays on-branch by design, not by policy." },
            { icon: <Network size={22} />, t: "Federated learning", d: "Local XGBoost models aggregated at HQ via Byzantine-robust FedAvg — resilient to poisoned updates." },
            { icon: <Zap size={22} />, t: "Real-time scoring", d: "Instant loan decisioning at the teller window, backed by the latest network-wide model." },
            { icon: <Lock size={22} />, t: "Auditable & secure", d: "Every model round is logged and signed. Full lineage from branch training to HQ aggregation." },
            { icon: <LineChart size={22} />, t: "Fairness monitoring", d: "Continuous checks across urban, semi-urban, and rural cohorts to keep scoring equitable." },
            { icon: <Globe size={22} />, t: "Built for Nepal", d: "From Kathmandu to Sarlahi — designed for uneven connectivity and offline-tolerant edge nodes." },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-line bg-surface p-7 shadow-card transition-shadow hover:shadow-lift">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-soft text-teal">{f.icon}</div>
              <h3 className="mt-5 font-display text-lg font-semibold text-ink">{f.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">How it works</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              { n: "01", t: "Train on-branch", d: "Each branch trains a credit model on its own customers. Raw data never leaves the building." },
              { n: "02", t: "Aggregate weights", d: "Branches send only model weights to HQ, combined into a stronger shared model — no raw records." },
              { n: "03", t: "Score everywhere", d: "The improved model flows back to every branch, sharpening decisions network-wide." },
            ].map((s) => (
              <div key={s.n}>
                <span className="nums font-display text-4xl font-semibold text-teal/30">{s.n}</span>
                <h3 className="mt-3 font-display text-xl font-semibold text-ink">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.d}</p>
              </div>
            ))}
          </div>
          <ul className="mt-14 flex flex-wrap gap-x-8 gap-y-3 text-sm text-ink-soft">
            {["No central data lake", "Regulator-friendly by construction", "Offline-tolerant edge nodes", "Poisoning-resistant aggregation"].map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check size={16} className="text-teal" /> {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Architecture diagram */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">Architecture</span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            One shared model. Thirteen private datasets.
          </h2>
          <p className="mt-4 text-ink-soft">
            Branches train locally and send only encrypted weight updates. HQ aggregates
            them with FedAvg and pushes the improved model back — a full round without a
            single raw record moving.
          </p>
        </div>
        <div className="mt-12 overflow-x-auto rounded-2xl border border-line bg-surface p-6 shadow-card md:p-10">
          <ArchitectureDiagram />
        </div>
      </section>

      {/* Traditional vs Federated */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Why federated, not centralized?
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-canvas p-7">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-danger">Traditional</span>
                <span className="text-sm text-ink-faint">central data lake</span>
              </div>
              <ComparisonDiagram variant="central" />
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                Every branch ships raw customer records to one central database. A single
                breach exposes the whole network, and regulators inherit the blast radius.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-teal/40 bg-canvas p-7">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal">SecureScore</span>
                <span className="text-sm text-ink-faint">federated</span>
              </div>
              <ComparisonDiagram variant="federated" />
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                Data stays on-branch. Only model weights travel, so there is no honeypot to
                breach and each branch keeps sovereignty over its own customers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Built for every seat in the bank</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            { icon: <Landmark size={22} />, t: "HQ & risk teams", d: "Network-wide oversight: model rounds, fairness metrics, and aggregation health in one console.", points: ["Global model dashboard", "Fairness & drift alerts", "Round-by-round audit log"] },
            { icon: <Building2 size={22} />, t: "Branch managers", d: "Local training and approvals without exporting a single customer record off-site.", points: ["On-branch training", "Instant loan decisions", "Offline-tolerant edge node"] },
            { icon: <User size={22} />, t: "Customers", d: "Faster, fairer credit decisions with the confidence their data never leaves their branch.", points: ["Transparent scoring", "KYC & MeroShare", "Privacy by design"] },
          ].map((r) => (
            <div key={r.t} className="rounded-2xl border border-line bg-surface p-7 shadow-card">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-soft text-teal">{r.icon}</div>
              <h3 className="mt-5 font-display text-lg font-semibold text-ink">{r.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{r.d}</p>
              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                {r.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-ink-soft">
                    <Check size={15} className="shrink-0 text-teal" /> {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Security & compliance */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">Security &amp; compliance</span>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                Privacy enforced by the architecture, not a policy PDF.
              </h2>
              <p className="mt-4 text-ink-soft">
                Every layer is designed so the safe path is the only path — from transport
                encryption to differentially-private gradients and signed aggregation rounds.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: <ShieldCheck size={20} />, t: "Differential privacy", d: "Calibrated noise on every gradient update." },
                { icon: <Lock size={20} />, t: "mTLS everywhere", d: "Mutually-authenticated branch ↔ HQ channels." },
                { icon: <ServerCog size={20} />, t: "Byzantine-robust", d: "Poisoned updates rejected before aggregation." },
                { icon: <FileCheck size={20} />, t: "Signed audit trail", d: "Every round logged, hashed, and verifiable." },
              ].map((c) => (
                <div key={c.t} className="rounded-xl border border-line bg-canvas p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-soft text-teal">{c.icon}</div>
                  <h3 className="mt-3 text-sm font-semibold text-ink">{c.t}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <Quote size={36} className="mx-auto text-teal/30" />
        <blockquote className="mt-6 font-display text-2xl font-medium leading-snug tracking-tight text-ink md:text-3xl">
          &ldquo;We finally get a network-wide credit model without asking any branch to hand
          over its customers. That was always the deal-breaker — now it isn&rsquo;t.&rdquo;
        </blockquote>
        <p className="mt-6 text-sm text-ink-faint">Head of Risk · pilot cooperative bank, Kathmandu</p>
      </section>

      {/* FAQ */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight md:text-4xl">Questions, answered</h2>
          <div className="mt-12 divide-y divide-line">
            {[
              { q: "Does any customer data leave the branch?", a: "No. Branches train on their own records and transmit only model weights. Raw data never crosses a branch boundary." },
              { q: "How does HQ improve the model without the data?", a: "HQ aggregates the weight updates from all branches using Byzantine-robust FedAvg, producing a stronger shared model that is pushed back to every branch." },
              { q: "What stops a malicious branch from poisoning the model?", a: "Aggregation is Byzantine-robust: outlier and poisoned updates are down-weighted or rejected before they reach the global model." },
              { q: "Does it work with unreliable connectivity?", a: "Yes. Edge nodes are offline-tolerant — branches keep scoring locally and sync weights when a connection is available." },
            ].map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-left font-medium text-ink marker:content-none">
                  {f.q}
                  <ArrowRight size={18} className="shrink-0 text-ink-faint transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="rounded-3xl bg-[#0c1626] px-8 py-16 text-center text-white md:px-16">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Ready to see federated credit scoring in action?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-white/60">
            Sign in with a demo account and explore the HQ, branch, and customer views.
          </p>
          <Link href="/" className="mt-8 inline-block">
            <Button size="lg">Sign in<ArrowRight size={16} /></Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-ink-faint md:flex-row">
          <span className="font-display font-semibold text-ink-soft">SecureScore</span>
          <span>Privacy-preserving federated credit scoring · Nepal</span>
        </div>
      </footer>
    </div>
  );
}

/* ── Federated round diagram ───────────────────────────── */
function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 860 320" className="mx-auto block w-full min-w-[680px] max-w-4xl" role="img"
      aria-label="Branches train locally and send encrypted weights to HQ, which aggregates with FedAvg and returns an improved global model each round.">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#0E7C66" />
        </marker>
      </defs>

      {/* Return loop */}
      <path d="M730 90 C 730 18, 130 18, 130 90" fill="none" stroke="#B8860B" strokeWidth="2"
        strokeDasharray="5 5" markerEnd="url(#arrow)" opacity="0.7" />
      <text x="430" y="14" textAnchor="middle" fontSize="12" fill="#B8860B" fontWeight="600">repeats every training round</text>

      {/* Node A — branches */}
      <g>
        <rect x="20" y="95" width="220" height="150" rx="14" fill="#0c1626" />
        <text x="130" y="128" textAnchor="middle" fontSize="15" fill="#ffffff" fontWeight="600">13 Branches</text>
        <text x="130" y="150" textAnchor="middle" fontSize="11" fill="#9fb0c9">train locally on</text>
        <text x="130" y="167" textAnchor="middle" fontSize="11" fill="#9fb0c9">their own customers</text>
        <rect x="70" y="188" width="120" height="30" rx="7" fill="#0E7C66" fillOpacity="0.18" stroke="#0E7C66" strokeOpacity="0.4" />
        <text x="130" y="207" textAnchor="middle" fontSize="11" fill="#3aa589" fontWeight="600">🔒 data stays put</text>
      </g>

      {/* Arrow 1 */}
      <text x="285" y="150" textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="600">① encrypted</text>
      <text x="285" y="166" textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="600">weights</text>
      <line x1="240" y1="185" x2="330" y2="185" stroke="#0E7C66" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <circle r="4" fill="#0E7C66">
        <animateMotion path="M240 185 L326 185" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Node B — HQ */}
      <rect x="330" y="120" width="200" height="130" rx="14" fill="#F7EFD9" stroke="#B8860B" strokeWidth="1.5" />
      <text x="430" y="158" textAnchor="middle" fontSize="15" fill="#11203A" fontWeight="600">HQ Aggregator</text>
      <text x="430" y="182" textAnchor="middle" fontSize="12" fill="#8A6d0b" fontWeight="600">FedAvg</text>
      <text x="430" y="204" textAnchor="middle" fontSize="10.5" fill="#43526B">Byzantine-robust</text>
      <text x="430" y="219" textAnchor="middle" fontSize="10.5" fill="#43526B">merge of all updates</text>

      {/* Arrow 2 */}
      <text x="575" y="150" textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="600">② improved</text>
      <text x="575" y="166" textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="600">global model</text>
      <line x1="530" y1="185" x2="620" y2="185" stroke="#0E7C66" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <circle r="4" fill="#0E7C66">
        <animateMotion path="M530 185 L616 185" dur="2s" begin="1s" repeatCount="indefinite" />
      </circle>

      {/* Node C — scoring */}
      <g>
        <rect x="620" y="120" width="220" height="130" rx="14" fill="#ffffff" stroke="#E6E9EF" strokeWidth="1.5" />
        <text x="730" y="160" textAnchor="middle" fontSize="15" fill="#11203A" fontWeight="600">Sharper scoring</text>
        <text x="730" y="184" textAnchor="middle" fontSize="11" fill="#43526B">every branch scores</text>
        <text x="730" y="201" textAnchor="middle" fontSize="11" fill="#43526B">with the shared model</text>
      </g>
    </svg>
  );
}

/* ── Centralized vs federated comparison ───────────────── */
function ComparisonDiagram({ variant }: { variant: "central" | "federated" }) {
  const central = variant === "central";
  const accent = central ? "#C0392B" : "#0E7C66";
  const hub = central ? "Central DB" : "HQ";
  const sub = central ? "sends raw data" : "🔒 keeps data";
  const flow = central ? "raw records" : "weights only";
  const rows = [24, 86, 148];

  return (
    <svg viewBox="0 0 340 210" className="mt-6 block w-full" role="img"
      aria-label={central ? "Branches ship raw records to a central database." : "Branches keep data; only weights travel to HQ."}>
      <defs>
        <marker id={`c-${variant}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={accent} />
        </marker>
      </defs>

      {rows.map((y, i) => (
        <g key={i}>
          <rect x="12" y={y} width="104" height="48" rx="9" fill="#F7F8FA" stroke="#E6E9EF" />
          <text x="64" y={y + 21} textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="600">Branch {String.fromCharCode(65 + i)}</text>
          <text x="64" y={y + 37} textAnchor="middle" fontSize="9.5" fill={central ? "#8A97AC" : "#0E7C66"}>{sub}</text>
          <path d={`M116 ${y + 24} C 180 ${y + 24}, 210 105, 250 105`} fill="none" stroke={accent}
            strokeWidth={central ? 2.4 : 1.6} strokeOpacity={central ? 0.85 : 0.7} markerEnd={`url(#c-${variant})`} />
          <circle r="3.4" fill={accent}>
            <animateMotion path={`M116 ${y + 24} C 180 ${y + 24}, 210 105, 250 105`} dur="2.4s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}

      {/* Hub */}
      <rect x="250" y="72" width="78" height="66" rx="11" fill={accent} fillOpacity="0.1" stroke={accent} strokeWidth="1.5" />
      <text x="289" y="101" textAnchor="middle" fontSize="12" fill="#11203A" fontWeight="700">{hub}</text>
      <text x="289" y="118" textAnchor="middle" fontSize="9" fill={accent} fontWeight="600">{flow}</text>
    </svg>
  );
}
