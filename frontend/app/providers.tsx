"use client";

import { AuthProvider } from "@/lib/auth-context";
import { WsProvider } from "@/lib/ws-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { SessionExpiryToast } from "@/components/session-expiry-toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary context="root">
      <AuthProvider>
        <WsProvider>
          {children}
          <SessionExpiryToast />
        </WsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
