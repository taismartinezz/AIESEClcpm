"use client";
import type { ReactNode } from "react";

interface Props {
  title: string;
  eyebrow?: string;
  badge?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
}

export default function PageHeader({ title, eyebrow, badge, subtitle, action, children }: Props) {
  const hasSub = !!(subtitle || children);
  return (
    <div
      className="px-4 sm:px-6 pt-4 pb-3 shrink-0"
      style={{
        backgroundColor: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* On phones the actions wrap under the title instead of covering it. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2${hasSub ? " mb-2" : ""}`}>
        <div className="flex flex-col flex-1 min-w-[min(100%,12rem)]">
          {eyebrow && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, marginBottom: 2 }}>
              {eyebrow}
            </span>
          )}
          <div className="flex items-center gap-2">
            <h1
              style={{
                fontFamily: "var(--font-lora)",
                fontWeight: 700,
                fontSize: 22,
                color: "var(--color-navy)",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {title}
            </h1>
            {badge}
          </div>
        </div>
        {action && (
          <div className="flex flex-wrap items-center gap-2 max-w-full">{action}</div>
        )}
      </div>
      {subtitle && (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}
