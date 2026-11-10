"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { useProject } from "@/context/ProjectContext";
import { pageSteps } from "@/lib/tours";

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
  const pathname = usePathname();
  const { role } = useProject();
  // The national view has its own "Take the tour" button in its top bar.
  const hasTour = !pathname.startsWith("/mc") && pageSteps(pathname, { role: role ?? "member" }).length > 0;
  return (
    <div
      data-tour="page-header"
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
            {hasTour && (
              <button type="button" data-tour="page-tour" title="Show me this page" aria-label="Show me this page"
                onClick={() => window.dispatchEvent(new CustomEvent("app:show-page-tour", { detail: { path: pathname } }))}
                className="hover:bg-[var(--color-navy-dim)]"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "none", background: "none", color: "var(--color-secondary)", cursor: "pointer" }}>
                <HelpCircle size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {action && (
          <div data-tour="page-actions" className="flex flex-wrap items-center gap-2 max-w-full">{action}</div>
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
