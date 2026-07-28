"use client";

// Global Ctrl/Cmd-K launcher. Reuses the sidebar NAV_ITEMS (already role-tagged)
// so every page a user can see is jump-to-able. ponytail: substring match, no fuzzy
// lib — add fuse.js only if ranking ever matters.

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS } from "@/components/sidebar";

export function CommandPalette() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const openEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", openEvt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", openEvt);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const role = user?.role;
    const mine = NAV_ITEMS.filter((n) => !role || n.roles.includes(role));
    const term = q.trim().toLowerCase();
    if (!term) return mine.slice(0, 8);
    return mine.filter((n) => n.label.toLowerCase().includes(term) || n.href.toLowerCase().includes(term)).slice(0, 12);
  }, [q, user]);

  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 backdrop-blur-sm pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Search size={16} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].href); }
            }}
            placeholder="Jump to a page…"
            className="flex-1 bg-transparent py-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="hidden sm:block text-[10px] text-ink-faint border border-line rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-faint">No matching pages.</li>
          )}
          {results.map((n, i) => (
            <li key={n.href}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(n.href)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? "bg-teal-soft text-teal-deep" : "text-ink hover:bg-canvas"
                }`}
              >
                <span className="shrink-0 [&>svg]:w-4 [&>svg]:h-4">{n.icon}</span>
                <span className="flex-1 truncate">{n.label}</span>
                {i === active && <CornerDownLeft size={13} className="text-ink-faint shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
