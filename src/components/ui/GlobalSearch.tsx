"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, X, FileText, CheckSquare, Bell, Bookmark, ExternalLink, BookOpen, MessageSquare, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface SearchResult {
  id: string;
  type: "task" | "literature" | "reminder" | "bookmark" | "journal" | "chat" | "event";
  title: string;
  subtitle?: string;
  url: string;
}

const TYPE_ICON: Record<SearchResult["type"], React.ReactNode> = {
  task:       <CheckSquare size={14} />,
  literature: <FileText size={14} />,
  reminder:   <Bell size={14} />,
  bookmark:   <Bookmark size={14} />,
  journal:    <BookOpen size={14} />,
  chat:       <MessageSquare size={14} />,
  event:      <Calendar size={14} />,
};

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  task: "Task", literature: "Paper", reminder: "Reminder", bookmark: "Bookmark", journal: "Journal", chat: "Chat", event: "Event",
};

const TYPE_COLOR: Record<SearchResult["type"], string> = {
  task: "#1B2E4B", literature: "#2E7D52", reminder: "#A0622A", bookmark: "#7C3AED", journal: "#1E6FA5", chat: "#2563EB", event: "#0F766E",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  todo:        "To Do",
  in_progress: "In Progress",
  in_review:   "In Review",
  done:        "Done",
  archived:    "Archived",
};

function formatTaskStatus(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return TASK_STATUS_LABEL[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

export default function GlobalSearch({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const term = `%${q.trim().toLowerCase()}%`;
    const hits: SearchResult[] = [];

    const [tasksRes, litRes, remindersRes, bookmarksRes, journalRes, chatRes, eventsRes] = await Promise.all([
      supabase.from("tasks").select("id, title, status").eq("project_id", projectId).ilike("title", term).limit(5),
      supabase.from("literature_items").select("id, title, journal").eq("project_id", projectId).is("deleted_at", null).ilike("title", term).limit(5),
      supabase.from("reminders").select("id, title, due_date").eq("project_id", projectId).ilike("title", term).limit(5),
      supabase.from("bookmarks").select("id, title, url").eq("project_id", projectId).ilike("title", term).limit(5),
      supabase.from("journal_entries").select("id, title, created_at").ilike("title", term).limit(5),
      supabase.from("chat_messages").select("id, content, created_at").eq("project_id", projectId).is("deleted_at", null).ilike("content", term).limit(5),
      supabase.from("schedule_events").select("id, title, date").eq("project_id", projectId).ilike("title", term).limit(5),
    ]);

    for (const t of tasksRes.data ?? []) {
      hits.push({ id: t.id as string, type: "task", title: t.title as string, subtitle: formatTaskStatus(t.status as string), url: `/tasks?openTask=${t.id as string}` });
    }
    for (const l of litRes.data ?? []) {
      hits.push({ id: l.id as string, type: "literature", title: l.title as string, subtitle: (l.journal as string) ?? undefined, url: "/literature" });
    }
    for (const r of remindersRes.data ?? []) {
      hits.push({ id: r.id as string, type: "reminder", title: r.title as string, subtitle: r.due_date ? new Date(r.due_date as string).toLocaleDateString() : undefined, url: "/scheduling" });
    }
    for (const b of bookmarksRes.data ?? []) {
      hits.push({ id: b.id as string, type: "bookmark", title: b.title as string, subtitle: b.url as string, url: b.url as string });
    }
    for (const j of journalRes.data ?? []) {
      const subtitle = j.created_at ? new Date(j.created_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : undefined;
      hits.push({ id: j.id as string, type: "journal", title: (j.title as string) || "Journal entry", subtitle, url: "/journal" });
    }
    for (const c of chatRes.data ?? []) {
      const snippet = (c.content as string).slice(0, 80);
      hits.push({ id: c.id as string, type: "chat", title: snippet, subtitle: c.created_at ? new Date(c.created_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined, url: "/chat" });
    }
    for (const e of eventsRes.data ?? []) {
      hits.push({ id: e.id as string, type: "event", title: e.title as string, subtitle: e.date ? new Date(e.date as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : undefined, url: "/scheduling" });
    }

    setResults(hits);
    setSelectedIdx(0);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!query.trim()) { setResults([]); return; }
    searchDebounce = setTimeout(() => runSearch(query), 280);
    return () => { if (searchDebounce) clearTimeout(searchDebounce); };
  }, [query, runSearch]);

  function navigate(result: SearchResult) {
    setOpen(false);
    if (result.type === "bookmark") {
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = result.url;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) navigate(results[selectedIdx]);
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99990, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "15vh", backgroundColor: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        style={{ width: "min(600px, 94vw)", backgroundColor: "var(--color-surface)", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 10, borderBottom: `1px solid var(--color-border)` }}>
          <Search size={18} color="var(--color-secondary)" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, papers, journal, chat, events…"
            style={{ flex: 1, fontSize: 15, border: "none", outline: "none", background: "transparent", color: "var(--color-body)", fontFamily: "var(--font-inter)" }}
          />
          <button onClick={() => setOpen(false)} style={{ display: "flex", background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)", padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {loading && (
            <p style={{ padding: "20px 20px", fontSize: 13, color: "var(--color-secondary)", textAlign: "center" }}>Searching…</p>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p style={{ padding: "20px 20px", fontSize: 13, color: "var(--color-secondary)", textAlign: "center" }}>No results for "{query}"</p>
          )}
          {!loading && results.length > 0 && results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => navigate(r)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 16px",
                textAlign: "left", background: i === selectedIdx ? "var(--color-navy-dim)" : "transparent",
                border: "none", cursor: "pointer", borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span style={{ color: TYPE_COLOR[r.type], flexShrink: 0 }}>{TYPE_ICON[r.type]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                {r.subtitle && <span style={{ fontSize: 11, color: "var(--color-secondary)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subtitle}</span>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: TYPE_COLOR[r.type], backgroundColor: `${TYPE_COLOR[r.type]}18`, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{TYPE_LABEL[r.type]}</span>
              {r.type === "bookmark" && <ExternalLink size={12} color="var(--color-secondary)" style={{ flexShrink: 0 }} />}
            </button>
          ))}
          {!loading && !query.trim() && (
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", margin: 0 }}>Search across</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {(["Tasks", "Papers", "Reminders", "Bookmarks"] as const).map((l) => (
                  <span key={l} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", color: "var(--color-secondary)" }}>{l}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{ display: "flex", gap: 16, padding: "8px 16px", borderTop: `1px solid var(--color-border)`, backgroundColor: "var(--color-canvas)" }}>
          {[["↑↓", "navigate"], ["↵", "open"], ["Esc", "close"]].map(([key, action]) => (
            <span key={action} style={{ fontSize: 11, color: "var(--color-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <kbd style={{ fontFamily: "monospace", backgroundColor: "var(--color-strip)", borderRadius: 4, padding: "1px 5px", fontSize: 10, color: "var(--color-body)" }}>{key}</kbd>
              {action}
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
