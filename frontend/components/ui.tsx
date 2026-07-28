import { clsx } from "clsx";

/* ── Card ─────────────────────────────────────────────── */
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl bg-surface border border-line shadow-card p-6 transition-shadow duration-200 hover:shadow-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Stat card ────────────────────────────────────────── */
export function StatCard({
  label,
  value,
  sub,
  icon,
  color = "blue",
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  color?: "blue" | "green" | "red" | "amber" | "purple" | "violet" | "emerald" | "teal" | "gold" | "default";
  trend?: number;
}) {
  // Map the legacy color names onto the institutional accent set.
  const accent: Record<string, string> = {
    blue:    "text-teal bg-teal-soft",
    teal:    "text-teal bg-teal-soft",
    green:   "text-teal bg-teal-soft",
    emerald: "text-teal bg-teal-soft",
    gold:    "text-gold bg-gold-soft",
    amber:   "text-gold bg-gold-soft",
    purple:  "text-ink bg-line/60",
    violet:  "text-ink bg-line/60",
    red:     "text-danger bg-red-50",
    default: "text-ink-soft bg-line/60",
  };
  return (
    <div className="group rounded-2xl bg-surface border border-line shadow-card p-5 transition-shadow duration-200 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-[0.08em]">{label}</p>
          <p className="mt-1.5 text-3xl font-bold text-ink nums leading-none">{value}</p>
          {sub && <p className="mt-1.5 text-sm text-ink-soft">{sub}</p>}
        </div>
        {icon && (
          <div className={clsx("shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105", accent[color])}>
            {icon}
          </div>
        )}
      </div>
      {typeof trend === "number" && (
        <p className={clsx("mt-3 text-xs font-semibold nums", trend >= 0 ? "text-positive" : "text-danger")}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
        </p>
      )}
    </div>
  );
}

/* ── Badge ────────────────────────────────────────────── */
export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const cls: Record<string, string> = {
    default: "bg-line/70 text-ink-soft ring-line",
    success: "bg-teal-soft text-teal-deep ring-teal/20",
    warning: "bg-gold-soft text-gold ring-gold/25",
    danger:  "bg-red-50 text-danger ring-red-200",
    info:    "bg-ink/5 text-ink ring-ink/10",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset", cls[variant], className)}>
      {children}
    </span>
  );
}

/* ── Button ───────────────────────────────────────────── */
export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2.5 text-sm",
    lg: "px-5 py-3 text-base",
  };
  const vars: Record<string, string> = {
    primary:   "bg-teal text-white shadow-sm hover:bg-teal-deep",
    secondary: "bg-ink/5 text-ink hover:bg-ink/10",
    danger:    "bg-danger text-white hover:brightness-95",
    ghost:     "text-ink-soft hover:bg-ink/5",
    outline:   "border border-line text-ink bg-surface hover:bg-canvas",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={clsx(base, sizes[size], vars[variant], className)}>
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
}

/* ── Spinner ──────────────────────────────────────────── */
export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" };
  return (
    <svg className={clsx("animate-spin text-teal", s[size], className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/* ── EmptyState ───────────────────────────────────────── */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-ink-faint animate-fade-in">
      <div className="w-12 h-12 rounded-2xl bg-line/60 flex items-center justify-center mb-3">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
