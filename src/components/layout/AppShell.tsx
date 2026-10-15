"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, CheckSquare, BookOpen, BookMarked, Bookmark, Users,
  Bell, ChevronDown, ChevronLeft, ChevronRight, LogOut, User as UserIcon,
  Menu, X, Settings, CalendarDays, CircleCheck, Plus, Search, MessageSquare,
} from "lucide-react";
import { computeInitials } from "@/lib/utils";
import type { User, SubProject } from "@/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import Toast from "@/components/ui/Toast";
import Avatar from "@/components/ui/Avatar";
import CanopyLogo from "@/components/ui/CanopyLogo";
import CreateProjectModal from "@/components/projects/CreateProjectModal";
import OnboardingModal, { useOnboarding } from "@/components/ui/OnboardingModal";
import Tooltip from "@/components/ui/Tooltip";
import GlobalSearch from "@/components/ui/GlobalSearch";
import { UndoToastProvider } from "@/context/UndoToastContext";
import KeyboardShortcutsModal from "@/components/ui/KeyboardShortcutsModal";
import ChatDock from "@/components/chat/ChatDock";

function contrastTextColor(hex: string): "#000000" | "#ffffff" {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.179 ? "#000000" : "#ffffff";
}

const NAV_ITEMS = [
  { href: "/",            label: "Dashboard",  icon: LayoutDashboard },
  { href: "/tasks",       label: "Tasks",      icon: CheckSquare     },
  { href: "/journal",     label: "Journal",    icon: BookOpen        },
  { href: "/chat",        label: "Chat",       icon: MessageSquare   },
  { href: "/reminders",   label: "Reminders",  icon: CircleCheck     },
  { href: "/scheduling",  label: "Scheduling", icon: CalendarDays    },
  { href: "/literature",  label: "Literature", icon: BookMarked      },
  { href: "/bookmarks",   label: "Bookmarks",  icon: Bookmark        },
  { href: "/team",        label: "Team",       icon: Users           },
];


function NotifDot({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center pointer-events-none"
      style={{ backgroundColor: "var(--color-navy)", fontSize: 10, fontWeight: 700, color: "#fff" }}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Shared sidebar nav body ───────────────────────────────────────────────────

function SidebarBody({
  isActive,
  onLinkClick,
  showCloseButton,
  onClose,
  team,
  currentUserId,
  collapsed = false,
  onCollapse,
  onExpand,
  pastDueCount = 0,
  chatUnread = 0,
  subProjects = [],
  activeScope = "lab",
  activeSubProjectId = null,
  onLabHome,
  onSelectProject,
  onPersonal,
  onCreateProject,
  onSettings,
  profileInitials = "??",
  projectName = "",
  projectColor = "",
}: {
  isActive: (href: string) => boolean;
  onLinkClick?: () => void;
  showCloseButton?: boolean;
  onClose?: () => void;
  team: User[];
  currentUserId: string;
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  pastDueCount?: number;
  chatUnread?: number;
  subProjects?: SubProject[];
  activeScope?: string;
  activeSubProjectId?: string | null;
  onLabHome?: () => void;
  onSelectProject?: (id: string) => void;
  onPersonal?: () => void;
  onCreateProject?: () => void;
  onSettings?: () => void;
  profileInitials?: string;
  projectName?: string;
  projectColor?: string;
}) {
  const [wsOpen, setWsOpen] = useState(false);
  const ICON_BTN = {
    width: 36, height: 36, display: "flex", alignItems: "center",
    justifyContent: "center", borderRadius: 8, flexShrink: 0,
  } as const;
  const Divider = () => (
    <div style={{ width: 28, height: 1, backgroundColor: "var(--color-border)", margin: "3px 0", flexShrink: 0 }} />
  );
  const activeSubProject = activeScope === "project" ? subProjects.find(sp => sp.id === activeSubProjectId) : null;
  const wsDisplayName = activeScope === "personal" ? "Personal" : (activeSubProject?.name ?? projectName ?? "");
  const wsBg = (activeSubProject?.color ?? projectColor) || "var(--color-navy)";
  const wsInitials = projectInitials(wsDisplayName);

  // ── Collapsed: single icon column ──────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="flex flex-col h-full items-center" aria-label="Site navigation" style={{ backgroundColor: "var(--color-sidebar)", paddingTop: 6, paddingBottom: 6, gap: 2 }}>

        {/* Canopy logo - static branding anchor */}
        <div style={{ ...ICON_BTN, flexShrink: 0, pointerEvents: "none" }} aria-hidden="true">
          <CanopyLogo size={22} />
        </div>

        {/* Expand toggle */}
        <button
          onClick={onExpand}
          className="transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ ...ICON_BTN, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer" }}
          aria-expanded={false}
          aria-label="Expand sidebar"
        >
          <ChevronRight size={15} />
        </button>

        <Divider />

        {/* Workspace avatar - opens scope/project switcher */}
        <div style={{ position: "relative" }}>
          <Tooltip label={wsDisplayName || "Workspace"} placement="right">
            <button
              onClick={() => setWsOpen(v => !v)}
              style={{
                ...ICON_BTN,
                backgroundColor: wsBg,
                color: contrastTextColor(wsBg),
                border: "none", cursor: "pointer",
                fontFamily: "var(--font-roboto)", fontSize: 10, fontWeight: 700,
              }}
              aria-label={`Workspace: ${wsDisplayName || "Lab"}`}
              aria-expanded={wsOpen}
            >
              {wsInitials}
            </button>
          </Tooltip>
          {wsOpen && (
            <div style={{
              position: "fixed", left: 52, zIndex: 50,
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 10, boxShadow: "0 8px 32px rgba(27,46,75,0.18)",
              padding: "8px 0", minWidth: 200, maxHeight: 320, overflowY: "auto",
            }}>
              <button
                onClick={() => { onLabHome?.(); setWsOpen(false); }}
                className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
                style={{ padding: "7px 14px", border: "none", background: activeScope === "lab" ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: wsBg, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: activeScope === "lab" ? 700 : 400, color: "var(--color-body)" }}>Lab Home</span>
              </button>
              {subProjects.map(sp => {
                const spActive = activeScope === "project" && activeSubProjectId === sp.id;
                return (
                  <button key={sp.id}
                    onClick={() => { onSelectProject?.(sp.id); setWsOpen(false); }}
                    className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
                    style={{ padding: "7px 14px", border: "none", background: spActive ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: sp.color ?? "var(--color-navy)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: spActive ? 700 : 400, color: "var(--color-body)" }}>{sp.name}</span>
                  </button>
                );
              })}
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
              <button
                onClick={() => { onPersonal?.(); setWsOpen(false); }}
                className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
                style={{ padding: "7px 14px", border: "none", background: activeScope === "personal" ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 50, backgroundColor: "var(--color-navy-dim)", border: "1px solid var(--color-border)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: activeScope === "personal" ? 700 : 400, color: "var(--color-body)" }}>Personal</span>
              </button>
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
              <button
                onClick={() => { onCreateProject?.(); setWsOpen(false); }}
                className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
                style={{ padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)", color: "var(--color-secondary)" }}
              >
                <Plus size={13} />
                <span style={{ fontSize: 13 }}>New project</span>
              </button>
            </div>
          )}
        </div>

        <Divider />

        {/* Page nav icons */}
        <nav className="flex-1 flex flex-col items-center overflow-y-auto" style={{ gap: 2, scrollbarWidth: "none" }} aria-label="Main navigation">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            const badgeCount = href === "/chat" ? chatUnread : 0;
            const showBadge = badgeCount > 0;
            const badgeLabel = `${badgeCount} unread`;
            return (
              <Tooltip key={href} label={showBadge ? `${label} (${badgeLabel})` : label} placement="right">
                <Link
                  href={href}
                  onClick={onLinkClick}
                  aria-label={showBadge ? `${label} - ${badgeLabel}` : label}
                  style={{
                    ...ICON_BTN,
                    position: "relative",
                    backgroundColor: active ? "var(--color-navy-dim)" : "transparent",
                    color: active ? "var(--color-navy)" : "var(--color-secondary)",
                    textDecoration: "none",
                    transition: "background-color 0.12s",
                    borderLeft: active ? "2.5px solid var(--color-navy)" : "2.5px solid transparent",
                  }}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-dim)"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = active ? "var(--color-navy-dim)" : "transparent"; }}
                >
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                  {showBadge && (
                    <span aria-hidden style={{ position: "absolute", top: 4, right: 4, minWidth: 14, height: 14, backgroundColor: "var(--color-navy)", borderRadius: 7, fontSize: 9, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
                      {badgeCount > 9 ? "9+" : badgeCount}
                    </span>
                  )}
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <Divider />

        {/* Settings */}
        <Tooltip label="Settings" placement="right">
          <button
            onClick={onSettings}
            style={{ ...ICON_BTN, background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)" }}
            className="hover:bg-[var(--color-navy-dim)]"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </Tooltip>

        {/* Personal workspace */}
        <Tooltip label="Personal workspace" placement="right">
          <button
            onClick={onPersonal}
            style={{
              ...ICON_BTN,
              backgroundColor: activeScope === "personal" ? "var(--color-navy)" : "var(--color-navy-dim)",
              color: activeScope === "personal" ? "#fff" : "var(--color-navy)",
              border: activeScope === "personal" ? "none" : "2px solid var(--color-border)",
              cursor: "pointer",
              fontFamily: "var(--font-roboto)", fontSize: 10, fontWeight: 700,
            }}
            aria-label="Personal workspace"
            aria-current={activeScope === "personal" ? "true" : undefined}
          >
            {profileInitials}
          </button>
        </Tooltip>

      </aside>
    );
  }

  // ── Expanded: full sidebar ──────────────────────────────────────────────────
  return (
    <aside className="flex flex-col h-full" aria-label="Site navigation" style={{ backgroundColor: "var(--color-sidebar)" }}>
      {/* Wordmark row - collapse button appears on sidebar hover */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 18, color: "var(--color-navy)" }}>
          Canopy
        </span>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="opacity-0 group-hover/sidenav:opacity-100 transition-opacity flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]"
              style={{ width: 32, height: 32 }}
              aria-expanded={true}
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={15} color="var(--color-secondary)" />
            </button>
          )}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
              style={{ width: 44, height: 44 }}
              aria-label="Close navigation"
            >
              <X size={18} color="var(--color-secondary)" />
            </button>
          )}
        </div>
      </div>

      {/* WorkspaceSwitcher */}
      <div className="px-2 mb-1 shrink-0" style={{ position: "relative" }}>
        <button
          onClick={() => setWsOpen(v => !v)}
          className="flex items-center gap-2.5 w-full rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ padding: "6px 10px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
          aria-expanded={wsOpen}
          aria-label="Switch workspace"
        >
          <span style={{
            width: 22, height: 22, borderRadius: 6, backgroundColor: wsBg, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-roboto)", fontSize: 9, fontWeight: 700,
            color: contrastTextColor(wsBg),
          }}>
            {wsInitials}
          </span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--color-navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wsDisplayName || "Lab"}
          </span>
          <ChevronDown size={13} color="var(--color-secondary)" style={{ flexShrink: 0, transform: wsOpen ? "rotate(180deg)" : undefined }} />
        </button>
        {wsOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 8, right: 8, zIndex: 50,
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 10, boxShadow: "0 8px 32px rgba(27,46,75,0.18)",
            padding: "8px 0", maxHeight: 280, overflowY: "auto",
          }}>
            <button
              onClick={() => { onLabHome?.(); setWsOpen(false); }}
              className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
              style={{ padding: "7px 14px", border: "none", background: activeScope === "lab" ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: wsBg, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: activeScope === "lab" ? 700 : 400, color: "var(--color-body)" }}>Lab Home</span>
            </button>
            {subProjects.map(sp => {
              const spActive = activeScope === "project" && activeSubProjectId === sp.id;
              return (
                <button key={sp.id}
                  onClick={() => { onSelectProject?.(sp.id); setWsOpen(false); }}
                  className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
                  style={{ padding: "7px 14px", border: "none", background: spActive ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: sp.color ?? "var(--color-navy)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: spActive ? 700 : 400, color: "var(--color-body)" }}>{sp.name}</span>
                </button>
              );
            })}
            <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
            <button
              onClick={() => { onPersonal?.(); setWsOpen(false); }}
              className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
              style={{ padding: "7px 14px", border: "none", background: activeScope === "personal" ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 50, backgroundColor: "var(--color-navy-dim)", border: "1px solid var(--color-border)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: activeScope === "personal" ? 700 : 400, color: "var(--color-body)" }}>Personal</span>
            </button>
            <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
            <button
              onClick={() => { onCreateProject?.(); setWsOpen(false); }}
              className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
              style={{ padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)", color: "var(--color-secondary)" }}
            >
              <Plus size={13} />
              <span style={{ fontSize: 13 }}>New project</span>
            </button>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const badgeCount = href === "/chat" ? chatUnread : 0;
          const showBadge = badgeCount > 0;
          const badgeLabel = `${badgeCount} unread`;
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
              className="flex items-center gap-2.5 rounded-lg transition-colors"
              style={{
                backgroundColor: active ? "var(--color-navy-dim)" : undefined,
                color: active ? "var(--color-navy)" : "var(--color-secondary)",
                fontWeight: active ? 600 : 400,
                fontSize: 13,
                borderRadius: 8,
                textDecoration: "none",
                minHeight: 38,
                display: "flex",
                alignItems: "center",
                paddingLeft: 10,
                paddingRight: 10,
                borderLeft: active ? "2.5px solid var(--color-navy)" : "2.5px solid transparent",
              }}
              aria-current={active ? "page" : undefined}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-dim)"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
            >
              <Icon size={15} strokeWidth={active ? 2.5 : 1.8} fill={active ? "var(--color-navy-dim)" : "none"} />
              <span style={{ flex: 1 }}>{label}</span>
              {showBadge && <span aria-label={badgeLabel} style={{ minWidth: 18, height: 18, backgroundColor: "var(--color-navy)", borderRadius: 9, fontSize: 10, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", flexShrink: 0 }}>{badgeCount > 9 ? "9+" : badgeCount}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Team member list */}
      <div className="px-3 py-3 shrink-0">
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {team.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--color-secondary)", padding: "2px 4px" }}>No teammates yet.</p>
          )}
          {team.map((user) => {
            const parts = user.name.trim().split(/\s+/);
            const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? user.name;
            return (
              <div key={user.id} className="flex items-center gap-2 px-1 py-1" style={{ minHeight: 32 }}>
                <Avatar user={user} size={22} />
                <span style={{
                  fontSize: 13,
                  color: user.id === currentUserId ? "var(--color-navy)" : "var(--color-body)",
                  fontWeight: user.id === currentUserId ? 600 : 400,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {shortName}
                  {user.role === "pi" && <span style={{ fontSize: 10, marginLeft: 4, color: "var(--color-secondary)", fontWeight: 400 }}>PI</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: settings + personal workspace */}
      <div className="px-2 pb-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 4 }}>
        <button
          onClick={onSettings}
          className="flex items-center gap-2.5 w-full rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ padding: "6px 10px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)", color: "var(--color-secondary)", fontSize: 13, minHeight: 36, textAlign: "left" }}
          aria-label="Settings"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
        <button
          onClick={onPersonal}
          className="flex items-center gap-2.5 w-full rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ padding: "6px 10px", border: "none", background: activeScope === "personal" ? "var(--color-navy-dim)" : "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)", color: activeScope === "personal" ? "var(--color-navy)" : "var(--color-secondary)", fontSize: 13, minHeight: 36, textAlign: "left" }}
          aria-label="Personal workspace"
          aria-current={activeScope === "personal" ? "true" : undefined}
        >
          <span style={{
            width: 20, height: 20, borderRadius: 10, flexShrink: 0,
            backgroundColor: activeScope === "personal" ? "var(--color-navy)" : "var(--color-navy-dim)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-roboto)", fontSize: 9, fontWeight: 700,
            color: activeScope === "personal" ? "#fff" : "var(--color-navy)",
          }}>
            {profileInitials}
          </span>
          <span>Personal</span>
        </button>
      </div>
    </aside>
  );
}

// ── Notification panel ────────────────────────────────────────────────────────

type SupabaseNotif = {
  id: string;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  created_at: string;
  related_id?: string;
};

function notifHref(n: SupabaseNotif): string {
  if (n.type === "task_assigned") return "/tasks";
  if (n.type === "reading_assigned") return "/literature";
  if (n.type === "chat_message") return "/chat";
  if (n.type === "lab_win") return "/dashboard";
  return "/dashboard";
}

function NotifPanel({ onClose, notifications, onNavigate, onMarkAllRead, onDismiss }: {
  onClose: () => void;
  notifications: SupabaseNotif[];
  onNavigate: (n: SupabaseNotif) => void;
  onMarkAllRead?: () => void;
  onDismiss?: (id: string) => void;
}) {
  const hasUnread = notifications.some((n) => !n.read);
  return (
    <div
      className="absolute right-0 top-full mt-2 animate-fade-in"
      style={{ width: 340, maxWidth: "calc(100vw - 24px)", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "var(--shadow-card)", zIndex: 100 }}
      role="dialog" aria-label="Notifications"
    >
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 15, color: "var(--color-navy)" }}>Notifications</span>
        <div className="flex items-center gap-1">
          {hasUnread && onMarkAllRead && (
            <button
              onClick={onMarkAllRead}
              style={{ fontSize: 11, fontWeight: 600, color: "var(--color-navy)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}
              className="transition-opacity hover:opacity-70"
            >
              Mark all read
            </button>
          )}
          <button onClick={onClose} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Close">
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>
      </div>
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {notifications.length === 0 ? (
          <p className="px-4 py-6 text-center" style={{ color: "var(--color-secondary)", fontSize: 13 }}>No notifications</p>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className="flex items-start group"
              style={{ backgroundColor: n.read ? undefined : "var(--color-navy-dim)", borderBottom: "1px solid var(--color-border)" }}
            >
              <button
                onClick={() => { onNavigate(n); onClose(); }}
                className="flex-1 text-left px-4 py-3 transition-colors hover:bg-[var(--color-navy-dim)]"
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", minWidth: 0 }}
              >
                <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0 }}>
                  {!n.read && <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: "var(--color-navy)", verticalAlign: "middle" }} />}
                  {n.title}{n.body ? `: ${n.body}` : ""}
                </p>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{relTime(n.created_at)}</p>
              </button>
              {onDismiss && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
                  aria-label="Dismiss notification"
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  style={{ width: 36, height: "100%", minHeight: 44, background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 8px", color: "var(--color-secondary)" }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Profile menu ──────────────────────────────────────────────────────────────

function ProfileMenu({ user, onClose, onSignOut, onNavigateProfile }: {
  user: Pick<User, "name" | "email">;
  onClose: () => void;
  onSignOut: () => void;
  onNavigateProfile: () => void;
}) {
  return (
    <div
      className="absolute right-0 top-full mt-2 animate-fade-in"
      style={{ width: 200, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "var(--shadow-card)", zIndex: 100 }}
    >
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p style={{ fontWeight: 600, fontSize: 13, color: "var(--color-body)" }}>{user.name}</p>
        <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 1 }}>{user.email}</p>
      </div>
      <div className="py-1">
        <button
          onClick={() => { onNavigateProfile(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-4 text-left transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ fontSize: 13, color: "var(--color-body)", minHeight: 44 }}
        >
          <UserIcon size={14} /> Profile
        </button>
        <div style={{ borderTop: "1px solid var(--color-border)", marginTop: 4, paddingTop: 4 }}>
          <button onClick={onSignOut} className="w-full flex items-center gap-2.5 px-4 text-left transition-colors hover:bg-[var(--color-navy-dim)]" style={{ fontSize: 13, color: "var(--color-error)", minHeight: 44 }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────

function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { projectId, subProjectId, subProjects, activeScope, setActiveSubProject, setActiveScope } = useProject();
  const [navCollapsed, setNavCollapsed]   = useState(false);
  const [navWidth, setNavWidth]           = useState(() => {
    try {
      const s = localStorage.getItem("canopy_nav_width");
      if (s) { const w = parseInt(s, 10); if (!isNaN(w)) return Math.max(160, Math.min(300, w)); }
    } catch { /* ignore */ }
    return 210;
  });
  const navWidthRef                       = useRef(210);
  const [showCreate, setShowCreate]       = useState(false);
  const { show: showOnboarding, close: closeOnboarding } = useOnboarding();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [team, setTeam] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<SupabaseNotif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pastDueCount, setPastDueCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dndSettings, setDndSettings] = useState<{ enabled: boolean; start: string; end: string; tz: string } | null>(null);
  const hasFetched = useRef(false);

  // Derive whether we're currently in DND (quiet hours) -- client-side display filter only
  const isDnd = (() => {
    if (!dndSettings?.enabled) return false;
    const { start, end, tz } = dndSettings;
    if (!start || !end) return false;
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
      const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
      const now = h * 60 + m;
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const s = sh * 60 + sm, e = eh * 60 + em;
      return s <= e ? now >= s && now < e : now >= s || now < e;
    } catch { return false; }
  })();

  // ── Auth gate + notifications ─────────────────────────────────────────────
  useEffect(() => {
    let notifChannel: ReturnType<typeof supabase.channel> | null = null;
    let remindersChannel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      // ── Prototype (no Supabase) path ──────────────────────────────────────
      if (!isSupabaseConfigured) {
        if (localStorage.getItem("canopy_authed") !== "true") {
          router.replace("/login");
          return;
        }
        try {
          const stored = localStorage.getItem("canopy_user");
          if (stored) {
            const u = JSON.parse(stored);
            setProfile(u);
            // Show the current user as their own team member in demo mode
            setTeam([{
              id: u.id ?? "demo",
              name: u.name ?? "You",
              email: u.email ?? "",
              role: (u.role ?? "researcher") as User["role"],
              avatarColor: u.avatarColor ?? "#B4D4E3",
              avatarInitials: computeInitials(u.name ?? "") || (u.avatarInitials ?? "??"),
            }]);
          }
        } catch { /* use null profile */ }
        setAuthed(true);
        return;
      }

      // ── Supabase path ─────────────────────────────────────────────────────
      try {
        // Use getUser() (server-verified) not getSession() (localStorage only).
        // On failure, attempt one refresh before redirecting.
        let user: import("@supabase/supabase-js").User | null = null;
        {
          const { data: { user: verified } } = await supabase.auth.getUser();
          if (verified) {
            user = verified;
          } else {
            const { data: refreshed } = await supabase.auth.refreshSession();
            if (refreshed?.user) {
              user = refreshed.user;
            } else {
              router.replace("/login?reason=session_expired");
              return;
            }
          }
        }
        if (!user) { router.replace("/login?reason=session_expired"); return; }

        const { data: prof } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        // Load DND / quiet hours
        const { data: userSettings } = await supabase.from("user_settings").select("dnd_enabled, quiet_hours_start, quiet_hours_end, timezone").eq("user_id", user.id).maybeSingle();
        if (userSettings) {
          setDndSettings({
            enabled: (userSettings.dnd_enabled as boolean) ?? false,
            start: (userSettings.quiet_hours_start as string) ?? "22:00",
            end: (userSettings.quiet_hours_end as string) ?? "08:00",
            tz: (userSettings.timezone as string) ?? "America/New_York",
          });
        }

        // Fetch notifications
        const { data: notifs, error: notifError } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (notifError) console.error("[AppShell] notifications error:", notifError);
        if (notifs) {
          setNotifications(notifs as SupabaseNotif[]);
          setUnreadCount(notifs.filter((n) => !n.read).length);
        }

        // Realtime subscription for new notifications
        notifChannel = supabase
          .channel(`notifications:${user.id}`)
          .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          }, (payload) => {
            setNotifications((prev) => [payload.new as SupabaseNotif, ...prev]);
            setUnreadCount((prev) => prev + 1);
          })
          .subscribe();

        // Count past-due reminders for badge, scoped to the active project
        const userId = user.id;
        async function refreshPastDueCount() {
          const ts = new Date().toISOString();
          const projFilter = projectId ? `,and(scope.eq.lab,project_id.eq.${projectId})` : "";
          const { count } = await supabase
            .from("reminders")
            .select("id", { count: "exact", head: true })
            .eq("completed", false)
            .not("due_at", "is", null)
            .lt("due_at", ts)
            .or(`user_id.eq.${userId},assignee_id.eq.${userId}${projFilter}`);
          setPastDueCount(count ?? 0);
        }

        await refreshPastDueCount();

        // Re-fetch the badge whenever any reminder row changes (complete, uncomplete, delete, add)
        remindersChannel = supabase
          .channel(`reminders-badge:${userId}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "reminders", filter: `user_id=eq.${userId}` }, () => { refreshPastDueCount(); })
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "reminders", filter: `user_id=eq.${userId}` }, () => { refreshPastDueCount(); })
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "reminders", filter: `user_id=eq.${userId}` }, () => { refreshPastDueCount(); })
          .subscribe();

        // Count unread chat messages (messages since last visit to /chat)
        try {
          const lastRead = localStorage.getItem("canopy_chat_last_read") ?? "1970-01-01";
          const labChannel = `lab:${projectId}`;
          const { count: chatCount } = await supabase
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("channel", labChannel)
            .gt("created_at", lastRead)
            .neq("sender_id", user.id);
          setChatUnread(chatCount ?? 0);
        } catch { /* ignore */ }

        setProfile(prof);
        setAuthed(true);
      } catch (err) {
        console.error("[AppShell] init error:", err);
        router.replace("/login");
      }
    }

    if (!hasFetched.current) {
      hasFetched.current = true;
      init();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });

    function onProfileUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail) setProfile(detail);
    }
    window.addEventListener("canopy:profile-updated", onProfileUpdated);

    return () => {
      subscription.unsubscribe();
      notifChannel?.unsubscribe();
      remindersChannel?.unsubscribe();
      window.removeEventListener("canopy:profile-updated", onProfileUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Project data + team - driven by projectId from context ────────────────
  useEffect(() => {
    if (!projectId) return;
    let canceled = false;

    async function loadProjectData() {
      const { data: proj } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle();
      if (!canceled) setProject(proj);

      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id ?? null;

      const { data: members } = await supabase
        .from("team_members")
        .select("*, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
        .eq("project_id", projectId);

      if (!canceled) {
        const mapped: User[] = (members ?? []).map((row) => {
          const profiles = row.user_profiles as unknown as Record<string, string>[] | null;
          const p = Array.isArray(profiles) ? profiles[0] : (profiles as Record<string, string> | null);
          return {
            id: row.user_id as string,
            name: p?.name ?? "Unknown",
            email: "",
            role: row.role as User["role"],
            avatarColor: p?.avatar_color ?? "#B4D4E3",
            avatarInitials: computeInitials(p?.name ?? "") || (p?.avatar_initials ?? "??"),
            avatarUrl: p?.avatar_url ?? undefined,
          };
        });

        // Guarantee the current user always appears, even if missing from team_members
        if (currentUserId && !mapped.some((m) => m.id === currentUserId)) {
          const { data: myProf } = await supabase
            .from("user_profiles")
            .select("name, role, avatar_color, avatar_initials, avatar_url")
            .eq("id", currentUserId)
            .maybeSingle();
          if (myProf && !canceled) {
            const name = (myProf.name as string) ?? "You";
            mapped.unshift({
              id: currentUserId,
              name,
              email: "",
              role: (myProf.role as User["role"]) ?? "researcher",
              avatarColor: (myProf.avatar_color as string) ?? "#B4D4E3",
              avatarInitials: computeInitials(name) || ((myProf.avatar_initials as string) ?? "??"),
              avatarUrl: (myProf.avatar_url as string) ?? undefined,
            });
          }
        }

        setTeam(mapped);
      }
    }

    loadProjectData();
    return () => { canceled = true; };
  }, [projectId]);

  useEffect(() => {
    const collapsed = localStorage.getItem("canopy_nav_collapsed") === "true";
    setNavCollapsed(collapsed);
    // Sync ref with the state value already read in useState init
    navWidthRef.current = navWidth;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMobileNavOpen(false); setNotifOpen(false); setProfileOpen(false);
    if (pathname.startsWith("/chat")) {
      setChatUnread(0);
      try { localStorage.setItem("canopy_chat_last_read", new Date().toISOString()); } catch { /* ignore */ }
    }
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileNavOpen(false); setNotifOpen(false); setProfileOpen(false);
        setShowShortcuts(false);
        return;
      }
      const inInput = (e.target as HTMLElement).tagName === "INPUT"
        || (e.target as HTMLElement).tagName === "TEXTAREA"
        || (e.target as HTMLElement).isContentEditable;
      if (inInput) return;
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const nav: Record<string, string> = {
          d: "/", t: "/tasks", j: "/journal", c: "/chat",
          r: "/reminders", s: "/scheduling", l: "/literature",
          b: "/bookmarks", m: "/team",
        };
        const dest = nav[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); router.push(dest); }
      }
    }
    function onShowShortcutsEvent() { setShowShortcuts(true); }
    document.addEventListener("keydown", onKey);
    window.addEventListener("canopy:show-shortcuts", onShowShortcutsEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("canopy:show-shortcuts", onShowShortcutsEvent);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    // Remove auth/session keys; preserve user preferences (theme, sidebar widths)
    ["canopy_authed", "canopy_project", "canopy_user", "pendingInviteCode", "pendingProjectInviteToken",
     "canopy_chat_last_read"].forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    // Clear all per-channel read-position keys
    try {
      Object.keys(localStorage).filter(k => k.startsWith("chat_channel:")).forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    router.replace("/login");
  }

  if (!authed) {
    return (
      <div className="flex h-full" style={{ backgroundColor: "var(--color-canvas)" }}>
        <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}.sk{background:linear-gradient(90deg,var(--color-border) 25%,var(--color-surface) 50%,var(--color-border) 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;border-radius:6px;}`}</style>
        {/* Nav sidebar skeleton */}
        <div className="hidden md:flex flex-col shrink-0" style={{ width: 200, borderRight: "1px solid var(--color-border)", padding: "16px 12px", gap: 8 }}>
          <div className="sk" style={{ width: 100, height: 14 }} />
          {[1,2,3,4,5,6].map(i => <div key={i} className="sk" style={{ width: `${60 + (i % 3) * 15}%`, height: 12 }} />)}
          <div style={{ marginTop: 12 }} />
          <div className="sk" style={{ width: 80, height: 14 }} />
          {[1,2,3].map(i => <div key={i} className="sk" style={{ width: `${55 + (i % 2) * 20}%`, height: 12 }} />)}
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 flex flex-col" style={{ padding: 24, gap: 16 }}>
          <div className="sk" style={{ width: 200, height: 24 }} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[180, 220, 160, 200].map((w, i) => <div key={i} className="sk" style={{ width: w, height: 80, borderRadius: 8 }} />)}
          </div>
          {[1,2,3,4].map(i => <div key={i} className="sk" style={{ width: `${70 + (i % 3) * 10}%`, height: 14 }} />)}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full" style={{ fontFamily: "var(--font-roboto)" }}>

      {/* Mobile nav backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-20 md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Nav sidebar - collapses to 52px icon rail, resizable ── */}
      <div
        className="hidden md:flex flex-col shrink-0 overflow-hidden group/sidenav"
        style={{
          position: "relative",
          width: navCollapsed ? 52 : navWidth,
          borderRight: "1px solid var(--color-border)",
          transition: navCollapsed ? "width 200ms ease" : "none",
        }}
      >
        <SidebarBody
          isActive={isActive}
          team={team}
          currentUserId={profile?.id ?? ""}
          collapsed={navCollapsed}
          onCollapse={() => { setNavCollapsed(true); localStorage.setItem("canopy_nav_collapsed", "true"); }}
          onExpand={() => { setNavCollapsed(false); localStorage.setItem("canopy_nav_collapsed", "false"); }}
          pastDueCount={pastDueCount}
          chatUnread={chatUnread}
          subProjects={subProjects}
          activeScope={activeScope}
          activeSubProjectId={subProjectId}
          onLabHome={() => { setActiveSubProject(null); setActiveScope("lab"); }}
          onSelectProject={(id) => { setActiveSubProject(id); setActiveScope("project"); }}
          onPersonal={() => { setActiveSubProject(null); setActiveScope("personal"); }}
          onCreateProject={() => setShowCreate(true)}
          onSettings={() => router.push("/settings")}
          profileInitials={computeInitials(profile?.name ?? "") || (profile?.avatar_initials ?? "??")}
          projectName={project?.name ?? ""}
          projectColor={project?.color ?? ""}
        />
        {/* Drag-to-resize handle */}
        {!navCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation sidebar"
            tabIndex={0}
            title="Drag to resize"
            style={{
              position: "absolute", top: 0, right: 0, bottom: 0, width: 6,
              cursor: "col-resize", zIndex: 10, backgroundColor: "transparent",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
            onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                const next = Math.min(300, navWidthRef.current + 10);
                navWidthRef.current = next; setNavWidth(next);
                localStorage.setItem("canopy_nav_width", String(next));
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                const next = navWidthRef.current - 10;
                if (next < 120) { setNavCollapsed(true); localStorage.setItem("canopy_nav_collapsed", "true"); return; }
                const clamped = Math.max(160, next);
                navWidthRef.current = clamped; setNavWidth(clamped);
                localStorage.setItem("canopy_nav_width", String(clamped));
              }
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = navWidthRef.current;
              let live = startW;
              document.body.style.userSelect = "none";
              document.body.style.cursor = "col-resize";
              function onMove(ev: MouseEvent) {
                const next = startW + (ev.clientX - startX);
                if (next < 120) {
                  cleanup();
                  setNavCollapsed(true);
                  localStorage.setItem("canopy_nav_collapsed", "true");
                  return;
                }
                live = Math.max(160, Math.min(300, next));
                navWidthRef.current = live; setNavWidth(live);
              }
              function onUp() {
                cleanup();
                localStorage.setItem("canopy_nav_width", String(live));
              }
              function cleanup() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
              }
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
          />
        )}
      </div>

      {/* ── Mobile nav drawer - fixed overlay, slide in/out ── */}
      <div
        className="md:hidden fixed top-0 left-0 h-full z-30"
        style={{
          width: 210,
          transform: mobileNavOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.22s ease-out",
          borderRight: "1px solid var(--color-border)",
        }}
        aria-hidden={!mobileNavOpen}
        role="navigation"
        aria-label="Main navigation"
      >
        <SidebarBody
          isActive={isActive}
          onLinkClick={() => setMobileNavOpen(false)}
          showCloseButton
          onClose={() => setMobileNavOpen(false)}
          team={team}
          currentUserId={profile?.id ?? ""}
          pastDueCount={pastDueCount}
          chatUnread={chatUnread}
          subProjects={subProjects}
          activeScope={activeScope}
          activeSubProjectId={subProjectId}
          onLabHome={() => { setActiveSubProject(null); setActiveScope("lab"); }}
          onSelectProject={(id) => { setActiveSubProject(id); setActiveScope("project"); }}
          onPersonal={() => { setActiveSubProject(null); setActiveScope("personal"); }}
          onCreateProject={() => setShowCreate(true)}
          onSettings={() => router.push("/settings")}
          profileInitials={computeInitials(profile?.name ?? "") || (profile?.avatar_initials ?? "??")}
          projectName={project?.name ?? ""}
          projectColor={project?.color ?? ""}
        />
      </div>

      {/* ── Layer 3: Main content ── */}
      <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "var(--color-canvas)" }}>

        {/* Top bar */}
        <header
          className="flex items-center gap-2 px-3 md:px-6"
          style={{ backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", height: 52, minHeight: 52 }}
        >
          {/* Hamburger - mobile only */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-navy-dim)] shrink-0"
            style={{ width: 44, height: 44 }}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
          >
            <Menu size={20} color="var(--color-navy)" />
          </button>

          {/* Mobile wordmark + logo */}
          <div className="md:hidden flex items-center gap-2">
            <CanopyLogo size={24} />
            <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 17, color: "var(--color-navy)" }}>
              Canopy
            </span>
          </div>

          {/* Desktop: breadcrumb - "Lab" or "Lab / Project" */}
          <div className="hidden md:flex items-center gap-1.5 min-w-0">
            {project?.name && activeScope !== "personal" && (
              <Link href="/" style={{ fontSize: 12, color: "var(--color-secondary)", whiteSpace: "nowrap", textDecoration: "none" }}
                className="transition-colors hover:text-[var(--color-body)] hover:underline">
                {project.name}
              </Link>
            )}
            {activeScope === "project" && (() => {
              const activeSp = subProjects.find((sp) => sp.id === subProjectId);
              if (!activeSp) return null;
              return (
                <>
                  <span style={{ fontSize: 12, color: "var(--color-border)", userSelect: "none" }}>/</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                    {activeSp.name}
                  </span>
                </>
              );
            })()}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Global search button */}
            <Tooltip label="Search (⌘K)" placement="bottom">
              <button
                onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
                className="hidden sm:flex items-center gap-2 px-3 rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
                style={{ height: 34, fontSize: 12, color: "var(--color-secondary)", border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}
                aria-label="Open search"
              >
                <Search size={13} />
                <span>Search</span>
                <kbd style={{ fontSize: 10, fontFamily: "monospace", backgroundColor: "var(--color-strip)", borderRadius: 4, padding: "1px 5px", color: "var(--color-secondary)", marginLeft: 2 }}>⌘K</kbd>
              </button>
            </Tooltip>

            {/* Institution badge - navigates to team page */}
            {project?.institution && (
              <Tooltip label="View lab team" placement="bottom">
                <Link href="/team" aria-label={`View ${project.institution} team`}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 shrink-0 transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--color-btn-primary)", color: "#fff", borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", textDecoration: "none" }}>
                  {project.institution}
                  <Users size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                </Link>
              </Tooltip>
            )}

            {/* Notification bell */}
            <div className="relative">
              <Tooltip label="Notifications" placement="bottom">
                <button
                  onClick={() => {
                    setNotifOpen(v => !v);
                    setProfileOpen(false);
                  }}
                  className="relative flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-navy-dim)]"
                  style={{ width: 44, height: 44 }}
                  aria-label={isDnd ? "Notifications (quiet hours active)" : `Notifications, ${unreadCount} unread`}
                >
                  <Bell size={18} color="var(--color-body)" />
                  <NotifDot count={isDnd ? 0 : unreadCount} />
                </button>
              </Tooltip>
              {notifOpen && (
                <NotifPanel
                  onClose={() => setNotifOpen(false)}
                  notifications={notifications}
                  onNavigate={(n) => {
                    if (!n.read) {
                      supabase.from("notifications").update({ read: true }).eq("id", n.id)
                        .then(() => setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x)));
                      setUnreadCount((c) => Math.max(0, c - 1));
                    }
                    router.push(notifHref(n));
                    setNotifOpen(false);
                  }}
                  onDismiss={(id) => {
                    const n = notifications.find((x) => x.id === id);
                    supabase.from("notifications").update({ read: true }).eq("id", id)
                      .then(() => {
                        setNotifications((prev) => prev.map((x) => x.id === id ? { ...x, read: true } : x));
                        if (n && !n.read) setUnreadCount((c) => Math.max(0, c - 1));
                      });
                  }}
                  onMarkAllRead={() => {
                    if (!profile?.id) return;
                    supabase.from("notifications").update({ read: true })
                      .eq("user_id", profile.id).eq("read", false)
                      .then(({ error }) => {
                        if (!error) {
                          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                          setUnreadCount(0);
                        }
                      });
                  }}
                />
              )}
            </div>

            {/* User avatar */}
            <div className="relative">
              <Tooltip label="Account" placement="bottom">
                <button
                  onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
                  className="flex items-center gap-1.5 rounded-lg px-1 transition-colors hover:bg-[var(--color-navy-dim)]"
                  style={{ minHeight: 44 }}
                  aria-label="Profile menu"
                >
                <Avatar
                  user={{
                    name: profile?.name ?? "",
                    avatarColor: profile?.avatar_color ?? "#B4D4E3",
                    avatarInitials: computeInitials(profile?.name ?? "") || (profile?.avatar_initials ?? "??"),
                    avatarUrl: profile?.avatar_url ?? undefined,
                  }}
                  size={28}
                />
                <ChevronDown size={14} color="var(--color-secondary)" className="hidden sm:block" />
                </button>
              </Tooltip>
              {profileOpen && (
                <ProfileMenu
                  user={{ name: profile?.name ?? "", email: profile?.email ?? "" }}
                  onClose={() => setProfileOpen(false)}
                  onSignOut={handleSignOut}
                  onNavigateProfile={() => router.push("/profile")}
                />
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <UndoToastProvider>
            <div key={pathname} style={{ animation: "page-in 150ms ease both", height: "100%" }}>
              {children}
            </div>
          </UndoToastProvider>
        </main>
      </div>
    </div>
    <Toast />
    {projectId && <GlobalSearch projectId={projectId} />}
    {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}
    {showOnboarding && authed && <OnboardingModal onClose={closeOnboarding} />}
    <KeyboardShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    {authed && <ChatDock />}
</>
  );
}
