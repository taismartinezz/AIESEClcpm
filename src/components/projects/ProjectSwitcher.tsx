"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen, Plus, Check } from "lucide-react";
import { useProject } from "@/context/ProjectContext";
import CreateProjectModal from "./CreateProjectModal";

export default function ProjectSwitcher() {
  const { subProjectId, subProjects, setActiveSubProject, isLoading } = useProject();
  const [open, setOpen]           = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const containerRef              = useRef<HTMLDivElement>(null);

  const activeLabel =
    subProjects.find((sp) => sp.id === subProjectId)?.name ?? "Whole LC";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <div ref={containerRef} className="relative">
        {/* Trigger */}
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-[rgba(2,99,196,0.06)]"
          style={{
            minHeight: 32,
            fontSize: 13,
            fontFamily: "var(--font-roboto)",
            color: "var(--color-body)",
            border: "1px solid var(--color-border)",
            backgroundColor: open ? "rgba(2,99,196,0.04)" : "transparent",
            cursor: isLoading ? "default" : "pointer",
            opacity: isLoading ? 0.5 : 1,
            maxWidth: 200,
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <FolderOpen size={13} color="var(--color-secondary)" />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 140,
              fontWeight: subProjectId ? 600 : 400,
              color: subProjectId ? "var(--color-navy)" : "var(--color-body)",
            }}
          >
            {activeLabel}
          </span>
          <ChevronDown
            size={12}
            color="var(--color-secondary)"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
          />
        </button>

        {/* Dropdown */}
        {open && (
          <div
            className="absolute left-0 top-full mt-1 animate-fade-in"
            style={{
              minWidth: 200,
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              boxShadow: "var(--shadow-card)",
              zIndex: 100,
              overflow: "hidden",
            }}
            role="listbox"
          >
            {/* All Lab option */}
            <DropdownItem
              label="Whole LC"
              active={subProjectId === null}
              onClick={() => { setActiveSubProject(null); setOpen(false); }}
            />

            {/* Sub-projects */}
            {subProjects.length > 0 && (
              <div style={{ borderTop: "1px solid var(--color-border)" }}>
                {subProjects.map((sp) => (
                  <DropdownItem
                    key={sp.id}
                    label={sp.name}
                    active={subProjectId === sp.id}
                    onClick={() => { setActiveSubProject(sp.id); setOpen(false); }}
                  />
                ))}
              </div>
            )}

            {/* New group */}
            <div style={{ borderTop: "1px solid var(--color-border)" }}>
              <button
                onClick={() => { setOpen(false); setShowCreate(true); }}
                className="w-full flex items-center gap-2 px-3 transition-colors hover:bg-[rgba(2,99,196,0.06)]"
                style={{
                  minHeight: 40,
                  fontSize: 13,
                  fontFamily: "var(--font-roboto)",
                  color: "var(--color-secondary)",
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                }}
              >
                <Plus size={13} />
                New group
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} />
      )}
    </>
  );
}

// ── Internal item ─────────────────────────────────────────────────────────────

function DropdownItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="option"
      aria-selected={active}
      className="w-full flex items-center justify-between px-3 transition-colors hover:bg-[rgba(2,99,196,0.06)]"
      style={{
        minHeight: 40,
        fontSize: 13,
        fontFamily: "var(--font-roboto)",
        color: active ? "var(--color-navy)" : "var(--color-body)",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        background: "none",
        border: "none",
        textAlign: "left",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {label}
      </span>
      {active && <Check size={13} color="var(--color-navy)" style={{ flexShrink: 0, marginLeft: 6 }} />}
    </button>
  );
}
