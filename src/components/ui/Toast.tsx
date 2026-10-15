"use client";

import { useState, useEffect } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
}

type SetFn = React.Dispatch<React.SetStateAction<ToastItem[]>>;
let _set: SetFn | null = null;

function dismiss(id: string) {
  _set?.((prev) => prev.filter((t) => t.id !== id));
}

export function showToast(message: string, type: ToastType = "info") {
  if (!_set) return;
  const id = crypto.randomUUID();
  _set((prev) => [...prev, { id, message, type }]);
  setTimeout(() => dismiss(id), 3000);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:toast", { detail: { id, message, type } }));
  }
}

export function showUndoToast(message: string, onUndo: () => void) {
  if (!_set) return;
  const id = crypto.randomUUID();
  let dismissed = false;
  const action = {
    label: "Undo",
    onClick: () => {
      if (dismissed) return;
      dismissed = true;
      dismiss(id);
      onUndo();
    },
  };
  _set((prev) => [...prev, { id, message, type: "success", action }]);
  setTimeout(() => { dismissed = true; dismiss(id); }, 4000);
}

const BG: Record<ToastType, string> = {
  success: "#2E7D52",
  error:   "#C0392B",
  info:    "#0263C4",
};

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    _set = setToasts;
    return () => { _set = null; };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="animate-slide-up-fade"
      style={{
        position: "fixed",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            backgroundColor: BG[t.type],
            color: "#fff",
            fontFamily: "var(--font-roboto)",
            fontWeight: 600,
            fontSize: 13,
            borderRadius: 10,
            padding: "10px 18px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 12,
            pointerEvents: t.action ? "auto" : "none",
          }}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={t.action.onClick}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.35)",
                borderRadius: 6,
                padding: "3px 10px",
                cursor: "pointer",
                fontFamily: "var(--font-roboto)",
                letterSpacing: "0.03em",
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
