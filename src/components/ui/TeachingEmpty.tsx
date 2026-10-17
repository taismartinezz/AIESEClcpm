import type { ReactNode } from "react";
import Link from "next/link";

/**
 * An empty page that teaches: what this page is for, in one or two lines, and
 * the obvious next step (usually "Import from Google Sheets" or "Add").
 */
export default function TeachingEmpty({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-label={title} style={{ maxWidth: 560, padding: "28px 24px", borderRadius: 12, border: "1px dashed var(--color-border)", backgroundColor: "var(--color-surface)" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 6px" }}>{title}</h2>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-body)" }}>{children}</div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>{actions}</div>}
    </section>
  );
}

/** Demo-mode (no database) version: what the page does, and how to switch it on. */
export function NeedsDatabase({ what, children }: { what: string; children: ReactNode }) {
  return (
    <TeachingEmpty title={what}>
      {children}
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-secondary)" }}>
        This part of the app isn&apos;t switched on for your LC yet, so there&apos;s nothing to show. Ask your LCP or whoever set the app up;
        meanwhile <Link href="/help" style={{ color: "var(--color-navy)" }}>read how it works</Link>.
      </p>
    </TeachingEmpty>
  );
}
