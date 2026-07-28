"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

// ─── Step definitions ────────────────────────────────────────────────────────

interface DemoStep {
  title: string;
  description: string;
  highlight?: string; // CSS class to apply to highlighted element (future use)
  duration: number;   // ms before auto-advance
}

const DEMO_STEPS: DemoStep[] = [
  {
    title: "Welcome to SecureScore",
    description: "A Privacy-Preserving Federated Credit Scoring Platform — built for Nepal's banking ecosystem.",
    duration: 3000,
  },
  {
    title: "Local Model Training",
    description: "Branch nodes train local XGBoost models on private customer data — data never leaves the branch. Your customers' financial records stay on-premise.",
    highlight: "branch-portal",
    duration: 4000,
  },
  {
    title: "Secure Weight Submission",
    description: "Model weights (not data) are submitted to HQ with SHA-256 integrity hashes. Only gradient updates travel over the network — never raw records.",
    duration: 4000,
  },
  {
    title: "Byzantine Fault Tolerance",
    description: "HQ validates each submission against Byzantine fault tolerance thresholds. Poisoned or anomalous model updates are automatically rejected.",
    duration: 4000,
  },
  {
    title: "FedAvg Aggregation",
    description: "Federated Averaging combines all branch models into a stronger global model. Each branch contributes proportionally to its dataset size.",
    duration: 4000,
  },
  {
    title: "Differential Privacy",
    description: "Differential privacy noise is applied — your ε budget is tracked in real-time. Mathematical privacy guarantees protect individual customer data.",
    duration: 3000,
  },
  {
    title: "Global Model Published",
    description: "The global model is published to all branches and available for credit decisions. Accuracy improves with every federation round.",
    duration: 3000,
  },
  {
    title: "Tamper-Evident Audit Trail",
    description: "All events are logged in a tamper-evident SHA-256 hash chain — fully auditable. Every federation round, model update, and decision is cryptographically recorded.",
    duration: 4000,
  },
];

// ─── Context ─────────────────────────────────────────────────────────────────

interface DemoModeState {
  active: boolean;
  step: number;
  totalSteps: number;
  start: () => void;
  next: () => void;
  exit: () => void;
}

const DemoModeContext = createContext<DemoModeState>({
  active: false,
  step: 0,
  totalSteps: DEMO_STEPS.length,
  start: () => {},
  next: () => {},
  exit: () => {},
});

export function useDemoMode() {
  return useContext(DemoModeContext);
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const advance = useCallback((currentStep: number) => {
    if (currentStep >= DEMO_STEPS.length - 1) {
      setActive(false);
      setStep(0);
    } else {
      setStep(currentStep + 1);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    clearTimer();
    const duration = DEMO_STEPS[step]?.duration ?? 4000;
    timerRef.current = setTimeout(() => advance(step), duration);
    return clearTimer;
  }, [active, step, advance]);

  const start = () => {
    setStep(0);
    setActive(true);
  };

  const next = () => {
    clearTimer();
    advance(step);
  };

  const exit = () => {
    clearTimer();
    setActive(false);
    setStep(0);
  };

  return (
    <DemoModeContext.Provider value={{ active, step, totalSteps: DEMO_STEPS.length, start, next, exit }}>
      {children}
      <DemoOverlay />
    </DemoModeContext.Provider>
  );
}

// ─── Overlay UI ──────────────────────────────────────────────────────────────

function DemoOverlay() {
  const { active, step, totalSteps, next, exit } = useDemoMode();
  const currentStep = DEMO_STEPS[step];
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !currentStep) return;
    setProgress(0);
    const duration = currentStep.duration;
    const interval = 50;
    const increment = (interval / duration) * 100;

    progressRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + increment, 100));
    }, interval);

    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [active, step, currentStep]);

  if (!active || !currentStep) return null;

  const stepNum = step + 1;
  const pct = Math.round((stepNum / totalSteps) * 100);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4"
      style={{ animation: "demo-slide-up 0.35s ease-out" }}
    >
      <style>{`
        @keyframes demo-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(24px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes demo-pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.5); }
          70%  { box-shadow: 0 0 0 12px rgba(99,102,241,0); }
          100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
        }
      `}</style>

      <div
        className="rounded-2xl border border-indigo-500/30 overflow-hidden shadow-2xl"
        style={{
          background: "linear-gradient(135deg, rgba(15,17,30,0.97) 0%, rgba(30,27,75,0.97) 100%)",
          animation: "demo-pulse-ring 2s infinite",
        }}
      >
        {/* Top bar with step counter and exit */}
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs font-bold text-indigo-300 tracking-widest uppercase">Demo Mode</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-soft font-mono">
              {stepNum}/{totalSteps}
            </span>
            <button
              onClick={exit}
              className="text-ink-soft hover:text-gray-200 transition-colors text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5"
            >
              <span>&#10005;</span>
              <span>Exit</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-3">
          <h3 className="text-white font-bold text-base mb-1 leading-tight">{currentStep.title}</h3>
          <p className="text-gray-300 text-sm leading-relaxed">{currentStep.description}</p>
        </div>

        {/* Progress bar + next button */}
        <div className="px-5 pb-4 flex items-center gap-4">
          {/* Overall step progress dots */}
          <div className="flex items-center gap-1 flex-1">
            {DEMO_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i < step
                    ? "bg-indigo-400"
                    : i === step
                    ? "bg-indigo-300 flex-[2]"
                    : "bg-white/10"
                }`}
                style={{ flex: i === step ? 2 : 1 }}
              />
            ))}
          </div>

          {/* Auto-advance timer bar */}
          <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>

          <button
            onClick={next}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shrink-0"
          >
            {step === totalSteps - 1 ? "Finish" : "Next"}
            {step < totalSteps - 1 && <span>&#8594;</span>}
          </button>
        </div>

        {/* Bottom overall fill bar */}
        <div className="h-1 bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Floating Demo Button ─────────────────────────────────────────────────────

export function DemoButton() {
  const { active, start, exit } = useDemoMode();

  return (
    <button
      onClick={active ? exit : start}
      className={`
        fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg
        text-sm font-bold transition-all duration-200
        ${active
          ? "bg-red-600 hover:bg-red-500 text-white"
          : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/30 hover:shadow-xl hover:-translate-y-0.5"
        }
      `}
      title={active ? "Exit demo mode" : "Start guided demo presentation"}
    >
      {active ? (
        <>
          <span className="w-2 h-2 rounded-full bg-white/70 animate-ping" />
          Stop Demo
        </>
      ) : (
        <>
          <span>&#9654;</span>
          Demo Mode
        </>
      )}
    </button>
  );
}
