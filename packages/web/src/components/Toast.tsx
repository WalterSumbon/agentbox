// ============================================================
// Toast — notification system for errors, warnings, and info
// ============================================================

import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import type { ReactNode } from "react";

// ---------- Types ----------

export type ToastType = "error" | "warning" | "info" | "success";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
}

// ---------- Context ----------

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

// ---------- Provider ----------

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "error", duration = 5000) => {
      const id = ++toastIdCounter;
      setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]); // keep max 5
      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast-item toast-${t.type}`}
              onClick={() => removeToast(t.id)}
            >
              <span className="toast-icon">
                {t.type === "error" && "\u2716"}
                {t.type === "warning" && "\u26A0"}
                {t.type === "info" && "\u2139"}
                {t.type === "success" && "\u2714"}
              </span>
              <span className="toast-message">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
