"use client";

import { Fragment, type ReactNode, useState, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SubProject } from "@/types";

export interface ScopeSection {
  id: string;
  label: string;
  color: string;
  icon: ReactNode;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}

interface Props {
  sections: ScopeSection[];
  subProjects?: SubProject[];
  selectedSubProjectId?: string | null;
  projectCounts?: Record<string, number>;
  onSelectSubProject?: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  extraContent?: ReactNode;
  fullContent?: ReactNode;
  storageKey?: string;
  headerLabel?: string;
  collapsedRailItems?: ScopeSection[];
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const SNAP_BELOW = 140;
const DEFAULT_WIDTH = 220;

function readStoredWidth(key: string): number {
  try {
    const s = localStorage.getItem(key + "_width");
    if (s) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(s, 10)));
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

function NavRow({ color, label, count, selected, onClick }: {
  color: string; label: string; count?: number; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px 6px 11px", borderRadius: 7,
        border: "none", borderLeft: `3px solid ${selected ? color : "transparent"}`,
        cursor: "pointer", backgroundColor: selected ? `${color}18` : "transparent",
        marginBottom: 1, transition: "background-color 120ms ease, border-left-color 120ms ease",
        textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)",
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
    >
      <span style={{ flex: 1, fontSize: 13, color: selected ? color : "var(--color-body)", fontWeight: selected ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: 11, fontWeight: 600, color: selected ? color : "var(--color-secondary)", backgroundColor: selected ? `${color}20` : "rgba(0,0,0,0.06)", borderRadius: 10, padding: "1px 7px", flexShrink: 0, minWidth: 20, textAlign: "center" }}>
          {count}
        </span>
      )}
    </button>
  );
}

function IconRailBtn({ isActive, color, icon, label, onClick }: {
  isActive: boolean; color: string; icon: ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center justify-center rounded-lg"
      style={{
        width: 36, height: 36,
        backgroundColor: isActive ? color : "transparent",
        color: isActive ? "#fff" : "var(--color-body)",
        border: "none", cursor: "pointer",
        transition: "background-color 0.12s",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(27,46,75,0.06)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
    >
      {icon}
    </button>
  );
}

export default function ScopeSidebar({
  sections,
  subProjects = [],
  selectedSubProjectId = null,
  projectCounts = {},
  onSelectSubProject,
  collapsed,
  onToggleCollapse,
  extraContent,
  fullContent,
  storageKey,
  headerLabel,
  collapsedRailItems,
}: Props) {
  const [width, setWidth] = useState(() =>
    storageKey ? readStoredWidth(storageKey) : DEFAULT_WIDTH
  );
  const handleRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let live = startWidth;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function onMove(ev: MouseEvent) {
      const next = startWidth + (ev.clientX - startX);
      if (next < SNAP_BELOW) {
        cleanup();
        if (!collapsed) onToggleCollapse();
        return;
      }
      live = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
      setWidth(live);
    }

    function onUp() {
      cleanup();
      if (storageKey) {
        try { localStorage.setItem(storageKey + "_width", String(live)); } catch { /* ignore */ }
      }
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [collapsed, onToggleCollapse, storageKey]);

  function onHandleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(MAX_WIDTH, widthRef.current + 10);
      setWidth(next);
      if (storageKey) try { localStorage.setItem(storageKey + "_width", String(next)); } catch { /* ignore */ }
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = widthRef.current - 10;
      if (next < SNAP_BELOW) { onToggleCollapse(); return; }
      const clamped = Math.max(MIN_WIDTH, next);
      setWidth(clamped);
      if (storageKey) try { localStorage.setItem(storageKey + "_width", String(clamped)); } catch { /* ignore */ }
    }
  }

  const effectiveWidth = collapsed ? 52 : width;

  // Suppress unused-variable warnings for dead props that remain in interface for compatibility
  void subProjects; void selectedSubProjectId; void projectCounts; void onSelectSubProject;

  return (
    <div
      className="group/scopesidebar group/litpanel flex flex-col h-full"
      style={{
        width: effectiveWidth,
        flexShrink: 0,
        backgroundColor: fullContent ? "transparent" : "var(--color-canvas)",
        borderRight: "1px solid var(--color-border)",
        transition: "width 220ms ease",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Collapsed expand button - always shown when collapsed, for every page type */}
      {collapsed && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 0", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, backgroundColor: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <ChevronRight size={15} color="var(--color-secondary)" />
          </button>
        </div>
      )}

      {/* Expanded header row - only when expanded AND no fullContent (fullContent supplies its own header) */}
      {!collapsed && !fullContent && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-secondary)" }}>
            {headerLabel ?? ""}
          </span>
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, backgroundColor: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <ChevronLeft size={15} color="var(--color-secondary)" />
          </button>
        </div>
      )}

      {/* Content area - collapsed always shows icon rail; expanded shows fullContent or sections */}
      {collapsed ? (
        (() => {
          const rail = collapsedRailItems ?? sections;
          return rail.length > 0 ? (
            <div className="flex flex-col items-center px-1.5 py-2 gap-0.5">
              {rail.map(s => (
                <IconRailBtn key={s.id} isActive={s.isActive} color={s.color} icon={s.icon} label={s.label} onClick={s.onClick} />
              ))}
            </div>
          ) : null;
        })()
      ) : fullContent ? (
        fullContent
      ) : (
        <div style={{ padding: "4px 8px 20px", overflowY: "auto", flex: 1 }}>
          {sections.map((s, i) => (
            <Fragment key={s.id}>
              <NavRow color={s.color} label={s.label} count={s.count} selected={s.isActive} onClick={s.onClick} />
              {i === 0 && sections.length > 1 && <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "5px 2px" }} />}
            </Fragment>
          ))}
          {extraContent}
        </div>
      )}

      {/* Resize handle - only in expanded state, not used by fullContent pages */}
      {!fullContent && !collapsed && (
        <div
          ref={handleRef}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          tabIndex={0}
          title="Drag to resize, or use arrow keys"
          onMouseDown={onDragMouseDown}
          onKeyDown={onHandleKeyDown}
          style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 6,
            cursor: "col-resize", zIndex: 10,
            backgroundColor: "transparent",
            transition: "background-color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-navy-dim)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
          onFocus={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-navy-dim)"; }}
          onBlur={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
        />
      )}
    </div>
  );
}
