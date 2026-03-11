// ============================================================
// useWebSocket — manages the WebSocket lifecycle with
// auto-reconnect, heartbeat, and event subscription.
// ============================================================

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import type { ClientMessage, ServerEvent } from "@agentbox/shared";

// ---------- Types ----------

export interface UseWebSocketReturn {
  /** Send a typed client message over the WebSocket. */
  send: (msg: ClientMessage) => void;
  /** Whether the WebSocket is currently open and connected. */
  connected: boolean;
  /**
   * Register a handler for server events.
   * Returns an unsubscribe function.
   */
  on: (handler: (event: ServerEvent) => void) => () => void;
}

// ---------- Constants ----------

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Interval between heartbeat pings (ms). */
const PING_INTERVAL_MS = 30_000;

// ---------- Hook ----------

export function useWebSocket(token: string | null): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);

  // Mutable refs so callbacks always see the latest values without
  // triggering effect re-runs.
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<(event: ServerEvent) => void>>(new Set());
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Flag to prevent reconnect after intentional disconnect. */
  const unmountedRef = useRef(false);

  // ---- helpers ----

  const clearPing = useCallback(() => {
    if (pingTimerRef.current !== null) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // ---- connect ----

  const connect = useCallback(() => {
    if (!token || unmountedRef.current) return;

    clearReconnect();

    const wsProtocol =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${wsProtocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = INITIAL_BACKOFF_MS;

      // Start heartbeat ping.
      clearPing();
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // Send a lightweight ping frame the server can ignore or echo.
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const parsed: ServerEvent = JSON.parse(event.data as string);
        for (const handler of handlersRef.current) {
          handler(parsed);
        }
      } catch {
        console.error("[useWebSocket] failed to parse incoming message");
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      clearPing();

      if (unmountedRef.current) return;

      // Don't reconnect on auth failures (server closes with 4001)
      if (event.code === 4001) {
        console.warn("[useWebSocket] auth failed — not reconnecting");
        return;
      }

      // Schedule reconnect with exponential backoff.
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire next — reconnect logic lives there.
      ws.close();
    };

    wsRef.current = ws;
  }, [token, clearPing, clearReconnect]);

  // ---- lifecycle ----

  useEffect(() => {
    unmountedRef.current = false;

    if (token) {
      connect();
    }

    return () => {
      unmountedRef.current = true;
      clearReconnect();
      clearPing();
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [token, connect, clearReconnect, clearPing]);

  // ---- public API ----

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const on = useCallback(
    (handler: (event: ServerEvent) => void): (() => void) => {
      handlersRef.current.add(handler);
      return () => {
        handlersRef.current.delete(handler);
      };
    },
    [],
  );

  // Memoize return value — only changes when `connected` changes.
  // `send` and `on` are already stable via useCallback.
  return useMemo(() => ({ send, connected, on }), [send, connected, on]);
}
