"use client";

import { useAuth } from "@/lib/auth-context";
import { Bell, Globe, WifiOff, LayoutGrid, Search } from "lucide-react";
import { useWsEvents } from "@/lib/ws-context";
import { usePathname, useRouter } from "next/navigation";
import { PWAInstallButton } from "@/components/pwa-installer";
import { listNotifications } from "@/lib/api";
import { useState, useEffect } from "react";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/branch/dashboard":     { title: "Branch Overview",    subtitle: "Real-time branch performance" },
  "/branch/customers":     { title: "Customers",          subtitle: "Customer profiles and scoring" },
  "/branch/ai-models":     { title: "AI Models Hub",      subtitle: "6 federated ML models status" },
  "/branch/hq-assess":     { title: "HQ Assessment",      subtitle: "Global model · Branch-tuned fingerprint" },
  "/branch/fraud-alerts":  { title: "Fraud Alerts",       subtitle: "Real-time transaction monitoring" },
  "/branch/fraud-ml":      { title: "Fraud ML",           subtitle: "IsolationForest + XGBoost anomaly detection" },
  "/branch/aml":           { title: "AML Monitor",        subtitle: "Anti-money laundering compliance" },
  "/branch/loan-assessment":{ title: "Loan Assessment",   subtitle: "NRB-compliant risk grading A–F" },
  "/branch/churn":         { title: "Churn Risk",         subtitle: "30-day customer retention analysis" },
  "/branch/cash-demand":   { title: "Cash Demand Forecast", subtitle: "Vault & ATM liquidity · branch-local model" },
  "/branch/cross-sell":    { title: "Cross-Sell",         subtitle: "Next-best-product recommendations" },
  "/branch/handwriting":   { title: "Handwriting OCR",    subtitle: "Digitise handwritten text · on-device" },
  "/branch/copilot":       { title: "Branch Copilot",     subtitle: "LLM analytics over aggregate branch data" },
  "/branch/service-requests": { title: "Service Requests", subtitle: "Cheque-book approvals & dispatch" },
  "/branch/data-drift":    { title: "Data Drift",         subtitle: "Model drift detection and adaptation" },
  "/customer/dashboard":   { title: "My Credit Score",    subtitle: "Your financial health snapshot" },
  "/customer/robo-advisor":{ title: "Robo Advisor",       subtitle: "Personalized investment guidance" },
  "/customer/cashflow":    { title: "Cash Flow Forecast", subtitle: "3-month projection with confidence bands" },
  "/customer/risk-profile":{ title: "Risk Profile",       subtitle: "5-dimension composite risk analysis" },
  "/customer/loans":       { title: "My Loans",           subtitle: "Disbursement · EMI schedule · repayments" },
  "/customer/qr-pay":      { title: "QR & Bills",         subtitle: "Dynamic QR · pay via QR · utility bills" },
  "/customer/payees":      { title: "Payees & Auto-pay",  subtitle: "Saved beneficiaries · recurring auto-pay" },
  "/customer/cards":       { title: "Cards & Cheques",    subtitle: "Debit card controls · cheque-book requests" },
  "/hq/dashboard":         { title: "Network Map",        subtitle: "Federation topology and node health" },
  "/hq/gl":                { title: "General Ledger",     subtitle: "Double-entry · trial balance · balance sheet" },
  "/hq/chain":             { title: "Blockchain Ledger",  subtitle: "Hash-linked blocks · Merkle roots · verify" },
  "/hq/federation":        { title: "Federation",         subtitle: "Federated learning rounds and aggregation" },
  "/hq/models":            { title: "Model Registry",     subtitle: "Global model versions and performance" },
  "/hq/audit":             { title: "Audit Log",          subtitle: "Cryptographic audit trail" },
  "/hq/security":          { title: "Security",           subtitle: "Certificates, TOTP, and access control" },
  "/hq/mu-graphcoder":     { title: "μGraphCoder",        subtitle: "GNN topology analysis" },
  "/hq/pi-devices":        { title: "Pi Devices",         subtitle: "Raspberry Pi edge nodes" },
};

export function TopBar({ onEnterDesktop }: { onEnterDesktop?: () => void }) {
  const { user } = useAuth();
  const { connected, events } = useWsEvents();
  const pathname = usePathname();
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "ne">("en");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (user?.role !== "customer") return;
    let alive = true;
    const poll = () => listNotifications().then((d) => { if (alive) setUnread(d.unread); }).catch(() => {});
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [user, pathname]);

  useEffect(() => {
    const saved = localStorage.getItem("lang") as "en" | "ne" | null;
    if (saved) setLang(saved);
  }, []);

  const toggleLang = () => {
    const next = lang === "en" ? "ne" : "en";
    setLang(next);
    localStorage.setItem("lang", next);
  };

  const recentAlerts = events.filter((e) => e.type === "fraud_alert").length;
  const pageInfo = PAGE_TITLES[pathname] ?? { title: "SecureScore", subtitle: "" };

  return (
    <header className="h-16 bg-surface/80 backdrop-blur-md border-b border-line flex items-center justify-between px-6 shrink-0 sticky top-0 z-20">
      {/* Left: page title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-ink leading-tight truncate">{pageInfo.title}</h2>
          {pageInfo.subtitle && (
            <p className="text-xs text-ink-faint leading-tight truncate">{pageInfo.subtitle}</p>
          )}
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Command palette launcher */}
        <button
          onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
          className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-line hover:bg-canvas transition-colors text-ink-soft"
          title="Quick jump (Ctrl/⌘ + K)"
        >
          <Search size={12} />
          <kbd className="font-semibold">⌘K</kbd>
        </button>

        <PWAInstallButton />

        {/* Desktop showcase toggle */}
        {onEnterDesktop && (
          <button
            onClick={onEnterDesktop}
            className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-line hover:bg-canvas transition-colors text-ink-soft"
            title="Switch to desktop showcase view"
          >
            <LayoutGrid size={13} />
            <span className="font-semibold">Desktop</span>
          </button>
        )}

        {/* Language toggle */}
        {/* <button
          onClick={toggleLang}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-line hover:bg-canvas transition-colors text-ink-soft"
          title="Switch language / भाषा बदल्नुहोस्"
        >
          <Globe size={12} />
          <span className="font-semibold">{lang === "en" ? "NE" : "EN"}</span>
        </button> */}

        {/* Live status */}
        <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
          connected
            ? "bg-teal-soft border-teal/20 text-teal-deep"
            : "bg-red-50 border-red-200 text-danger"
        }`}>
          {connected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
              <span className="font-semibold">Live</span>
            </>
          ) : (
            <>
              <WifiOff size={11} />
              <span className="font-semibold">Offline</span>
            </>
          )}
        </div>

        {/* Notification bell — customers get a live unread feed; staff see fraud-alert count */}
        {/* {user?.role === "customer" ? (
          <button
            onClick={() => router.push("/customer/notifications")}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-canvas transition-colors"
            title="Notifications"
          >
            <Bell size={16} className="text-ink-faint" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 bg-danger text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        ) : (
          <button className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-canvas transition-colors">
            <Bell size={16} className="text-ink-faint" />
            {recentAlerts > 0 && (
              <span className="absolute top-1 right-1 bg-danger text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                {recentAlerts > 9 ? "9+" : recentAlerts}
              </span>
            )}
          </button>
        )} */}

        {/* Role badge */}
        {user && (
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${
            user.role === "admin"
              ? "bg-gold-soft text-gold"
              : user.role === "branch_manager"
              ? "bg-ink/5 text-ink"
              : "bg-teal-soft text-teal-deep"
          }`}>
            {user.role.replace("_", " ")}
          </span>
        )}
      </div>
    </header>
  );
}
