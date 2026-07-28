"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, SECTION_GROUPS, ROLE_META } from "@/components/sidebar";
import { Window, type WinState } from "@/components/window";
import { LayoutGrid, Search, LogOut, Building2, Power, PanelLeft } from "lucide-react";

export function Desktop({ onExit }: { onExit?: () => void }) {
  const { user, logout } = useAuth();
  const [windows, setWindows] = useState<WinState[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState("");
  const z = useRef(10);
  const opened = useRef(false);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 1000 * 30);
    return () => clearInterval(t);
  }, []);

  const apps = useMemo(
    () => (user ? NAV_ITEMS.filter((i) => i.roles.includes(user.role)) : []),
    [user],
  );

  // Auto-open the role's primary app so the desktop isn't empty on first load.
  useEffect(() => {
    if (opened.current || apps.length === 0) return;
    opened.current = true;
    const a = apps[0];
    const maxW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
    setWindows([{
      id: `${a.href}-${Date.now()}`, href: a.href, label: a.label, icon: a.icon,
      x: 80, y: 40, w: Math.min(940, maxW - 120), h: Math.min(620, maxH - 140),
      z: ++z.current, minimized: false, maximized: false,
    }]);
  }, [apps]);
  const groups = user ? SECTION_GROUPS[user.role] ?? [] : [];
  const meta = user ? ROLE_META[user.role] : null;

  if (!user || !meta) return null;

  const focus = (id: string) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++z.current, minimized: false } : w)));

  const open = (href: string, label: string, icon: React.ReactNode) => {
    setStartOpen(false);
    setWindows((ws) => {
      const existing = ws.find((w) => w.href === href);
      if (existing) return ws.map((w) => (w.id === existing.id ? { ...w, z: ++z.current, minimized: false } : w));
      const n = ws.length;
      const maxW = typeof window !== "undefined" ? window.innerWidth : 1280;
      const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
      return [
        ...ws,
        {
          id: `${href}-${Date.now()}`,
          href, label, icon,
          x: 60 + (n % 6) * 34,
          y: 30 + (n % 6) * 34,
          w: Math.min(940, maxW - 120),
          h: Math.min(620, maxH - 140),
          z: ++z.current,
          minimized: false,
          maximized: false,
        },
      ];
    });
  };

  const close = (id: string) => setWindows((ws) => ws.filter((w) => w.id !== id));
  const minimize = (id: string) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  const toggleMax = (id: string) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, maximized: !w.maximized, z: ++z.current } : w)));
  const change = (id: string, geom: Partial<WinState>) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...geom } : w)));

  const topZ = Math.max(0, ...windows.filter((w) => !w.minimized).map((w) => w.z));
  const filtered = query
    ? apps.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : null;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-slate-900">
      {/* Wallpaper */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 600px at 20% 10%, #1e3a8a40, transparent), radial-gradient(900px 500px at 90% 80%, #6d28d940, transparent), linear-gradient(135deg, #0b1220, #131a2b)",
        }}
      />

      {/* Desktop work area */}
      <div className="relative flex-1 min-h-0">
        {/* Desktop icons */}
        <div className="absolute top-4 left-4 grid grid-flow-col grid-rows-[repeat(7,minmax(0,1fr))] gap-1 content-start">
          {apps.map((a) => (
            <button
              key={a.href}
              onClick={() => open(a.href, a.label, a.icon)}
              className="w-20 h-20 flex flex-col items-center justify-center gap-1 rounded-lg text-white/90 hover:bg-white/10 focus:bg-white/15 outline-none transition-colors"
              title={`Open ${a.label}`}
            >
              <span className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5 shadow">
                {a.icon}
              </span>
              <span className="text-[10px] leading-tight text-center line-clamp-2 px-0.5">{a.label}</span>
            </button>
          ))}
        </div>

        {/* Windows */}
        {windows.map((w) => (
          <Window
            key={w.id}
            win={w}
            focused={w.z === topZ && !w.minimized}
            onFocus={() => focus(w.id)}
            onClose={() => close(w.id)}
            onMinimize={() => minimize(w.id)}
            onToggleMax={() => toggleMax(w.id)}
            onChange={(geom) => change(w.id, geom)}
          />
        ))}
      </div>

      {/* Start menu */}
      {startOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setStartOpen(false)} />
          <div className="absolute bottom-12 left-2 z-50 w-[420px] max-h-[70vh] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl flex flex-col text-white overflow-hidden">
            <div className={`px-4 py-3 bg-gradient-to-r ${meta.accent} flex items-center gap-2`}>
              <Building2 size={18} />
              <div>
                <p className="text-sm font-bold leading-tight">SecureScore</p>
                <p className="text-[11px] text-white/70">{meta.label}</p>
              </div>
            </div>
            <div className="p-2 border-b border-white/10">
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-2.5 py-1.5">
                <Search size={14} className="text-white/50" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search apps…"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-white/40"
                />
              </div>
            </div>
            <div className="overflow-y-auto p-2 space-y-3">
              {filtered ? (
                <div className="grid grid-cols-1 gap-0.5">
                  {filtered.map((a) => (
                    <StartItem key={a.href} a={a} onOpen={open} />
                  ))}
                  {filtered.length === 0 && <p className="text-xs text-white/40 px-2 py-3">No apps match.</p>}
                </div>
              ) : (
                groups.map((g) => {
                  const items = apps.filter((a) => g.hrefs.includes(a.href));
                  if (!items.length) return null;
                  return (
                    <div key={g.label}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 px-2 mb-1">{g.label}</p>
                      <div className="grid grid-cols-2 gap-0.5">
                        {items.map((a) => (
                          <StartItem key={a.href} a={a} onOpen={open} />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-white/10 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-white/70 truncate">{user.full_name}</span>
              <button onClick={logout} className="flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200">
                <Power size={13} />Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* Taskbar */}
      <div className="relative z-30 h-12 shrink-0 flex items-center gap-1 px-2 bg-slate-950/80 backdrop-blur-xl border-t border-white/10">
        <button
          onClick={() => setStartOpen((s) => !s)}
          className={`flex items-center gap-2 px-3 h-9 rounded-lg font-semibold text-sm text-white transition-colors ${
            startOpen ? "bg-white/20" : "hover:bg-white/10"
          }`}
        >
          <LayoutGrid size={16} />Start
        </button>
        <div className="w-px h-6 bg-white/10 mx-1" />
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
          {windows.map((w) => {
            const active = w.z === topZ && !w.minimized;
            return (
              <button
                key={w.id}
                onClick={() => (active ? minimize(w.id) : focus(w.id))}
                className={`flex items-center gap-2 px-3 h-9 rounded-lg text-xs font-medium text-white whitespace-nowrap transition-colors border-b-2 ${
                  active ? "bg-white/15 border-blue-400" : "bg-white/5 border-transparent hover:bg-white/10"
                } ${w.minimized ? "opacity-60" : ""}`}
              >
                <span className="[&_svg]:w-3.5 [&_svg]:h-3.5">{w.icon}</span>
                <span className="max-w-[120px] truncate">{w.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 px-2 text-white/80">
          {onExit && (
            <button
              onClick={onExit}
              title="Exit desktop — back to dashboard"
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium hover:bg-white/10"
            >
              <PanelLeft size={14} />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
          )}
          <button onClick={logout} title="Sign out" className="p-1.5 rounded hover:bg-white/10">
            <LogOut size={15} />
          </button>
          <span className="text-xs font-medium tabular-nums">{clock}</span>
        </div>
      </div>
    </div>
  );
}

function StartItem({
  a,
  onOpen,
}: {
  a: { href: string; label: string; icon: React.ReactNode };
  onOpen: (href: string, label: string, icon: React.ReactNode) => void;
}) {
  return (
    <button
      onClick={() => onOpen(a.href, a.label, a.icon)}
      className="flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/10 transition-colors"
    >
      <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 [&_svg]:w-4 [&_svg]:h-4">
        {a.icon}
      </span>
      <span className="truncate">{a.label}</span>
    </button>
  );
}
