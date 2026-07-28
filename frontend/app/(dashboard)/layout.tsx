"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { CommandPalette } from "@/components/command-palette";
import { ChatWidget } from "@/components/chat-widget";
import { DemoModeProvider } from "@/components/demo-mode";
import { FinancialTicker } from "@/components/financial-ticker";
import { Desktop } from "@/components/desktop";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import neMessages from "@/messages/ne.json";

const MESSAGES = { en: enMessages, ne: neMessages } as const;
type Locale = keyof typeof MESSAGES;

// Research/demo pages whose figures are generated for demonstration (CLAUDE.md §18b),
// not live production data. Shown with an explicit banner so nothing is mistaken for real.
const SIM_ROUTES = new Set([
  "/hq/privacy-attacks", "/hq/benchmark", "/hq/watermarking", "/hq/fairness",
  "/hq/convergence", "/hq/drift", "/hq/network", "/hq/he-demo", "/hq/split-learning",
  "/hq/zkp-demo", "/hq/fl-simulator", "/hq/leaderboard", "/hq/branch-explainability",
  "/hq/compliance",
]);

function SimBanner() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-gold/30 bg-gold-soft px-3 py-2 text-xs text-gold">
      <FlaskConical size={14} className="shrink-0" />
      <span><strong>Illustrative simulation.</strong> Figures on this page are generated deterministically for demonstration — not live production data.</span>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isSim = SIM_ROUTES.has(pathname);
  const [locale, setLocale] = useState<Locale>("en");
  // null = context not yet known; true = rendered inside a desktop window (iframe).
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  // "sidebar" (default, fast) | "desktop" (windowed showcase). Persisted locally.
  const [shell, setShell] = useState<"sidebar" | "desktop">("sidebar");

  useEffect(() => {
    setEmbedded(window.self !== window.top);
    const saved = localStorage.getItem("shell_mode");
    if (saved === "desktop") setShell("desktop");
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [loading, user, router]);

  useEffect(() => {
    const saved = localStorage.getItem("lang") as Locale | null;
    if (saved && saved in MESSAGES) setLocale(saved);
    const handler = () => {
      const next = localStorage.getItem("lang") as Locale | null;
      if (next && next in MESSAGES) setLocale(next);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setShellMode = (mode: "sidebar" | "desktop") => {
    localStorage.setItem("shell_mode", mode);
    setShell(mode);
  };

  if (loading || !user || embedded === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Page rendered inside a desktop window (iframe) — bare content, no shell.
  if (embedded) {
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <DemoModeProvider>
          <div className="min-h-screen bg-canvas">
            <main className="p-6">
              {isSim && <SimBanner />}
              {children}
            </main>
          </div>
        </DemoModeProvider>
      </NextIntlClientProvider>
    );
  }

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <DemoModeProvider>
        <CommandPalette />
        {shell === "desktop" ? (
          <>
            <Desktop onExit={() => setShellMode("sidebar")} />
            <FinancialTicker />
            {user.role === "customer" && <ChatWidget bottom="bottom-12" />}
          </>
        ) : (
          <div className="flex min-h-screen bg-canvas">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <TopBar onEnterDesktop={() => setShellMode("desktop")} />
              <main key={pathname} className="flex-1 min-w-0 p-6 animate-fade-in overflow-x-hidden">
                {isSim && <SimBanner />}
                {children}
              </main>
              {user.role === "customer" && <ChatWidget />}
            </div>
          </div>
        )}
      </DemoModeProvider>
    </NextIntlClientProvider>
  );
}
