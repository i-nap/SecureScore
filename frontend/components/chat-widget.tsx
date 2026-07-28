"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth-context";
import { customerChat, type ChatResponse } from "@/lib/api";
import {
  Send, Bot, User, Sparkles, MessageSquare, ChevronDown, X,
  TrendingUp, HelpCircle, BarChart3, Lightbulb, Mic,
} from "lucide-react";

// ─── Speech Recognition hook ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

function useSpeechRecognition(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const startListening = () => {
    const w = window as AnySR;
    const SR: (new () => AnySR) | undefined = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec: AnySR = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e: AnySR) => onResult(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  };
  return { listening, startListening };
}

function isSpeechSupported() {
  if (typeof window === "undefined") return false;
  const w = window as AnySR;
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

// ─── Minimal markdown renderer (bold, bullets, line-breaks) ──────────────────

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const isBullet = /^(\s*[-•]|\s*\d+\.)/.test(line);
        const content = line.replace(/^(\s*[-•]|\s*\d+\.)\s*/, "");

        const renderInline = (s: string) => {
          const parts = s.split(/(\*\*[^*]+\*\*)/g);
          return parts.map((p, j) =>
            p.startsWith("**") && p.endsWith("**")
              ? <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>
              : p
          );
        };

        if (isBullet) {
          return (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-current opacity-40 shrink-0 mt-1">•</span>
              <span>{renderInline(content)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: <HelpCircle size={13} />,  text: "Why was I rejected?" },
  { icon: <BarChart3 size={13} />,   text: "What is my credit score?" },
  { icon: <TrendingUp size={13} />,  text: "How can I improve my score?" },
  { icon: <Lightbulb size={13} />,   text: "What factors hurt my score the most?" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  xai_context?: ChatResponse["xai_context"];
  poweredBy?: string;
  timestamp: Date;
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

// ─── Chat panel (the popup body) ─────────────────────────────────────────────

function ChatPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      timestamp: new Date(),
      content: `Hello ${user?.full_name?.split(" ")[0] || "there"}! I'm your SecureScore AI assistant.\n\nI can help you understand:\n- **Why** a credit decision was made\n- **How** to improve your score\n- **What** your current risk profile looks like\n\nAsk me anything about your credit or finances!`,
    },
  ]);
  const [input, setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { listening, startListening } = useSpeechRecognition((text) => {
    setInput(text);
    // auto-submit after a short tick so state has updated
    setTimeout(() => sendMessage(text), 50);
  });
  const speechSupported = isSpeechSupported();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setShowScroll(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  };

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const sendMessage = async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || sending) return;
    setInput("");
    inputRef.current?.focus();

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: msg,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const res = await customerChat(
        user?.customer_id || user?.username || "cust001",
        msg,
      );
      const botMsg: Message = {
        id: `b-${Date.now()}`,
        role: "assistant",
        content: res.reply,
        xai_context: res.xai_context,
        poweredBy: (res as { powered_by?: string }).powered_by,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I couldn't reach the AI service right now. Please try again shortly.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const isFirstExchange = messages.length <= 2;

  return (
    <div className="relative flex flex-col h-full p-4">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal to-teal-deep flex items-center justify-center shadow-md">
          <Sparkles size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-ink leading-tight">SecureScore AI</h1>
          <p className="text-[11px] text-ink-faint">
            Credit guidance ·{" "}
            <span className="text-indigo-500 font-semibold">Groq Llama 3.1</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Online
        </div>
        <button
          onClick={onClose}
          className="text-ink-faint hover:text-ink transition-colors shrink-0"
          aria-label="Close chat"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Messages area ───────────────────────────────────── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-4 pr-1 scroll-smooth"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#e5e7eb transparent" }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-teal to-teal-deep flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <Bot size={14} className="text-white" />
              </div>
            )}

            <div className={`max-w-[82%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                  msg.role === "user"
                    ? "bg-teal text-white rounded-br-md"
                    : "bg-white border border-line text-ink rounded-bl-md"
                }`}
              >
                {msg.role === "assistant"
                  ? <MarkdownText text={msg.content} />
                  : msg.content
                }
              </div>

              <div className={`flex items-center gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <span className="text-[10px] text-ink-faint">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {msg.role === "assistant" && msg.poweredBy && (
                  <span className="text-[10px] text-indigo-400 font-medium">
                    {msg.poweredBy === "groq" ? "✦ Groq AI" : "Rule-based"}
                  </span>
                )}
              </div>
            </div>

            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-xl bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} className="text-ink-soft" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2.5 justify-start">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-teal to-teal-deep flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-line rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom pill */}
      {showScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white border border-line shadow-md text-xs font-medium text-ink-soft px-3 py-1.5 rounded-full hover:shadow-lg transition-all"
        >
          <ChevronDown size={13} />New message
        </button>
      )}

      {/* ── Suggestions (shown early in conversation) ────────── */}
      {isFirstExchange && (
        <div className="flex flex-wrap gap-2 mt-3 shrink-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              onClick={() => sendMessage(s.text)}
              disabled={sending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-line bg-white hover:bg-teal-soft hover:border-teal/40 hover:text-teal-deep text-ink-soft transition-colors shadow-sm disabled:opacity-50"
            >
              {s.icon}
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ────────────────────────────────────────── */}
      <form
        onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
        className="mt-3 flex flex-col gap-1.5 shrink-0"
      >
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <MessageSquare size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your credit, loans, or finances…"
              disabled={sending}
              className="w-full rounded-2xl border border-line bg-white pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none shadow-sm disabled:opacity-60 transition"
            />
          </div>

          {/* Mic button */}
          {speechSupported && (
            <button
              type="button"
              onClick={startListening}
              disabled={sending || listening}
              title="Voice input"
              className={`w-11 h-11 flex items-center justify-center rounded-2xl transition shadow-md shrink-0 ${
                listening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-gray-100 hover:bg-gray-200 text-ink-soft"
              } disabled:opacity-40`}
            >
              <Mic size={16} />
            </button>
          )}

          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="w-11 h-11 flex items-center justify-center rounded-2xl bg-teal hover:bg-teal-deep active:bg-teal-deep text-white transition shadow-md disabled:opacity-40 shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Floating widget (button + popup) ────────────────────────────────────────

// `bottom` lets the desktop shell lift the widget above the fixed live-tx ticker bar (h-8).
export function ChatWidget({ bottom = "bottom-6" }: { bottom?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open chat assistant"
        className={`fixed ${bottom} right-6 z-[9998] w-14 h-14 flex items-center justify-center rounded-full bg-gradient-to-br from-teal to-teal-deep text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all`}
      >
        <MessageSquare size={22} />
      </button>
    );
  }

  return createPortal(
    <div className={`fixed ${bottom} right-6 z-[9999] w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] rounded-2xl bg-surface border border-line shadow-2xl overflow-hidden`}>
      <ChatPanel onClose={() => setOpen(false)} />
    </div>,
    document.body,
  );
}
