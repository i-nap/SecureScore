"use client";

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { connectWs, type WsMessage } from "./api";

export interface WsEvent extends WsMessage {
  id: string; // unique key for list rendering
}

interface WsContextValue {
  connected: boolean;
  events: WsEvent[];
  clearEvents: () => void;
}

const WsContext = createContext<WsContextValue>({
  connected: false,
  events: [],
  clearEvents: () => {},
});

let _eventCounter = 0;

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = connectWs((msg) => {
      if (msg.type === "pong") return;
      const evt: WsEvent = { ...msg, id: `ws-${++_eventCounter}` };
      setEvents((prev) => [evt, ...prev].slice(0, 200)); // keep last 200
    });

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      setTimeout(() => {
        // re-mount will trigger useEffect again
      }, 3000);
    };

    wsRef.current = ws;
    return () => {
      ws.close();
    };
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return (
    <WsContext.Provider value={{ connected, events, clearEvents }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWsEvents() {
  return useContext(WsContext);
}
