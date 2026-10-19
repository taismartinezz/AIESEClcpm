"use client";

import { useHydrated } from "@/lib/use-hydrated";

import { X } from "lucide-react";
import { createPortal } from "react-dom";

export interface Shortcut {
  keys: string[];
  description: string;
  category?: string;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const mod = isMac ? "Cmd" : "Ctrl";

export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { category: "General",    keys: ["?"],             description: "Show keyboard shortcuts"  },
  { category: "General",    keys: [mod, "K"],        description: "Open global search"        },
  { category: "General",    keys: ["Esc"],           description: "Close modal / panel"       },
  { category: "Navigation", keys: ["Alt", "D"],      description: "Go to Dashboard"           },
  { category: "Navigation", keys: ["Alt", "T"],      description: "Go to Tasks"               },
  { category: "Navigation", keys: ["Alt", "J"],      description: "Go to Journal"             },
  { category: "Navigation", keys: ["Alt", "C"],      description: "Go to Chat"                },
  { category: "Navigation", keys: ["Alt", "R"],      description: "Go to Reminders"           },
  { category: "Navigation", keys: ["Alt", "B"],      description: "Go to LC Drive"             },
  { category: "Navigation", keys: ["Alt", "M"],      description: "Go to Team"                },
];

function Kbd({ k }: { k: string }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 22, height: 20, padding: "0 5px",
      fontSize: 11, fontFamily: "inherit", fontWeight: 600,
      backgroundColor: "var(--color-strip)",
      border: "1px solid var(--color-border)",
      borderRadius: 4,
      color: "var(--color-body)",
      boxShadow: "0 1px 0 var(--color-border)",
    }}>
      {k}
    </kbd>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  const mounted = useHydrated();

  if (!mounted || !open) return null;

  const categories = Array.from(new Set(GLOBAL_SHORTCUTS.map(s => s.category ?? "Other")));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      style={{
        position: "fixed", inset: 0, zIndex: 99990,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(520px, 94vw)",
          maxHeight: "min(600px, 90vh)",
          backgroundColor: "var(--color-surface)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--color-border)",
        }}>
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 16, color: "var(--color-navy)" }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: "var(--color-secondary)", borderRadius: 6 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "12px 20px 20px" }}>
          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                {cat}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {GLOBAL_SHORTCUTS.filter(s => (s.category ?? "Other") === cat).map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "7px 10px", borderRadius: 7,
                      backgroundColor: "transparent",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-navy-dim)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                  >
                    <span style={{ fontSize: 13, color: "var(--color-body)" }}>{s.description}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      {s.keys.map((k, ki) => (
                        <span key={ki} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Kbd k={k} />
                          {ki < s.keys.length - 1 && <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>+</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: 0 }}>
            Shortcuts are disabled when typing in a text field.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
