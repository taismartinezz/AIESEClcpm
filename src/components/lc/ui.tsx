"use client";

// Small shared building blocks for the Finance, Attendance and Tabling pages.
// Inline styles + design tokens, matching the rest of the app.

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box", height: 38,
  border: "1px solid var(--color-border)", borderRadius: 8, padding: "0 10px",
  fontSize: 13, color: "var(--color-body)", backgroundColor: "var(--color-surface)",
  fontFamily: "var(--font-roboto)", outline: "none",
};

export const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const palette = {
    primary:   { backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none" },
    secondary: { backgroundColor: "var(--color-surface)", color: "var(--color-navy)", border: "1px solid var(--color-border)" },
    danger:    { backgroundColor: "var(--color-surface)", color: "var(--color-error)", border: "1px solid var(--color-error)" },
    ghost:     { backgroundColor: "transparent", color: "var(--color-secondary)", border: "none" },
  }[variant];
  return (
    <button
      type="button"
      {...props}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        height: 36, padding: "0 14px", borderRadius: 7, fontSize: 13, fontWeight: 600,
        fontFamily: "var(--font-roboto)", cursor: props.disabled ? "default" : "pointer",
        opacity: props.disabled ? 0.6 : 1, whiteSpace: "nowrap", ...palette, ...props.style,
      }}
    >
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "8px 0 0" }}>{children}</p>;
}

export function Modal({ title, onClose, children, footer, width = 460 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog" aria-modal="true" aria-label={title}
      className="animate-fade-in"
      style={{ position: "fixed", inset: 0, zIndex: 60, backgroundColor: "var(--color-navy-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "var(--color-surface)", borderRadius: 12, width: "100%", maxWidth: width, maxHeight: "90dvh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", borderRadius: 8 }}>
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>
        <div style={{ padding: "16px 20px", overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          {title && <h2 style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: 0 }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 0, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 600, color: "var(--color-body)", margin: "4px 0 0", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</p>
      {note && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{note}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 4, marginTop: 8, overflowX: "auto" }}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.id)}
            style={{
              height: 32, padding: "0 12px", borderRadius: 7, fontSize: 13, fontWeight: active ? 700 : 500,
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
              backgroundColor: active ? "var(--color-navy-dim)" : "transparent",
              color: active ? "var(--color-navy)" : "var(--color-secondary)",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal bars for a breakdown (single hue; value printed at the bar end). */
export function BarList({ items, format }: { items: { key: string; label: string; value: number; color?: string }[]; format: (n: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (items.length === 0) return <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "12px 14px" }}>Nothing yet.</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: "8px 14px 12px" }}>
      {items.map((i) => (
        <li key={i.key} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 1fr) 2fr auto", alignItems: "center", gap: 10, padding: "5px 0" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-body)", minWidth: 0 }}>
            {i.color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: i.color, flexShrink: 0 }} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</span>
          </span>
          <span aria-hidden="true" style={{ height: 8, borderRadius: 4, backgroundColor: "var(--chart-grid)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${max ? (i.value / max) * 100 : 0}%`, backgroundColor: "var(--chart-series)", borderRadius: "0 4px 4px 0" }} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums" }}>{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}
