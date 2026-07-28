"use client";

import { useEffect, useState } from "react";
import { branchAIModelsStatus, type AIModelsStatusResult, type AIModelInfo } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  Brain, TrendingUp, ShieldAlert, CreditCard, Activity, AlertTriangle,
  CheckCircle2, XCircle, Clock, ArrowRight, Cpu, Users, Layers, Box,
  Home, Percent, ArrowLeftRight, Fingerprint,
} from "lucide-react";

type ModelMeta = {
  label: string;
  description: string;
  algo: string;
  icon: React.ReactNode;
  href: string;
};

// Default so a model key the backend returns but we haven't catalogued still
// renders with an icon and a readable name — never a blank/missing card.
const DEFAULT_META: ModelMeta = {
  label: "Model",
  description: "Federated edge model trained on branch-local data.",
  algo: "Ensemble",
  icon: <Box size={18} />,
  href: "/branch/ai-models",
};

const MODEL_META: Record<string, ModelMeta> = {
  fraud_detection: {
    label: "Fraud Detection",
    description: "Behavioral anomaly scoring via IsolationForest + XGBoost ensemble on transaction patterns.",
    algo: "IF + XGBoost",
    icon: <AlertTriangle size={18} />,
    href: "/branch/fraud-ml",
  },
  loan_default: {
    label: "Loan Default / Credit Risk",
    description: "NRB-compliant credit risk grading A–F with interest rate recommendations per applicant.",
    algo: "XGBoost",
    icon: <CreditCard size={18} />,
    href: "/branch/loan-assessment",
  },
  churn_predictor: {
    label: "Churn Predictor",
    description: "RFM + digital engagement features for 30-day churn probability prediction.",
    algo: "Random Forest",
    icon: <TrendingUp size={18} />,
    href: "/branch/churn",
  },
  aml_monitor: {
    label: "AML Monitor",
    description: "Structuring detection, round-amount flagging, and unsupervised anomaly scanning.",
    algo: "IsolationForest",
    icon: <ShieldAlert size={18} />,
    href: "/branch/aml",
  },
  cashflow_forecaster: {
    label: "Cash Flow Forecaster",
    description: "Exponential smoothing + 3-period MA ensemble. 3-month forecast with CI bands.",
    algo: "ES + MA Ensemble",
    icon: <Activity size={18} />,
    href: "/branch/cashflow",
  },
  unified_risk: {
    label: "Unified Risk Engine",
    description: "5-dimension composite scorer: credit, fraud, AML, churn, cash flow with SHAP explanation.",
    algo: "Weighted Ensemble",
    icon: <Brain size={18} />,
    href: "/branch/unified-risk",
  },
  collateral_estimator: {
    label: "Collateral Estimator",
    description: "Automated property valuation using location, area, and market index. Land, building, and vehicle collateral.",
    algo: "Gradient Boosting",
    icon: <Home size={18} />,
    href: "/branch/collateral-estimator",
  },
  rate_optimizer: {
    label: "Interest Rate Optimizer",
    description: "Branch-specific optimal rate engine balancing NRB policy, market competition, and borrower risk.",
    algo: "Bayesian Optimization",
    icon: <Percent size={18} />,
    href: "/branch/rate-optimizer",
  },
  remittance_analyzer: {
    label: "Remittance Analyzer",
    description: "Detects unusual remittance patterns, hawaala indicators, and cross-border flow anomalies.",
    algo: "LSTM + IsolationForest",
    icon: <ArrowLeftRight size={18} />,
    href: "/branch/remittance-analyzer",
  },
  hq_fingerprint: {
    label: "HQ Fingerprint",
    description: "Global federated model accessed via HQ. Branch sends params, HQ runs inference — zero branch compute.",
    algo: "Federated XGBoost",
    icon: <Fingerprint size={18} />,
    href: "/branch/hq-assess",
  },
};

// The six edge models that always exist for a branch. Rendered unconditionally
// so their icons are present even before the (slow) status call resolves.
const EDGE_KEYS = [
  "fraud_detection", "loan_default", "churn_predictor",
  "aml_monitor", "cashflow_forecaster", "unified_risk",
] as const;

const EXTENDED_KEYS = ["collateral_estimator", "rate_optimizer", "remittance_analyzer", "hq_fingerprint"];

function StatusPill({ info }: { info?: AIModelInfo }) {
  const status = info?.status;
  const ready = status === "trained" || status === "ready";
  const failed = status === "failed";
  const pending = !status || status === "pending";
  const Icon = ready ? CheckCircle2 : failed ? XCircle : Clock;
  const cls = ready ? "text-teal" : failed ? "text-danger" : "text-gold";
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold capitalize ${cls}`}>
      <Icon size={14} className={pending ? "animate-pulse" : ""} />
      {status ?? "loading"}
    </span>
  );
}

function metricsOf(info?: AIModelInfo): { label: string; value: string }[] {
  if (!info) return [];
  const m: { label: string; value: string }[] = [];
  if (info.n_customers != null) m.push({ label: "Customers", value: info.n_customers.toLocaleString() });
  if (info.accuracy != null) m.push({ label: "Accuracy", value: `${(info.accuracy * 100).toFixed(1)}%` });
  if (info.f1 != null && info.f1 > 0) m.push({ label: "F1", value: info.f1.toFixed(3) });
  if (info.auc != null && info.auc > 0) m.push({ label: "AUC", value: info.auc.toFixed(3) });
  if (info.ensemble_auc != null) m.push({ label: "AUC", value: info.ensemble_auc.toFixed(3) });
  if (info.n_flagged != null) m.push({ label: "Flagged", value: info.n_flagged.toLocaleString() });
  if (info.default_rate != null) m.push({ label: "Default rate", value: `${(info.default_rate * 100).toFixed(1)}%` });
  if (info.churn_rate != null) m.push({ label: "Churn rate", value: `${(info.churn_rate * 100).toFixed(1)}%` });
  return m;
}

function ModelCard({ modelKey, info, tag }: { modelKey: string; info?: AIModelInfo; tag?: string }) {
  const meta = MODEL_META[modelKey] ?? { ...DEFAULT_META, label: modelKey.replace(/_/g, " ") };
  const ready = info?.status === "trained" || info?.status === "ready";
  const metrics = metricsOf(info);

  return (
    <div className="group bg-surface rounded-2xl shadow-card border border-line hover:shadow-lift transition-shadow overflow-hidden animate-fade-up">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-teal-soft text-teal flex items-center justify-center transition-transform group-hover:scale-105">
              {meta.icon}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-ink truncate">{meta.label}</h3>
              <span className="text-xs text-ink-faint">{meta.algo}</span>
            </div>
          </div>
          {tag ? (
            <span className="shrink-0 text-[10px] font-semibold bg-gold-soft text-gold rounded-full px-2 py-0.5">{tag}</span>
          ) : (
            <StatusPill info={info} />
          )}
        </div>

        <p className="text-xs text-ink-soft leading-relaxed mb-3">{meta.description}</p>

        {info?.error && (
          <p className="text-xs text-danger bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{info.error}</p>
        )}

        {metrics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {metrics.map((m) => (
              <span key={m.label} className="inline-flex items-center gap-1 bg-canvas border border-line rounded-lg px-2 py-1 text-xs nums">
                <span className="text-ink-faint">{m.label}</span>
                <span className="font-semibold text-ink">{m.value}</span>
              </span>
            ))}
          </div>
        )}

        <a
          href={meta.href}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70 ${ready || tag ? "text-teal" : "text-ink-faint"}`}
        >
          Open dashboard <ArrowRight size={12} />
        </a>
      </div>
    </div>
  );
}

export default function AIModelsPage() {
  const [data, setData] = useState<AIModelsStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    branchAIModelsStatus()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const models = data?.models as Record<string, AIModelInfo | undefined> | undefined;
  const readyCount = models
    ? Object.values(models).filter((m) => m?.status === "trained" || m?.status === "ready").length
    : 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.4]" style={{
          background: "radial-gradient(600px 240px at 85% 20%, #0E7C6655, transparent)",
        }} />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-teal">
              <Brain size={18} />
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">XGBoost · Random Forest · IsolationForest · Ensemble</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">AI Models Hub</h1>
            <p className="mt-1 text-white/60 text-sm">
              {data ? `${data.branch} Branch · ${data.n_customers.toLocaleString()} customers profiled` : "Branch AI models · federated edge"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-5xl font-semibold nums">{loading ? "…" : readyCount}<span className="text-2xl text-white/40">/6</span></p>
            <p className="text-white/50 text-xs mt-1">Edge models ready</p>
            <p className="text-white/30 text-[10px] mt-0.5">+4 extended models</p>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Customers Profiled", value: data?.n_customers.toLocaleString() ?? "—", icon: <Users size={14} /> },
            { label: "Total Models",       value: `${readyCount + 4} / 10`,                  icon: <Cpu size={14} /> },
            { label: "ML Stack",           value: "XGB · RF · LSTM · FL",                    icon: <Layers size={14} /> },
          ].map((s) => (
            <div key={s.label} className="bg-white/[0.07] ring-1 ring-white/10 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 text-white/50 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
              <p className="text-xl font-bold nums">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-danger flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {error} — showing model catalogue; status will populate when the edge node is reachable.
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-ink-soft text-sm">
          <Spinner size="sm" /> Initializing edge models — first load may take 30–60 s…
        </div>
      )}

      {/* Edge models — always rendered so every icon is present. */}
      <div>
        <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-3">Edge Models {data ? "(Live)" : ""}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger">
          {EDGE_KEYS.map((key) => (
            <ModelCard key={key} modelKey={key} info={models?.[key]} />
          ))}
        </div>
      </div>

      {/* Extended / HQ models */}
      <div>
        <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-3">Extended Models</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger">
          {EXTENDED_KEYS.map((key) => (
            <ModelCard key={key} modelKey={key} tag={key === "hq_fingerprint" ? "HQ Global" : "Available"} />
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-faint text-center">
        Edge models trained on branch-local data (federated learning). HQ Fingerprint uses the global model — no branch compute.
      </p>
    </div>
  );
}
