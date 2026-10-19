"use client";

import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/**
 * Ask before something destructive, in the app's own dialog rather than the
 * browser's confirm() (which browsers can suppress, and which looked different
 * on every page). Resolves true when confirmed.
 */
export function askConfirm(message: string, opts: { confirmLabel?: string } = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      resolve(ok);
      root.unmount();
      host.remove();
    };
    root.render(<ConfirmDialog message={message} confirmLabel={opts.confirmLabel ?? "Delete"} onDone={done} />);
  });
}

function ConfirmDialog({ message, confirmLabel, onDone }: { message: string; confirmLabel: string; onDone: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    // Capture phase, so Escape closes only this dialog and not the one beneath it.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onDone(false); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const btn = { height: 36, padding: "0 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" } as const;
  return (
    <div
      role="alertdialog" aria-modal="true" aria-label="Are you sure?"
      onClick={() => onDone(false)}
      style={{ position: "fixed", inset: 0, zIndex: 10000, backgroundColor: "var(--color-navy-scrim)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "max(16px, 18vh) 16px 16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "var(--color-surface)", borderRadius: 12, width: "100%", maxWidth: 400, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}
      >
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-body)", margin: "0 0 18px" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button ref={cancelRef} type="button" onClick={() => onDone(false)}
            style={{ ...btn, background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-body)" }}>
            Cancel
          </button>
          <button type="button" onClick={() => onDone(true)}
            style={{ ...btn, background: "var(--color-error)", border: "none", color: "#fff" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
