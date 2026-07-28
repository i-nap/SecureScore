"use client";

import { useState } from "react";
import { branchCopilot, type CopilotResponse } from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { Bot, Sparkles, Send, ShieldCheck, User } from "lucide-react";

const SUGGESTIONS = [
  "How is my loan portfolio doing?",
  "Where should I focus my deposits effort?",
  "What's pending in my work queue?",
  "Summarise this branch's health.",
];

const npr = (n: number) => {
  if (Math.abs(n) >= 1e7) return `NPR ${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `NPR ${(n / 1e5).toFixed(1)} L`;
  return "NPR " + n.toLocaleString("en-NP");
};

interface Turn { q: string; res: CopilotResponse }

export default function CopilotPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async (q: string) => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true); setError("");
    try {
      const res = await branchCopilot(query);
      setTurns((t) => [{ q: query, res }, ...t]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copilot failed");
    } finally {
      setBusy(false);
    }
  };

  const latestMetrics = turns[0]?.res.metrics;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <Bot size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Branch operations · LLM analytics</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Branch Copilot</h1>
        <p className="mt-1 text-white/55 text-sm">Ask about your branch in plain language. It reasons only over aggregate figures — no customer data leaves the branch.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Conversation */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-end gap-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
                rows={2}
                placeholder="Ask about loans, deposits, your work queue…"
                className="flex-1 border border-line rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
              <Button onClick={() => ask(question)} loading={busy} disabled={!question.trim()}><Send size={15} /></Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} disabled={busy}
                  className="text-xs px-2.5 py-1 rounded-full border border-line text-ink-soft hover:bg-canvas hover:border-teal transition-colors disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-danger mt-2">{error}</p>}
          </Card>

          {busy && (
            <Card><div className="flex items-center gap-2 text-ink-soft text-sm"><Spinner size="sm" /> Thinking…</div></Card>
          )}

          {turns.map((t, i) => (
            <Card key={i} className="space-y-3 animate-fade-up">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-ink/5 flex items-center justify-center shrink-0"><User size={14} className="text-ink-soft" /></div>
                <p className="text-sm font-medium text-ink pt-1">{t.q}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-teal-soft flex items-center justify-center shrink-0"><Bot size={14} className="text-teal" /></div>
                <div className="flex-1">
                  <p className="text-sm text-ink-soft leading-relaxed">{t.res.answer}</p>
                  <div className="mt-2">
                    <Badge variant={t.res.source === "llm" ? "success" : "default"}>
                      <Sparkles size={11} />{t.res.source === "llm" ? t.res.model : "rule-based fallback"}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {turns.length === 0 && !busy && (
            <Card><p className="text-sm text-ink-faint text-center py-6">Ask a question or tap a suggestion to begin.</p></Card>
          )}
        </div>

        {/* Transparency: what the model can see */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} className="text-teal" />
            <h2 className="font-display text-base font-semibold text-ink">What the copilot sees</h2>
          </div>
          <p className="text-xs text-ink-faint mb-4">Only these aggregates — never names or accounts.</p>
          {latestMetrics ? (
            <div className="space-y-2 text-sm">
              <MetricRow label="Active accounts" value={`${latestMetrics.active_accounts} (${latestMetrics.dormant_accounts} dormant)`} />
              <MetricRow label="Total deposits" value={npr(latestMetrics.total_deposits)} />
              <MetricRow label="Txns (30d)" value={`${latestMetrics.txn_30d_count} · ${npr(latestMetrics.txn_30d_volume)}`} />
              <MetricRow label="Active loans" value={`${latestMetrics.active_loans} · ${npr(latestMetrics.loan_outstanding)}`} />
              <MetricRow label="Overdue installments" value={`${latestMetrics.overdue_installments}`} highlight={latestMetrics.overdue_installments > 0} />
              <MetricRow label="Fixed deposits" value={`${latestMetrics.active_fds} · ${npr(latestMetrics.fd_principal)}`} />
              <MetricRow label="Pending apps / cheques" value={`${latestMetrics.pending_applications} / ${latestMetrics.pending_cheques}`} />
            </div>
          ) : (
            <p className="text-xs text-ink-faint">Ask a question to see the figures it reasoned over.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 pb-1.5">
      <span className="text-ink-soft">{label}</span>
      <span className={`font-semibold nums ${highlight ? "text-danger" : "text-ink"}`}>{value}</span>
    </div>
  );
}
