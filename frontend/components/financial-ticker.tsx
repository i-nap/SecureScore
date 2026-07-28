"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Activity } from "lucide-react";

const BRANCHES = [
  "Kathmandu", "Lalitpur", "Pokhara", "Bharatpur", "Biratnagar",
  "Butwal", "Hetauda", "Itahari", "Dharan", "Janakpur",
  "Birgunj", "Nepalgunj", "Sarlahi",
];

const TX_TYPES = ["Transfer", "Loan Payment", "Deposit", "Remittance", "Withdrawal"];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatNPR(n: number) {
  return n.toLocaleString("en-NP");
}

interface Tick {
  id: string;
  time: string;
  from: string;
  to: string;
  amount: number;
  type: string;
  suspicious: boolean;
}

function generateTick(): Tick {
  const from = randomPick(BRANCHES);
  let to = randomPick(BRANCHES);
  while (to === from) to = randomPick(BRANCHES);
  const now = new Date();
  return {
    id: `${Date.now()}-${Math.random()}`,
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    from,
    to,
    amount: randomInt(10000, 500000),
    type: randomPick(TX_TYPES),
    suspicious: Math.random() < 0.07, // ~7% suspicious
  };
}

export function FinancialTicker() {
  const [ticks, setTicks] = useState<Tick[]>(() =>
    Array.from({ length: 8 }, generateTick)
  );
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false); // shown by default; the effect hides it if previously dismissed
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHidden(localStorage.getItem("livetx_hidden") === "1");
  }, []);

  const dismiss = () => {
    localStorage.setItem("livetx_hidden", "1");
    setHidden(true);
  };

  const restore = () => {
    localStorage.removeItem("livetx_hidden");
    setHidden(false);
  };

  const addTick = useCallback(() => {
    const tick = generateTick();
    setTicks((prev) => [tick, ...prev].slice(0, 20));
    if (tick.suspicious) {
      setFlashId(tick.id);
      setTimeout(() => setFlashId(null), 800);
    }
  }, []);

  useEffect(() => {
    if (paused || hidden) return;
    const id = setInterval(addTick, 500);
    return () => clearInterval(id);
  }, [paused, hidden, addTick]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [ticks, paused]);

  // All hooks above this line always run — keep the early return last.
  if (hidden) {
    return (
      <button
        onClick={restore}
        title="Show live transactions"
        className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full bg-gray-950 text-gray-200 hover:text-white border border-gray-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-lift"
      >
        <Activity size={12} className="text-teal" />
        Live Tx
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800 flex items-center h-8 select-none">
      {/* Label */}
      <div className="flex items-center gap-1.5 px-3 border-r border-gray-800 shrink-0 h-full">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Live Tx</span>
      </div>

      {/* Scrolling ticks */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto flex items-center gap-0 h-full scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex items-center gap-0 whitespace-nowrap">
          {ticks.map((tick) => (
            <span
              key={tick.id}
              className={`inline-flex items-center gap-1 px-3 h-full text-[11px] font-mono border-r border-gray-800 transition-colors ${
                tick.suspicious
                  ? flashId === tick.id
                    ? "bg-red-900 text-red-200"
                    : "text-red-400"
                  : "text-ink-faint"
              }`}
            >
              <span className="text-ink-soft">[{tick.time}]</span>
              <span className={tick.suspicious ? "text-red-300 font-semibold" : "text-gray-300"}>
                {tick.from}
              </span>
              <span className="text-ink-soft">→</span>
              <span className={tick.suspicious ? "text-red-300 font-semibold" : "text-gray-300"}>
                {tick.to}
              </span>
              <span className="text-ink-soft">|</span>
              <span className="text-emerald-400">NPR {formatNPR(tick.amount)}</span>
              <span className="text-ink-soft">|</span>
              <span className="text-blue-400">{tick.type}</span>
              <span className="text-ink-soft">|</span>
              {tick.suspicious ? (
                <span className="text-red-400 font-bold">! Suspicious</span>
              ) : (
                <span className="text-green-400">✓ Normal</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Pause/Resume */}
      <button
        onClick={() => setPaused((v) => !v)}
        className="px-3 border-l border-gray-800 text-[10px] font-bold text-ink-soft hover:text-gray-300 transition-colors h-full shrink-0"
      >
        {paused ? "▶ RESUME" : "⏸ PAUSE"}
      </button>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        title="Hide live transactions"
        aria-label="Hide live transactions"
        className="px-2.5 border-l border-gray-800 text-ink-soft hover:text-white transition-colors h-full shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  );
}
