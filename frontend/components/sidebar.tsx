"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useAuth, type UserRole } from "@/lib/auth-context";
import {
  LayoutDashboard, Users, AlertTriangle, Globe,
  FileText, Shield, LogOut, Activity, TrendingUp, Network, Cpu, Brain,
  ShieldAlert, CreditCard, Radar, Server, Sparkles, ChevronRight,
  Building2, BarChart3, Fingerprint, Home, Percent, ArrowLeftRight,
  Wallet, Send, PiggyBank, UserCircle, Lock, ShieldCheck, Bell,
  PlusCircle, ClipboardList, Sunrise, BookOpen, UserCheck,
  Sliders, GitBranch, HelpCircle, Zap, KeySquare, ClipboardCheck,
  FlaskConical, GitCompare, Stamp, MapPin,
  GitFork, ScanFace, Scale, AlertOctagon, Trophy,
  Heart, CheckCircle2, ScanLine, Landmark, QrCode, Repeat, Banknote, PenLine, BookOpenCheck, Blocks, Bot,
  Coffee,
} from "lucide-react";
import { CoffeeModal, CoffeeThanks } from "./coffee-modal";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: UserRole[];
  badge?: string;
  highlight?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // Branch Manager — Core Banking
  { label: "Branch Overview",      href: "/branch/dashboard",          icon: <LayoutDashboard size={16} />, roles: ["branch_manager"] },
  { label: "Client Profiles",      href: "/branch/clients",            icon: <UserCheck size={16} />,       roles: ["branch_manager"], highlight: true },
  { label: "Account Applications", href: "/branch/account-applications", icon: <ClipboardList size={16} />, roles: ["branch_manager"] },
  { label: "KYC Applications",    href: "/branch/kyc-applications",    icon: <UserCheck size={16} />,      roles: ["branch_manager"], highlight: true },
  { label: "EOD / BOD",           href: "/branch/eod",                icon: <Sunrise size={16} />,         roles: ["branch_manager"] },

  // Branch Manager — Intelligence
  { label: "AI Models Hub",       href: "/branch/ai-models",          icon: <Brain size={16} />,           roles: ["branch_manager"], badge: "6" },
  { label: "Cash Flow Forecast",  href: "/branch/cashflow",           icon: <Activity size={16} />,        roles: ["branch_manager"] },
  { label: "Cash Demand",         href: "/branch/cash-demand",        icon: <Banknote size={16} />,        roles: ["branch_manager"], highlight: true },
  { label: "Unified Risk",        href: "/branch/unified-risk",       icon: <Radar size={16} />,           roles: ["branch_manager"] },
  { label: "HQ Assessment",       href: "/branch/hq-assess",          icon: <Fingerprint size={16} />,     roles: ["branch_manager"], highlight: true },
  { label: "ML Customers",        href: "/branch/customers",          icon: <Users size={16} />,           roles: ["branch_manager"] },
  { label: "Cross-Sell",          href: "/branch/cross-sell",         icon: <Sparkles size={16} />,        roles: ["branch_manager"], highlight: true },
  { label: "Handwriting OCR",     href: "/branch/handwriting",        icon: <PenLine size={16} />,         roles: ["branch_manager"], highlight: true },
  { label: "Branch Copilot",      href: "/branch/copilot",            icon: <Bot size={16} />,             roles: ["branch_manager"], highlight: true },
  { label: "Service Requests",    href: "/branch/service-requests",   icon: <ClipboardList size={16} />,   roles: ["branch_manager"] },

  // Branch Manager — Risk & Compliance
  { label: "Fraud Alerts",        href: "/branch/fraud-alerts",       icon: <AlertTriangle size={16} />,   roles: ["branch_manager"] },
  { label: "Fraud ML",            href: "/branch/fraud-ml",           icon: <ShieldAlert size={16} />,     roles: ["branch_manager"] },
  { label: "AML Monitor",         href: "/branch/aml",                icon: <Shield size={16} />,          roles: ["branch_manager"] },
  { label: "Loan Assessment",     href: "/branch/loan-assessment",    icon: <CreditCard size={16} />,      roles: ["branch_manager"] },
  { label: "Collateral Estimator",href: "/branch/collateral-estimator", icon: <Home size={16} />,          roles: ["branch_manager"] },
  { label: "Rate Optimizer",      href: "/branch/rate-optimizer",     icon: <Percent size={16} />,         roles: ["branch_manager"] },
  { label: "Remittance Analyzer", href: "/branch/remittance-analyzer",icon: <ArrowLeftRight size={16} />, roles: ["branch_manager"] },
  { label: "Records",             href: "/branch/records",            icon: <FileText size={16} />,        roles: ["branch_manager"] },
  { label: "Churn Risk",          href: "/branch/churn",              icon: <TrendingUp size={16} />,      roles: ["branch_manager"] },
  { label: "Data Drift",          href: "/branch/data-drift",         icon: <Activity size={16} />,        roles: ["branch_manager"] },
  { label: "Background Verify",   href: "/branch/background-verify",  icon: <ShieldCheck size={16} />,     roles: ["branch_manager"] },
  { label: "Approvals",           href: "/branch/approvals",          icon: <ShieldCheck size={16} />,     roles: ["branch_manager"], highlight: true },
  { label: "Fraud Stream",        href: "/branch/fraud-stream",       icon: <Activity size={16} />,        roles: ["branch_manager"], highlight: true },
  { label: "Portfolio at Risk",   href: "/branch/par",                icon: <TrendingUp size={16} />,      roles: ["branch_manager"] },
  { label: "SAR Generator",       href: "/branch/sar",                icon: <FileText size={16} />,        roles: ["branch_manager"], highlight: true },

  // Customer — AI / Credit
  { label: "My Score",            href: "/customer/dashboard",        icon: <LayoutDashboard size={16} />, roles: ["customer"] },
  { label: "Score Explanation",   href: "/customer/explainability",   icon: <HelpCircle size={16} />,      roles: ["customer"], highlight: true },
  { label: "What-If Simulator",   href: "/customer/whatif",           icon: <Sliders size={16} />,         roles: ["customer"], highlight: true },
  { label: "Credit Journey",      href: "/customer/journey",          icon: <GitBranch size={16} />,       roles: ["customer"] },
  { label: "Robo Advisor",        href: "/customer/robo-advisor",     icon: <TrendingUp size={16} />,      roles: ["customer"] },
  { label: "Cash Flow",           href: "/customer/cashflow",         icon: <Activity size={16} />,        roles: ["customer"] },
  { label: "Risk Profile",        href: "/customer/risk-profile",     icon: <Radar size={16} />,           roles: ["customer"] },

  // Customer — KYC
  { label: "KYC Onboarding",      href: "/customer/kyc",              icon: <UserCheck size={16} />,       roles: ["customer"], highlight: true },
  { label: "Counterfactual",      href: "/customer/counterfactual",   icon: <GitFork size={16} />,         roles: ["customer"], highlight: true },
  { label: "Loan Apply",          href: "/customer/loan-apply",       icon: <CreditCard size={16} />,      roles: ["customer"], highlight: true },
  { label: "AI KYC Verify",       href: "/customer/kyc-verify",       icon: <ScanFace size={16} />,        roles: ["customer"], highlight: true },

  // Customer — Banking
  { label: "My Accounts",         href: "/customer/accounts",         icon: <Wallet size={16} />,          roles: ["customer"] },
  { label: "Account Statement",   href: "/customer/statement",        icon: <BookOpen size={16} />,        roles: ["customer"] },
  { label: "Fund Transfer",       href: "/customer/transfer",         icon: <Send size={16} />,            roles: ["customer"] },
  { label: "Fixed Deposits",      href: "/customer/fd",               icon: <PiggyBank size={16} />,       roles: ["customer"] },
  { label: "Cards & Cheques",     href: "/customer/cards",            icon: <CreditCard size={16} />,      roles: ["customer"], highlight: true },
  { label: "My Loans",            href: "/customer/loans",            icon: <Landmark size={16} />,        roles: ["customer"], highlight: true },
  { label: "QR & Bills",          href: "/customer/qr-pay",           icon: <QrCode size={16} />,          roles: ["customer"], highlight: true },
  { label: "Payees & Auto-pay",   href: "/customer/payees",           icon: <Repeat size={16} />,          roles: ["customer"] },
  { label: "Cheque Deposit",      href: "/customer/cheque-deposit",   icon: <ScanLine size={16} />,        roles: ["customer"], highlight: true },
  { label: "Open New Account",    href: "/customer/apply-account",    icon: <PlusCircle size={16} />,      roles: ["customer"] },
  { label: "My Applications",     href: "/customer/applications",     icon: <ClipboardList size={16} />,   roles: ["customer"] },
  { label: "My Profile",          href: "/customer/profile",          icon: <UserCircle size={16} />,      roles: ["customer"] },
  { label: "Change Password",     href: "/customer/password",         icon: <Lock size={16} />,            roles: ["customer"] },
  { label: "Security Audit",      href: "/customer/security-audit",   icon: <ShieldCheck size={16} />,     roles: ["customer"] },

  // HQ Admin
  { label: "Network Map",         href: "/hq/dashboard",              icon: <Network size={16} />,         roles: ["admin"] },
  { label: "Federation",          href: "/hq/federation",             icon: <Globe size={16} />,           roles: ["admin"] },
  { label: "Model Registry",      href: "/hq/models",                 icon: <BarChart3 size={16} />,       roles: ["admin"] },
  { label: "HQ Analytics",        href: "/hq/analytics",              icon: <TrendingUp size={16} />,      roles: ["admin"] },
  { label: "General Ledger",      href: "/hq/gl",                     icon: <BookOpenCheck size={16} />,   roles: ["admin"], highlight: true },
  { label: "Blockchain Ledger",   href: "/hq/chain",                  icon: <Blocks size={16} />,          roles: ["admin"], highlight: true },
  { label: "Compliance Reports",  href: "/hq/compliance",             icon: <ClipboardCheck size={16} />,  roles: ["admin"] },
  { label: "Stress Test",         href: "/hq/stress-test",            icon: <Zap size={16} />,             roles: ["admin"] },
  { label: "Privacy Budget",      href: "/hq/privacy-budget",         icon: <KeySquare size={16} />,       roles: ["admin"] },
  { label: "Records",             href: "/hq/records",                icon: <FileText size={16} />,        roles: ["admin"] },
  { label: "Audit Log",           href: "/hq/audit",                  icon: <FileText size={16} />,        roles: ["admin"] },
  { label: "Security",            href: "/hq/security",               icon: <Shield size={16} />,          roles: ["admin"] },
  // Hidden until the edge submits fingerprints: submit_fingerprint_to_hq (edge_node.py:925)
  // has no caller, so HQ never receives data and the page only ever shows its empty state.
  // { label: "μGraphCoder",         href: "/hq/mu-graphcoder",          icon: <Cpu size={16} />,             roles: ["admin"] },
  { label: "Pi Devices",          href: "/hq/pi-devices",             icon: <Server size={16} />,          roles: ["admin"] },

  // HQ — Administration (RBAC)
  { label: "Users",               href: "/hq/users",                  icon: <Users size={16} />,           roles: ["admin"], highlight: true },
  { label: "Branches",            href: "/hq/branches",               icon: <MapPin size={16} />,          roles: ["admin"] },
  { label: "Roles & Permissions", href: "/hq/roles",                  icon: <KeySquare size={16} />,       roles: ["admin"], highlight: true },

  // HQ — Research & Security
  { label: "Privacy Attacks",     href: "/hq/privacy-attacks",        icon: <FlaskConical size={16} />,    roles: ["admin"], highlight: true },
  { label: "FL Benchmark",        href: "/hq/benchmark",              icon: <GitCompare size={16} />,      roles: ["admin"] },
  { label: "Watermarking",        href: "/hq/watermarking",           icon: <Stamp size={16} />,           roles: ["admin"] },
  { label: "Branch Map",          href: "/hq/branch-map",             icon: <MapPin size={16} />,          roles: ["admin"] },
  { label: "Fairness Audit",      href: "/hq/fairness",               icon: <Scale size={16} />,           roles: ["admin"], highlight: true },
  { label: "FL Convergence",      href: "/hq/convergence",            icon: <TrendingUp size={16} />,      roles: ["admin"] },
  { label: "Model Drift",         href: "/hq/drift",                  icon: <AlertOctagon size={16} />,    roles: ["admin"] },
  { label: "FL Network",          href: "/hq/network",                icon: <Network size={16} />,         roles: ["admin"] },
  { label: "HE Demo",             href: "/hq/he-demo",                icon: <Lock size={16} />,            roles: ["admin"] },
  { label: "Branch Leaderboard", href: "/hq/leaderboard",            icon: <Trophy size={16} />,          roles: ["admin"], highlight: true },

  // HQ — Research & Security (new)
  // { label: "Branch Explain",    href: "/hq/branch-explainability",  icon: <Brain size={16} />,           roles: ["admin"], highlight: true },
  { label: "Split Learning",    href: "/hq/split-learning",         icon: <Cpu size={16} />,             roles: ["admin"], highlight: true },
  { label: "ZKP Demo",          href: "/hq/zkp-demo",               icon: <Lock size={16} />,            roles: ["admin"], highlight: true },
  { label: "FL Simulator",      href: "/hq/fl-simulator",           icon: <Activity size={16} />,        roles: ["admin"], highlight: true },

  // Cashier / Teller
  { label: "Teller Desk",       href: "/cashier/teller",            icon: <Wallet size={16} />,          roles: ["cashier"], highlight: true },
  { label: "Cash Position",     href: "/cashier/cash-position",     icon: <BookOpenCheck size={16} />,   roles: ["cashier"] },

  // CEO / IT consoles
  { label: "Executive",         href: "/hq/executive",              icon: <TrendingUp size={16} />,      roles: ["ceo"], highlight: true },
  { label: "IT Console",        href: "/hq/it-console",             icon: <Server size={16} />,          roles: ["it_admin"], highlight: true },

  // Customer — AI & Credit (new)
  { label: "Health Score",      href: "/customer/health-score",     icon: <Heart size={16} />,           roles: ["customer"], highlight: true },
  { label: "Loan Eligibility",  href: "/customer/loan-eligibility", icon: <CheckCircle2 size={16} />,    roles: ["customer"], highlight: true },
  { label: "Spending",          href: "/customer/spending",         icon: <BarChart3 size={16} />,       roles: ["customer"] },
  // { label: "MeroShare / IPO",   href: "/customer/meroshare",        icon: <TrendingUp size={16} />,      roles: ["customer"], highlight: true },
  // { label: "Dollar Card",       href: "/customer/dollar-card",      icon: <CreditCard size={16} />,      roles: ["customer"], highlight: true },
  { label: "Card Controls",     href: "/customer/card-controls",    icon: <Lock size={16} />,            roles: ["customer"] },
  { label: "Notifications",     href: "/customer/notifications",    icon: <Bell size={16} />,            roles: ["customer"] },
];

export const SECTION_GROUPS: Record<UserRole, { label: string; hrefs: string[] }[]> = {
  branch_manager: [
    { label: "Core Banking",        hrefs: ["/branch/dashboard", "/branch/clients", "/branch/account-applications", "/branch/kyc-applications", "/branch/service-requests", "/branch/eod"] },
    { label: "Intelligence",        hrefs: ["/branch/ai-models", "/branch/cashflow", "/branch/cash-demand", "/branch/unified-risk", "/branch/cross-sell", "/branch/handwriting", "/branch/copilot", "/branch/hq-assess", "/branch/customers"] },
    { label: "Risk & Compliance",   hrefs: ["/branch/fraud-alerts", "/branch/fraud-ml", "/branch/aml", "/branch/loan-assessment", "/branch/collateral-estimator", "/branch/rate-optimizer", "/branch/remittance-analyzer", "/branch/records", "/branch/churn", "/branch/data-drift", "/branch/background-verify", "/branch/approvals", "/branch/fraud-stream", "/branch/par", "/branch/sar"] },
  ],
  customer: [
    { label: "AI & Credit",         hrefs: ["/customer/dashboard", "/customer/explainability", "/customer/whatif", "/customer/journey", "/customer/robo-advisor", "/customer/cashflow", "/customer/risk-profile", "/customer/health-score", "/customer/loan-eligibility", "/customer/spending"] },
    { label: "Onboarding",          hrefs: ["/customer/kyc", "/customer/counterfactual", "/customer/loan-apply", "/customer/kyc-verify"] },
    { label: "Banking",             hrefs: ["/customer/accounts", "/customer/statement", "/customer/transfer", "/customer/fd", "/customer/loans", "/customer/cards", "/customer/card-controls", "/customer/qr-pay", "/customer/payees", "/customer/cheque-deposit", "/customer/notifications", "/customer/apply-account", "/customer/applications", "/customer/security-audit"] },
    // { label: "Invest",              hrefs: ["/customer/meroshare", "/customer/dollar-card"] },
    { label: "Account",             hrefs: ["/customer/profile", "/customer/password"] },
  ],
  admin: [
    { label: "HQ Command",          hrefs: ["/hq/dashboard", "/hq/federation", "/hq/models", "/hq/analytics", "/hq/records", "/hq/audit"] },
    { label: "Administration",      hrefs: ["/hq/users", "/hq/branches", "/hq/roles"] },
    { label: "Analytics & Risk",    hrefs: ["/hq/gl", "/hq/chain", "/hq/compliance", "/hq/stress-test", "/hq/privacy-budget", "/hq/leaderboard"] },
    { label: "Platform",            hrefs: ["/hq/security", "/hq/pi-devices"] },
    { label: "Research & Security", hrefs: ["/hq/privacy-attacks", "/hq/benchmark", "/hq/watermarking", "/hq/branch-map", "/hq/fairness", "/hq/convergence", "/hq/drift", "/hq/network", "/hq/he-demo", "/hq/branch-explainability", "/hq/split-learning", "/hq/zkp-demo", "/hq/fl-simulator"] },
  ],
  cashier: [
    { label: "Teller", hrefs: ["/cashier/teller", "/cashier/cash-position"] },
  ],
  it_admin: [
    { label: "IT", hrefs: ["/hq/it-console"] },
  ],
  ceo: [
    { label: "Executive", hrefs: ["/hq/executive"] },
  ],
  viewer: [],
};

export const ROLE_META: Record<UserRole, { label: string; accent: string; dot: string }> = {
  customer:       { label: "Customer Portal",    accent: "from-teal to-teal-deep",         dot: "bg-teal" },
  branch_manager: { label: "Branch Manager",     accent: "from-[#11203A] to-[#27406a]",    dot: "bg-teal" },
  admin:          { label: "HQ Command Center",  accent: "from-[#B8860B] to-[#8a6608]",    dot: "bg-gold" },
  cashier:        { label: "Teller / Cashier",   accent: "from-[#0f5132] to-[#198754]",    dot: "bg-emerald-400" },
  it_admin:       { label: "IT Department",      accent: "from-[#1e3a5f] to-[#2d5a8a]",    dot: "bg-blue-400" },
  ceo:            { label: "Executive Office",   accent: "from-[#4a2c5a] to-[#6b3f82]",    dot: "bg-purple-400" },
  viewer:         { label: "Viewer",             accent: "from-gray-600 to-gray-700",      dot: "bg-gray-400" },
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [coffee, setCoffee] = useState(false);

  if (!user) return null;

  const allItems  = NAV_ITEMS.filter((i) => i.roles.includes(user.role));
  const groups    = SECTION_GROUPS[user.role] ?? [];
  const meta      = ROLE_META[user.role];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const initials = user.full_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 bg-surface text-ink-soft border-r border-line select-none">

      {/* ── Brand header ──────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-line">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.accent} flex items-center justify-center shadow-sm`}>
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-ink tracking-tight leading-none">SecureScore</h1>
            <p className="text-[11px] text-ink-faint font-medium mt-0.5">{meta.label}</p>
          </div>
        </div>
      </div>

      {/* ── User info ─────────────────────────────────────── */}
      <div className="px-4 py-3.5 border-b border-line">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${meta.accent} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate leading-tight">{user.full_name}</p>
            <p className="text-[11px] text-ink-faint truncate capitalize mt-0.5">
              {user.branch_id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </p>
          </div>
          <div className={`w-2 h-2 rounded-full ${meta.dot} shrink-0 shadow-[0_0_6px_currentColor]`} />
        </div>
      </div>

      {/* ── Nav ───────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-none space-y-5">
        {groups.map((group) => {
          const groupItems = allItems.filter((i) => group.hrefs.includes(i.href));
          if (!groupItems.length) return null;
          return (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-ink-faint uppercase tracking-[0.14em] px-3 mb-1.5">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {groupItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 relative",
                          active
                            ? "bg-teal-soft text-teal-deep"
                            : "text-ink-soft hover:bg-canvas hover:text-ink",
                        )}
                      >
                        {/* Active accent bar */}
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-teal" />
                        )}

                        <span className={clsx(
                          "shrink-0 transition-colors",
                          active ? "text-teal" : item.highlight ? "text-gold" : "text-ink-faint group-hover:text-ink-soft",
                        )}>
                          {item.icon}
                        </span>

                        <span className="flex-1 truncate">{item.label}</span>

                        {item.highlight && !active && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide bg-gold-soft text-gold rounded-full px-1.5 py-0.5">
                            <Sparkles size={8} />AI
                          </span>
                        )}

                        {item.badge && !item.highlight && (
                          <span className="text-[10px] font-bold bg-line text-ink-soft rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                            {item.badge}
                          </span>
                        )}

                        {active && <ChevronRight size={12} className="text-teal/50 shrink-0" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── Footer ────────────────────────────────────────── */}
      <div className="px-3 py-3 border-t border-line">
        <button
          onClick={() => setCoffee(true)}
          className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-[13px] font-medium text-ink-soft hover:bg-gold-soft hover:text-gold transition-colors duration-150 group mb-1"
        >
          <Coffee size={15} className="text-gold group-hover:scale-110 transition-transform" />
          Buy me a coffee
        </button>
        {coffee && <CoffeeModal onClose={() => setCoffee(false)} />}
        <CoffeeThanks />
        <button
          onClick={logout}
          className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-[13px] font-medium text-ink-soft hover:bg-red-50 hover:text-danger transition-colors duration-150 group"
        >
          <LogOut size={15} className="group-hover:-translate-x-0.5 transition-transform" />
          Sign Out
        </button>
        <p className="text-[10px] text-ink-faint text-center mt-2">SecureScore v2.0 · Federated ML</p>
      </div>
    </aside>
  );
}
