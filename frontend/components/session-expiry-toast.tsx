"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

const WARNING_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 30 * 1000;            // check every 30s

function getTokenExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function SessionExpiryToast() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const handleExtend = useCallback(() => {
    // In a real system this would call /api/refresh_token
    setVisible(false);
  }, []);

  const handleLogout = useCallback(() => {
    logout?.();
    router.push("/");
  }, [logout, router]);

  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem("securescore_token") ?? "";
    if (!token) return;

    const interval = setInterval(() => {
      const expiry = getTokenExpiry(token);
      if (!expiry) return;

      const msLeft = expiry - Date.now();

      if (msLeft <= 0) {
        // Already expired — force logout
        clearInterval(interval);
        handleLogout();
        return;
      }

      if (msLeft <= WARNING_BEFORE_EXPIRY_MS) {
        setSecondsLeft(Math.floor(msLeft / 1000));
        setVisible(true);
      } else {
        setVisible(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user, handleLogout]);

  if (!visible) return null;

  const minutesLeft = Math.floor(secondsLeft / 60);

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full animate-slide-up">
      <div className="bg-amber-50 border border-amber-300 rounded-xl shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">Session expiring soon</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Your session expires in{" "}
              <span className="font-bold">
                {minutesLeft > 0 ? `${minutesLeft}m ${secondsLeft % 60}s` : `${secondsLeft}s`}
              </span>
              . Save your work.
            </p>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="flex-shrink-0 text-amber-400 hover:text-amber-600"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleLogout}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors"
          >
            Log out
          </button>
          <button
            onClick={handleExtend}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
