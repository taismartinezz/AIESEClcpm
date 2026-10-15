"use client";

import {
  createContext, useContext, useState, useRef, useCallback,
  useEffect, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Undo2 } from "lucide-react";

const DURATION = 10_000;

interface UndoToastCtx {
  show: (message: string, onUndo: () => void, onConfirm?: () => void) => void;
}

const Ctx = createContext<UndoToastCtx>({ show: () => {} });

export function useUndoToast() {
  return useContext(Ctx);
}

interface ActiveToast { id: number; message: string; }

export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [progress, setProgress] = useState(1);
  const [mounted, setMounted] = useState(false);
  const idRef       = useRef(0);
  const undoRef     = useRef<(() => void) | null>(null);
  const confirmRef  = useRef<(() => void) | null>(null);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const clear = useCallback(() => {
    if (timerRef.current)  clearTimeout(timerRef.current);
    if (frameRef.current)  clearInterval(frameRef.current);
  }, []);

  const dismiss = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);

  const show = useCallback((message: string, onUndo: () => void, onConfirm?: () => void) => {
    // If a toast is already showing, commit the previous action first
    if (toast) {
      clear();
      confirmRef.current?.();
    }

    idRef.current += 1;
    const id = idRef.current;
    undoRef.current = onUndo;
    confirmRef.current = onConfirm ?? null;

    setToast({ id, message });
    setProgress(1);

    const start = Date.now();
    frameRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 1 - elapsed / DURATION));
    }, 80);

    timerRef.current = setTimeout(() => {
      clear();
      confirmRef.current?.();
      setToast(null);
    }, DURATION);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, clear]);

  const handleUndo = useCallback(() => {
    dismiss();
    undoRef.current?.();
  }, [dismiss]);

  // Cmd/Ctrl+Z triggers undo while a toast is visible
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey && toast) {
        e.preventDefault();
        handleUndo();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toast, handleUndo]);

  const toastEl = toast && mounted ? createPortal(
    <>
      <style>{`
        @keyframes canopyToastIn {
          from { opacity:0; transform:translateX(-50%) translateY(12px); }
          to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed", bottom: 28, left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "#1B2E4B", color: "#fff",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          zIndex: 9999,
          animation: "canopyToastIn 0.18s ease",
          minWidth: 260, maxWidth: "min(480px, 92vw)",
          fontFamily: "var(--font-roboto)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 10px 14px" }}>
          <Undo2 size={13} color="rgba(255,255,255,0.6)" style={{ flexShrink: 0 }} />
          <span style={{
            flex: 1, fontSize: 13, color: "rgba(255,255,255,0.9)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {toast.message}
          </span>
          <button
            onClick={handleUndo}
            style={{
              background: "rgba(255,255,255,0.18)", border: "none",
              borderRadius: 6, padding: "4px 12px",
              color: "#fff", fontWeight: 700, fontSize: 12,
              cursor: "pointer", flexShrink: 0,
              fontFamily: "var(--font-roboto)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.28)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.18)"; }}
          >
            Undo
          </button>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.5)", fontSize: 16, lineHeight: 1,
              padding: "0 2px", marginLeft: 2,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)"; }}
          >
            &times;
          </button>
        </div>
        {/* Progress bar */}
        <div style={{ height: 2, backgroundColor: "rgba(255,255,255,0.12)" }}>
          <div style={{
            height: "100%", backgroundColor: "rgba(255,255,255,0.45)",
            width: `${progress * 100}%`,
            transition: "width 80ms linear",
          }} />
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toastEl}
    </Ctx.Provider>
  );
}
