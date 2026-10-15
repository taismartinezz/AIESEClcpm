"use client";

import type { SubProject } from "@/types";

interface Props {
  subProjects: SubProject[];
  selected: string | null; // null = show all
  onChange: (id: string | null) => void;
  className?: string;
}

export default function ProjectFilterTabs({ subProjects, selected, onChange, className = "" }: Props) {
  if (subProjects.length === 0) return null;

  const btnBase: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    padding: "4px 10px",
    borderRadius: 6,
    border: "none",
    background: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "color 0.12s",
    lineHeight: 1.4,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  };

  return (
    <div
      className={`flex items-center gap-0.5 overflow-x-auto ${className}`}
      style={{ scrollbarWidth: "none", borderBottom: "1px solid var(--color-border)" }}
      role="tablist"
      aria-label="Filter by group"
    >
      <button
        role="tab"
        aria-selected={selected === null}
        onClick={() => onChange(null)}
        style={{
          ...btnBase,
          color: selected === null ? "var(--color-navy)" : "var(--color-secondary)",
          fontWeight: selected === null ? 600 : 400,
          borderBottom: selected === null ? "2px solid var(--color-navy)" : "2px solid transparent",
          marginBottom: -1,
        }}
      >
        All
      </button>

      {subProjects.map((sp) => {
        const accent = sp.color ?? "var(--color-navy)";
        const active = selected === sp.id;
        return (
          <button
            key={sp.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(sp.id)}
            style={{
              ...btnBase,
              color: active ? accent : "var(--color-secondary)",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {active && sp.color && (
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: sp.color, flexShrink: 0 }}
                aria-hidden="true"
              />
            )}
            {sp.name}
          </button>
        );
      })}
    </div>
  );
}
