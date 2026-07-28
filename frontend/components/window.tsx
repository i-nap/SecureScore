"use client";

import { useRef, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";

export interface WinState {
  id: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
}

interface Props {
  win: WinState;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMax: () => void;
  onChange: (geom: Partial<WinState>) => void;
}

// ponytail: drag/resize via native pointer events — no react-rnd. Swap in a lib
// only if snapping/multi-monitor edge cases ever matter.
export function Window({ win, focused, onFocus, onClose, onMinimize, onToggleMax, onChange }: Props) {
  const [interacting, setInteracting] = useState(false);
  const start = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 });

  if (win.minimized) return null;

  const beginDrag = (e: React.PointerEvent) => {
    if (win.maximized) return;
    onFocus();
    start.current = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setInteracting(true);
    const move = (ev: PointerEvent) => {
      onChange({
        x: Math.max(0, start.current.x + ev.clientX - start.current.mx),
        y: Math.max(0, start.current.y + ev.clientY - start.current.my),
      });
    };
    const up = () => {
      setInteracting(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    onFocus();
    start.current = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setInteracting(true);
    const move = (ev: PointerEvent) => {
      onChange({
        w: Math.max(360, start.current.w + ev.clientX - start.current.mx),
        h: Math.max(240, start.current.h + ev.clientY - start.current.my),
      });
    };
    const up = () => {
      setInteracting(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const geom = win.maximized
    ? { left: 0, top: 0, width: "100%", height: "100%" }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <div
      className={`absolute flex flex-col rounded-xl overflow-hidden shadow-2xl border ${
        focused ? "border-blue-400/50 ring-1 ring-blue-400/30" : "border-white/10"
      } bg-white`}
      style={{ ...geom, zIndex: win.z }}
      onPointerDown={onFocus}
    >
      {/* Title bar */}
      <div
        onPointerDown={beginDrag}
        onDoubleClick={onToggleMax}
        className={`flex items-center gap-2 px-3 h-9 shrink-0 cursor-move select-none ${
          focused ? "bg-gradient-to-r from-slate-800 to-slate-900" : "bg-slate-700"
        } text-white`}
      >
        <span className="shrink-0 opacity-90 [&_svg]:w-3.5 [&_svg]:h-3.5">{win.icon}</span>
        <span className="text-xs font-semibold truncate flex-1">{win.label}</span>
        {/* stopPropagation on pointerdown so clicking a control doesn't start a
            drag (which renders a fullscreen overlay that would eat the click). */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onMinimize}
          className="p-1 rounded hover:bg-white/20"
          title="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleMax}
          className="p-1 rounded hover:bg-white/20"
          title="Maximize"
        >
          {win.maximized ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="p-1 rounded hover:bg-red-500"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="relative flex-1 bg-canvas">
        <iframe
          src={`${win.href}?embedded=1`}
          title={win.label}
          className="w-full h-full border-0"
        />
        {/* Transparent overlay so the iframe doesn't swallow pointer moves while dragging. */}
        {interacting && <div className="absolute inset-0" />}
      </div>

      {/* Resize handle (SE corner) */}
      {!win.maximized && (
        <div
          onPointerDown={beginResize}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ touchAction: "none" }}
        />
      )}

      {/* Fixed overlay while interacting — catches events across the whole desktop. */}
      {interacting && <div className="fixed inset-0 z-[9999]" style={{ cursor: "inherit" }} />}
    </div>
  );
}
