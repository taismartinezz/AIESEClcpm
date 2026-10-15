"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, ExternalLink, Trash2, Bookmark, X, Check, Pencil,
  FileText, BookOpen, FlaskConical, ClipboardList, Link2, Code2, Play, Table,
  Users, User as UserIcon, Home,
} from "lucide-react";
import ScopeSidebar, { type ScopeSection } from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import type { SubProject } from "@/types";
import EmptyState from "@/components/ui/EmptyState";
import { useUndoToast } from "@/context/UndoToastContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type BookmarkType = "doc" | "paper" | "protocol" | "supplies" | "code" | "video" | "sheet" | "link";
type FilterCategory = "all" | BookmarkType;

interface BookmarkRow {
  id: string;
  project_id: string;
  url: string;
  title: string;
  added_by: string | null;
  added_at: string;
  adder_name?: string;
  scope?: string;
  sub_project_id?: string | null;
}

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<BookmarkType, {
  label: string;
  badge: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}> = {
  doc:      { label: "Docs",      badge: "doc",      icon: FileText,     color: "#2563EB", bg: "rgba(37,99,235,0.10)" },
  paper:    { label: "Papers",    badge: "paper",    icon: BookOpen,     color: "#B45309", bg: "rgba(180,83,9,0.10)" },
  protocol: { label: "Protocols", badge: "protocol", icon: ClipboardList, color: "#6D28D9", bg: "rgba(109,40,217,0.10)" },
  supplies: { label: "Supplies",  badge: "supplier", icon: FlaskConical, color: "#0D7A5F", bg: "rgba(13,122,95,0.10)" },
  code:     { label: "Code",      badge: "code",     icon: Code2,        color: "#334155", bg: "rgba(51,65,85,0.10)" },
  video:    { label: "Videos",    badge: "video",    icon: Play,         color: "#B91C1C", bg: "rgba(185,28,28,0.10)" },
  sheet:    { label: "Sheets",    badge: "sheet",    icon: Table,        color: "#15803D", bg: "rgba(21,128,61,0.10)" },
  link:     { label: "Links",     badge: "link",     icon: Link2,        color: "#475569", bg: "rgba(71,85,105,0.10)" },
};

type BmScope = "all" | "personal" | "lab" | "project";

const SCOPE_CONFIG: Record<"all" | "personal" | "lab", { label: string; color: string; icon: React.ElementType }> = {
  all:      { label: "All",      color: "#475569", icon: Bookmark  },
  personal: { label: "Personal", color: "#0EA5E9", icon: UserIcon  },
  lab:      { label: "Lab",      color: "#0F2544", icon: Users     },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferType(url: string): BookmarkType {
  try {
    const { hostname: h, pathname: p } = new URL(url);
    const host = h.replace(/^www\./, "");
    if (host === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "sheet";
      return "doc";
    }
    if (host === "sheets.google.com") return "sheet";
    if (host.includes("notion.so") || host.includes("confluence") || host.includes("sharepoint.com")) return "doc";
    if (host.includes("protocols.io") || p.toLowerCase().includes("protocol")) return "protocol";
    if (
      host.includes("ncbi.nlm") || host.includes("pubmed") ||
      host.includes("psycnet.apa.org") || host.includes("scholar.google") ||
      host.includes("biorxiv.org") || host.includes("medrxiv.org") ||
      host.includes("semanticscholar.org") || host.includes("nature.com") ||
      host.includes("nejm.org") || host.includes("cell.com") ||
      host.includes("apa.org") || host.includes("tandfonline.com") ||
      host.includes("wiley.com") || host.includes("jstor.org")
    ) return "paper";
    if (host === "github.com" || host.includes("gitlab.com")) return "code";
    if (host === "youtube.com" || host === "youtu.be" || host.includes("vimeo.com")) return "video";
    if (
      host.includes("thermofisher") || host.includes("sigmaaldrich") ||
      host.includes("fishersci") || host.includes("grainger") ||
      host.includes("vwr.com") || host.includes("biolegend") ||
      host.includes("addgene.org") || host.includes("millipore") ||
      host.includes("qiagen.com") || host.includes("abcam.com")
    ) return "supplies";
    return "link";
  } catch { return "link"; }
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isCanopyInternalUrl(url: string): boolean {
  if (typeof window === "undefined") return false;
  try { return new URL(url).origin === window.location.origin; } catch { return false; }
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_BOOKMARKS: BookmarkRow[] = [
  { id: "d1", project_id: "demo", url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7523697/", title: "Moral Injury in Healthcare Workers (PMC)", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), adder_name: "Dr. Yara Osei" },
  { id: "d2", project_id: "demo", url: "https://psycnet.apa.org/record/2009-05485-004", title: "Moral Injury and Moral Repair in War Veterans", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(), adder_name: "Tais Martinez" },
  { id: "d3", project_id: "demo", url: "https://docs.google.com/document/d/1/edit", title: "Interview Protocol: Wave 2", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), adder_name: "Dana Kim" },
  { id: "d4", project_id: "demo", url: "https://docs.google.com/document/d/2/edit", title: "Consent Form Template v3", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), adder_name: "Dr. Yara Osei" },
  { id: "d5", project_id: "demo", url: "https://www.sigmaaldrich.com/US/en/product/sigma/m3148", title: "Morphine Sulfate Salt (Sigma-Aldrich)", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), adder_name: "Dr. Yara Osei" },
  { id: "d6", project_id: "demo", url: "https://www.protocols.io/view/interview-guide-bwcjhau", title: "Structured Interview Guide for Moral Injury", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), adder_name: "Tais Martinez" },
  { id: "d7", project_id: "demo", url: "https://sheets.google.com/spreadsheets/d/1/edit", title: "Participant Tracking: Spring 2025", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), adder_name: "Dana Kim" },
  { id: "d8", project_id: "demo", url: "https://github.com/osei-lab/interview-analysis", title: "interview-analysis (GitHub)", added_by: null, added_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), adder_name: "Tais Martinez" },
];


// ── Add form ──────────────────────────────────────────────────────────────────

function AddForm({ onAdd, onCancel }: {
  onAdd: (url: string, title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [urlError, setUrlError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

  async function handleUrlBlur() {
    if (!url || !isValidUrl(url) || title) return;
    setFetching(true);
    const fetched = await fetchPageTitle(url);
    // Use functional update: if the user typed a title while fetch was in-flight, keep it
    setTitle((prev) => prev || (fetched ?? hostname(url)));
    setFetching(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidUrl(url)) { setUrlError("Enter a valid URL (https://…)"); return; }
    setSaving(true);
    const finalTitle = title.trim() || hostname(url);
    await onAdd(url.trim(), finalTitle);
    setSaving(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-fade-in"
      style={{
        marginBottom: 24,
        borderRadius: 10,
        padding: 20,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-navy)",
        boxShadow: "0 4px 20px rgba(27,46,75,0.10)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 15, color: "var(--color-navy)" }}>
          Add bookmark
        </span>
        <button
          type="button"
          onClick={onCancel}
          style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "none", cursor: "pointer" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(27,46,75,0.06)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          aria-label="Cancel"
        >
          <X size={16} color="var(--color-secondary)" />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5 }}>URL *</label>
          <input
            ref={urlRef}
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
            onBlur={handleUrlBlur}
            placeholder="https://example.com"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13, border: `1px solid ${urlError ? "#C0392B" : "var(--color-border)"}`, borderRadius: 7, outline: "none", fontFamily: "var(--font-roboto)", color: "var(--color-body)", backgroundColor: "var(--color-canvas)" }}
          />
          {urlError && <p style={{ fontSize: 12, color: "#C0392B", marginTop: 4 }}>{urlError}</p>}
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5 }}>
            Title <span style={{ fontWeight: 400 }}>(auto-filled from URL if blank)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={fetching ? "Fetching title…" : "Page title"}
            disabled={fetching}
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13, border: "1px solid var(--color-border)", borderRadius: 7, outline: "none", fontFamily: "var(--font-roboto)", color: "var(--color-body)", backgroundColor: "var(--color-canvas)", opacity: fetching ? 0.6 : 1 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <button
          type="submit"
          disabled={saving || fetching}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", height: 40, backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", borderRadius: 7, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}
        >
          <Check size={14} />
          {saving ? "Saving…" : "Add Bookmark"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ fontSize: 13, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "0 8px", height: 40 }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Favicon loader for "link" type bookmarks ─────────────────────────────────

function FaviconImg({ url, fallbackColor }: { url: string; fallbackColor: string }) {
  const [failed, setFailed] = useState(false);
  const domain = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!domain || failed) return <Link2 size={16} color={fallbackColor} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      width={16}
      height={16}
      onError={() => setFailed(true)}
      style={{ borderRadius: 3, objectFit: "contain" }}
    />
  );
}

// ── Bookmark card ─────────────────────────────────────────────────────────────

function BookmarkCard({ bm, canDelete, onDelete, onEdit }: {
  bm: BookmarkRow;
  canDelete: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string, title: string, url: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(bm.title);
  const [editUrl, setEditUrl] = useState(bm.url);
  const [editSaving, setEditSaving] = useState(false);
  const [editUrlError, setEditUrlError] = useState("");
  const type = inferType(bm.url);
  const cfg = TYPE_CONFIG[type];
  const Icon = cfg.icon;
  const isInternal = isCanopyInternalUrl(bm.url);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Remove "${bm.title}"?\nThis cannot be undone.`)) return;
    setDeleting(true);
    await onDelete(bm.id);
    setDeleting(false);
  }

  async function handleSaveEdit(e: React.MouseEvent) {
    e.stopPropagation();
    if (!editUrl.trim() || !isValidUrl(editUrl.trim())) {
      setEditUrlError("Enter a valid URL (https://…)");
      return;
    }
    setEditUrlError("");
    setEditSaving(true);
    await onEdit(bm.id, editTitle.trim() || hostname(editUrl.trim()), editUrl.trim());
    setEditSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-navy)",
          borderRadius: 10, padding: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", display: "block", marginBottom: 3 }}>Title</label>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 6, outline: "none", fontFamily: "var(--font-roboto)", color: "var(--color-body)", backgroundColor: "var(--color-canvas)" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", display: "block", marginBottom: 3 }}>URL</label>
          <input
            value={editUrl}
            onChange={(e) => { setEditUrl(e.target.value); setEditUrlError(""); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, border: `1px solid ${editUrlError ? "#C0392B" : "var(--color-border)"}`, borderRadius: 6, outline: "none", fontFamily: "var(--font-roboto)", color: "var(--color-body)", backgroundColor: "var(--color-canvas)" }}
          />
          {editUrlError && <p style={{ fontSize: 11, color: "#C0392B", marginTop: 3 }}>{editUrlError}</p>}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(false); setEditTitle(bm.title); setEditUrl(bm.url); }}
            style={{ fontSize: 12, color: "var(--color-secondary)", background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 12px", cursor: "pointer", minHeight: 32 }}
          >Cancel</button>
          <button
            onClick={handleSaveEdit}
            disabled={editSaving || !editUrl.trim()}
            style={{ fontSize: 12, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 6, padding: "5px 12px", cursor: editSaving ? "not-allowed" : "pointer", minHeight: 32, opacity: editSaving ? 0.7 : 1 }}
          >{editSaving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  const domainLabel = isInternal
    ? (() => { try { return new URL(bm.url).pathname; } catch { return bm.url; } })()
    : hostname(bm.url);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => isInternal ? (window.location.href = bm.url) : window.open(bm.url, "_blank", "noopener,noreferrer")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: hovered ? "var(--shadow-card)" : "none",
        transition: "border-color 150ms ease, box-shadow 150ms ease",
        cursor: "pointer",
      }}
    >
      {/* Type icon */}
      <div style={{
        width: 30, height: 30, borderRadius: 7,
        backgroundColor: cfg.bg, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {type === "link" ? (
          <FaviconImg url={bm.url} fallbackColor={cfg.color} />
        ) : (
          <Icon size={14} color={cfg.color} />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 600, color: "var(--color-body)",
          margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {bm.title}
        </p>
        <p style={{
          fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {domainLabel} · {bm.adder_name ?? "Unknown"} · {relTime(bm.added_at)}
        </p>
      </div>

      {/* Badge + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {isInternal && (
          <span style={{
            display: "flex", alignItems: "center", gap: 3,
            fontSize: 9, fontWeight: 700, color: "var(--color-navy)",
            backgroundColor: "var(--color-navy-dim)", borderRadius: 4,
            padding: "2px 5px",
          }}>
            <Home size={8} />
            Canopy
          </span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 700, color: cfg.color,
          backgroundColor: cfg.bg, borderRadius: 4,
          padding: "2px 6px", letterSpacing: "0.05em",
          textTransform: "uppercase", whiteSpace: "nowrap",
        }}>
          {cfg.badge}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "none", background: "none", cursor: "pointer", color: "var(--color-secondary)", transition: "background-color 120ms ease, color 120ms ease" }}
          onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--color-navy)"; el.style.backgroundColor = "rgba(27,46,75,0.08)"; }}
          onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--color-secondary)"; el.style.backgroundColor = "transparent"; }}
          aria-label="Edit bookmark"
        >
          <Pencil size={11} />
        </button>
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "none", background: "none", cursor: deleting ? "not-allowed" : "pointer", color: "var(--color-secondary)", transition: "background-color 120ms ease, color 120ms ease" }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--color-error)"; el.style.backgroundColor = "rgba(192,57,43,0.08)"; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--color-secondary)"; el.style.backgroundColor = "transparent"; }}
            aria-label="Delete bookmark"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BookmarksPage() {
  const { show: showUndoToast } = useUndoToast();
  // Only read from ProjectContext -- never write back to it from this page.
  // All scope selection here is purely local (bmScope) and never calls setActiveScope.
  const { projectId, subProjectId, subProjects, activeScope } = useProject();
  const isLabHome = activeScope === "lab";
  // Initialize the local scope from the global scope so first render is consistent.
  // Personal/project scopes from the global context are reflected here, but subsequent
  // changes via the sidebar only affect local state.
  const [bmScope, setBmScope] = useState<BmScope>(() => {
    if (activeScope === "personal") return "personal";
    if (activeScope === "project") return "project";
    return "all";
  });
  const [selectedSubProjectId, setSelectedSubProjectId] = useState<string | null>(null);
  const effectiveBmScope: BmScope = isLabHome ? bmScope : (activeScope === "project" ? "project" : "personal");
  const effectiveSubProjectId: string | null = isLabHome
    ? (bmScope === "project" ? selectedSubProjectId : null)
    : (activeScope === "project" ? (subProjectId ?? null) : null);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("bookmarks_sidebar_collapsed") === "true"; } catch { return false; }
  });

  function handleScopeSelect(scope: BmScope, spId?: string) {
    setBmScope(scope);
    setSelectedSubProjectId(spId ?? null);
    setShowForm(false);
    setActiveCategory("all");
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setBookmarks(DEMO_BOOKMARKS);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setCurrentUserId(session.user.id);
    });
  }, []);

  const fetchBookmarks = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bookmarks")
      .select("*, user_profiles!added_by(name)")
      .eq("project_id", projectId)
      .order("added_at", { ascending: false });

    if (error) {
      console.error("[Bookmarks] fetch error:", error);
    } else if (data) {
      setBookmarks(
        data.map((row) => {
          const prof = row.user_profiles as { name?: string } | null;
          return {
            id:             row.id as string,
            project_id:     row.project_id as string,
            url:            row.url as string,
            title:          row.title as string,
            added_by:       row.added_by as string | null,
            added_at:       row.added_at as string,
            adder_name:     prof?.name ?? undefined,
            scope:          (row.scope as string | undefined) ?? "lab",
            sub_project_id: (row.sub_project_id as string | null | undefined) ?? null,
          };
        })
      );
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (isSupabaseConfigured && projectId) fetchBookmarks();
  }, [projectId, fetchBookmarks]);

  async function handleAdd(url: string, title: string) {
    if (!projectId) return;

    const addScope = effectiveBmScope === "all" ? "lab" : effectiveBmScope;

    const optimistic: BookmarkRow = {
      id:             `optimistic-${Date.now()}`,
      project_id:     projectId,
      url,
      title,
      added_by:       currentUserId,
      added_at:       new Date().toISOString(),
      adder_name:     "You",
      scope:          addScope,
      sub_project_id: effectiveSubProjectId,
    };
    setBookmarks((prev) => [optimistic, ...prev]);
    setShowForm(false);

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        project_id:     projectId,
        url,
        title,
        added_by:       currentUserId,
        scope:          addScope,
        sub_project_id: effectiveSubProjectId,
      })
      .select("*, user_profiles!added_by(name)")
      .single();

    if (error) {
      console.error("[Bookmarks] insert error:", error);
      setBookmarks((prev) => prev.filter((b) => b.id !== optimistic.id));
      return;
    }

    const prof = data.user_profiles as { name?: string } | null;
    const confirmed: BookmarkRow = {
      id:             data.id as string,
      project_id:     data.project_id as string,
      url:            data.url as string,
      title:          data.title as string,
      added_by:       data.added_by as string | null,
      added_at:       data.added_at as string,
      adder_name:     prof?.name ?? undefined,
      scope:          addScope,
      sub_project_id: effectiveSubProjectId,
    };
    setBookmarks((prev) => prev.map((b) => b.id === optimistic.id ? confirmed : b));
  }

  function handleDelete(id: string) {
    const bm = bookmarks.find((b) => b.id === id);
    if (!bm) return;
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    showUndoToast(
      `"${bm.title}" deleted`,
      () => setBookmarks((prev) => [...prev, bm]),
      async () => {
        const { error } = await supabase.from("bookmarks").delete().eq("id", id);
        if (error) { console.error("[Bookmarks] delete error:", error); fetchBookmarks(); }
      },
    );
  }

  async function handleEditBookmark(id: string, title: string, url: string) {
    setBookmarks((prev) => prev.map((b) => b.id === id ? { ...b, title, url } : b));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("bookmarks").update({ title, url }).eq("id", id);
      if (error) {
        console.error("[Bookmarks] edit error:", error);
        fetchBookmarks();
      }
    }
  }

  // Local scope filter - uses effectiveBmScope so clicking the icon rail drives data immediately
  const scopedBookmarks = bookmarks.filter((bm) => {
    if (effectiveBmScope === "all") return true;
    if (effectiveBmScope === "project") return bm.scope === "project" && (!effectiveSubProjectId || bm.sub_project_id === effectiveSubProjectId);
    return bm.scope === effectiveBmScope;
  });

  // Scope counts for sidebar
  const scopeCounts = {
    all:      bookmarks.length,
    personal: bookmarks.filter((b) => b.scope === "personal").length,
    lab:      bookmarks.filter((b) => b.scope === "lab").length,
  };
  const projectCounts: Record<string, number> = {};
  for (const sp of subProjects) {
    projectCounts[sp.id] = bookmarks.filter((b) => b.scope === "project" && b.sub_project_id === sp.id).length;
  }

  // Derive category counts from scoped bookmarks
  const categoryCounts = Object.entries(
    scopedBookmarks.reduce((acc, bm) => {
      const t = inferType(bm.url);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {} as Record<BookmarkType, number>)
  )
    .map(([type, count]) => ({ type: type as BookmarkType, count }))
    .sort((a, b) => b.count - a.count);

  // Apply category filter on top of scoped list
  const filtered = activeCategory === "all"
    ? scopedBookmarks
    : scopedBookmarks.filter((bm) => inferType(bm.url) === activeCategory);

  const emptyLabel = activeCategory === "all"
    ? "No bookmarks yet"
    : `No ${TYPE_CONFIG[activeCategory as BookmarkType]?.label.toLowerCase() ?? "bookmarks"} yet`;

  const sidebarSections: ScopeSection[] = [
    { id: "all",      label: "All",      color: SCOPE_CONFIG.all.color,      icon: <SCOPE_CONFIG.all.icon size={14} />,      count: scopeCounts.all,      isActive: bmScope === "all",      onClick: () => handleScopeSelect("all") },
    { id: "personal", label: "Personal", color: SCOPE_CONFIG.personal.color, icon: <SCOPE_CONFIG.personal.icon size={14} />, count: scopeCounts.personal, isActive: bmScope === "personal", onClick: () => handleScopeSelect("personal") },
    { id: "lab",      label: "Lab",      color: SCOPE_CONFIG.lab.color,      icon: <SCOPE_CONFIG.lab.icon size={14} />,      count: scopeCounts.lab,      isActive: bmScope === "lab",      onClick: () => handleScopeSelect("lab") },
  ];

  const typesExtra = categoryCounts.length > 0 ? (
    <>
      <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "5px 2px" }} />
      <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 11px 4px", margin: 0 }}>Types</p>
      {categoryCounts.map(({ type, count }) => {
        const cfg = TYPE_CONFIG[type];
        const Icon = cfg.icon;
        const active = activeCategory === type;
        return (
          <button
            key={type}
            onClick={() => setActiveCategory(active ? "all" : type)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${active ? cfg.color : "transparent"}`, cursor: "pointer", backgroundColor: active ? `${cfg.color}18` : "transparent", marginBottom: 1, transition: "background-color 120ms ease, border-left-color 120ms ease", textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)" }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <span style={{ flexShrink: 0, color: active ? cfg.color : "var(--color-secondary)", display: "flex", alignItems: "center" }}><Icon size={14} /></span>
            <span style={{ flex: 1, fontSize: 13, color: active ? cfg.color : "var(--color-body)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cfg.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: active ? cfg.color : "var(--color-secondary)", backgroundColor: active ? `${cfg.color}20` : "rgba(0,0,0,0.06)", borderRadius: 10, padding: "1px 7px", flexShrink: 0, minWidth: 20, textAlign: "center" }}>{count}</span>
          </button>
        );
      })}
    </>
  ) : null;

  const bmBadgeSp = !isLabHome && activeScope === "project"
    ? subProjects.find((s) => s.id === subProjectId) ?? null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontFamily: "var(--font-roboto)" }}>

      <PageHeader
        title="Bookmarks"
        badge={bmBadgeSp ? (
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", backgroundColor: "rgba(27,46,75,0.10)", color: "var(--color-navy)", padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {bmBadgeSp.name}
          </span>
        ) : undefined}
        action={!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", height: 36, padding: "0 14px" }}
          >
            <Plus size={13} />
            Add
          </button>
        ) : undefined}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* ── Left sidebar - desktop only, lab-home context only ───────────── */}
      {isLabHome && (
        <div className="hidden md:flex">
          <ScopeSidebar
            sections={sidebarSections}
            subProjects={subProjects}
            selectedSubProjectId={bmScope === "project" ? selectedSubProjectId : null}
            projectCounts={projectCounts}
            onSelectSubProject={(id) => handleScopeSelect("project", id)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => {
              const next = !c;
              try { localStorage.setItem("bookmarks_sidebar_collapsed", String(next)); } catch { /* ignore */ }
              return next;
            })}
            extraContent={typesExtra}
            storageKey="canopy_bookmarks_sidebar"
            headerLabel="Filters"
          />
        </div>
      )}

      {/* ── Right content area ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", backgroundColor: "var(--color-canvas)" }}>

        {/* Mobile scope + type chips - lab-home context only */}
        {isLabHome && (
          <div className="md:hidden flex items-center gap-2 px-4 pt-4 pb-2 overflow-x-auto" style={{ borderBottom: "1px solid var(--color-border)", scrollbarWidth: "none" }}>
            {(["all", "personal", "lab"] as const).map((s) => {
              const cfg = SCOPE_CONFIG[s];
              const isAct = bmScope === s && !selectedSubProjectId;
              return (
                <button key={s} onClick={() => handleScopeSelect(s)} style={{ flexShrink: 0, fontSize: 12, fontWeight: isAct ? 700 : 500, padding: "5px 12px", borderRadius: 20, border: `1px solid ${isAct ? cfg.color : "var(--color-border)"}`, backgroundColor: isAct ? `${cfg.color}18` : "transparent", color: isAct ? cfg.color : "var(--color-secondary)", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font-roboto)" }}>
                  {cfg.label} {scopeCounts[s]}
                </button>
              );
            })}
            </div>
        )}

        <div className="p-6">

          {/* Add form */}
          {showForm && (
            <AddForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
          )}

          {/* Loading */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ width: `${40 + i * 10}%`, height: 13, borderRadius: 4, backgroundColor: "var(--color-border)", marginBottom: 8 }} className="animate-pulse" />
                  <div style={{ width: "60%", height: 10, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.6 }} className="animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && filtered.length === 0 && (
            <EmptyState
              variant="bookmarks"
              title={emptyLabel}
              description="Add one to share a useful link with your lab."
              action={activeCategory === "all" ? (
                <button
                  onClick={() => setShowForm(true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", height: 36, backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 7, cursor: "pointer" }}
                >
                  <Plus size={13} />
                  Add bookmark
                </button>
              ) : undefined}
            />
          )}

          {/* Card list */}
          {!loading && filtered.length > 0 && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}>
              {filtered.map((bm) => (
                <BookmarkCard
                  key={bm.id}
                  bm={bm}
                  canDelete={currentUserId !== null && (bm.scope !== "personal" || bm.added_by === currentUserId)}
                  onDelete={handleDelete}
                  onEdit={handleEditBookmark}
                />
              ))}
            </div>
          )}

        </div>
      </div>
      </div>
    </div>
  );
}
