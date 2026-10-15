"use client";

import { useState, useEffect, useRef } from "react";
import {
  formatFileSize,
} from "@/lib/mock-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUndoToast } from "@/context/UndoToastContext";
import { useProject } from "@/context/ProjectContext";
import type { LiteratureItem, ReadStatus, LiteratureType, LibraryScope, LiteratureFile, LitAnnotation, LitAssignedReading, LitRecommendation, AssignmentReadingStatus, SubProject, User, UserRole } from "@/types";
import Avatar from "@/components/ui/Avatar";
import PDFViewer from "@/components/literature/PDFViewer";
import PDFViewerInline from "@/components/literature/PDFViewerInline";
import ScopeSidebar from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";
import {
  Plus, Search, Download, FileText, File as FileIcon, X, Trash2,
  Tag, Star, ExternalLink, Copy, Check, ChevronLeft, ChevronRight,
  Book, BarChart2, GraduationCap,
  Library, ClipboardList, Brain, Microscope, Heart,
  Upload, Link2, MessageSquare, Zap, UserCheck, RefreshCw, Eye, EyeOff, Wifi, Undo2, Pencil,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<LiteratureType, React.ReactNode> = {
  article:  <FileText      size={14} color="var(--color-secondary)" aria-label="Article"  />,
  book:     <Book          size={14} color="var(--color-secondary)" aria-label="Book"     />,
  preprint: <FileText      size={14} color="var(--color-secondary)" aria-label="Preprint" />,
  report:   <BarChart2     size={14} color="var(--color-secondary)" aria-label="Report"   />,
  thesis:   <GraduationCap size={14} color="var(--color-secondary)" aria-label="Thesis"  />,
};

function collectionIcon(iconName: string, active: boolean) {
  const color = active ? "#fff" : "var(--color-secondary)";
  const map: Record<string, React.ReactNode> = {
    Library: <Library size={14} color={color} />, ClipboardList: <ClipboardList size={14} color={color} />,
    Brain: <Brain size={14} color={color} />, Microscope: <Microscope size={14} color={color} />,
    Heart: <Heart size={14} color={color} />,
  };
  return map[iconName] ?? <Library size={14} color={color} />;
}

const STATUS_CONFIG: Record<ReadStatus, { label: string; color: string; bg: string }> = {
  read:    { label: "Read",    color: "var(--lit-read-color)",    bg: "var(--lit-read-bg)" },
  reading: { label: "Reading", color: "var(--lit-reading-color)", bg: "var(--lit-reading-bg)" },
  unread:  { label: "Unread",  color: "var(--lit-unread-color)",  bg: "var(--lit-unread-bg)" },
};

function StatusBadge({ status }: { status: ReadStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center px-2 py-0.5" style={{ backgroundColor: cfg.bg, color: cfg.color, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

function toAuthorsArray(authors: string | string[]): string[] {
  if (Array.isArray(authors)) return authors;
  if (typeof authors !== "string" || !authors.trim()) return [];
  // Handles JSON-array strings stored in the text column e.g. '["Smith","Jones"]'
  if (authors.startsWith("[")) {
    try { return JSON.parse(authors) as string[]; } catch { /* fall through */ }
  }
  return authors.split(",").map((s) => s.trim()).filter(Boolean);
}

function formatAuthors(authors: string | string[]) {
  const arr = toAuthorsArray(authors);
  if (!arr.length) return "-";
  if (arr.length <= 2) return arr.join(", ");
  return `${arr[0]} et al.`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function parseAuthor(raw: string): { last: string; first: string } {
  const c = raw.indexOf(",");
  if (c !== -1) return { last: raw.slice(0, c).trim(), first: raw.slice(c + 1).trim() };
  const parts = raw.trim().split(/\s+/);
  return { last: parts[parts.length - 1] ?? "", first: parts.slice(0, -1).join(" ") };
}

function formatCitation(item: LiteratureItem, style: "apa" | "mla" | "chicago"): string {
  const parsed = toAuthorsArray(item.authors).map(parseAuthor);
  const journal = item.journal ?? item.publisher ?? "";
  const year = item.year > 0 ? String(item.year) : "n.d.";
  const title = stripHtml(item.title);

  if (style === "apa") {
    // APA 7th: Last, F., Last, F., & Last, F. (Year). Title. Journal, Volume, Pages. DOI
    const fmt = (a: { last: string; first: string }) =>
      `${a.last}, ${a.first ? a.first[0].toUpperCase() + "." : ""}`;
    let authorStr = "";
    if (parsed.length === 1) {
      authorStr = fmt(parsed[0]);
    } else if (parsed.length > 1) {
      const parts = parsed.map(fmt);
      const last = parts.pop()!;
      authorStr = parts.join(", ") + ", & " + last;
    }
    const vol = item.volume ? `, ${item.volume}` : "";
    const pages = item.pages ? `, ${item.pages}` : "";
    const doi = item.doi ? ` https://doi.org/${item.doi}` : "";
    return `${authorStr} (${year}). ${title}. ${journal}${vol}${pages}.${doi}`;
  }

  if (style === "mla") {
    // MLA 9th: Last, First[, and First Last | , et al.]. "Title." Journal, vol. Volume, Year, pp. Pages.
    let authorStr = "";
    if (parsed.length === 1) {
      const a = parsed[0];
      authorStr = a.first ? `${a.last}, ${a.first}` : a.last;
    } else if (parsed.length === 2) {
      const [a, b] = parsed;
      authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, and ${b.first ? `${b.first} ${b.last}` : b.last}`;
    } else if (parsed.length > 2) {
      const a = parsed[0];
      authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, et al.`;
    }
    const vol = item.volume ? `, vol. ${item.volume}` : "";
    const pages = item.pages ? `, pp. ${item.pages}` : "";
    return `${authorStr}. "${title}." ${journal}${vol}, ${year}${pages}.`;
  }

  // Chicago 17th: Last, First[, First Last[, and First Last]]. "Title." Journal Volume (Year): Pages. DOI.
  let authorStr = "";
  if (parsed.length === 1) {
    const a = parsed[0];
    authorStr = a.first ? `${a.last}, ${a.first}` : a.last;
  } else if (parsed.length === 2) {
    const [a, b] = parsed;
    authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, and ${b.first ? `${b.first} ${b.last}` : b.last}`;
  } else if (parsed.length === 3) {
    const [a, b, c] = parsed;
    authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, ${b.first ? `${b.first} ${b.last}` : b.last}, and ${c.first ? `${c.first} ${c.last}` : c.last}`;
  } else if (parsed.length > 3) {
    const a = parsed[0];
    authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, et al.`;
  }
  const vol = item.volume ? ` ${item.volume}` : "";
  const pages = item.pages ? `: ${item.pages}` : "";
  const doi = item.doi ? ` https://doi.org/${item.doi}.` : "";
  return `${authorStr}. "${title}." ${journal}${vol} (${year})${pages}.${doi}`;
}

function guessLitFileType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  return ext || "other";
}

function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return "Removed today";
  if (days === 1) return "Removed 1 day ago";
  return `Removed ${days} days ago`;
}

// ── Insert payload builder - single source of truth for real DB schema ────────
// Real columns (confirmed from live DB): id, project_id, user_id, library,
//   title, authors, year, journal, doi, abstract, status, tags, created_at
// Any key not in REAL_LIT_COLS is dropped with a console.warn so drift is
// caught at dev time instead of surfacing as a 400 three rounds later.

const REAL_LIT_COLS = new Set([
  "id", "project_id", "user_id", "added_by", "library",
  "title", "authors", "year", "journal", "volume", "pages",
  "doi", "abstract", "status", "tags", "type",
  "sub_project_id", "zotero_key",
]);

function buildLitInsert(
  projectId: string,
  userId: string,
  fields: {
    id?: string;
    library: LibraryScope;
    title: string;
    authors: string | string[];
    year?: number | null;
    journal?: string | null;
    volume?: string | null;
    pages?: string | null;
    doi?: string | null;
    abstract?: string | null;
    tags?: string[];
    status?: "unread" | "reading" | "read";
    type?: LiteratureType | null;
    sub_project_id?: string | null;
    zotero_key?: string | null;
    [extra: string]: unknown;
  }
) {
  // Warn on any key the caller passed that doesn't map to a real column
  for (const key of Object.keys(fields)) {
    if (key !== "id" && !REAL_LIT_COLS.has(key)) {
      console.warn(`[buildLitInsert] Dropping unrecognized field: "${key}"`);
    }
  }
  const payload: Record<string, unknown> = {
    project_id: projectId,
    user_id: userId,
    added_by: userId,
    library: fields.library,
    type: fields.type ?? "article",
    title: fields.title,
    authors: Array.isArray(fields.authors)
      ? fields.authors
      : (fields.authors ?? ""),
    year: fields.year ?? null,
    journal: fields.journal ?? null,
    volume: fields.volume ?? null,
    pages: fields.pages ?? null,
    doi: fields.doi ?? null,
    abstract: fields.abstract ?? null,
    tags: fields.tags ?? [],
    status: fields.status ?? "unread",
  };
  if (fields.id) payload.id = fields.id;
  if (fields.sub_project_id != null) payload.sub_project_id = fields.sub_project_id;
  if (fields.zotero_key) payload.zotero_key = fields.zotero_key;
  return payload;
}

// ── Add Item Modal ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", height: 36, border: "1px solid var(--color-border)", borderRadius: 7,
  padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)",
  color: "var(--color-body)", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: 5, display: "block",
};

function AddItemModal({
  onSave, onClose, projectId, currentUserId, subProjectId, subProjects,
}: {
  onSave: (item: LiteratureItem) => void;
  onClose: () => void;
  projectId: string;
  currentUserId: string;
  subProjectId: string | null;
  subProjects?: SubProject[];
}) {
  const [type, setType]       = useState<LiteratureType>("article");
  const [title, setTitle]     = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear]       = useState(String(new Date().getFullYear()));
  const [journal, setJournal] = useState("");
  const [doi, setDoi]         = useState("");
  const [tags, setTags]       = useState("");
  const [scope, setScope]     = useState<LibraryScope>("lab");
  const [modalSubProjectId, setModalSubProjectId] = useState<string | null>(subProjectId);
  const [personalSubProjectId, setPersonalSubProjectId] = useState<string | null>(null);
  const [status, setStatus]   = useState<ReadStatus>("unread");
  const [error, setError]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    const now = new Date().toISOString();

    const { data, error: insertError } = await supabase
      .from("literature_items")
      .insert(buildLitInsert(projectId, currentUserId, {
        library: scope,
        type,
        title: title.trim(),
        authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
        year: parseInt(year) || new Date().getFullYear(),
        journal: journal.trim() || null,
        doi: doi.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        status,
        sub_project_id: scope === "project" ? (modalSubProjectId ?? subProjectId) : scope === "personal" ? personalSubProjectId : null,
      }))
      .select()
      .single();

    if (insertError) {
      console.error("[Literature] insert error:", insertError.code, insertError.message, insertError.details);
      setError(`Failed to save: ${insertError.message}`);
      setSaving(false);
      return;
    }

    const newItem: LiteratureItem & { subProjectId?: string } = {
      id: data.id as string,
      projectId: data.project_id as string,
      scope: ((data.library ?? data.scope ?? scope) as LiteratureItem["scope"]),
      subProjectId: scope === "project" ? (modalSubProjectId ?? subProjectId ?? undefined) : scope === "personal" ? (personalSubProjectId ?? undefined) : undefined,
      type: (data.type as LiteratureItem["type"]) ?? type,
      title: data.title as string,
      authors: toAuthorsArray(data.authors as string | string[]),
      year: (data.year as number) ?? 0,
      journal: (data.journal as string | null) ?? undefined,
      doi: (data.doi as string | null) ?? undefined,
      abstract: (data.abstract as string | null) ?? undefined,
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      removedTags: [],
      status: data.status as LiteratureItem["status"],
      rating: 0,
      notes: "",
      files: [],
      addedById: (data.user_id as string) ?? currentUserId,
      addedAt: (data.created_at as string) ?? new Date().toISOString(),
      collections: [],
      relatedIds: [],
    };
    // Log activity
    supabase.from("activity_feed").insert({
      project_id: projectId,
      user_id: currentUserId,
      action_type: "added",
      item_name: newItem.title,
      item_type: "paper",
      sub_project_id: newItem.subProjectId ?? null,
    }).then(({ error }) => { if (error) console.error("[Literature] activity insert error:", error); });

    // Optional PDF upload
    let finalItem: LiteratureItem = { ...newItem };
    if (pdfFile && isSupabaseConfigured) {
      const fileId = crypto.randomUUID();
      const storagePath = `${projectId}/${newItem.id}/${fileId}-${pdfFile.name}`;
      const { error: upErr } = await supabase.storage.from("literature-files").upload(storagePath, pdfFile);
      if (!upErr) {
        const url = supabase.storage.from("literature-files").getPublicUrl(storagePath).data.publicUrl;
        const newFile: LiteratureFile = {
          id: fileId, name: pdfFile.name, size: pdfFile.size,
          uploaderId: currentUserId, uploadedAt: new Date().toISOString(), ocrStatus: null, url, storagePath,
        };
        await supabase.from("literature_items").update({ files: [newFile] }).eq("id", newItem.id);
        finalItem = { ...newItem, files: [newFile] };
      } else {
        console.warn("[AddItem] PDF upload failed:", upErr.message);
      }
    }

    onSave(finalItem);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: "rgba(27,46,75,0.35)" }} onClick={onClose}>
      <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 520, width: "100%", borderRadius: 10, padding: 28, boxShadow: "0 8px 40px rgba(27,46,75,0.18)", maxHeight: "90dvh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>Add item</h2>
          <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 36, height: 36 }} aria-label="Close"><X size={16} color="var(--color-secondary)" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as LiteratureType)} style={{ ...inputStyle, cursor: "pointer" }}>
                {(["article", "book", "preprint", "report", "thesis"] as LiteratureType[]).map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as ReadStatus)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="unread">Unread</option>
                <option value="reading">Reading</option>
                <option value="read">Read</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Title *</label>
            <input autoFocus value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="Title" style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 3 }}>{error}</p>}
          </div>

          <div>
            <label style={labelStyle}>Authors (comma-separated)</label>
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Last, F., Last, F." style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Year</label>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} min={1900} max={2030} style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            </div>
            <div>
              <label style={labelStyle}>Journal / Publisher</label>
              <input value={journal} onChange={(e) => setJournal(e.target.value)} placeholder="Journal name" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>DOI</label>
            <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.xxxx/xxxxx" style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
          </div>

          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag1, tag2" style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
          </div>

          <div>
            <label style={labelStyle}>Library</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(["lab", "personal"] as const).map((s) => (
                <button key={s} onClick={() => { setScope(s); setModalSubProjectId(null); setPersonalSubProjectId(null); }} style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: `1px solid ${scope === s ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: scope === s ? "var(--color-navy)" : "transparent", color: scope === s ? "#fff" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
                  {s === "lab" ? "Lab Library" : "My Library"}
                </button>
              ))}
              {(subProjects ?? []).map((sp) => {
                const active = scope === "project" && modalSubProjectId === sp.id;
                return (
                  <button key={sp.id} onClick={() => { setScope("project"); setModalSubProjectId(sp.id); setPersonalSubProjectId(null); }} style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: `1px solid ${active ? (sp.color ?? "#34A853") : "var(--color-border)"}`, backgroundColor: active ? (sp.color ?? "#34A853") : "transparent", color: active ? "#fff" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
                    {sp.name}
                  </button>
                );
              })}
            </div>
            {(subProjects ?? []).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, paddingLeft: 2 }}>
                <span style={{ fontSize: 11, color: "var(--color-secondary)", alignSelf: "center", marginRight: 2 }}>Tag to:</span>
                <button
                  onClick={() => setPersonalSubProjectId(null)}
                  style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === null ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: personalSubProjectId === null ? "rgba(27,46,75,0.08)" : "transparent", color: personalSubProjectId === null ? "var(--color-navy)" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
                >General</button>
                {(subProjects ?? []).map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => setPersonalSubProjectId(sp.id)}
                    style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "var(--color-border)"}`, backgroundColor: personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "transparent", color: personalSubProjectId === sp.id ? "#fff" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}
                  >{sp.name}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Optional PDF attachment */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
          <label style={labelStyle}>PDF (optional)</label>
          <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
            >
              <Upload size={12} />{pdfFile ? pdfFile.name : "Attach PDF"}
            </button>
            {pdfFile && (
              <button onClick={() => { setPdfFile(null); if (pdfInputRef.current) pdfInputRef.current.value = ""; }}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 2 }} aria-label="Remove PDF">
                <X size={13} color="var(--color-secondary)" />
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "8px 16px", backgroundColor: "transparent", cursor: "pointer", minHeight: 44, fontFamily: "var(--font-roboto)" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 7, padding: "8px 20px", cursor: saving ? "default" : "pointer", minHeight: 44, fontFamily: "var(--font-roboto)", opacity: saving ? 0.7 : 1 }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
          >{saving ? (pdfFile ? "Uploading…" : "Saving…") : "Add item"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Annotation color palette ──────────────────────────────────────────────────

export const ANNOT_COLORS: { hex: string; label: string }[] = [
  { hex: "#3B82F6", label: "Key finding" },
  { hex: "#F59E0B", label: "Question" },
  { hex: "#EF4444", label: "Important" },
  { hex: "#10B981", label: "Methodology" },
  { hex: "#8B5CF6", label: "Hypothesis" },
  { hex: "#64748B", label: "Note" },
];

// ── Dupe detection + merge helpers ───────────────────────────────────────────

function litLastName(author: string): string {
  // Handles "Last, First" and "First Last" formats
  const c = author.indexOf(",");
  if (c !== -1) return author.slice(0, c).trim().toLowerCase();
  const parts = author.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

// Extract the last-name portion from a citation author string like "Smith et al." or "Smith & Jones".
function citationLastName(authorPart: string): string {
  return authorPart
    .replace(/\s+et\s+al\.?.*$/i, "")
    .replace(/\s*[&,].*$/, "")
    .replace(/\s*\band\b.*$/i, "")
    .trim()
    .toLowerCase();
}

// Strip URL prefix variants (https://doi.org/, http://dx.doi.org/) then trim+lowercase.
// Zotero, CrossRef, and manual entry all produce slightly different DOI forms.
function normalizeDoi(raw: string): string {
  return raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim().toLowerCase();
}

// Collapse whitespace, normalize typographic quotes and dashes, lowercase.
// Protects against Zotero curly-quote titles not matching CrossRef straight-quote titles.
function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–-]/g, "-")
    .toLowerCase();
}

function litIsDupe(
  existing: LiteratureItem,
  doi: string | undefined,
  title: string,
  firstAuthor: string,
  year: number,
  zoteroKey?: string
): boolean {
  // Zotero item key - stable per library item, works even when DOI is absent
  if (zoteroKey && existing.zoteroKey && existing.zoteroKey === zoteroKey) return true;
  // DOI match (normalized both sides to catch URL-prefix and case variants)
  if (doi && existing.doi) {
    if (normalizeDoi(existing.doi) === normalizeDoi(doi)) return true;
  }
  // Title + first-author-last-name match.
  // Year is used as a tie-breaker only when BOTH sides have a valid year - items
  // with year=0 (Zotero sometimes omits date-parts) would otherwise never match
  // and accumulate duplicate rows on every re-sync.
  const titleMatch = normalizeTitle(existing.title) === normalizeTitle(title);
  const authorMatch =
    firstAuthor !== "" &&
    existing.authors.length > 0 &&
    litLastName(existing.authors[0]) === litLastName(firstAuthor);
  if (titleMatch && authorMatch) {
    if (year > 0 && existing.year > 0) return existing.year === year;
    return true; // one or both sides missing year - title+author match is sufficient
  }
  return false;
}

function computeMergeUpdates(existing: LiteratureItem, incoming: LiteratureItem): Partial<LiteratureItem> {
  const u: Partial<LiteratureItem> = {};
  if (!existing.doi && incoming.doi) u.doi = incoming.doi;
  if (!existing.url && incoming.url) u.url = incoming.url;
  if (!existing.volume && incoming.volume) u.volume = incoming.volume;
  if (!existing.pages && incoming.pages) u.pages = incoming.pages;
  if (!existing.journal && incoming.journal) u.journal = incoming.journal;
  if ((!existing.year || existing.year === 0) && incoming.year) u.year = incoming.year;
  // Prefer the more complete abstract (longer wins, not just fill-empty)
  const ea = existing.abstract ?? "";
  const ia = incoming.abstract ?? "";
  if (ia && ia.length > ea.length) u.abstract = ia;
  // Union incoming tags into existing ones - never overwrites manually-added Canopy tags,
  // but surfaces new Zotero tags on re-sync. Respects removedTags to avoid re-adding
  // tags the user explicitly deleted.
  const incomingTags = incoming.tags ?? [];
  if (incomingTags.length > 0) {
    const removed = new Set(existing.removedTags ?? []);
    const existingSet = new Set(existing.tags ?? []);
    const newTags = incomingTags.filter((t) => !existingSet.has(t) && !removed.has(t));
    if (newTags.length > 0) u.tags = [...(existing.tags ?? []), ...newTags];
  }
  return u;
}

// ── Zotero RDF parser ─────────────────────────────────────────────────────────

type RDFParsedNote = { itemRef: string; html: string; color?: string };

function parseZoteroRDF(content: string, existingItems: LiteratureItem[], projectId: string, currentUserId: string, scope: LibraryScope): {
  items: LiteratureItem[];
  notes: RDFParsedNote[];
  merges: { existing: LiteratureItem; incoming: LiteratureItem }[];
  tagUpdates: { id: string; mergedTags: string[] }[];
  pdfLinks: { itemId: string; filename: string }[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  const ns = (prefix: string) => ({
    rdf:     "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    z:       "http://www.zotero.org/namespaces/export#",
    dc:      "http://purl.org/dc/elements/1.1/",
    dcterms: "http://purl.org/dc/terms/",
    bib:     "http://purl.org/net/biblio#",
    foaf:    "http://xmlns.com/foaf/0.1/",
    prism:   "http://prismstandard.org/namespaces/basic/2.0/",
    link:    "http://purl.org/rss/1.0/modules/link/",
  })[prefix];

  const el = (parent: Element | Document, localName: string, nsPrefix: string) =>
    parent.getElementsByTagNameNS(ns(nsPrefix)!, localName)[0];
  const txt = (parent: Element | Document, localName: string, nsPrefix: string) =>
    el(parent, localName, nsPrefix)?.textContent?.trim() ?? "";

  const RDF_TYPE_MAP: Record<string, LiteratureType> = {
    Article: "article", BookSection: "book", Book: "book",
    Thesis: "thesis", Report: "report", Memo: "article",
  };

  const itemEls = Array.from(doc.querySelectorAll(
    "Article, BookSection, Book, Thesis, Report, ConferencePaper, Document, Presentation"
  ));

  // Build a map: rdf:about value (e.g. "#item_3") → PDF filename
  // from z:Attachment elements that have link:type = "application/pdf"
  const attachmentFilenameMap = new Map<string, string>();
  for (const attEl of Array.from(doc.getElementsByTagNameNS(ns("z")!, "Attachment"))) {
    const about = attEl.getAttributeNS(ns("rdf")!, "about");
    const type = txt(attEl, "type", "link");
    const title = txt(attEl, "title", "dc");
    if (about && type === "application/pdf" && title) {
      attachmentFilenameMap.set(about, title);
    }
  }

  const now = new Date().toISOString();
  const items: LiteratureItem[] = [];
  const merges: { existing: LiteratureItem; incoming: LiteratureItem }[] = [];
  const tagUpdates: { id: string; mergedTags: string[] }[] = [];
  const pdfLinks: { itemId: string; filename: string }[] = [];

  for (const itemEl of itemEls) {
    const title = txt(itemEl, "title", "dc") || txt(itemEl, "title", "dcterms");
    if (!title) continue;

    const doiIdentifiers = Array.from(itemEl.getElementsByTagNameNS(ns("dc")!, "identifier"))
      .map((e) => e.textContent?.trim() ?? "");
    const doiRaw = doiIdentifiers.find((v) => /^DOI\s+/i.test(v));
    const doi = doiRaw ? doiRaw.replace(/^DOI\s+/i, "").trim() : undefined;

    // Extract all fields first (needed for both new items and merge candidates)
    const tags = Array.from(itemEl.getElementsByTagNameNS(ns("dc")!, "subject"))
      .map((e) => e.textContent?.trim()).filter((t): t is string => !!t);

    const authorsEl = el(itemEl, "authors", "bib");
    const authors: string[] = [];
    if (authorsEl) {
      for (const person of Array.from(authorsEl.getElementsByTagNameNS(ns("foaf")!, "Person"))) {
        const surname = person.getElementsByTagNameNS(ns("foaf")!, "surname")[0]?.textContent?.trim() ?? "";
        const given   = person.getElementsByTagNameNS(ns("foaf")!, "givenName")[0]?.textContent?.trim() ?? "";
        const full = [given, surname].filter(Boolean).join(" ");
        if (full) authors.push(full);
      }
    }

    const dateStr = txt(itemEl, "date", "dc") || txt(itemEl, "dateSubmitted", "dcterms");
    const year = parseInt(dateStr) || 0;

    const isPartOf = el(itemEl, "isPartOf", "dcterms");
    const journal  = isPartOf ? txt(isPartOf, "title", "dc") : undefined;
    const volume   = isPartOf ? txt(isPartOf, "volume", "prism") : undefined;

    const abstract = txt(itemEl, "abstract", "dcterms") || txt(itemEl, "description", "dc");
    const url      = txt(itemEl, "link", "link") || txt(itemEl, "identifier", "link") || undefined;

    const tagName = itemEl.localName;
    const incomingItem: LiteratureItem = {
      id: crypto.randomUUID(), projectId, scope,
      type: RDF_TYPE_MAP[tagName] ?? "article",
      title, authors, year, journal, doi, abstract, url, volume,
      tags, removedTags: [], status: "unread", rating: 0, notes: "",
      files: [], collections: [], relatedIds: [],
      addedById: currentUserId, addedAt: now, importSource: "zotero_json",
    };

    const dupeIdx = existingItems.findIndex(
      (ex) => litIsDupe(ex, doi, title, authors[0] ?? "", year)
    );
    if (dupeIdx !== -1) {
      const existing = existingItems[dupeIdx];
      const merged = Array.from(new Set([...existing.tags, ...tags]))
        .filter((t) => !(existing.removedTags ?? []).includes(t));
      if (merged.length !== existing.tags.length || merged.some((t) => !existing.tags.includes(t))) {
        tagUpdates.push({ id: existing.id, mergedTags: merged });
      }
      merges.push({ existing, incoming: incomingItem });
      continue;
    }

    // Check for PDF attachment links via link:link rdf:resource → z:Attachment
    for (const linkEl of Array.from(itemEl.getElementsByTagNameNS(ns("link")!, "link"))) {
      const resource = linkEl.getAttributeNS(ns("rdf")!, "resource");
      if (resource && attachmentFilenameMap.has(resource)) {
        pdfLinks.push({ itemId: incomingItem.id, filename: attachmentFilenameMap.get(resource)! });
        break; // first PDF attachment per item only
      }
    }

    items.push(incomingItem);
  }

  // Extract z:Note elements (Zotero child notes)
  const noteEls = Array.from(doc.getElementsByTagNameNS(ns("z")!, "Note"));
  const notes: RDFParsedNote[] = noteEls.map((noteEl) => {
    const html    = txt(noteEl, "value", "rdf");
    const color   = noteEl.getElementsByTagNameNS(ns("z")!, "color")[0]?.textContent?.trim();
    // Relation: dc:relation @rdf:resource → "#item_N"
    const relation = noteEl.getElementsByTagNameNS(ns("dc")!, "relation")[0]
      ?.getAttributeNS(ns("rdf")!, "resource") ?? "";
    return { itemRef: relation, html, color: color || undefined };
  }).filter((n) => n.html);

  return { items, notes, merges, tagUpdates, pdfLinks };
}

// ── Zotero JSON Import Modal ──────────────────────────────────────────────────

type CSLJsonItem = {
  type?: string; title?: string | string[];
  author?: Array<{ family?: string; given?: string; literal?: string }>;
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string; publisher?: string;
  DOI?: string; abstract?: string; URL?: string;
  volume?: string; page?: string;
};
const CSL_TYPE_MAP: Record<string, LiteratureType> = {
  "article-journal": "article", "article-magazine": "article",
  "article-newspaper": "article", article: "article",
  "paper-conference": "article", "speech": "article",
  book: "book", chapter: "book", incollection: "book",
  "book-chapter": "book",
  report: "report", thesis: "thesis", phdthesis: "thesis",
  manuscript: "preprint", preprint: "preprint",
};
function parseCSLAuthors(a: CSLJsonItem["author"]): string[] {
  return (a ?? []).map((x) => x.literal ?? `${x.given ?? ""} ${x.family ?? ""}`.trim()).filter(Boolean);
}

function ZoteroImportModal({ existingItems, onImport, onUpdateItem, onClose, projectId, currentUserId, subProjectId, subProjects }: {
  existingItems: LiteratureItem[]; onImport: (items: LiteratureItem[]) => void;
  onUpdateItem: (id: string, updates: Partial<LiteratureItem>) => void;
  onClose: () => void; projectId: string; currentUserId: string; subProjectId: string | null;
  subProjects?: SubProject[];
}) {
  const [tab, setTab]           = useState<"file" | "api">("file");
  const [parsed, setParsed]     = useState<LiteratureItem[]>([]);
  const [pendingNotes, setPendingNotes] = useState<RDFParsedNote[]>([]);
  const [pendingTagUpdates, setPendingTagUpdates] = useState<{ id: string; mergedTags: string[] }[]>([]);
  const [pendingMerges, setPendingMerges] = useState<{ existing: LiteratureItem; incoming: LiteratureItem }[]>([]);
  const [mergeDupes, setMergeDupes] = useState(true);
  const [forceNewIds, setForceNewIds] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  const [error, setError]       = useState("");
  const [importing, setImporting] = useState(false);
  const [scope, setScope]       = useState<LibraryScope>("lab");
  const [personalSubProjectId, setPersonalSubProjectId] = useState<string | null>(null);

  // Zotero API tab state
  const [apiKey, setApiKey]     = useState("");
  const [zoteroUserId, setZoteroUserId] = useState("");
  const [syncing, setSyncing]   = useState(false);
  const [apiError, setApiError] = useState("");
  const [groups, setGroups]     = useState<{ id: string; name: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [collections, setCollections] = useState<{ key: string; name: string }[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState("");
  const [selectedCollectionKey, setSelectedCollectionKey] = useState("");

  // Dropzone drag state (file tab)
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const dropzoneInputRef = useRef<HTMLInputElement>(null);

  // PDF attachment state - API sync
  const [pdfAttachments, setPdfAttachments] = useState<Record<string, { attachmentKey: string; filename: string }>>({});
  const [pdfKeyMap, setPdfKeyMap]           = useState<Record<string, string>>({}); // uuid → zotero key
  // Structured annotations from Zotero API - keyed by client-side item uuid
  const [annotationsForImport, setAnnotationsForImport] = useState<Record<string, import("@/app/api/zotero/sync/route").ZoteroAnnotation[]>>({});
  // Items that have only a linked URL in Zotero (no stored PDF) - keyed by Zotero item key
  const [linkedUrlZoteroKeys, setLinkedUrlZoteroKeys]   = useState<Record<string, true>>({});
  // PDF attachment state - RDF file import
  const [parsedPDFLinks, setParsedPDFLinks] = useState<{ itemId: string; filename: string }[]>([]);
  const [selectedPDFFiles, setSelectedPDFFiles] = useState<File[]>([]);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Upload progress feedback
  const [uploadStatus, setUploadStatus]     = useState("");
  const [importErrors, setImportErrors]     = useState<string[]>([]);
  const [pdfErrors, setPdfErrors]           = useState<string[]>([]);
  const [syncWarnings, setSyncWarnings]     = useState<string[]>([]); // CSL-drop warnings shown pre-import

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The dropzone label showed a stale filename after the picker was reopened
  // and cancelled: `fileName` is React state set once in processFile(), so it
  // never noticed the underlying <input> going back to zero files. The
  // "cancel" event (fired only when the dialog is dismissed without a
  // selection, never on a real pick) is the reliable signal for that, so
  // clear the file-tab state directly from input.files right when it fires,
  // rather than trusting the stale state to have kept up on its own.
  useEffect(() => {
    const input = dropzoneInputRef.current;
    if (!input) return;
    function onCancel() {
      if (dropzoneInputRef.current?.files?.length) return; // picked, not cancelled
      setFileName(""); setParsed([]); setPendingNotes([]); setPendingTagUpdates([]);
      setPendingMerges([]); setError(""); setForceNewIds(new Set()); setImportErrors([]); setPdfErrors([]); setSyncWarnings([]);
    }
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, []);

  function processFile(file: File) {
    setFileName(file.name); setParsed([]); setPendingNotes([]); setPendingTagUpdates([]); setPendingMerges([]); setMergeDupes(true); setError("");
    setParsedPDFLinks([]); setSelectedPDFFiles([]); setPdfAttachments({}); setPdfKeyMap({});
    setForceNewIds(new Set()); setImportErrors([]); setPdfErrors([]); setSyncWarnings([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      try {
        if (file.name.toLowerCase().endsWith(".rdf")) {
          // Zotero RDF export (multi-item, with notes)
          const { items, notes, merges, tagUpdates, pdfLinks } = parseZoteroRDF(content, existingItems, projectId, currentUserId, scope);
          setParsed(items); setPendingNotes(notes); setPendingMerges(merges); setPendingTagUpdates(tagUpdates);
          setParsedPDFLinks(pdfLinks);
          if (items.length === 0 && merges.length === 0) {
            setError("No items found in this file. If you meant to export a single collection, right-click it in Zotero and choose Export Collection… - File → Export Library always exports everything and may have picked up an empty or wrong library.");
          }
        } else {
          // CSL JSON export
          const raw = JSON.parse(content) as CSLJsonItem[];
          const now = new Date().toISOString();
          const items: LiteratureItem[] = [];
          const cslMerges: { existing: LiteratureItem; incoming: LiteratureItem }[] = [];
          for (const z of raw) {
            const title = (Array.isArray(z.title) ? z.title[0] : z.title) ?? "";
            const doi = z.DOI?.toLowerCase();
            const authors = parseCSLAuthors(z.author);
            const year = z.issued?.["date-parts"]?.[0]?.[0] ?? 0;
            const incomingItem: LiteratureItem = {
              id: crypto.randomUUID(), projectId, scope,
              type: CSL_TYPE_MAP[z.type ?? ""] ?? "article",
              title, authors, year,
              journal: z["container-title"] ?? z.publisher,
              doi: z.DOI, abstract: z.abstract?.replace(/<[^>]+>/g, ""),
              volume: z.volume, pages: z.page, url: z.URL,
              tags: [], removedTags: [], status: "unread", rating: 0, notes: "",
              files: [], collections: [], relatedIds: [],
              addedById: currentUserId, addedAt: now, importSource: "zotero_json",
            };
            const dupeIdx = existingItems.findIndex(
              (ex) => litIsDupe(ex, doi, title, authors[0] ?? "", year)
            );
            if (dupeIdx !== -1) { cslMerges.push({ existing: existingItems[dupeIdx], incoming: incomingItem }); continue; }
            items.push(incomingItem);
          }
          setParsed(items); setPendingMerges(cslMerges);
          if (items.length === 0 && cslMerges.length === 0) {
            setError(raw.length === 0
              ? "No items found in this file. If you meant to export a single collection, right-click it in Zotero and choose Export Collection… - File → Export Library always exports everything and may have picked up an empty or wrong library."
              : `All ${raw.length} item${raw.length > 1 ? "s" : ""} already exist in your library and were detected as duplicates.`
            );
          }
        }
      } catch {
        setError(file.name.toLowerCase().endsWith(".rdf")
          ? "Could not parse RDF file. Export from Zotero: File → Export Library → Zotero RDF."
          : "Could not parse file. Export from Zotero as CSL JSON (File → Export Library → CSL JSON).");
      }
    };
    reader.readAsText(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) processFile(file);
    e.target.value = ""; // reset so re-selecting the same file triggers onChange
  }

  function handleDropzoneDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }

  function handleDropzoneDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }

  function handleDropzoneDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function handleImport() {
    if (!parsed.length && !forceNewIds.size) return;
    setImporting(true);
    setImportErrors([]); setPdfErrors([]);
    let hadImportErrors = false;

    // Items forced-new from the duplicates list get inserted alongside regular items
    const forceNewItems = pendingMerges
      .filter(({ existing }) => forceNewIds.has(existing.id))
      .map(({ incoming }) => ({ ...incoming, id: crypto.randomUUID() }));
    const allNew = [...parsed, ...forceNewItems];

    const subId = scope === "project" ? subProjectId : scope === "personal" ? personalSubProjectId : null;
    const rows = allNew.map((item) =>
      buildLitInsert(projectId, currentUserId, {
        id: item.id, library: scope, type: item.type, title: item.title, authors: item.authors,
        year: item.year || null, journal: item.journal ?? null,
        volume: item.volume ?? null, pages: item.pages ?? null,
        doi: item.doi ?? null, abstract: item.abstract ?? null,
        tags: item.tags ?? [], status: "unread",
        sub_project_id: subId,
        ...(item.zoteroKey ? { zotero_key: item.zoteroKey } : {}),
      })
    );

    // Attempt batch insert; on failure fall back to per-item inserts so one bad row
    // doesn't silently discard all the others.
    let successfulItems = allNew;
    const { error: batchErr } = await supabase.from("literature_items").insert(rows);
    if (batchErr) {
      console.warn("[Zotero import] batch insert failed, falling back to per-item:", batchErr.message);
      const results = await Promise.allSettled(
        rows.map((row, i) =>
          supabase.from("literature_items").insert([row]).then((res) => ({ res, item: allNew[i] }))
        )
      );
      const failed: string[] = [];
      const succeeded: LiteratureItem[] = [];
      for (const r of results) {
        if (r.status === "fulfilled" && !r.value.res.error) {
          succeeded.push(r.value.item);
        } else {
          const item = r.status === "fulfilled" ? r.value.item : allNew[results.indexOf(r)];
          failed.push(item?.title ?? "Unknown item");
          if (r.status === "fulfilled" && r.value.res.error) {
            console.error("[Zotero import] item insert error:", r.value.res.error.message, "–", item?.title);
          }
        }
      }
      if (succeeded.length === 0) {
        setError(`Import failed: ${batchErr.message}`);
        setImporting(false);
        return;
      }
      successfulItems = succeeded;
      if (failed.length > 0) { setImportErrors(failed); hadImportErrors = true; }
    }
    // Import RDF notes as annotations on the corresponding items
    const successIds = new Set(successfulItems.map((i) => i.id));
    if (pendingNotes.length > 0) {
      const annotRows = pendingNotes.flatMap((note) => {
        // Match by itemRef fragment (#item_N) or positional index if available
        const refFragment = note.itemRef.replace(/^.*#/, "");
        const target = parsed.find((_, i) => `item_${i + 1}` === refFragment || `item${i + 1}` === refFragment)
          ?? parsed[0]; // fallback to first item if ref can't be matched
        if (!target || !successIds.has(target.id)) return [];
        // Pick nearest Canopy color; if Zotero color hex doesn't match palette, keep raw hex
        const color = note.color ?? undefined;
        const plainText = note.html.replace(/<[^>]+>/g, "").trim();
        if (!plainText) return [];
        return [{
          id: crypto.randomUUID(), item_id: target.id, author_id: currentUserId,
          text: "", comment: plainText, parent_id: null,
          ...(color ? { color } : {}),
        }];
      });
      if (annotRows.length > 0)
        await supabase.from("lit_annotations").insert(annotRows);
    }
    // Persist url + notes for API-imported items (not included in buildLitInsert)
    if (isSupabaseConfigured) {
      const postInsertUpdates = successfulItems
        .map((item) => ({ id: item.id, url: item.url, notes: item.notes }))
        .filter((x) => x.url || x.notes);
      if (postInsertUpdates.length > 0) {
        setUploadStatus("Saving metadata…");
        await Promise.all(
          postInsertUpdates.map(({ id, url, notes }) => {
            const payload: Record<string, unknown> = {};
            if (url) payload.url = url;
            if (notes) payload.notes = notes;
            return supabase.from("literature_items").update(payload).eq("id", id);
          })
        );
      }
    }

    onImport(successfulItems);
    // Apply merged tags to any existing dupe items from RDF import
    if (pendingTagUpdates.length > 0) {
      pendingTagUpdates.forEach((u) => onUpdateItem(u.id, { tags: u.mergedTags }));
    }
    // Merge empty fields from Zotero into existing items if user chose to merge
    if (mergeDupes && pendingMerges.length > 0) {
      pendingMerges.forEach(({ existing, incoming }) => {
        const updates = computeMergeUpdates(existing, incoming);
        if (Object.keys(updates).length > 0) onUpdateItem(existing.id, updates);
      });
    }

    // Upload PDFs from API sync (server-side Zotero download → Supabase Storage)
    const hasPdfAtts = Object.keys(pdfAttachments).length > 0;
    if (hasPdfAtts && apiKey.trim()) {
      const collectedPdfErrors: string[] = [];
      for (const item of successfulItems) {
        const zKey = pdfKeyMap[item.id];
        if (!zKey) continue;
        const att = pdfAttachments[zKey];
        if (!att) continue;
        setUploadStatus(`Fetching PDF: ${att.filename}…`);
        try {
          const { data: { session: pdfSession } } = await supabase.auth.getSession();
          const pdfRes = await fetch("/api/zotero/fetch-pdf", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(pdfSession?.access_token ? { Authorization: `Bearer ${pdfSession.access_token}` } : {}),
            },
            body: JSON.stringify({
              apiKey: apiKey.trim(), zoteroUserId: zoteroUserId.trim(),
              ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
              attachmentKey: att.attachmentKey, projectId, itemId: item.id, filename: att.filename,
            }),
          });
          if (pdfRes.ok) {
            const { url, storagePath, name, size, fileId } = await pdfRes.json() as {
              url: string; storagePath: string; name: string; size: number; fileId: string;
            };
            const newFile: LiteratureFile = {
              id: fileId, name, size, uploaderId: currentUserId,
              uploadedAt: new Date().toISOString(), ocrStatus: null, url, storagePath,
            };
            await supabase.from("literature_items").update({ files: [newFile] }).eq("id", item.id);
            onUpdateItem(item.id, { files: [newFile] });
          } else {
            const body = await pdfRes.json() as { error?: string };
            console.warn("[ZoteroImport] PDF fetch skipped:", att.filename, body.error);
            collectedPdfErrors.push(`${att.filename}: ${body.error ?? "unknown error"}`);
          }
        } catch (ex) {
          console.warn("[ZoteroImport] PDF fetch error:", att.filename, ex);
          collectedPdfErrors.push(`${att.filename}: network error`);
        }
      }
      if (collectedPdfErrors.length > 0) setPdfErrors(collectedPdfErrors);
    }

    // Upload PDFs from local file picker (RDF export with "Export Files" checked)
    if (parsedPDFLinks.length > 0 && selectedPDFFiles.length > 0) {
      for (const { itemId, filename } of parsedPDFLinks) {
        const file = selectedPDFFiles.find((f) => f.name === filename);
        const item = parsed.find((i) => i.id === itemId);
        if (!file || !item) continue;
        setUploadStatus(`Uploading PDF: ${file.name}…`);
        try {
          const fileId = crypto.randomUUID();
          const storagePath = `${projectId}/${item.id}/${fileId}-${file.name}`;
          const { error: upErr } = await supabase.storage.from("literature-files").upload(storagePath, file);
          if (!upErr) {
            const url = supabase.storage.from("literature-files").getPublicUrl(storagePath).data.publicUrl;
            const newFile: LiteratureFile = {
              id: fileId, name: file.name, size: file.size, uploaderId: currentUserId,
              uploadedAt: new Date().toISOString(), ocrStatus: null, url, storagePath,
            };
            await supabase.from("literature_items").update({ files: [newFile] }).eq("id", item.id);
            onUpdateItem(item.id, { files: [newFile] });
          } else {
            console.warn("[ZoteroImport] local PDF upload error:", file.name, upErr.message);
          }
        } catch (ex) {
          console.warn("[ZoteroImport] local PDF upload error:", file.name, ex);
        }
      }
    }

    // Upsert Zotero annotations for newly imported items
    // Uses zotero_key as the conflict target so re-syncing the same collection
    // updates existing annotations instead of creating duplicates.
    const upsertAnnotations = async (itemId: string, clientId: string) => {
      const annots = annotationsForImport[clientId];
      if (!annots?.length) return; // no annotations for this item - silently skip
      const rows = annots.map((a) => ({
        id: crypto.randomUUID(),
        item_id: itemId,
        author_id: currentUserId,
        text: a.text,
        comment: a.comment,
        color: a.color,
        page_number: a.pageNumber,
        bbox: a.bbox ?? undefined,
        zotero_key: a.zoteroKey,
      }));
      const { error } = await supabase.from("lit_annotations").upsert(rows, {
        onConflict: "item_id,zotero_key",
        ignoreDuplicates: false,
      });
      if (error) {
        // Layer 2: strip color (migration 019 not applied yet) and retry upsert
        console.warn("[ZoteroImport] annotation upsert failed:", error.message);
        const rowsNoColor = rows.map(({ color: _c, ...rest }) => rest);
        const { error: e2 } = await supabase.from("lit_annotations").upsert(rowsNoColor, {
          onConflict: "item_id,zotero_key", ignoreDuplicates: false,
        });
        if (e2) {
          // Layer 3: strip zotero_key too (migration 018 not applied) - plain insert, accepts duplicates on re-sync
          console.warn("[ZoteroImport] annotation upsert (no color) failed:", e2.message);
          const rowsMinimal = rowsNoColor.map(({ zotero_key: _zk, ...rest }) => rest);
          const { error: e3 } = await supabase.from("lit_annotations").insert(rowsMinimal);
          if (e3) console.warn("[ZoteroImport] annotation insert fallback also failed:", e3.message);
        }
      }
    };

    if (isSupabaseConfigured) {
      const annotItemCount = Object.keys(annotationsForImport).length;
      const annotTotal = Object.values(annotationsForImport).reduce((s, a) => s + a.length, 0);
      console.log(`[ZoteroImport] annotation map: ${annotItemCount} item(s), ${annotTotal} annotation(s) total`);
      if (annotTotal > 0) setUploadStatus("Saving annotations…");
      // New items
      await Promise.all(successfulItems.map((item) => {
        const count = annotationsForImport[item.id]?.length ?? 0;
        if (count > 0) console.log(`[ZoteroImport] saving ${count} annotation(s) for new item "${item.title}"`);
        return upsertAnnotations(item.id, item.id);
      }));
      // Merged items (existing DB id, incoming client id with the annotation data)
      if (mergeDupes) {
        await Promise.all(
          pendingMerges
            .filter(({ existing }) => !forceNewIds.has(existing.id))
            .map(({ existing, incoming }) => {
              const count = annotationsForImport[incoming.id]?.length ?? 0;
              if (count > 0) console.log(`[ZoteroImport] saving ${count} annotation(s) for merged item "${existing.title}"`);
              return upsertAnnotations(existing.id, incoming.id);
            })
        );
      }
    }

    setUploadStatus("");
    setImporting(false);
    // Keep modal open if there are errors to report so the user can read them
    if (!hadImportErrors) onClose();
  }

  // Accepts an explicit groupId so it can be called right from the group
  // <select>'s onChange with the just-picked value - reading `selectedGroupId`
  // there would still see the pre-change value, since the setState from the
  // same handler hasn't applied yet.
  async function handleFetchCollections(groupIdOverride?: string) {
    if (!apiKey.trim() || !zoteroUserId.trim()) {
      setCollectionsError("Enter your Zotero user ID and API key first."); return;
    }
    const groupId = groupIdOverride ?? selectedGroupId;
    setCollectionsLoading(true); setCollectionsError("");
    try {
      const res = await fetch("/api/zotero/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          zoteroUserId: zoteroUserId.trim(),
          ...(groupId ? { groupId } : {}),
        }),
      });
      const { collections: cols, groups: grps, error: err } = await res.json() as {
        collections?: { key: string; name: string }[];
        groups?: { id: string; name: string }[];
        error?: string;
      };
      if (err) { setCollectionsError(err); return; }
      setCollections(cols ?? []);
      if (grps) setGroups(grps);
      setSelectedCollectionKey(""); // default: entire library
    } catch (ex) {
      setCollectionsError(ex instanceof Error ? ex.message : "Could not fetch collections");
    } finally { setCollectionsLoading(false); }
  }

  async function handleAPISync() {
    if (!apiKey.trim() || !zoteroUserId.trim()) {
      setApiError("Enter your Zotero user ID and API key."); return;
    }
    if (importing) { setApiError("Wait for the current import to finish before syncing again."); return; }
    setSyncing(true); setApiError(""); setPdfAttachments({}); setPdfKeyMap({});
    try {
      const res = await fetch("/api/zotero/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          zoteroUserId: zoteroUserId.trim(),
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
          ...(selectedCollectionKey ? { collectionKey: selectedCollectionKey } : {}),
        }),
      });
      const {
        items: raw, pdfAttachments: apiPdfAtts, notesMap: rawNotesMap,
        tagsMap: rawTagsMap, droppedItems: rawDropped,
        annotationsMap: rawAnnotationsMap, linkedUrlItems: rawLinkedUrlItems,
        error: err,
      } = await res.json() as {
        items?: CSLJsonItem[];
        pdfAttachments?: Record<string, { attachmentKey: string; filename: string }>;
        notesMap?: Record<string, string[]>;
        tagsMap?: Record<string, string[]>;
        droppedItems?: { key: string; title: string }[];
        annotationsMap?: Record<string, import("@/app/api/zotero/sync/route").ZoteroAnnotation[]>;
        linkedUrlItems?: Record<string, true>;
        error?: string;
      };
      if (err || !raw) { setApiError(err ?? "Sync failed"); setSyncing(false); return; }
      setPdfAttachments(apiPdfAtts ?? {});
      setLinkedUrlZoteroKeys(rawLinkedUrlItems ?? {});

      // Surface items that Zotero's CSL serializer silently dropped.
      if (rawDropped?.length) {
        setSyncWarnings(
          rawDropped.map((d) => `"${d.title || d.key}" was in your Zotero library but dropped by Zotero's CSL export - import via File export (Zotero RDF) to capture it`)
        );
        console.warn("[ZoteroSync] CSL-dropped items:", rawDropped);
      } else {
        setSyncWarnings([]);
      }

      // Re-fetch existing items from the DB right before matching so we compare
      // against current DB state, not the potentially-stale in-memory snapshot.
      // This prevents duplicates when other team members imported items since
      // this tab was loaded, or when the modal is reused across multiple syncs.
      const { data: freshRows } = await supabase
        .from("literature_items")
        .select("id, title, doi, year, authors, abstract, url, volume, pages, journal, tags, removed_tags, zotero_key")
        .eq("project_id", projectId)
        .is("deleted_at", null);
      // Build a lightweight lookup list that satisfies litIsDupe + computeMergeUpdates
      type FreshItem = Pick<LiteratureItem, "id" | "title" | "doi" | "year" | "authors" | "abstract" | "url" | "volume" | "pages" | "journal" | "tags" | "removedTags" | "zoteroKey">;
      const freshExisting: FreshItem[] = (freshRows ?? []).map((r) => ({
        id: r.id as string,
        title: r.title as string ?? "",
        doi: (r.doi as string | null) ?? undefined,
        year: r.year as number ?? 0,
        authors: toAuthorsArray(r.authors as string | string[]),
        abstract: (r.abstract as string | null) ?? undefined,
        url: (r.url as string | null) ?? undefined,
        volume: (r.volume as string | null) ?? undefined,
        pages: (r.pages as string | null) ?? undefined,
        journal: (r.journal as string | null) ?? undefined,
        tags: r.tags as string[] ?? [],
        removedTags: r.removed_tags as string[] ?? [],
        zoteroKey: (r.zotero_key as string | null) ?? undefined,
      }));
      console.log(`[ZoteroSync] existingItems (prop snapshot): ${existingItems.length}, freshExisting (DB): ${freshExisting.length}, incoming Zotero items: ${raw.length}`);

      const now = new Date().toISOString();
      const items: LiteratureItem[] = [];
      const apiMerges: { existing: LiteratureItem; incoming: LiteratureItem }[] = [];
      const newKeyMap: Record<string, string> = {};
      const newAnnotationsMap: Record<string, import("@/app/api/zotero/sync/route").ZoteroAnnotation[]> = {};
      const parseErrors: string[] = [];
      let dupeCount = 0;
      for (const z of raw) {
        let title: string;
        let rawDoi: string | undefined;
        let doi: string | undefined;
        let authors: string[];
        let year: number;
        let zoteroKey: string | undefined;
        try {
          title = (Array.isArray(z.title) ? z.title[0] : z.title) ?? "";
          if (!title) { parseErrors.push(`Skipped item with no title (key: ${(z as {id?:string}).id ?? "unknown"})`); continue; }
          // Normalize DOI on ingest so stored values are consistent regardless of source format
          rawDoi = z.DOI?.trim();
          doi = rawDoi ? normalizeDoi(rawDoi) : undefined;
          authors = parseCSLAuthors(z.author);
          year = z.issued?.["date-parts"]?.[0]?.[0] ?? 0;
          zoteroKey = (z as {id?: string}).id?.split("/").pop();
        } catch (parseErr) {
          parseErrors.push(`Could not parse item: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
          continue;
        }
        const itemId = crypto.randomUUID();
        if (zoteroKey) newKeyMap[itemId] = zoteroKey;
        // Collect structured annotations for this item (populated into lit_annotations on import)
        if (zoteroKey && rawAnnotationsMap?.[zoteroKey]?.length) {
          newAnnotationsMap[itemId] = rawAnnotationsMap[zoteroKey];
        }
        const zNotes: string[] = (zoteroKey ? rawNotesMap?.[zoteroKey] : undefined) ?? [];
        const notesText = zNotes
          .map((h: string) => h.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
          .filter(Boolean)
          .join("\n\n---\n\n");
        const incomingItem: LiteratureItem = {
          id: itemId, projectId, scope,
          type: CSL_TYPE_MAP[z.type ?? ""] ?? "article",
          title, authors, year,
          journal: z["container-title"] ?? z.publisher,
          doi: rawDoi ? normalizeDoi(rawDoi) : undefined,
          abstract: z.abstract?.replace(/<[^>]+>/g, ""),
          volume: z.volume, pages: z.page, url: z.URL,
          tags: (zoteroKey ? rawTagsMap?.[zoteroKey] : undefined) ?? [], removedTags: [], status: "unread", rating: 0, notes: notesText,
          files: [], collections: [], relatedIds: [],
          addedById: currentUserId, addedAt: now, importSource: "zotero_api",
          ...(zoteroKey ? { zoteroKey } : {}),
        };
        // Check against fresh DB state (primary) - catches items added by other team
        // members or from a previous import in this session
        const freshDupeIdx = freshExisting.findIndex(
          (ex) => litIsDupe(ex as LiteratureItem, doi, title, authors[0] ?? "", year, zoteroKey)
        );
        if (freshDupeIdx !== -1) {
          dupeCount++;
          // For the merge preview, prefer the full LiteratureItem from existingItems if
          // available; fall back to the fresh data (which has enough for computeMergeUpdates)
          const existingFull = existingItems.find((ex) => ex.id === freshExisting[freshDupeIdx].id);
          const mergeBase = existingFull ?? (freshExisting[freshDupeIdx] as unknown as LiteratureItem);
          apiMerges.push({ existing: mergeBase, incoming: incomingItem });
          console.log(`[ZoteroSync] dupe (DB match): "${title}" doi=${doi ?? "none"} zoteroKey=${zoteroKey ?? "none"} year=${year}`);
          continue;
        }
        // Also check within the current batch - Zotero can return the same item
        // multiple times (e.g. in multiple collections), creating phantom duplicates.
        const inBatchDupe = items.findIndex(
          (ex) => litIsDupe(ex, doi, title, authors[0] ?? "", year, zoteroKey)
        );
        if (inBatchDupe !== -1) {
          console.warn("[ZoteroSync] intra-batch duplicate, skipping:", title, doi ?? "(no DOI)");
          continue;
        }
        items.push(incomingItem);
      }
      console.log(`[ZoteroSync] result: ${items.length} new, ${dupeCount} dupes, ${apiMerges.length} merge candidates, ${parseErrors.length} parse errors`);
      if (parseErrors.length > 0) {
        setSyncWarnings((prev) => [...prev, ...parseErrors]);
        console.warn("[ZoteroSync] parse errors:", parseErrors);
      }
      setFileName(`Zotero API: ${items.length + apiMerges.length} items`);
      setParsed(items); setPendingMerges(apiMerges); setMergeDupes(true);
      setAnnotationsForImport(newAnnotationsMap);
      setPdfKeyMap(newKeyMap);
      setTab("file");
    } catch (ex) {
      setApiError(ex instanceof Error ? ex.message : "Sync failed");
    } finally { setSyncing(false); }
  }

  const SCOPE_LABELS: Record<LibraryScope, string> = { lab: "Lab Library", personal: "My Library", project: "Project Library" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(27,46,75,0.35)" }}>
      <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 480, width: "100%", borderRadius: 10, padding: 28, boxShadow: "0 8px 40px rgba(27,46,75,0.18)", maxHeight: "90dvh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>Import from Zotero</h2>
          <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 36, height: 36 }}><X size={16} color="var(--color-secondary)" /></button>
        </div>

        {/* Tab: File vs API */}
        <div className="flex rounded-lg p-0.5 mb-4" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", width: "fit-content" }}>
          {([["file", "File export"], ["api", "API sync"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: "none", backgroundColor: tab === t ? "var(--color-navy)" : "transparent", color: tab === t ? "#fff" : "var(--color-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {t === "api" && <Wifi size={11} />}{label}
            </button>
          ))}
        </div>

        {tab === "file" && (
          <>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 14 }}>
              <strong>To export one collection:</strong> right-click it in the Zotero sidebar → <strong>Export Collection…</strong>, choose <strong>Zotero RDF</strong> (or CSL JSON), and check <strong>Export Files</strong> and <strong>Include Annotations</strong> for full fidelity.<br /><br />
              <strong>To export your whole library:</strong> <strong>File → Export Library</strong> with the same options. For a quick metadata-only export, CSL JSON is faster. API sync (tab above) auto-attaches PDFs stored in Zotero cloud.
            </p>
            <label
              style={{
                display: "block",
                border: `2px dashed ${isDragOver ? "var(--color-navy)" : "var(--color-border)"}`,
                borderRadius: 8,
                padding: "20px 16px",
                textAlign: "center",
                cursor: "pointer",
                marginBottom: 14,
                backgroundColor: isDragOver ? "rgba(27,46,75,0.04)" : "transparent",
                transition: "border-color 0.12s, background-color 0.12s",
              }}
              onDragEnter={handleDropzoneDragEnter}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={handleDropzoneDragLeave}
              onDrop={handleDropzoneDrop}
            >
              <Upload size={20} color={isDragOver ? "var(--color-navy)" : "var(--color-secondary)"} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: isDragOver ? "var(--color-navy)" : fileName ? "var(--color-body)" : "var(--color-secondary)" }}>
                {isDragOver ? "Drop your file here" : (fileName || "Click to select or drag a .json or .rdf file")}
              </p>
              <input ref={dropzoneInputRef} type="file" accept=".json,.rdf" className="hidden" onChange={handleFile} />
            </label>
            {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{error}</p>}
            {syncWarnings.length > 0 && (
              <div className="mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(160,98,42,0.06)", border: "1px solid rgba(160,98,42,0.25)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#A0622A", marginBottom: 4 }}>{syncWarnings.length} item{syncWarnings.length > 1 ? "s" : ""} missing from Zotero's CSL export:</p>
                <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                  {syncWarnings.map((w, i) => <li key={i} style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 2 }}>{w}</li>)}
                </ul>
              </div>
            )}
            {parsed.length > 0 && (
              <div className="mb-4 px-3 py-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{parsed.length} item{parsed.length > 1 ? "s" : ""} ready to import{pendingNotes.length > 0 ? ` + ${pendingNotes.length} note${pendingNotes.length > 1 ? "s" : ""} as annotations` : ""}</p>
                {pendingMerges.length > 0 && (
                  <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 7, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" id="merge-dupes" checked={mergeDupes} onChange={(e) => setMergeDupes(e.target.checked)} style={{ cursor: "pointer" }} />
                      <label htmlFor="merge-dupes" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", cursor: "pointer" }}>
                        Merge {pendingMerges.length} duplicate{pendingMerges.length > 1 ? "s" : ""} (update with most complete fields)
                      </label>
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                      {pendingMerges.map(({ existing, incoming }) => {
                        const updates = computeMergeUpdates(existing, incoming);
                        const fields = Object.keys(updates);
                        const isForceNew = forceNewIds.has(existing.id);
                        return (
                          <li key={existing.id} style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 3, display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--color-body)", fontWeight: 600 }}>{existing.title.length > 44 ? existing.title.slice(0, 44) + "…" : existing.title}</span>
                            {isForceNew ? (
                              <span style={{ color: "var(--color-navy)", fontWeight: 600 }}>→ will add as new</span>
                            ) : mergeDupes ? (
                              fields.length > 0 ? ` → update: ${fields.join(", ")}` : " (no new fields)"
                            ) : (
                              " (skip)"
                            )}
                            <button
                              onClick={() => setForceNewIds((prev) => {
                                const next = new Set(prev);
                                if (isForceNew) next.delete(existing.id); else next.add(existing.id);
                                return next;
                              })}
                              style={{ fontSize: 10, fontWeight: 600, color: isForceNew ? "var(--color-error)" : "var(--color-navy)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", textDecoration: "underline" }}
                            >
                              {isForceNew ? "undo" : "add as new"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {!mergeDupes && forceNewIds.size === 0 && (
                      <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0" }}>
                        Duplicates not marked "add as new" will be skipped.
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-3">
                  <label style={labelStyle}>Add to</label>
                  <div className="flex rounded-lg p-0.5 mt-1" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", width: "fit-content" }}>
                    {(["lab", "personal", "project"] as const).map((s) => (
                      <button key={s} onClick={() => { setScope(s); setPersonalSubProjectId(null); }} style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", backgroundColor: scope === s ? "var(--color-navy)" : "transparent", color: scope === s ? "#fff" : "var(--color-secondary)", cursor: "pointer" }}>
                        {SCOPE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                  {(subProjects ?? []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                      <span style={{ fontSize: 11, color: "var(--color-secondary)", alignSelf: "center", marginRight: 2 }}>Tag to:</span>
                      <button onClick={() => setPersonalSubProjectId(null)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === null ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: personalSubProjectId === null ? "rgba(27,46,75,0.08)" : "transparent", color: personalSubProjectId === null ? "var(--color-navy)" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>General</button>
                      {(subProjects ?? []).map((sp) => (
                        <button key={sp.id} onClick={() => setPersonalSubProjectId(sp.id)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "var(--color-border)"}`, backgroundColor: personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "transparent", color: personalSubProjectId === sp.id ? "#fff" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>{sp.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Second file picker: PDF files from Zotero "Export Files" folder (RDF only) */}
            {parsedPDFLinks.length > 0 && (
              <div className="mt-3 px-3 py-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", marginBottom: 4 }}>
                  {parsedPDFLinks.length} PDF attachment{parsedPDFLinks.length > 1 ? "s" : ""} found in this RDF
                </p>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 8 }}>
                  In Zotero, export with both <strong>Export Files</strong> and <strong>Include Annotations</strong> checked. Then select the PDFs from the exported <em>files/</em> folder below (optional - skip to import metadata only).
                </p>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setSelectedPDFFiles(files);
                  }}
                />
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", color: "var(--color-body)", cursor: "pointer" }}
                >
                  <Upload size={11} style={{ display: "inline", marginRight: 5 }} />
                  {selectedPDFFiles.length > 0
                    ? `${selectedPDFFiles.length} PDF${selectedPDFFiles.length > 1 ? "s" : ""} selected`
                    : "Select PDF files"}
                </button>
                {selectedPDFFiles.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 5 }}>
                    {parsedPDFLinks.filter(l => selectedPDFFiles.some(f => f.name === l.filename)).length} of {parsedPDFLinks.length} matched by filename
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {tab === "api" && (
          <div>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 14 }}>
              Go to <strong>zotero.org → Settings → Feeds/API</strong> to create a personal API key, then enter it below.
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <label style={labelStyle}>Zotero User ID</label>
                <input value={zoteroUserId} onChange={(e) => { setZoteroUserId(e.target.value); setCollections([]); }}
                  placeholder="e.g. 1234567" style={{ ...inputStyle, width: "100%" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
              </div>
              <div>
                <label style={labelStyle}>API Key</label>
                <input value={apiKey} onChange={(e) => { setApiKey(e.target.value); setCollections([]); }}
                  placeholder="e.g. AbCdEfGhIjKlMnOp" type="password" style={{ ...inputStyle, width: "100%" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
              </div>
            </div>

            {/* Collection picker + group library selector */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <label style={labelStyle}>Library &amp; Collection</label>
                <button
                  onClick={() => handleFetchCollections()}
                  disabled={collectionsLoading || !apiKey.trim() || !zoteroUserId.trim()}
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--color-navy)", backgroundColor: "transparent", border: "1px solid var(--color-navy)", borderRadius: 5, padding: "2px 8px", cursor: "pointer", opacity: (collectionsLoading || !apiKey.trim() || !zoteroUserId.trim()) ? 0.4 : 1 }}
                >
                  {collectionsLoading ? "Loading…" : "Load"}
                </button>
              </div>
              {collectionsError && <p style={{ fontSize: 11, color: "var(--color-error)", marginBottom: 6 }}>{collectionsError}</p>}
              {/* Group selector - shown when the user has group libraries */}
              {groups.length > 0 && (
                <div className="mb-2">
                  <select
                    value={selectedGroupId}
                    onChange={(e) => {
                      const newGroupId = e.target.value;
                      setSelectedGroupId(newGroupId);
                      setCollections([]); setSelectedCollectionKey("");
                      // Auto-refresh so the Collection dropdown for the newly
                      // chosen library reappears immediately, instead of
                      // clearing it and requiring a second manual "Load"
                      // click the user has no reason to expect.
                      handleFetchCollections(newGroupId);
                    }}
                    style={{ ...inputStyle, width: "100%", marginBottom: 6 }}
                  >
                    <option value="">Personal library</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name} (group)</option>
                    ))}
                  </select>
                </div>
              )}
              {collections.length > 0 && (
                <select
                  value={selectedCollectionKey}
                  onChange={(e) => setSelectedCollectionKey(e.target.value)}
                  style={{ ...inputStyle, width: "100%" }}
                >
                  <option value="">Entire library</option>
                  {collections.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            {apiError && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{apiError}</p>}
            <button onClick={handleAPISync} disabled={syncing || importing || !apiKey.trim() || !zoteroUserId.trim()}
              className="flex items-center gap-2"
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 7, padding: "8px 20px", cursor: "pointer", minHeight: 44, opacity: (syncing || importing || !apiKey.trim() || !zoteroUserId.trim()) ? 0.5 : 1 }}>
              <Wifi size={14} />{syncing ? "Syncing…" : importing ? "Import in progress…" : (selectedCollectionKey ? `Sync "${collections.find(c => c.key === selectedCollectionKey)?.name ?? "collection"}"` : "Sync library")}
            </button>
          </div>
        )}

        {importErrors.length > 0 && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 7, backgroundColor: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.2)" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-error)", marginBottom: 4 }}>{importErrors.length} item{importErrors.length > 1 ? "s" : ""} could not be inserted:</p>
            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
              {importErrors.slice(0, 10).map((t, i) => <li key={i} style={{ fontSize: 11, color: "var(--color-secondary)" }}>{t}</li>)}
              {importErrors.length > 10 && <li style={{ fontSize: 11, color: "var(--color-secondary)" }}>…and {importErrors.length - 10} more</li>}
            </ul>
          </div>
        )}
        {pdfErrors.length > 0 && (
          <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, backgroundColor: "rgba(192,57,43,0.04)", border: "1px solid rgba(192,57,43,0.15)" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-error)", marginBottom: 4 }}>PDF attach failed for {pdfErrors.length} item{pdfErrors.length > 1 ? "s" : ""} (metadata still imported):</p>
            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
              {pdfErrors.slice(0, 5).map((t, i) => <li key={i} style={{ fontSize: 11, color: "var(--color-secondary)" }}>{t}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "8px 16px", backgroundColor: "transparent", cursor: "pointer", minHeight: 44 }}>
            {importErrors.length > 0 ? "Close" : "Cancel"}
          </button>
          {tab === "file" && (
            <button onClick={handleImport} disabled={(!parsed.length && !forceNewIds.size) || importing || syncing}
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 7, padding: "8px 20px", cursor: ((!parsed.length && !forceNewIds.size) || importing || syncing) ? "default" : "pointer", minHeight: 44, opacity: ((!parsed.length && !forceNewIds.size) || importing || syncing) ? 0.5 : 1 }}>
              {uploadStatus || (importing ? "Importing…" : syncing ? "Sync in progress…" : `Import ${parsed.length + forceNewIds.size > 0 ? (parsed.length + forceNewIds.size) + " item" + (parsed.length + forceNewIds.size > 1 ? "s" : "") : ""}`)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DOI / BibTeX / URL Lookup Modal ──────────────────────────────────────────

function parseBibTeX(bib: string): Partial<LiteratureItem> {
  const field = (name: string) =>
    new RegExp(`${name}\\s*=\\s*[{"]([^}"]+)[}"]`, "i").exec(bib)?.[1]?.trim();
  const rawType = (/@(\w+)\s*\{/.exec(bib)?.[1] ?? "article").toLowerCase();
  const TYPE_MAP_BIB: Record<string, LiteratureType> = {
    article: "article", book: "book", inbook: "book", incollection: "book",
    phdthesis: "thesis", mastersthesis: "thesis", techreport: "report", unpublished: "preprint", misc: "article",
  };
  const authorStr = field("author") ?? "";
  return {
    type: TYPE_MAP_BIB[rawType] ?? "article",
    title: field("title") ?? "",
    authors: authorStr ? authorStr.split(/\s+and\s+/i).map((a) => a.trim()) : [],
    year: parseInt(field("year") ?? "0") || 0,
    journal: field("journal") ?? field("booktitle") ?? undefined,
    doi: field("doi") ?? undefined,
    abstract: field("abstract") ?? undefined,
    volume: field("volume") ?? undefined,
    pages: field("pages") ?? undefined,
  };
}

type DOIMode = "doi" | "bibtex" | "url";

function DOILookupModal({ onSave, onMerge, onClose, projectId, currentUserId, subProjectId, subProjects, existingItems }: {
  onSave: (item: LiteratureItem) => void;
  onMerge: (id: string, updates: Partial<LiteratureItem>) => void;
  onClose: () => void;
  projectId: string; currentUserId: string; subProjectId: string | null;
  subProjects?: SubProject[];
  existingItems?: LiteratureItem[];
}) {
  const [mode, setMode]       = useState<DOIMode>("doi");
  const [input, setInput]     = useState("");
  const [preview, setPreview] = useState<Partial<LiteratureItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [scope, setScope]     = useState<LibraryScope>("lab");
  const [personalSubProjectId, setPersonalSubProjectId] = useState<string | null>(null);

  useEffect(() => { setInput(""); setPreview(null); setError(""); }, [mode]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function fetchDOI(doi: string) {
    setLoading(true); setError(""); setPreview(null);
    try {
      const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`);
      if (!res.ok) throw new Error("Not found");
      const { message: m } = await res.json();
      setPreview({
        type: "article",
        title: (Array.isArray(m.title) ? m.title[0] : m.title) ?? "",
        authors: (m.author ?? []).map((a: { given?: string; family?: string }) => `${a.given ?? ""} ${a.family ?? ""}`.trim()).filter(Boolean),
        year: m.published?.["date-parts"]?.[0]?.[0] ?? m["published-print"]?.["date-parts"]?.[0]?.[0] ?? 0,
        journal: Array.isArray(m["container-title"]) ? m["container-title"][0] : m["container-title"] ?? undefined,
        doi: m.DOI ?? clean,
        abstract: m.abstract?.replace(/<[^>]+>/g, "") ?? undefined,
        volume: m.volume ?? undefined, pages: m.page ?? undefined,
      });
    } catch { setError("Could not fetch metadata. Check the DOI and try again."); }
    finally { setLoading(false); }
  }

  function handleBibTeX() {
    setError(""); setPreview(null);
    const p = parseBibTeX(input);
    if (!p.title) { setError("Could not parse BibTeX. Check the format."); return; }
    setPreview(p);
  }

  async function handleURL() {
    setError(""); setPreview(null);

    // Bare DOI anywhere in the URL
    const doiMatch = /10\.\d{4,}\/[^\s"<>]+/.exec(input);
    if (doiMatch) { await fetchDOI(doiMatch[0]); return; }

    // Google Scholar - try SerpApi first (if configured server-side), then Semantic Scholar
    if (/scholar\.google\./i.test(input)) {
      if (/[?&]user=/.test(input)) {
        setPreview({ title: "", authors: [], year: 0, url: input });
        setError("This is a Scholar author profile page, not a paper page. Paste a Scholar search result or paper URL instead.");
        return;
      }
      setLoading(true);
      // Try server-side SerpApi route first (handles arbitrary Scholar URLs)
      try {
        const { data: { session: serpSession } } = await supabase.auth.getSession();
        const serpRes = await fetch("/api/scholar-search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(serpSession?.access_token ? { Authorization: `Bearer ${serpSession.access_token}` } : {}),
          },
          body: JSON.stringify({ url: input }),
        });
        if (serpRes.ok) {
          const data = await serpRes.json() as Partial<LiteratureItem>;
          if (data.title) { setPreview(data); setLoading(false); return; }
        }
        // SerpApi not configured or returned nothing - fall through to Semantic Scholar
      } catch { /* fall through */ }
      // Semantic Scholar fallback using title/q param
      const titleParam = /[?&](?:title|q)=([^&]+)/.exec(input)?.[1];
      if (titleParam) {
        const q = decodeURIComponent(titleParam.replace(/\+/g, " "));
        const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&fields=title,authors,year,journal,externalIds&limit=1`;
        let paper: { title: string; authors?: { name: string }[]; year?: number; journal?: { name?: string }; externalIds?: { DOI?: string } } | null = null;
        for (let attempt = 0; attempt < 3 && !paper; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
            const { data: ss } = await (await fetch(ssUrl)).json();
            paper = ss?.[0] ?? null;
          } catch { /* retry */ }
        }
        setLoading(false);
        if (paper) {
          setPreview({ type: "article", title: paper.title, authors: (paper.authors ?? []).map((a) => a.name), year: paper.year, journal: paper.journal?.name, doi: paper.externalIds?.DOI });
          return;
        }
        setPreview({ title: "", authors: [], year: 0, url: input });
        setError("Couldn't find this paper. Try the DOI or BibTeX option instead (on Scholar, click the quote icon → BibTeX).");
        return;
      }
      setLoading(false);
      setPreview({ title: "", authors: [], year: 0, url: input });
      setError("Can't extract a title from this Scholar URL. Use the DOI or BibTeX option instead.");
      return;
    }

    // Generic URL fallback
    setPreview({ title: "", authors: [], year: 0, url: input });
    setError("Could not extract a DOI from this URL. Fill in the details manually below.");
  }

  async function handleSave() {
    if (!preview?.title?.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const title = preview.title!;
    const doi = preview.doi?.toLowerCase();
    const authors = preview.authors ?? [];
    const year = preview.year ?? 0;

    // Check for a duplicate in the current library
    const existing = existingItems?.find((ex) =>
      litIsDupe(ex, doi, title, authors[0] ?? "", year)
    );
    if (existing) {
      const incomingItem: LiteratureItem = {
        id: crypto.randomUUID(), projectId, scope,
        type: preview.type ?? "article", title,
        authors, year, journal: preview.journal, doi: preview.doi,
        abstract: preview.abstract, volume: preview.volume,
        pages: preview.pages, url: preview.url,
        tags: [], removedTags: [], status: "unread", rating: 0, notes: "",
        files: [], collections: [], relatedIds: [],
        addedById: currentUserId, addedAt: now,
        importSource: mode === "doi" ? "doi" : mode === "bibtex" ? "bibtex" : "url",
      };
      const updates = computeMergeUpdates(existing, incomingItem);
      const fieldList = Object.keys(updates).join(", ");
      const choice = window.confirm(
        `"${title.length > 60 ? title.slice(0, 60) + "…" : title}" looks like a duplicate of an existing item.\n\n` +
        (fieldList ? `Merge → fill in missing fields: ${fieldList}\nCancel → add as a new item` : `Merge → no new fields to add\nCancel → add as a new item`)
      );
      if (choice) {
        if (Object.keys(updates).length > 0) onMerge(existing.id, updates);
        setSaving(false);
        onClose();
        return;
      }
      // User chose "Add anyway" - fall through to insert
    }

    const item: LiteratureItem = {
      id: crypto.randomUUID(), projectId, scope,
      type: preview.type ?? "article", title,
      authors, year, journal: preview.journal, doi: preview.doi,
      abstract: preview.abstract, volume: preview.volume,
      pages: preview.pages, url: preview.url,
      tags: [], removedTags: [], status: "unread", rating: 0, notes: "",
      files: [], collections: [], relatedIds: [],
      addedById: currentUserId, addedAt: now,
      importSource: mode === "doi" ? "doi" : mode === "bibtex" ? "bibtex" : "url",
    };
    const { error: insertErr } = await supabase.from("literature_items").insert(
      buildLitInsert(projectId, currentUserId, {
        id: item.id, library: scope, type: item.type, title: item.title, authors: item.authors,
        year: item.year || null, journal: item.journal ?? null,
        volume: item.volume ?? null, pages: item.pages ?? null,
        doi: item.doi ?? null, abstract: item.abstract ?? null,
        tags: [], status: "unread",
        sub_project_id: scope === "project" ? subProjectId : scope === "personal" ? personalSubProjectId : null,
      })
    );
    if (insertErr) {
      console.error("[DOI lookup save]", insertErr.code, insertErr.message, insertErr.details);
      setError(`Failed to save: ${insertErr.message}`);
      setSaving(false);
      return;
    }
    onSave(item); setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(27,46,75,0.35)" }} onClick={onClose}>
      <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 480, width: "100%", borderRadius: 10, padding: 28, boxShadow: "0 8px 40px rgba(27,46,75,0.18)", maxHeight: "90dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>Add by DOI / BibTeX / URL</h2>
          <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 36, height: 36 }}><X size={16} color="var(--color-secondary)" /></button>
        </div>

        <div className="flex rounded-lg p-0.5 mb-4" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", width: "fit-content" }}>
          {(["doi", "bibtex", "url"] as DOIMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: "none", backgroundColor: mode === m ? "var(--color-navy)" : "transparent", color: mode === m ? "#fff" : "var(--color-secondary)", cursor: "pointer", textTransform: "uppercase" }}>{m}</button>
          ))}
        </div>

        {mode === "doi" && (
          <div className="flex gap-2 mb-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="10.xxxx/xxxxx or doi.org/…" style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") fetchDOI(input); }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            <button onClick={() => fetchDOI(input)} disabled={loading || !input.trim()} style={{ padding: "0 16px", height: 36, borderRadius: 7, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, minWidth: 72, opacity: (loading || !input.trim()) ? 0.5 : 1 }}>
              {loading ? "…" : "Fetch"}
            </button>
          </div>
        )}
        {mode === "bibtex" && (
          <div className="mb-3">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={"@article{key,\n  title = {…},\n  author = {…},\n  year = {2024},\n}"}
              style={{ width: "100%", minHeight: 120, fontSize: 12, fontFamily: "monospace", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", resize: "vertical", outline: "none", boxSizing: "border-box", backgroundColor: "var(--color-canvas)", color: "var(--color-body)" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            <button onClick={handleBibTeX} disabled={!input.trim()} style={{ marginTop: 8, padding: "6px 16px", height: 36, borderRadius: 7, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: !input.trim() ? 0.5 : 1 }}>Parse</button>
          </div>
        )}
        {mode === "url" && (
          <div className="flex gap-2 mb-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://doi.org/10.xxxx or article URL" style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") handleURL(); }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            <button onClick={handleURL} disabled={loading || !input.trim()} style={{ padding: "0 16px", height: 36, borderRadius: 7, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, minWidth: 72, opacity: (loading || !input.trim()) ? 0.5 : 1 }}>
              {loading ? "…" : "Fetch"}
            </button>
          </div>
        )}

        {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{error}</p>}

        {preview !== null && (
          <div className="px-3 py-3 rounded-lg mb-4" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
            <label style={labelStyle}>Title</label>
            <input value={preview.title ?? ""} onChange={(e) => setPreview((p) => ({ ...p, title: e.target.value }))}
              style={{ ...inputStyle, fontWeight: 600, marginBottom: 8 }} placeholder="Title"
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            {((preview.authors ?? []).length > 0 || preview.journal) && (
              <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 2 }}>
                {(preview.authors ?? []).join("; ")}{preview.journal ? ` · ${preview.journal}` : ""}{preview.year ? ` · ${preview.year}` : ""}
              </p>
            )}
            {preview.doi && <p style={{ fontSize: 11, color: "var(--color-secondary)" }}>DOI: {preview.doi}</p>}
            <div className="mt-3 flex rounded-lg p-0.5" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", width: "fit-content" }}>
              {(["lab", "personal"] as const).map((s) => (
                <button key={s} onClick={() => { setScope(s); setPersonalSubProjectId(null); }} style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: "none", backgroundColor: scope === s ? "var(--color-navy)" : "transparent", color: scope === s ? "#fff" : "var(--color-secondary)", cursor: "pointer" }}>
                  {s === "lab" ? "Lab" : "Mine"}
                </button>
              ))}
            </div>
            {(subProjects ?? []).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                <span style={{ fontSize: 11, color: "var(--color-secondary)", alignSelf: "center", marginRight: 2 }}>Tag to:</span>
                <button onClick={() => setPersonalSubProjectId(null)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === null ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: personalSubProjectId === null ? "rgba(27,46,75,0.08)" : "transparent", color: personalSubProjectId === null ? "var(--color-navy)" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>General</button>
                {(subProjects ?? []).map((sp) => (
                  <button key={sp.id} onClick={() => setPersonalSubProjectId(sp.id)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: `1px solid ${personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "var(--color-border)"}`, backgroundColor: personalSubProjectId === sp.id ? (sp.color ?? "#34A853") : "transparent", color: personalSubProjectId === sp.id ? "#fff" : "var(--color-secondary)", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>{sp.name}</button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "8px 16px", backgroundColor: "transparent", cursor: "pointer", minHeight: 44 }}>Cancel</button>
          <button onClick={handleSave} disabled={!preview?.title?.trim() || saving}
            style={{ fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 7, padding: "8px 20px", cursor: (!preview?.title?.trim() || saving) ? "default" : "pointer", minHeight: 44, opacity: (!preview?.title?.trim() || saving) ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add to library"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Left panel ────────────────────────────────────────────────────────────────

type LitScope = "all" | LibraryScope;

const LIT_SCOPE_COLORS: Record<LitScope, string> = {
  all:      "#475569",
  personal: "#0EA5E9",
  lab:      "#0F2544",
  project:  "#34A853",
};

function LitSidebarRow({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${active ? color : "transparent"}`, cursor: "pointer", backgroundColor: active ? `${color}18` : "transparent", marginBottom: 1, transition: "background-color 120ms ease, border-left-color 120ms ease", textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)" }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
    >
      <span style={{ flex: 1, fontSize: 13, color: active ? color : "var(--color-body)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: active ? color : "var(--color-secondary)", backgroundColor: active ? `${color}20` : "rgba(0,0,0,0.06)", borderRadius: 10, padding: "1px 7px", flexShrink: 0, minWidth: 20, textAlign: "center" }}>{count}</span>
    </button>
  );
}

function CollectionsSidebar({
  scope, setScope, selectedSubProjectId, setSelectedSubProjectId,
  activeCollection, setActiveCollection, allTags, activeTag, setActiveTag,
  items, allItems,
  showClose, onClose, onAddItem, onCollapse, onImportZotero, onAddByDOI, subProjects,
  onReadingProgress, showReadingProgress,
  showTrash, setShowTrash,
  showScopeFilter = true,
  projectBadge,
}: {
  scope: LitScope; setScope: (s: LitScope) => void;
  selectedSubProjectId: string | null; setSelectedSubProjectId: (id: string | null) => void;
  activeCollection: string; setActiveCollection: (id: string) => void;
  allTags: string[]; activeTag: string | null; setActiveTag: (t: string | null) => void;
  items: LiteratureItem[];    // scoped (for collections/tags/stats)
  allItems: LiteratureItem[]; // unscoped (for scope counts in sidebar)
  showClose?: boolean; onClose?: () => void;
  onAddItem: () => void;
  onCollapse?: () => void;
  onImportZotero?: () => void;
  onAddByDOI?: () => void;
  subProjects?: SubProject[];
  onReadingProgress?: () => void;
  showReadingProgress?: boolean;
  showTrash?: boolean;
  setShowTrash?: (v: boolean) => void;
  showScopeFilter?: boolean;
  projectBadge?: string;
}) {
  const totalRead    = items.filter((i) => i.status === "read").length;
  const totalReading = items.filter((i) => i.status === "reading").length;
  const totalUnread  = items.filter((i) => i.status === "unread").length;

  const scopeCounts = {
    all:      allItems.length,
    personal: allItems.filter((i) => i.scope === "personal").length,
    lab:      allItems.filter((i) => i.scope === "lab").length,
  };
  const projectCounts: Record<string, number> = {};
  for (const sp of (subProjects ?? [])) {
    projectCounts[sp.id] = allItems.filter((i) => i.scope === "project" && (i as LiteratureItem & { subProjectId?: string }).subProjectId === sp.id).length;
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-surface)" }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>Literature</h2>
          {projectBadge && (
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0", fontFamily: "var(--font-roboto)" }}>{projectBadge}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="opacity-0 group-hover/litpanel:opacity-100 transition-opacity flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]"
              style={{ width: 32, height: 32 }}
              title="Collapse panel"
              aria-label="Collapse panel"
            >
              <ChevronLeft size={15} color="var(--color-secondary)" />
            </button>
          )}
          {showClose && <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 44, height: 44 }} aria-label="Close"><X size={16} color="var(--color-secondary)" /></button>}
          {onImportZotero && <button onClick={onImportZotero} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 32, height: 32 }} title="Import from Zotero" aria-label="Import from Zotero"><Upload size={15} color="var(--color-body)" /></button>}
          {onAddByDOI && <button onClick={onAddByDOI} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 32, height: 32 }} title="Add by DOI / BibTeX / URL" aria-label="Add by DOI"><Link2 size={15} color="var(--color-body)" /></button>}
        </div>
      </div>

      <div style={{ padding: "4px 8px 6px", borderBottom: "1px solid var(--color-border)" }}>
        {showScopeFilter && <LitSidebarRow label="All Items" count={scopeCounts.all} active={scope === "all"} color={LIT_SCOPE_COLORS.all} onClick={() => { setScope("all"); setSelectedSubProjectId(null); }} />}
        {showScopeFilter && (
          <>
            <LitSidebarRow label="Personal"  count={scopeCounts.personal} active={scope === "personal" && selectedSubProjectId === null} color={LIT_SCOPE_COLORS.personal} onClick={() => { setScope("personal"); setSelectedSubProjectId(null); }} />
            {(subProjects ?? []).length > 0 && (
              <>
                <LitSidebarRow
                  label="General"
                  count={allItems.filter((i) => i.scope === "personal" && !(i as LiteratureItem & { subProjectId?: string }).subProjectId).length}
                  active={selectedSubProjectId === "__general__"}
                  color={LIT_SCOPE_COLORS.personal}
                  onClick={() => setSelectedSubProjectId("__general__")}
                />
                {(subProjects ?? []).filter((sp) => sp.name.toLowerCase() !== "general").map((sp) => (
                  <LitSidebarRow
                    key={sp.id}
                    label={sp.name}
                    count={allItems.filter((i) => i.scope === "personal" && (i as LiteratureItem & { subProjectId?: string }).subProjectId === sp.id).length}
                    active={selectedSubProjectId === sp.id}
                    color={sp.color ?? LIT_SCOPE_COLORS.personal}
                    onClick={() => setSelectedSubProjectId(sp.id)}
                  />
                ))}
              </>
            )}
            <LitSidebarRow label="Lab"       count={scopeCounts.lab}      active={scope === "lab"}      color={LIT_SCOPE_COLORS.lab}      onClick={() => { setScope("lab");      setSelectedSubProjectId(null); }} />
          </>
        )}
        {setShowTrash && (
          <>
            <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "4px 2px" }} />
            <button
              onClick={() => setShowTrash(true)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${showTrash ? "#C0392B" : "transparent"}`, cursor: "pointer", backgroundColor: showTrash ? "rgba(192,57,43,0.08)" : "transparent", textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)", marginBottom: 1 }}
              onMouseEnter={(e) => { if (!showTrash) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
              onMouseLeave={(e) => { if (!showTrash) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
            >
              <Trash2 size={13} color={showTrash ? "#C0392B" : "var(--color-secondary)"} />
              <span style={{ fontSize: 13, color: showTrash ? "#C0392B" : "var(--color-body)", fontWeight: showTrash ? 600 : 400 }}>Recently removed</span>
            </button>
          </>
        )}
      </div>

      {onReadingProgress && (
        <div style={{ padding: "4px 8px 4px", borderBottom: "1px solid var(--color-border)" }}>
          <button
            onClick={onReadingProgress}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${showReadingProgress ? "#6366F1" : "transparent"}`, cursor: "pointer", backgroundColor: showReadingProgress ? "rgba(99,102,241,0.09)" : "transparent", textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)" }}
            onMouseEnter={(e) => { if (!showReadingProgress) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
            onMouseLeave={(e) => { if (!showReadingProgress) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <BarChart2 size={14} color={showReadingProgress ? "#6366F1" : "var(--color-secondary)"} />
            <span style={{ fontSize: 13, color: showReadingProgress ? "#6366F1" : "var(--color-body)", fontWeight: showReadingProgress ? 600 : 400 }}>Reading Progress</span>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {[
          { id: "lc0", name: "All Items", iconName: "Library", itemCount: items.length },
          ...[...new Set(items.flatMap((i) => i.collections))].map((colId) => ({
            id: colId,
            name: colId,
            iconName: "Library",
            itemCount: items.filter((i) => i.collections.includes(colId)).length,
          })),
        ].map((col) => (
          <button key={col.id} onClick={() => { setActiveCollection(col.id); onClose?.(); }}
            className="w-full flex items-center justify-between px-3 py-2"
            style={{ backgroundColor: activeCollection === col.id ? "var(--color-navy)" : "transparent", color: activeCollection === col.id ? "#fff" : "var(--color-body)", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, textAlign: "left", minHeight: 44, margin: "0 4px", width: "calc(100% - 8px)" }}>
            <span className="flex items-center gap-2">{collectionIcon(col.iconName, activeCollection === col.id)}{col.name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: activeCollection === col.id ? "rgba(255,255,255,0.7)" : "var(--color-secondary)" }}>{col.itemCount}</span>
          </button>
        ))}
        {allTags.length > 0 && (
          <div className="px-3 mt-4">
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-secondary)", marginBottom: 8 }}>Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => (
                <button key={tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: `1px solid ${activeTag === tag ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: activeTag === tag ? "rgba(27,46,75,0.06)" : "transparent", color: activeTag === tag ? "var(--color-navy)" : "var(--color-secondary)", cursor: "pointer", minHeight: 30 }}>
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 grid gap-1" style={{ borderTop: "1px solid var(--color-border)", gridTemplateColumns: totalReading > 0 ? "repeat(4,1fr)" : "repeat(3,1fr)" }}>
        {[
          { label: "Total",   value: items.length },
          { label: "Read",    value: totalRead    },
          ...(totalReading > 0 ? [{ label: "Reading", value: totalReading }] : []),
          { label: "Unread",  value: totalUnread  },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)" }}>{value}</p>
            <p style={{ fontSize: 10, color: "var(--color-secondary)" }}>{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reading Progress Dashboard ────────────────────────────────────────────────

const PROGRESS_STATUS_LABELS: Record<AssignmentReadingStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  not_started: "Not started",
};
const PROGRESS_STATUS_COLORS: Record<AssignmentReadingStatus, string> = {
  done: "#10B981",
  in_progress: "#F59E0B",
  not_started: "#94A3B8",
};

type ProgressRow = {
  id: string; itemId: string; itemTitle: string;
  itemScope: LibraryScope | null; itemSubProjectId: string | null;
  assignedBy: string; assigneeId: string; dueDate: string | null;
  readingStatus: AssignmentReadingStatus; statusHidden: boolean;
};

function ReadingProgressDashboard({
  projectId, currentUserId, currentUserRole, teamMembers, scope, selectedSubProjectId,
}: {
  projectId: string; currentUserId: string; currentUserRole: UserRole;
  teamMembers: User[]; scope: LitScope; selectedSubProjectId: string | null;
}) {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("lit_assigned_readings")
      .select("id, item_id, assigned_by, assignee_id, due_date, reading_status, status_hidden, literature_items(library, title, sub_project_id)")
      .eq("project_id", projectId)
      .then(({ data, error }) => {
        if (error) {
          console.error("ReadingProgressDashboard fetch error:", error.message, error.details);
          setLoading(false);
          return;
        }
        setRows((data ?? []).map((r) => {
          const li = Array.isArray(r.literature_items) ? r.literature_items[0] : (r.literature_items as Record<string, unknown> | null);
          return {
            id: r.id as string,
            itemId: r.item_id as string,
            itemTitle: (li?.title as string) ?? "Unknown paper",
            itemScope: (li?.library as LibraryScope | null) ?? null,
            itemSubProjectId: (li?.sub_project_id as string | null) ?? null,
            assignedBy: r.assigned_by as string,
            assigneeId: r.assignee_id as string,
            dueDate: (r.due_date as string | null) ?? null,
            readingStatus: (r.reading_status as AssignmentReadingStatus) ?? "not_started",
            statusHidden: (r.status_hidden as boolean) ?? false,
          };
        }));
        setLoading(false);
      });
  }, [projectId]);

  const scoped = rows.filter((a) => {
    if (scope === "all") return true;
    if (scope === "personal") return a.itemScope === "personal";
    if (scope === "lab") return a.itemScope === "lab";
    if (scope === "project") return a.itemScope === "project" && a.itemSubProjectId === selectedSubProjectId;
    return true;
  });

  // Researchers see only their own assignments
  const visible = currentUserRole === "pi" ? scoped : scoped.filter((a) => a.assigneeId === currentUserId);

  const memberMap = new Map<string, ProgressRow[]>();
  const itemMap = new Map<string, ProgressRow[]>();
  for (const a of visible) {
    if (!memberMap.has(a.assigneeId)) memberMap.set(a.assigneeId, []);
    memberMap.get(a.assigneeId)!.push(a);
    if (!itemMap.has(a.itemId)) itemMap.set(a.itemId, []);
    itemMap.get(a.itemId)!.push(a);
  }

  function getStatus(a: ProgressRow): AssignmentReadingStatus | null {
    if (a.statusHidden && a.assigneeId !== currentUserId && currentUserRole !== "pi") return null;
    return a.readingStatus;
  }

  function memberName(id: string) {
    if (id === currentUserId) return "You";
    return teamMembers.find((m) => m.id === id)?.name ?? id.slice(0, 8);
  }

  if (loading) return (
    <div className="flex-1" style={{ padding: "20px 24px" }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ width: "45%", height: 13, borderRadius: 4, backgroundColor: "var(--color-border)", marginBottom: 10 }} className="animate-pulse" />
          <div style={{ width: "70%", height: 10, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.6 }} className="animate-pulse" />
        </div>
      ))}
    </div>
  );

  if (visible.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
      <BarChart2 size={32} color="var(--color-border)" />
      <p style={{ fontSize: 14, color: "var(--color-secondary)", margin: 0 }}>No assigned readings in this scope.</p>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>Open any paper and use the Assigned tab to assign it to team members.</p>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" style={{ fontFamily: "var(--font-roboto)" }}>
      <h3 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 16, color: "var(--color-navy)", marginBottom: 16, marginTop: 0 }}>
        Reading Progress
      </h3>

      {/* Team overview table - PI only */}
      {currentUserRole === "pi" && memberMap.size > 0 && (
        <section className="mb-6">
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-secondary)", marginBottom: 8 }}>Team overview</p>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: "var(--color-canvas)" }}>
                  {["Member", "Total", "Done", "In Progress", "Not Started", "Progress"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Member" || h === "Progress" ? "left" : "center", fontWeight: 700, color: "var(--color-secondary)", borderBottom: "1px solid var(--color-border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...memberMap.entries()].map(([mid, mrows]) => {
                  const done = mrows.filter((r) => getStatus(r) === "done").length;
                  const inProg = mrows.filter((r) => getStatus(r) === "in_progress").length;
                  const notStarted = mrows.filter((r) => getStatus(r) === "not_started").length;
                  const total = mrows.length;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <tr key={mid} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "8px 12px", color: "var(--color-body)", fontWeight: 500 }}>{memberName(mid)}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--color-body)" }}>{total}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#10B981", fontWeight: 600 }}>{done}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#F59E0B", fontWeight: 600 }}>{inProg}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--color-secondary)" }}>{notStarted}</td>
                      <td style={{ padding: "8px 12px", minWidth: 120 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, backgroundColor: "#10B981", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Per-paper breakdown */}
      <section>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-secondary)", marginBottom: 8 }}>By paper</p>
        <div className="space-y-2">
          {[...itemMap.entries()].map(([itemId, itemRows]) => {
            const done = itemRows.filter((r) => getStatus(r) === "done").length;
            const total = itemRows.length;
            const isExpanded = expandedItem === itemId;
            return (
              <div key={itemId} style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
                <button
                  onClick={() => setExpandedItem(isExpanded ? null : itemId)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", backgroundColor: "var(--color-canvas)", border: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{itemRows[0].itemTitle}</p>
                  </div>
                  <span style={{ fontSize: 11, color: done === total ? "#10B981" : "var(--color-secondary)", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{done}/{total} done</span>
                  <ChevronRight size={14} color="var(--color-secondary)" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 150ms", flexShrink: 0 }} />
                </button>
                {isExpanded && (
                  <div style={{ padding: "6px 12px 10px", backgroundColor: "var(--color-surface)", display: "flex", flexDirection: "column", gap: 4 }}>
                    {itemRows.map((a) => {
                      const st = getStatus(a);
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: st ? PROGRESS_STATUS_COLORS[st] : "var(--color-border)", flexShrink: 0, display: "inline-block" }} />
                          <span style={{ flex: 1, color: "var(--color-body)" }}>{memberName(a.assigneeId)}</span>
                          <span style={{ color: st ? PROGRESS_STATUS_COLORS[st] : "var(--color-secondary)", fontWeight: st ? 600 : 400 }}>
                            {st ? PROGRESS_STATUS_LABELS[st] : "-"}
                          </span>
                          {a.dueDate && <span style={{ color: "var(--color-secondary)", fontSize: 11, flexShrink: 0 }}>due {a.dueDate}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── Assign Reading Form ───────────────────────────────────────────────────────

function AssignReadingForm({ itemId, projectId, assignedBy, teamMembers, onAssigned }: {
  itemId: string; projectId: string; assignedBy: string;
  teamMembers: User[];
  onAssigned: (a: LitAssignedReading) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [note, setNote]               = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  // Exclude the current user - you can't assign a reading to yourself
  const assignableMembers = teamMembers.filter((m) => m.id !== assignedBy);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setError("");
  }

  async function handleAssign() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    setError("");
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const assigneeId of selectedIds) {
      const newA: LitAssignedReading = {
        id: crypto.randomUUID(), itemId, projectId, assignedBy,
        assigneeId, note: note.trim() || undefined,
        readingStatus: "not_started", createdAt: now,
      };
      const { error: insertErr } = await supabase.from("lit_assigned_readings").insert({
        id: newA.id, item_id: itemId, project_id: projectId, assigned_by: assignedBy,
        assignee_id: assigneeId, note: note.trim() || null, reading_status: "not_started",
      });
      if (insertErr) {
        const member = teamMembers.find((m) => m.id === assigneeId);
        const name = member?.name.split(" ")[0] ?? assigneeId.slice(0, 8);
        errors.push(
          insertErr.code === "23505"
            ? `Already assigned to ${name}`
            : `Failed for ${name}: ${insertErr.message}`
        );
      } else {
        onAssigned(newA);
      }
    }

    if (errors.length > 0) setError(errors.join(" · "));
    else { setSelectedIds(new Set()); setNote(""); }
    setSaving(false);
  }

  const count = selectedIds.size;

  return (
    <div className="mt-2 p-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>
        Assign to team members
      </p>

      {assignableMembers.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>No other team members to assign to.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
          {assignableMembers.map((member) => {
            const checked = selectedIds.has(member.id);
            return (
              <label
                key={member.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 10px", borderRadius: 7, cursor: "pointer",
                  backgroundColor: checked ? "rgba(27,46,75,0.08)" : "transparent",
                  outline: checked ? "1.5px solid var(--color-navy)" : "1.5px solid transparent",
                  transition: "background-color 100ms ease",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(member.id)}
                  style={{ width: 15, height: 15, accentColor: "var(--color-navy)", cursor: "pointer", flexShrink: 0 }}
                />
                <Avatar user={member} size={22} />
                <span style={{ fontSize: 13, color: "var(--color-body)", fontWeight: checked ? 600 : 400, flex: 1 }}>
                  {member.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-secondary)", textTransform: "capitalize" }}>{member.role}</span>
              </label>
            );
          })}
        </div>
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        style={{ width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 10px", fontSize: 12, fontFamily: "var(--font-roboto)", outline: "none", boxSizing: "border-box", marginBottom: 8 }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
      />

      {error && <p style={{ fontSize: 11, color: "var(--color-error)", margin: "0 0 6px" }}>{error}</p>}

      <button
        onClick={handleAssign}
        disabled={count === 0 || saving}
        style={{
          fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 7,
          backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer",
          minHeight: 36, opacity: count === 0 || saving ? 0.5 : 1,
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        {saving
          ? "Assigning…"
          : count === 0
          ? "Select members"
          : count === 1
          ? `Assign to ${teamMembers.find((m) => m.id === [...selectedIds][0])?.name.split(" ")[0] ?? "1 member"}`
          : `Assign to ${count} members`}
      </button>
    </div>
  );
}

// ── Citation linking ──────────────────────────────────────────────────────────

interface ParsedCitation {
  start: number; end: number; raw: string; authorPart: string; year: number;
}

function parseCitations(text: string): ParsedCitation[] {
  const patterns: RegExp[] = [
    // (Author, YEAR) - with optional page ref suffix
    /\(([A-Z][a-zA-ZÀ-ɏ'\-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z'\-]+|and\s+[A-Z][a-zA-Z'\-]+))?),\s*((?:19|20)\d{2})(?:[,;][^)]{0,30})?\)/g,
    // [Author, YEAR] bracket style
    /\[([A-Z][a-zA-ZÀ-ɏ'\-]+(?:\s+et\s+al\.?)?),\s*((?:19|20)\d{2})\]/g,
    // Narrative: Author (YEAR) or Author et al. (YEAR)
    /\b([A-Z][a-zA-ZÀ-ɏ'\-]+(?:\s+et\s+al\.)?)\s+\(((?:19|20)\d{2})\)/g,
  ];
  const all: ParsedCitation[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      all.push({ start: m.index, end: m.index + m[0].length, raw: m[0], authorPart: m[1], year: parseInt(m[2], 10) });
    }
  }
  all.sort((a, b) => a.start - b.start);
  // Remove overlaps - keep first match at each position
  const out: ParsedCitation[] = [];
  let lastEnd = -1;
  for (const c of all) {
    if (c.start >= lastEnd) { out.push(c); lastEnd = c.end; }
  }
  return out;
}

function CitationLinker({ text, items, onSelectItem }: {
  text: string;
  items: LiteratureItem[];
  onSelectItem: (id: string) => void;
}) {
  const citations = parseCitations(text);
  if (citations.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const c of citations) {
    if (cursor < c.start) parts.push(text.slice(cursor, c.start));

    const cLast = citationLastName(c.authorPart);
    const match = items.find(
      (it) => it.year === c.year && it.authors.length > 0 && litLastName(it.authors[0]) === cLast
    );

    if (match) {
      parts.push(
        <button
          key={c.start}
          onClick={(e) => { e.stopPropagation(); onSelectItem(match.id); }}
          title={match.title}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-navy)", textDecoration: "underline", textDecorationStyle: "dotted", fontFamily: "inherit", fontSize: "inherit", fontWeight: 600 }}
        >
          {c.raw}
        </button>
      );
    } else {
      parts.push(c.raw);
    }
    cursor = c.end;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

const PRIMARY_TABS = ["Info", "Abstract", "Notes", "Tags", "Files", "Assigned"] as const;
const MORE_TABS = ["Cite", "Related", "Annotations"] as const;
type DetailTab = typeof PRIMARY_TABS[number] | typeof MORE_TABS[number];

function DetailTabBar({ tab, setTab }: { tab: DetailTab; setTab: (t: DetailTab) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const isMoreActive = (MORE_TABS as readonly string[]).includes(tab);

  return (
    <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--color-border)" }}>
      {PRIMARY_TABS.map((t) => (
        <button key={t} onClick={() => setTab(t)}
          style={{ fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? "var(--color-navy)" : "var(--color-secondary)", backgroundColor: "transparent", border: "none", borderBottom: tab === t ? "2px solid var(--color-navy)" : "2px solid transparent", cursor: "pointer", padding: "10px 8px", whiteSpace: "nowrap", minHeight: 44 }}>
          {t}
        </button>
      ))}
      <div ref={moreRef} style={{ position: "relative", marginLeft: "auto" }}>
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-label="More tabs"
          style={{ fontSize: 15, fontWeight: isMoreActive ? 600 : 400, color: isMoreActive ? "var(--color-navy)" : "var(--color-secondary)", backgroundColor: "transparent", border: "none", borderBottom: isMoreActive ? "2px solid var(--color-navy)" : "2px solid transparent", cursor: "pointer", padding: "10px 12px", minHeight: 44, letterSpacing: "0.05em" }}>
          ⋯
        </button>
        {moreOpen && (
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 2px)", zIndex: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 130, padding: "4px 0" }}>
            {MORE_TABS.map((t) => (
              <button key={t} onClick={() => { setTab(t); setMoreOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? "var(--color-navy)" : "var(--color-body)", backgroundColor: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-dim)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailPanelContent({
  item, onClose, onUpdateItem, onDeleteItem, allItems, currentUserId, projectId, onAddItem, subProjectId, teamMembers, onNavigateToItem,
}: {
  item: LiteratureItem;
  onClose: () => void;
  onUpdateItem: (id: string, updates: Partial<LiteratureItem>) => void;
  onDeleteItem?: (id: string) => void;
  allItems: LiteratureItem[];
  currentUserId: string;
  projectId: string;
  onAddItem: (item: LiteratureItem) => void;
  subProjectId: string | null;
  teamMembers: User[];
  onNavigateToItem?: (id: string) => void;
}) {
  const [tab, setTab]                     = useState<DetailTab>("Info");
  const [citationStyle, setCitationStyle] = useState<"apa" | "mla" | "chicago">("apa");
  const [copied, setCopied]               = useState(false);
  const [notes, setNotes]                 = useState(item.notes ?? "");
  const [notesSaved, setNotesSaved]       = useState(false);
  const [localTags, setLocalTags]         = useState<string[]>(item.tags);
  const [tagInput, setTagInput]           = useState("");
  const [localFiles, setLocalFiles]       = useState<LiteratureFile[]>(item.files);
  const [localStatus, setLocalStatus]     = useState<ReadStatus>(item.status);
  const [localRating, setLocalRating]     = useState<number>(item.rating);
  const [fileUploading, setFileUploading] = useState(false);
  const [filesDragOver, setFilesDragOver] = useState(false);
  const [filesError, setFilesError] = useState("");
  const filesDragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editable DOI / URL / Volume / Pages
  const [editingDoi, setEditingDoi]       = useState(false);
  const [localDoi, setLocalDoi]           = useState(item.doi ?? "");
  const [doiError, setDoiError]           = useState("");
  const [editingUrl, setEditingUrl]       = useState(false);
  const [localUrl, setLocalUrl]           = useState(item.url ?? "");
  const [urlError, setUrlError]           = useState("");
  const [editingVolume, setEditingVolume] = useState(false);
  const [localVolume, setLocalVolume]     = useState(item.volume ?? "");
  const [editingPages, setEditingPages]   = useState(false);
  const [localPages, setLocalPages]       = useState(item.pages ?? "");

  const [annotations, setAnnotations]   = useState<LitAnnotation[]>([]);
  const [annotAuthors, setAnnotAuthors] = useState<Record<string, string>>({});
  const [newAnnotText, setNewAnnotText] = useState("");
  const [newAnnotComment, setNewAnnotComment] = useState("");
  const [newAnnotColor, setNewAnnotColor] = useState<string | undefined>(undefined);
  const [replyingTo, setReplyingTo]     = useState<string | null>(null);
  const [replyText, setReplyText]       = useState("");
  const [savingAnnot, setSavingAnnot]   = useState(false);
  const [assigned, setAssigned]         = useState<LitAssignedReading[]>([]);
  const [recs, setRecs]                 = useState<LitRecommendation[]>([]);
  const [recsLoading, setRecsLoading]   = useState(false);
  const [recsError, setRecsError]       = useState("");
  const [recsFetched, setRecsFetched]   = useState(false);
  const [showPDFViewer, setShowPDFViewer]           = useState(false);
  const [pdfViewerInitialPage, setPdfViewerInitialPage] = useState(1);
  const [pdfViewerExternalUrl, setPdfViewerExternalUrl] = useState<string | null>(null);

  // Sync when item switches
  useEffect(() => {
    setNotes(item.notes ?? "");
    setLocalTags(item.tags);
    setLocalFiles(item.files);
    setLocalStatus(item.status);
    setLocalRating(item.rating);
    setLocalDoi(item.doi ?? "");
    setLocalUrl(item.url ?? "");
    setLocalVolume(item.volume ?? "");
    setLocalPages(item.pages ?? "");
    setEditingDoi(false); setDoiError("");
    setEditingUrl(false); setUrlError("");
    setEditingVolume(false);
    setEditingPages(false);
    setTab("Info");
    setAnnotations([]); setAssigned([]); setRecs([]); setRecsFetched(false);
    setShowPDFViewer(false); setPdfViewerExternalUrl(null);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep localFiles in sync when the item's files array is mutated externally while
  // the same item is open - e.g. Zotero PDF fetched right after import. The effect
  // above only fires on item.id change, leaving localFiles stale in that window.
  useEffect(() => {
    setLocalFiles(item.files);
  }, [item.files]); // eslint-disable-line react-hooks/exhaustive-deps

  // Eagerly fetch annotations whenever item changes - not just when the Annotations tab is open.
  // This ensures the PDF viewer's `annotations` prop is populated before the viewer mounts.
  useEffect(() => {
    const seedMap: Record<string, string> = {};
    for (const m of teamMembers) seedMap[m.id] = m.name;
    setAnnotAuthors(seedMap);

    supabase.from("lit_annotations").select("id, item_id, author_id, text, comment, page_ref, parent_id, created_at, color, page_number, bbox").eq("item_id", item.id).order("created_at")
      .then(async ({ data }) => {
        if (!data) return;
        const mapped = data.map((r) => ({
          id: r.id as string, itemId: r.item_id as string, authorId: r.author_id as string,
          text: r.text as string, comment: r.comment as string,
          pageRef: r.page_ref as string | undefined,
          parentId: r.parent_id as string | undefined,
          createdAt: r.created_at as string,
          color: r.color as string | undefined,
          pageNumber: r.page_number as number | undefined,
          bbox: r.bbox as { x: number; y: number; w: number; h: number } | undefined,
        }));
        setAnnotations(mapped);
        // Fetch profiles for any IDs not already in teamMembers (e.g. past members)
        const knownIds = new Set([...teamMembers.map((m) => m.id), currentUserId]);
        const unknownIds = [...new Set(mapped.map((a) => a.authorId))].filter((id) => !knownIds.has(id));
        if (unknownIds.length > 0) {
          const { data: profiles } = await supabase.from("user_profiles").select("id, name").in("id", unknownIds);
          if (profiles) {
            setAnnotAuthors((prev) => {
              const next = { ...prev };
              for (const p of profiles) next[p.id as string] = (p.name as string) ?? p.id;
              return next;
            });
          }
        }
      });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "Assigned") {
      (async () => {
        // Prefer the RPC which enforces server-side status masking and returns aggregates.
        // Fall back to direct select (client-side masking only) if the RPC is unavailable.
        const { data: rpcRows, error: rpcErr } = await supabase.rpc(
          "get_item_assignments", { p_item_id: item.id },
        );
        if (!rpcErr && rpcRows) {
          setAssigned((rpcRows as Record<string, unknown>[]).map((r) => ({
            id: r.id as string, itemId: r.item_id as string, projectId: r.project_id as string,
            assignedBy: r.assigned_by as string, assigneeId: r.assignee_id as string,
            dueDate: r.due_date as string | undefined, note: r.note as string | undefined,
            readingStatus: r.reading_status as AssignmentReadingStatus | null,
            createdAt: r.created_at as string,
            statusHidden: (r.status_hidden as boolean | null) ?? false,
            aggDone: r.agg_done as number,
            aggTotal: r.agg_total as number,
          })));
        } else {
          // Fallback: direct query with client-side masking
          if (rpcErr) console.warn("[Assigned] RPC unavailable, falling back to direct query:", rpcErr.message);
          const { data } = await supabase.from("lit_assigned_readings").select("*").eq("item_id", item.id);
          if (data) setAssigned(data.map((r) => ({
            id: r.id as string, itemId: r.item_id as string, projectId: r.project_id as string,
            assignedBy: r.assigned_by as string, assigneeId: r.assignee_id as string,
            dueDate: r.due_date as string | undefined, note: r.note as string | undefined,
            readingStatus: (r.reading_status as AssignmentReadingStatus | null) ?? "not_started",
            createdAt: r.created_at as string,
            statusHidden: (r.status_hidden as boolean | null) ?? false,
          })));
        }
      })();
    }
  }, [tab, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addAnnotation(parentId?: string) {
    const comment = parentId ? replyText : newAnnotComment;
    const text    = parentId ? "" : newAnnotText;
    const color   = parentId ? undefined : newAnnotColor;
    if (!comment.trim()) return;
    setSavingAnnot(true);
    const now = new Date().toISOString();
    const newA: LitAnnotation = {
      id: crypto.randomUUID(), itemId: item.id, authorId: currentUserId,
      text, comment, parentId, createdAt: now, color,
    };
    const { error: insertErr } = await supabase.from("lit_annotations").insert({
      id: newA.id, item_id: item.id, author_id: currentUserId,
      text, comment, parent_id: parentId ?? null,
      ...(color ? { color } : {}),
    });
    if (insertErr) console.error("[Annotation insert]", insertErr);
    setAnnotations((prev) => [...prev, newA]);
    if (parentId) { setReplyText(""); setReplyingTo(null); }
    else { setNewAnnotText(""); setNewAnnotComment(""); setNewAnnotColor(undefined); }
    setSavingAnnot(false);
  }

  async function updateAnnotationColor(id: string, color: string | undefined) {
    await supabase.from("lit_annotations").update({ color: color ?? null }).eq("id", id);
    setAnnotations((prev) => prev.map((a) => a.id === id ? { ...a, color } : a));
  }

  async function deleteAnnotation(id: string) {
    const { error: delErr } = await supabase.from("lit_annotations").delete().eq("id", id);
    if (delErr) console.error("[Annotation delete]", delErr);
    setAnnotations((prev) => prev.filter((a) => a.id !== id && a.parentId !== id));
  }

  async function fetchRecs() {
    if (!item.doi && !item.title) return;
    setRecsLoading(true); setRecsError(""); setRecsFetched(true);
    try {
      const { data: { session: recsSession } } = await supabase.auth.getSession();
      const res = await fetch("/api/literature/recommendations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(recsSession?.access_token ? { Authorization: `Bearer ${recsSession.access_token}` } : {}),
        },
        body: JSON.stringify({ doi: item.doi, sourceItemId: item.id, projectId, title: stripHtml(item.title) }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { recommendations = [] } = await res.json() as {
        recommendations: Array<{
          title: string; authors: string[];
          year?: number; journal?: string; doi?: string; openAlexId: string;
        }>;
        fromCache?: boolean;
      };
      setRecs(recommendations.map((r) => ({
        id: crypto.randomUUID(), sourceItemId: item.id, projectId,
        title: r.title, authors: r.authors, year: r.year,
        journal: r.journal, doi: r.doi, openAlexId: r.openAlexId,
        cachedAt: new Date().toISOString(), dismissed: false,
      })));
    } catch (err) {
      setRecsError(err instanceof Error ? err.message : "Could not load suggestions.");
    } finally { setRecsLoading(false); }
  }

  function updateStatus(s: ReadStatus) {
    setLocalStatus(s);
    onUpdateItem(item.id, { status: s });
  }

  function updateRating(r: number) {
    setLocalRating(r);
    onUpdateItem(item.id, { rating: r });
  }

  function saveDoi() {
    const v = localDoi.trim();
    if (v && !/^10\.\d+\/.+/.test(v)) { setDoiError("Must start with 10. and contain a /"); return; }
    setDoiError(""); setEditingDoi(false);
    onUpdateItem(item.id, { doi: v || undefined });
  }

  function saveUrl() {
    const v = localUrl.trim();
    if (v) { try { new URL(v); } catch { setUrlError("Enter a valid URL (include https://)"); return; } }
    setUrlError(""); setEditingUrl(false);
    onUpdateItem(item.id, { url: v || undefined });
  }

  function saveVolume() {
    const v = localVolume.trim();
    setEditingVolume(false);
    onUpdateItem(item.id, { volume: v || undefined });
  }

  function savePages() {
    const v = localPages.trim();
    setEditingPages(false);
    onUpdateItem(item.id, { pages: v || undefined });
  }

  function handleCopy() {
    navigator.clipboard.writeText(formatCitation(item, citationStyle)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveNotes() {
    // Sync local state immediately via parent
    onUpdateItem(item.id, { notes });
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from("literature_items")
        .update({ notes })
        .eq("id", item.id);
      if (error) {
        console.error("[Literature] notes save failed:", error);
        return; // Don't show "Saved ✓" if DB rejected the write
      }
    }
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1500);
  }

  function handleAddTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const tag = tagInput.trim();
    if (!tag || localTags.includes(tag)) { setTagInput(""); return; }
    const updated = [...localTags, tag];
    // Re-adding a tag clears it from removed_tags so future syncs can restore it
    const updatedRemoved = (item.removedTags ?? []).filter((t) => t !== tag);
    setLocalTags(updated);
    onUpdateItem(item.id, { tags: updated, removedTags: updatedRemoved });
    setTagInput("");
  }

  function handleRemoveTag(tag: string) {
    const updatedTags = localTags.filter((t) => t !== tag);
    // Mark tag as explicitly removed so Zotero sync never restores it
    const updatedRemoved = [...new Set([...(item.removedTags ?? []), tag])];
    setLocalTags(updatedTags);
    onUpdateItem(item.id, { tags: updatedTags, removedTags: updatedRemoved });
  }

  async function handleFileFromSource(file: File) {
    const MAX_MB = 50;
    if (file.size > MAX_MB * 1024 * 1024) {
      setFilesError(`File is ${Math.round(file.size / 1024 / 1024)} MB - exceeds the ${MAX_MB} MB limit. Try compressing it first.`);
      return;
    }
    setFilesError("");
    setFileUploading(true);
    try {
      await handleFileUpload(file);
    } finally {
      setFileUploading(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await handleFileFromSource(file);
  }

  async function handleFileUpload(file: File) {
    // Duplicate name handling
    const duplicate = localFiles.find((f) => f.name === file.name);
    let finalFile = file;
    let baseList = localFiles;
    if (duplicate) {
      const replace = window.confirm(
        `"${file.name}" is already attached.\n\nOK → replace the existing file\nCancel → keep both (new file will be renamed)`
      );
      if (replace) {
        baseList = localFiles.filter((f) => f.name !== file.name);
        setLocalFiles(baseList);
        if (duplicate.storagePath && isSupabaseConfigured) {
          await supabase.storage.from("literature-files").remove([duplicate.storagePath]);
        }
      } else {
        const ext = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
        const base = file.name.slice(0, file.name.length - ext.length);
        let suffix = 2;
        while (localFiles.some((f) => f.name === `${base} (${suffix})${ext}`)) suffix++;
        finalFile = new File([file], `${base} (${suffix})${ext}`, { type: file.type });
      }
    }

    const fileId = crypto.randomUUID();
    let url = "";
    let storagePath: string | undefined;

    if (isSupabaseConfigured) {
      storagePath = `${projectId}/${item.id}/${fileId}-${finalFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("literature-files")
        .upload(storagePath, finalFile);
      if (uploadError) {
        console.error("[LitFiles] upload:", uploadError);
        setFilesError(`Upload failed: ${uploadError.message}`);
        return;
      }
      url = supabase.storage.from("literature-files").getPublicUrl(storagePath).data.publicUrl;
    }

    const newFile: LiteratureFile = {
      id: fileId, name: finalFile.name, size: finalFile.size,
      uploaderId: currentUserId, uploadedAt: new Date().toISOString(),
      ocrStatus: null, url, storagePath,
    };
    const updated = [...baseList, newFile];
    setLocalFiles(updated);
    onUpdateItem(item.id, { files: updated });
  }

  async function handleDeleteFile(id: string) {
    if (!window.confirm("Remove this file?")) return;
    const target = localFiles.find((f) => f.id === id);
    const updated = localFiles.filter((f) => f.id !== id);
    setLocalFiles(updated);
    onUpdateItem(item.id, { files: updated });
    if (target?.storagePath && isSupabaseConfigured) {
      const { error } = await supabase.storage.from("literature-files").remove([target.storagePath]);
      if (error) console.error("[LitFiles] delete from storage:", error);
    }
  }

  function handleFilesDragEnter(e: React.DragEvent) {
    e.preventDefault();
    filesDragCounterRef.current++;
    setFilesDragOver(true);
  }
  function handleFilesDragLeave(e: React.DragEvent) {
    e.preventDefault();
    filesDragCounterRef.current = Math.max(0, filesDragCounterRef.current - 1);
    if (filesDragCounterRef.current === 0) setFilesDragOver(false);
  }
  async function handleFilesDrop(e: React.DragEvent) {
    e.preventDefault();
    filesDragCounterRef.current = 0;
    setFilesDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFileFromSource(file);
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-surface)" }}>
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {TYPE_ICONS[item.type]}
              <StatusBadge status={localStatus} />
            </div>
            <p style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 13, color: "var(--color-body)", lineHeight: 1.4, margin: 0 }}>{stripHtml(item.title)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onDeleteItem && (
              <button
                onClick={() => { if (window.confirm("Remove this paper from the library?")) onDeleteItem(item.id); }}
                className="flex items-center justify-center rounded-lg"
                style={{ width: 36, height: 36, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer" }}
                aria-label="Delete paper"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-error)"; (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(192,57,43,0.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-secondary)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[var(--color-navy-dim)]" style={{ width: 44, height: 44 }} aria-label="Close"><X size={15} color="var(--color-secondary)" /></button>
          </div>
        </div>
      </div>

      <DetailTabBar tab={tab} setTab={setTab} />

      <div className="flex-1 overflow-y-auto">
        {tab === "Info" && (
          <div className="px-4 py-4 space-y-3">
            {[["Authors", toAuthorsArray(item.authors).join("; ") || "-"], ["Year", item.year > 0 ? String(item.year) : ""], ["Journal", item.journal ?? item.publisher ?? "-"], ["Type", item.type.charAt(0).toUpperCase() + item.type.slice(1)]].map(([label, value]) => (
              <div key={label}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 3 }}>{label}</p>
                <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.4, wordBreak: "break-word" }}>{value}</p>
              </div>
            ))}

            {/* Editable Volume */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 3 }}>Volume</p>
              {editingVolume ? (
                <div>
                  <input autoFocus value={localVolume} onChange={(e) => setLocalVolume(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveVolume(); if (e.key === "Escape") { setEditingVolume(false); setLocalVolume(item.volume ?? ""); } }}
                    placeholder="e.g. 42" style={{ width: "100%", height: 32, padding: "0 8px", fontSize: 12, border: "1px solid var(--color-navy)", borderRadius: 5, fontFamily: "var(--font-roboto)", outline: "none" }} />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button onClick={saveVolume} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                    <button onClick={() => { setEditingVolume(false); setLocalVolume(item.volume ?? ""); }} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--color-border)", backgroundColor: "transparent", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center gap-1">
                  <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.4, flex: 1 }}>{item.volume ?? "-"}</p>
                  <button onClick={() => setEditingVolume(true)} aria-label="Edit Volume"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--color-secondary)" }}>
                    <Pencil size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Editable Pages */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 3 }}>Pages</p>
              {editingPages ? (
                <div>
                  <input autoFocus value={localPages} onChange={(e) => setLocalPages(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePages(); if (e.key === "Escape") { setEditingPages(false); setLocalPages(item.pages ?? ""); } }}
                    placeholder="e.g. 123-145" style={{ width: "100%", height: 32, padding: "0 8px", fontSize: 12, border: "1px solid var(--color-navy)", borderRadius: 5, fontFamily: "var(--font-roboto)", outline: "none" }} />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button onClick={savePages} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                    <button onClick={() => { setEditingPages(false); setLocalPages(item.pages ?? ""); }} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--color-border)", backgroundColor: "transparent", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center gap-1">
                  <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.4, flex: 1 }}>{item.pages ?? "-"}</p>
                  <button onClick={() => setEditingPages(true)} aria-label="Edit Pages"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--color-secondary)" }}>
                    <Pencil size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Editable DOI */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 3 }}>DOI</p>
              {editingDoi ? (
                <div>
                  <input autoFocus value={localDoi} onChange={(e) => { setLocalDoi(e.target.value); setDoiError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") saveDoi(); if (e.key === "Escape") { setEditingDoi(false); setLocalDoi(item.doi ?? ""); setDoiError(""); } }}
                    placeholder="10.xxxx/yyyy" style={{ width: "100%", height: 32, padding: "0 8px", fontSize: 12, border: `1px solid ${doiError ? "var(--color-error,#C0392B)" : "var(--color-navy)"}`, borderRadius: 5, fontFamily: "var(--font-roboto)", outline: "none" }} />
                  {doiError && <p style={{ fontSize: 11, color: "var(--color-error,#C0392B)", marginTop: 2 }}>{doiError}</p>}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button onClick={saveDoi} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                    <button onClick={() => { setEditingDoi(false); setLocalDoi(item.doi ?? ""); setDoiError(""); }} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--color-border)", backgroundColor: "transparent", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center gap-1">
                  <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.4, wordBreak: "break-word", flex: 1 }}>{item.doi ?? "-"}</p>
                  <button onClick={() => setEditingDoi(true)} aria-label="Edit DOI"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--color-secondary)" }}>
                    <Pencil size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Editable URL */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 3 }}>URL</p>
              {editingUrl ? (
                <div>
                  <input autoFocus value={localUrl} onChange={(e) => { setLocalUrl(e.target.value); setUrlError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") saveUrl(); if (e.key === "Escape") { setEditingUrl(false); setLocalUrl(item.url ?? ""); setUrlError(""); } }}
                    placeholder="https://..." style={{ width: "100%", height: 32, padding: "0 8px", fontSize: 12, border: `1px solid ${urlError ? "var(--color-error,#C0392B)" : "var(--color-navy)"}`, borderRadius: 5, fontFamily: "var(--font-roboto)", outline: "none" }} />
                  {urlError && <p style={{ fontSize: 11, color: "var(--color-error,#C0392B)", marginTop: 2 }}>{urlError}</p>}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button onClick={saveUrl} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                    <button onClick={() => { setEditingUrl(false); setLocalUrl(item.url ?? ""); setUrlError(""); }} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--color-border)", backgroundColor: "transparent", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center gap-1">
                  <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.4, wordBreak: "break-all", flex: 1 }}>{item.url ?? "-"}</p>
                  <button onClick={() => setEditingUrl(true)} aria-label="Edit URL"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--color-secondary)" }}>
                    <Pencil size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Status toggle */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 6 }}>Status</p>
              <div className="flex gap-1.5">
                {(["unread", "reading", "read"] as ReadStatus[]).map((s) => (
                  <button key={s} onClick={() => updateStatus(s)}
                    style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: `1px solid ${localStatus === s ? STATUS_CONFIG[s].color : "var(--color-border)"}`, backgroundColor: localStatus === s ? STATUS_CONFIG[s].bg : "transparent", color: localStatus === s ? STATUS_CONFIG[s].color : "var(--color-secondary)", cursor: "pointer", minHeight: 36 }}>
                    {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Star rating */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 6 }}>Rating</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} onClick={() => updateRating(star)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", lineHeight: 1 }}
                    aria-label={`Rate ${star} stars`}
                  >
                    <Star size={18} color={star <= localRating ? "#A0622A" : "var(--color-border)"} fill={star <= localRating ? "#A0622A" : "none"} />
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              // Any attached file with a URL counts - extension check silently fails for
              // some Zotero-synced filenames that lack a .pdf suffix in the stored name.
              const uploadedPdf = localFiles.find((f) => f.url);
              const isDirectPdfUrl = item.url && (() => {
                try { return new URL(item.url!).pathname.toLowerCase().endsWith(".pdf"); } catch { return false; }
              })();
              const hasPdf = !!uploadedPdf || !!isDirectPdfUrl;
              return (
                <>
                  <div className="flex gap-2 pt-2">
                    {/* PDF button - always present regardless of DOI/URL */}
                    {hasPdf ? (
                      uploadedPdf ? (
                        <button
                          onClick={() => { setPdfViewerInitialPage(1); setShowPDFViewer(true); }}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                          style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 7, cursor: "pointer", minHeight: 44 }}
                        >
                          <FileText size={13} /> View PDF
                        </button>
                      ) : (
                        <button
                          onClick={() => { setPdfViewerExternalUrl(item.url!); setPdfViewerInitialPage(1); setShowPDFViewer(true); }}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                          style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 7, cursor: "pointer", minHeight: 44 }}
                        >
                          <FileText size={13} /> Open PDF
                        </button>
                      )
                    ) : item.zoteroKey ? (
                      <div
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ backgroundColor: "var(--color-canvas)", color: "var(--color-secondary)", fontSize: 12, fontWeight: 500, border: "1px solid var(--color-border)", borderRadius: 7, minHeight: 44 }}
                        title="No PDF stored in Zotero for this item - link-only or no attachment"
                      >
                        <FileText size={13} /> No PDF in Zotero
                      </div>
                    ) : (
                      <button
                        onClick={() => setTab("Files")}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ backgroundColor: "var(--color-canvas)", color: "var(--color-secondary)", fontSize: 12, fontWeight: 600, border: "1px dashed var(--color-border)", borderRadius: 7, cursor: "pointer", minHeight: 44 }}
                        title="No PDF attached - click to open the Files tab and upload one"
                      >
                        <FileText size={13} /> Attach PDF
                      </button>
                    )}
                    {/* DOI/URL button - independent of PDF state; both can show simultaneously */}
                    {item.doi && (
                      <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ backgroundColor: "transparent", color: "var(--color-navy)", fontSize: 12, fontWeight: 700, border: "1px solid var(--color-navy)", borderRadius: 7, cursor: "pointer", minHeight: 44, textDecoration: "none" }}>
                        <ExternalLink size={13} /> Open via DOI
                      </a>
                    )}
                    {item.url && !isDirectPdfUrl && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ backgroundColor: "transparent", color: "var(--color-navy)", fontSize: 12, fontWeight: 700, border: "1px solid var(--color-navy)", borderRadius: 7, cursor: "pointer", minHeight: 44, textDecoration: "none" }}>
                        <ExternalLink size={13} /> Open URL
                      </a>
                    )}
                  </div>
                  {!hasPdf && !item.doi && !item.url && (
                    <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 6 }}>No DOI, URL, or file attached yet.</p>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {tab === "Abstract" && (
          <div className="px-4 py-4">
            {item.abstract
              ? <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.75 }}>
                  <CitationLinker
                    text={item.abstract}
                    items={allItems}
                    onSelectItem={(id) => onNavigateToItem?.(id)}
                  />
                </p>
              : <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No abstract available.</p>}
          </div>
        )}

        {tab === "Notes" && (
          <div className="px-4 py-4 flex flex-col gap-3">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add your notes here..."
              style={{ width: "100%", minHeight: 180, fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)", lineHeight: 1.6, border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", resize: "vertical", backgroundColor: "var(--color-canvas)", outline: "none" }} />
            <button onClick={handleSaveNotes}
              style={{ alignSelf: "flex-end", fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 7, backgroundColor: notesSaved ? "var(--color-success)" : "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", minHeight: 44, transition: "background-color 0.2s" }}>
              {notesSaved ? "Saved ✓" : "Save notes"}
            </button>
          </div>
        )}

        {tab === "Tags" && (
          <div className="px-4 py-4">
            <div className="flex flex-wrap gap-2 mb-4">
              {localTags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1" style={{ border: "1px solid var(--color-navy)", borderRadius: 6, fontSize: 12, color: "var(--color-navy)", backgroundColor: "rgba(27,46,75,0.04)" }}>
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} aria-label={`Remove ${tag}`} style={{ display: "flex", cursor: "pointer", background: "none", border: "none", padding: 0 }}>
                    <X size={11} color="var(--color-navy)" />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder="Add tag and press Enter"
              style={{ width: "100%", height: 36, paddingLeft: 10, border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-roboto)", outline: "none" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>
        )}

        {tab === "Files" && (
          <div className="px-4 py-4">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
            {localFiles.length > 0 && (
              <div className="space-y-2 mb-4">
                {localFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                    <FileText size={14} color="#C0392B" />
                    <div className="flex-1 min-w-0">
                      {file.url ? (
                        <button
                          onClick={() => { setPdfViewerInitialPage(1); setShowPDFViewer(true); }}
                          style={{ fontSize: 12, fontWeight: 500, color: "var(--color-navy)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", textDecoration: "underline", textDecorationStyle: "dotted" }}
                          title="Open in PDF viewer"
                        >
                          {file.name}
                        </button>
                      ) : (
                        <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-body)" }}>{file.name}</p>
                      )}
                      <p style={{ fontSize: 10, color: "var(--color-secondary)" }}>
                        {formatFileSize(file.size)}
                        {file.ocrStatus === "ready" && <span style={{ marginLeft: 6, color: "var(--color-success)" }}>✓ Searchable</span>}
                      </p>
                    </div>
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center rounded hover:bg-[var(--color-navy-dim)]"
                        style={{ width: 36, height: 36 }} title="Open / download" aria-label="Open file">
                        <Download size={12} color="var(--color-navy)" />
                      </a>
                    ) : (
                      <span className="flex items-center justify-center" style={{ width: 36, height: 36, opacity: 0.3 }}>
                        <Download size={12} color="var(--color-secondary)" />
                      </span>
                    )}
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      className="flex items-center justify-center rounded"
                      style={{ width: 32, height: 32, background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)" }}
                      aria-label="Remove file"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-error)"; (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(192,57,43,0.08)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-secondary)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {localFiles.length === 0 && !fileUploading && (
              item.zoteroKey ? (
                <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 12 }}>
                  No PDF stored in Zotero - link only or no attachment.
                </p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 12 }}>No files attached.</p>
              )
            )}
            {filesError && (
              <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 8, padding: "6px 8px", backgroundColor: "rgba(192,57,43,0.06)", borderRadius: 6 }}>
                {filesError}
              </p>
            )}
            <div
              onClick={() => { if (!fileUploading) fileInputRef.current?.click(); }}
              onDragEnter={handleFilesDragEnter}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={handleFilesDragLeave}
              onDrop={handleFilesDrop}
              className="flex flex-col items-center justify-center gap-2 py-6 cursor-pointer transition-colors"
              style={{
                border: `2px dashed ${filesDragOver ? "var(--color-navy)" : "var(--color-border)"}`,
                borderRadius: 8,
                backgroundColor: filesDragOver ? "rgba(27,46,75,0.04)" : "transparent",
                cursor: fileUploading ? "default" : "pointer",
                transition: "border-color 0.12s, background-color 0.12s",
              }}
            >
              {fileUploading ? (
                <>
                  <RefreshCw size={18} color="var(--color-navy)" style={{ animation: "spin 1s linear infinite" }} />
                  <p style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600 }}>Uploading…</p>
                </>
              ) : (
                <>
                  <FileIcon size={18} color={filesDragOver ? "var(--color-navy)" : "var(--color-secondary)"} />
                  <p style={{ fontSize: 12, color: filesDragOver ? "var(--color-navy)" : "var(--color-secondary)" }}>
                    {filesDragOver ? "Drop to attach" : "Drop a file or click to upload"}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "Cite" && (
          <div className="px-4 py-4">
            <div className="flex gap-1.5 mb-4">
              {(["apa", "mla", "chicago"] as const).map((s) => (
                <button key={s} onClick={() => setCitationStyle(s)}
                  style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: `1px solid ${citationStyle === s ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: citationStyle === s ? "var(--color-navy)" : "transparent", color: citationStyle === s ? "#fff" : "var(--color-secondary)", cursor: "pointer", textTransform: "uppercase", minHeight: 36 }}>
                  {s}
                </button>
              ))}
            </div>
            <div className="px-3 py-3 mb-3" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-body)", lineHeight: 1.65 }}>
              {formatCitation(item, citationStyle)}
            </div>
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ fontSize: 12, fontWeight: 600, backgroundColor: copied ? "var(--color-success)" : "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", minHeight: 44, transition: "background-color 0.2s" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied!" : "Copy citation"}
            </button>
            <div className="flex gap-2 mt-3">
              {["BibTeX", "RIS", "EndNote"].map((fmt) => (
                <button key={fmt} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--color-border)", backgroundColor: "transparent", color: "var(--color-secondary)", cursor: "pointer", minHeight: 36 }}>{fmt}</button>
              ))}
            </div>
          </div>
        )}

        {tab === "Related" && (
          <div className="px-4 py-4">
            {item.relatedIds.length === 0
              ? <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No related items linked.</p>
              : (
                <div className="space-y-2 mb-4">
                  {item.relatedIds.map((id) => {
                    const rel = allItems.find((i) => i.id === id);
                    if (!rel) return null;
                    return (
                      <button key={id} className="w-full text-left flex items-start gap-2 px-3 py-2.5 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 8, minHeight: 44 }}>
                        {TYPE_ICONS[rel.type]}
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.35 }}>{(() => { const t = stripHtml(rel.title); return t.length > 60 ? t.slice(0, 60) + "…" : t; })()}</p>
                          <div className="flex items-center gap-2 mt-1"><span style={{ fontSize: 10, color: "var(--color-secondary)" }}>{rel.year}</span><StatusBadge status={rel.status} /></div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            <button style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy)", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 14px", cursor: "pointer", minHeight: 44 }}>
              + Link a related item
            </button>

            {/* AI Suggestions */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)" }}>AI Suggestions</p>
                {!recsFetched && (
                  <button onClick={fetchRecs} disabled={recsLoading}
                    className="flex items-center gap-1.5"
                    style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)", backgroundColor: "rgba(27,46,75,0.06)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", minHeight: 30 }}>
                    <Zap size={11} /> Find similar papers
                  </button>
                )}
                {recsFetched && !recsLoading && (
                  <button onClick={() => { setRecsFetched(false); setRecs([]); fetchRecs(); }} style={{ fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                    <RefreshCw size={11} /> Refresh
                  </button>
                )}
              </div>
              {!item.doi && !recsFetched && (
                <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>
                  Works best with a DOI - results come from OpenAlex related-works when available, then title search.
                </p>
              )}
              {recsLoading && <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>Fetching suggestions from OpenAlex…</p>}
              {recsError && <p style={{ fontSize: 12, color: "var(--color-error)" }}>{recsError}</p>}
              {recs.filter((r) => !r.dismissed).map((rec) => (
                <div key={rec.id} className="flex items-start gap-2 px-3 py-2.5 mb-2 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.35, marginBottom: 2 }}>{rec.title.length > 70 ? rec.title.slice(0, 70) + "…" : rec.title}</p>
                    <p style={{ fontSize: 11, color: "var(--color-secondary)" }}>{rec.authors.join(", ")}{rec.year ? ` · ${rec.year}` : ""}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={async () => {
                      const newItem: LiteratureItem = {
                        id: crypto.randomUUID(), projectId, scope: item.scope,
                        type: "article", title: rec.title, authors: rec.authors,
                        year: rec.year ?? 0, journal: rec.journal, doi: rec.doi,
                        tags: [], removedTags: [], status: "unread", rating: 0, notes: "",
                        files: [], collections: [], relatedIds: [],
                        addedById: currentUserId, addedAt: new Date().toISOString(),
                      };
                      const { error: e } = await supabase.from("literature_items").insert(
                        buildLitInsert(projectId, currentUserId, {
                          id: newItem.id, library: item.scope, type: "article", title: rec.title,
                          authors: rec.authors, year: rec.year || null,
                          journal: rec.journal ?? null, doi: rec.doi ?? null,
                          tags: [], status: "unread",
                          sub_project_id: item.scope === "project" ? subProjectId : null,
                        })
                      );
                      if (e) { console.error("[Rec add]", e.code, e.message, e.details); setRecsError(`Failed to add: ${e.message}`); return; }
                      onAddItem(newItem);
                      setRecs((prev) => prev.map((r) => r.id === rec.id ? { ...r, dismissed: true } : r));
                    }} style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", minHeight: 28, whiteSpace: "nowrap" }}>+ Add</button>
                    <button onClick={() => setRecs((prev) => prev.map((r) => r.id === rec.id ? { ...r, dismissed: true } : r))}
                      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", padding: 2 }} aria-label="Dismiss">
                      <X size={12} color="var(--color-secondary)" />
                    </button>
                  </div>
                </div>
              ))}
              {recsFetched && !recsLoading && recs.filter((r) => !r.dismissed).length === 0 && !recsError && (
                <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>No suggestions found for this paper.</p>
              )}
            </div>
          </div>
        )}

        {tab === "Annotations" && (
          <div className="px-4 py-4">
            {/* Add annotation form */}
            <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
              <label style={labelStyle}>Quoted passage (optional)</label>
              <textarea value={newAnnotText} onChange={(e) => setNewAnnotText(e.target.value)} placeholder="Paste a quote from the paper…"
                style={{ width: "100%", minHeight: 60, fontSize: 12, fontFamily: "var(--font-roboto)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 10px", resize: "none", outline: "none", boxSizing: "border-box", backgroundColor: "var(--color-surface)", color: "var(--color-body)", marginBottom: 8 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
              <label style={labelStyle}>Comment *</label>
              <textarea value={newAnnotComment} onChange={(e) => setNewAnnotComment(e.target.value)} placeholder="Add your comment…"
                style={{ width: "100%", minHeight: 60, fontSize: 12, fontFamily: "var(--font-roboto)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 10px", resize: "none", outline: "none", boxSizing: "border-box", backgroundColor: "var(--color-surface)", color: "var(--color-body)", marginBottom: 8 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
              {/* Color tag picker */}
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>Tag:</span>
                {ANNOT_COLORS.map((c) => (
                  <button key={c.hex} title={c.label} onClick={() => setNewAnnotColor(newAnnotColor === c.hex ? undefined : c.hex)}
                    style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: c.hex, border: newAnnotColor === c.hex ? "2px solid var(--color-navy)" : "2px solid transparent", cursor: "pointer", outline: "none", flexShrink: 0 }} />
                ))}
                {newAnnotColor && (
                  <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
                    {ANNOT_COLORS.find((c) => c.hex === newAnnotColor)?.label}
                  </span>
                )}
              </div>
              <button onClick={() => addAnnotation()} disabled={!newAnnotComment.trim() || savingAnnot}
                style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 7, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", minHeight: 36, opacity: (!newAnnotComment.trim() || savingAnnot) ? 0.5 : 1 }}>
                <MessageSquare size={12} style={{ display: "inline", marginRight: 5 }} />{savingAnnot ? "Saving…" : "Add annotation"}
              </button>
            </div>

            {/* Annotation list */}
            {annotations.length === 0
              ? <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No annotations yet. Be the first to comment.</p>
              : annotations.filter((a) => !a.parentId).map((a) => (
                <div key={a.id} className="mb-3">
                  <div className="px-3 py-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: `1px solid ${a.color ?? "var(--color-border)"}`, borderLeft: a.color ? `3px solid ${a.color}` : "1px solid var(--color-border)" }}>
                    {/* Page badge for PDF-anchored annotations */}
                    {a.pageNumber != null && (
                      <button
                        onClick={() => { setPdfViewerInitialPage(a.pageNumber!); setShowPDFViewer(true); }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, backgroundColor: a.color ? `${a.color}22` : "rgba(27,46,75,0.07)", color: a.color ?? "var(--color-navy)", border: `1px solid ${a.color ?? "var(--color-navy)"}`, cursor: "pointer", marginBottom: 6 }}
                        title="Open PDF at this page"
                      >
                        <FileText size={9} /> p.{a.pageNumber}
                      </button>
                    )}
                    {a.text && (
                      <blockquote style={{ borderLeft: `3px solid ${a.color ?? "var(--color-navy)"}`, paddingLeft: 10, margin: "0 0 8px", fontSize: 12, color: "var(--color-secondary)", fontStyle: "italic", lineHeight: 1.5 }}>
                        {a.text}
                      </blockquote>
                    )}
                    <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.5, marginBottom: 6 }}>{a.comment}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>
                          {a.authorId === currentUserId ? "You" : (annotAuthors[a.authorId] ?? "Unknown")} · {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                        {/* Inline color tag change for annotation author */}
                        {a.authorId === currentUserId && (
                          <div className="flex items-center gap-1">
                            {ANNOT_COLORS.map((c) => (
                              <button key={c.hex} title={c.label} onClick={() => updateAnnotationColor(a.id, a.color === c.hex ? undefined : c.hex)}
                                style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: c.hex, border: a.color === c.hex ? "1.5px solid var(--color-navy)" : "1.5px solid transparent", cursor: "pointer", outline: "none" }} />
                            ))}
                          </div>
                        )}
                        {a.color && a.authorId !== currentUserId && (
                          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: a.color, display: "inline-block" }} />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setReplyingTo(replyingTo === a.id ? null : a.id)}
                          style={{ fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>Reply</button>
                        {a.authorId === currentUserId && (
                          <button onClick={() => deleteAnnotation(a.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }} aria-label="Delete">
                            <X size={11} color="var(--color-secondary)" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Replies */}
                  {annotations.filter((r) => r.parentId === a.id).map((reply) => (
                    <div key={reply.id} className="ml-4 mt-1.5 px-3 py-2.5 rounded-lg" style={{ backgroundColor: "rgba(27,46,75,0.03)", border: "1px solid var(--color-border)" }}>
                      <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.5, marginBottom: 4 }}>{reply.comment}</p>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>{reply.authorId === currentUserId ? "You" : (annotAuthors[reply.authorId] ?? reply.authorId.slice(0, 8))} · {new Date(reply.createdAt).toLocaleDateString()}</span>
                        {reply.authorId === currentUserId && (
                          <button onClick={() => deleteAnnotation(reply.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><X size={11} color="var(--color-secondary)" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Reply form */}
                  {replyingTo === a.id && (
                    <div className="ml-4 mt-1.5 flex gap-2">
                      <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Write a reply…"
                        style={{ flex: 1, height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 10px", fontSize: 12, fontFamily: "var(--font-roboto)", outline: "none" }}
                        onKeyDown={(e) => { if (e.key === "Enter") addAnnotation(a.id); }}
                        onFocus={(ex) => { ex.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={(ex) => { ex.currentTarget.style.borderColor = "var(--color-border)"; }} />
                      <button onClick={() => addAnnotation(a.id)} style={{ padding: "0 12px", height: 34, borderRadius: 6, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12 }}>↑</button>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
        )}

        {tab === "Assigned" && (() => {
          const STATUS_LABELS: Record<AssignmentReadingStatus, string> = {
            not_started: "Not started", in_progress: "In progress", done: "Done",
          };
          const STATUS_COLORS: Record<AssignmentReadingStatus, { color: string; bg: string }> = {
            not_started: { color: "#64748B", bg: "#F1F5F9" },
            in_progress: { color: "#A0622A", bg: "#FDEFD4" },
            done:        { color: "#2E7D52", bg: "#D4EDE0" },
          };
          // Server-computed aggregates include hidden entries; fall back to client count when RPC unavailable.
          const aggDone  = assigned[0]?.aggDone  ?? assigned.filter((a) => a.readingStatus === "done").length;
          const aggTotal = assigned[0]?.aggTotal ?? assigned.length;
          const progress = aggTotal > 0 ? Math.round((aggDone / aggTotal) * 100) : 0;

          return (
            <div className="px-4 py-4">
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>Team Assignments</p>

              {/* Progress summary */}
              {assigned.length > 0 && (
                <div className="mb-4 px-3 py-2.5 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)" }}>{aggDone} of {aggTotal} completed</span>
                    <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{progress}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, backgroundColor: "#2E7D52", borderRadius: 3, transition: "width 0.3s ease" }} />
                  </div>
                </div>
              )}

              {assigned.length === 0
                ? <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 16 }}>No one has been assigned this paper yet.</p>
                : (
                  <div className="space-y-2 mb-4">
                    {assigned.map((a) => {
                      // readingStatus is null when the server masked it (hidden peer row)
                      const sc = STATUS_COLORS[a.readingStatus ?? "not_started"];
                      const canSeeStatus = a.readingStatus !== null;
                      return (
                        <div key={a.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                          <UserCheck size={14} color="var(--color-navy)" style={{ marginTop: 2, flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", wordBreak: "break-all" }}>
                              {a.assigneeId === currentUserId ? "You" : (teamMembers.find((m) => m.id === a.assigneeId)?.name ?? a.assigneeId.slice(0, 8))}
                            </p>
                            {a.dueDate && <p style={{ fontSize: 11, color: "var(--color-secondary)" }}>Due {new Date(a.dueDate).toLocaleDateString()}</p>}
                            {a.note && <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>{a.note}</p>}
                            {/* Status - only the assignee can update; peers may see "-" if hidden */}
                            {a.assigneeId === currentUserId ? (
                              <div className="flex items-center gap-2 mt-1">
                                <select
                                  value={a.readingStatus ?? "not_started"}
                                  onChange={async (e) => {
                                    const newStatus = e.target.value as AssignmentReadingStatus;
                                    const { error: updErr } = await supabase
                                      .from("lit_assigned_readings")
                                      .update({ reading_status: newStatus })
                                      .eq("id", a.id);
                                    if (updErr) { console.error("[Update reading status]", updErr); return; }
                                    setAssigned((prev) => prev.map((x) => x.id === a.id ? { ...x, readingStatus: newStatus } : x));
                                  }}
                                  style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: `1px solid ${sc.color}`, backgroundColor: sc.bg, color: sc.color, cursor: "pointer", outline: "none" }}
                                >
                                  {(["not_started", "in_progress", "done"] as AssignmentReadingStatus[]).map((s) => (
                                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                  ))}
                                </select>
                                {/* Visibility toggle - only the assignee sees this */}
                                <button
                                  title={a.statusHidden ? "Status hidden from peers. Click to show." : "Status visible to peers. Click to hide."}
                                  onClick={async () => {
                                    const hidden = !a.statusHidden;
                                    await supabase.from("lit_assigned_readings").update({ status_hidden: hidden }).eq("id", a.id);
                                    setAssigned((prev) => prev.map((x) => x.id === a.id ? { ...x, statusHidden: hidden } : x));
                                  }}
                                  style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                                  aria-label={a.statusHidden ? "Show status to peers" : "Hide status from peers"}
                                >
                                  {a.statusHidden
                                    ? <EyeOff size={13} color="var(--color-secondary)" />
                                    : <Eye size={13} color="var(--color-secondary)" />}
                                </button>
                              </div>
                            ) : (
                              <span style={{ display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, backgroundColor: canSeeStatus ? sc.bg : "#F1F5F9", color: canSeeStatus ? sc.color : "#64748B" }}>
                                {canSeeStatus ? STATUS_LABELS[a.readingStatus!] : "-"}
                              </span>
                            )}
                          </div>
                          {(a.assignedBy === currentUserId || a.assigneeId === currentUserId) && (
                            <button
                              onClick={async () => {
                                const { error: delErr } = await supabase.from("lit_assigned_readings").delete().eq("id", a.id);
                                if (delErr) { console.error("[Remove assignment]", delErr); return; }
                                setAssigned((prev) => prev.filter((x) => x.id !== a.id));
                              }}
                              style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
                              title="Remove assignment" aria-label="Remove assignment"
                            >
                              <X size={13} color="var(--color-secondary)" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              <AssignReadingForm itemId={item.id} projectId={projectId} assignedBy={currentUserId}
                teamMembers={teamMembers}
                onAssigned={(a) => {
                  setAssigned((prev) => [...prev, a]);
                  // Fire email notification - best-effort, non-blocking
                  const assignerName = teamMembers.find((m) => m.id === currentUserId)?.name ?? "A teammate";
                  fetch("/api/email/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      type: "reading_assigned",
                      recipientId: a.assigneeId,
                      payload: { paperTitle: item.title, assignerName },
                    }),
                  }).catch((e) => console.warn("[email] reading_assigned:", e));
                }} />
            </div>
          );
        })()}
      </div>

      {/* PDF Viewer overlay - position: fixed, renders above everything */}
      {showPDFViewer && (() => {
        const pdfFile = localFiles.find((f) => f.url);
        // Prefer an uploaded/stored file; fall back to external PDF URL for direct-.pdf links.
        const viewerUrl = pdfFile?.url ?? pdfViewerExternalUrl;
        if (!viewerUrl) { setShowPDFViewer(false); return null; }
        return (
          <PDFViewer
            url={viewerUrl}
            itemId={item.id}
            currentUserId={currentUserId}
            annotations={annotations}
            onAnnotationAdded={(a) => setAnnotations((prev) => [...prev, a])}
            onClose={() => { setShowPDFViewer(false); setPdfViewerExternalUrl(null); }}
            initialPage={pdfViewerInitialPage}
            openTabUrl={pdfFile?.url ? undefined : (pdfViewerExternalUrl ?? undefined)}
          />
        );
      })()}
    </div>
  );
}

// ── Row mapper (shared between main fetch and trash fetch) ────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLitRow(row: Record<string, any>): LiteratureItem {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    scope: ((row.library ?? row.scope ?? "lab") as LiteratureItem["scope"]),
    subProjectId: (row.sub_project_id as string | null | undefined) ?? undefined,
    type: (row.type as LiteratureItem["type"]) ?? "article",
    title: row.title as string,
    authors: toAuthorsArray(row.authors as string | string[]),
    year: (row.year as number | null) ?? 0,
    journal: (row.journal as string | null) ?? undefined,
    volume: (row.volume as string | null) ?? undefined,
    pages: (row.pages as string | null) ?? undefined,
    doi: (row.doi as string | null) ?? undefined,
    url: (row.url as string | null) ?? undefined,
    abstract: (row.abstract as string | null) ?? undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    removedTags: Array.isArray(row.removed_tags) ? (row.removed_tags as string[]) : [],
    status: (row.status as LiteratureItem["status"]) ?? "unread",
    rating: (row.rating as number | null) ?? 0,
    notes: (row.notes as string | null) ?? "",
    files: Array.isArray(row.files) ? (row.files as LiteratureFile[]) : [],
    addedById: (row.user_id ?? row.added_by) as string,
    addedAt: (row.created_at ?? row.added_at) as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
    collections: [],
    relatedIds: [],
    zoteroKey: (row.zotero_key as string | null) ?? undefined,
  };
}

// ── Literature page ───────────────────────────────────────────────────────────

export default function LiteraturePage() {
  const { show: showUndoToast } = useUndoToast();
  const { subProjectId, subProjects, activeScope } = useProject();
  const [items, setItems]               = useState<LiteratureItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [scope, setScope]               = useState<LitScope>("all");
  const [selectedSubProjectId, setSelectedSubProjectId] = useState<string | null>(null);
  const isLabHome = activeScope === "lab";
  const effectiveLitScope: LitScope = isLabHome ? scope : (activeScope === "project" ? "project" : "personal");
  const effectiveLitSubProjectId: string | null = isLabHome
    ? (scope === "project" ? selectedSubProjectId : null)
    : (activeScope === "project" ? (subProjectId ?? null) : null);
  const [activeCollection, setActiveCollection] = useState("lc0");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<ReadStatus | "all">("all");
  const [activeTag, setActiveTag]       = useState<string | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try { return localStorage.getItem("literature_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [isMobile, setIsMobile]         = useState(false);
  const [addItemOpen, setAddItemOpen]       = useState(false);
  const [zoteroImportOpen, setZoteroImportOpen] = useState(false);
  const [doiLookupOpen, setDoiLookupOpen]   = useState(false);
  const [projectId, setProjectId]           = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [teamMembers, setTeamMembers]     = useState<User[]>([]);
  const [typeFilter, setTypeFilter]     = useState<LiteratureType | "all">("all");
  const [yearFilter, setYearFilter]     = useState<number | "all">("all");
  const [yearSort, setYearSort]         = useState<"desc" | "asc">("desc");
  const [showReadingProgress, setShowReadingProgress] = useState(false);
  const [selectMode, setSelectMode]     = useState(false);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [showTrash, setShowTrash]       = useState(false);
  const [trashItems, setTrashItems]     = useState<LiteratureItem[]>([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [myAssignedItemIds, setMyAssignedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null;
      if (!user) { setLoadingItems(false); return; }
      setCurrentUserId(user.id);
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("project_id")
        .eq("id", user.id)
        .maybeSingle();
      const projectId = profile?.project_id as string | undefined;
      if (!projectId) { setLoadingItems(false); return; }
      setProjectId(projectId);

      // Fetch team members for the assignee picker
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("team_members")
        .select("*, user_profiles(name, avatar_initials, avatar_color, avatar_url, role)")
        .eq("project_id", projectId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(({ data: members }) => {
          if (members) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setTeamMembers((members as any[]).map((row) => {
              const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
              const id = row.user_id as string;
              let hash = 0;
              for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
              return {
                id, name: p?.name ?? "Team Member", email: "",
                role: (p?.role ?? "researcher") as UserRole,
                avatarColor: p?.avatar_color ?? `hsl(${hash % 360}, 55%, 80%)`,
                avatarInitials: p?.avatar_initials ?? "??",
                avatarUrl: p?.avatar_url ?? undefined,
              } as User;
            }));
          }
        });

      // Fetch items assigned to the current user so they appear in personal scope
      supabase
        .from("lit_assigned_readings")
        .select("item_id")
        .eq("project_id", projectId)
        .eq("assignee_id", user.id)
        .then(({ data: assignedRows }) => {
          if (assignedRows) {
            setMyAssignedItemIds(new Set(assignedRows.map((r) => r.item_id as string)));
          }
        });

      supabase
        .from("literature_items")
        .select("*")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .then(({ data, error: fetchError }) => {
          if (fetchError) console.error("[Literature] fetch error:", fetchError);
          if (data) setItems(data.map(mapLitRow));
          setLoadingItems(false);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep myAssignedItemIds in sync in real-time so newly assigned documents appear
  // in the assignee's personal library without requiring a page reload.
  useEffect(() => {
    if (!currentUserId || !projectId || !isSupabaseConfigured) return;
    const channel = supabase
      .channel(`lit_assigned_readings:${projectId}:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lit_assigned_readings", filter: `assignee_id=eq.${currentUserId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const itemId = (payload.new as { item_id: string }).item_id;
            setMyAssignedItemIds((prev) => new Set([...prev, itemId]));
          } else if (payload.eventType === "DELETE") {
            const itemId = (payload.old as { item_id: string }).item_id;
            setMyAssignedItemIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId, projectId]);

  useEffect(() => {
    if (collectionsOpen) { document.body.style.overflow = "hidden"; }
    else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [collectionsOpen]);

  // Clear the detail panel whenever the lab/project scope changes so a previously
  // selected item from another scope doesn't remain visible with 0 matching items.
  useEffect(() => {
    setSelectedItemId(null);
  }, [effectiveLitScope, effectiveLitSubProjectId]);

  // Derive selectedItem from items so updates are atomic - no two-render flicker
  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  function updateItem(id: string, updates: Partial<LiteratureItem>) {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...updates } : item));
    if (!isSupabaseConfigured) return;
    const colMap: Record<string, string> = { tags: "tags", removedTags: "removed_tags", status: "status", rating: "rating", files: "files", doi: "doi", url: "url", volume: "volume", pages: "pages" };
    // notes is handled exclusively by handleSaveNotes (async, with proper error feedback)
    const nullableCols = new Set(["doi", "url"]);
    const payload: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(colMap)) {
      if (k in updates) {
        const v = (updates as Record<string, unknown>)[k];
        payload[col] = nullableCols.has(k) ? (v ?? null) : v;
      }
    }
    if (Object.keys(payload).length > 0) {
      supabase.from("literature_items").update(payload).eq("id", id)
        .then(({ error }) => { if (error) console.error("[Literature] update:", error); });
    }
  }

  function deleteItem(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedItemId(null);
    showUndoToast(
      `"${item.title}" removed`,
      () => setItems((prev) => [{ ...item, deletedAt: null }, ...prev]),
      async () => {
        if (!isSupabaseConfigured) return;
        const { error } = await supabase.from("literature_items")
          .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId || null })
          .eq("id", id);
        if (error) console.error("[Literature] soft-delete:", error);
      },
    );
  }

  async function deleteBulk(ids: string[]) {
    setItems((prev) => prev.filter((item) => !ids.includes(item.id)));
    setSelectedItemId(null);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("literature_items")
        .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId || null })
        .in("id", ids);
      if (error) console.error("[Literature] bulk soft-delete:", error);
    }
  }

  async function restoreItem(id: string) {
    const restored = trashItems.find((i) => i.id === id);
    setTrashItems((prev) => prev.filter((i) => i.id !== id));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("literature_items")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", id);
      if (error) { console.error("[Literature] restore:", error); return; }
    }
    if (restored) setItems((prev) => [{ ...restored, deletedAt: null }, ...prev]);
  }

  async function restoreBulk(ids: string[]) {
    const toRestore = trashItems.filter((i) => ids.includes(i.id));
    setTrashItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    setSelectedIds(new Set());
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("literature_items")
        .update({ deleted_at: null, deleted_by: null })
        .in("id", ids);
      if (error) { console.error("[Literature] bulk restore:", error); return; }
    }
    setItems((prev) => [...toRestore.map((i) => ({ ...i, deletedAt: null })), ...prev]);
  }

  async function openTrash() {
    setShowTrash(true);
    setShowReadingProgress(false);
    setSelectedItemId(null);
    setSelectMode(false);
    setSelectedIds(new Set());
    if (!isSupabaseConfigured || !projectId) return;
    setLoadingTrash(true);
    const { data, error } = await supabase.from("literature_items")
      .select("*")
      .eq("project_id", projectId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) console.error("[Literature] trash fetch:", error);
    if (data) setTrashItems(data.map(mapLitRow));
    setLoadingTrash(false);
  }

  function closeTrash() {
    setShowTrash(false);
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function addItem(item: LiteratureItem) {
    setItems((prev) => [item, ...prev]);
    setAddItemOpen(false);
  }

  function importItems(newItems: LiteratureItem[]) {
    setItems((prev) => [...newItems, ...prev]);
    setZoteroImportOpen(false);
  }

  function addItemFromDOI(item: LiteratureItem) {
    setItems((prev) => [item, ...prev]);
    setDoiLookupOpen(false);
  }

  const scopedItems = items.filter((item) => {
    if (effectiveLitScope === "all") return true;
    if (effectiveLitScope === "personal") {
      // Assigned items (from any scope) always appear in the assignee's personal view
      if (myAssignedItemIds.has(item.id)) return true;
      if (!item.scope || item.scope !== "personal") return false;
      if (effectiveLitSubProjectId === "__general__") return !(item as LiteratureItem & { subProjectId?: string }).subProjectId;
      if (effectiveLitSubProjectId) return (item as LiteratureItem & { subProjectId?: string }).subProjectId === effectiveLitSubProjectId;
      return true;
    }
    if (effectiveLitScope === "project") return item.scope === "project" && (!effectiveLitSubProjectId || (item as LiteratureItem & { subProjectId?: string }).subProjectId === effectiveLitSubProjectId);
    return item.scope === "lab";
  });

  // Extract year from DOI as a fallback for items with missing year metadata.
  // Handles common patterns like 10.1080/19331681.2025.2501027 where the year is
  // embedded as a 4-digit segment after the publisher prefix.
  function itemEffectiveYear(i: LiteratureItem): number {
    if (i.year > 0) return i.year;
    if (i.doi) {
      const m = i.doi.match(/\b(20\d{2}|19\d{2})\b/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }
  const availableYears = [...new Set(scopedItems.map(itemEffectiveYear).filter(Boolean))].sort((a, b) => b - a);

  const filtered = scopedItems
    .filter((item) => {
      if (search && !item.title.toLowerCase().includes(search.toLowerCase()) &&
          !toAuthorsArray(item.authors).some((a) => a.toLowerCase().includes(search.toLowerCase()))) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (yearFilter !== "all" && itemEffectiveYear(item) !== yearFilter) return false;
      if (activeTag && !item.tags.includes(activeTag)) return false;
      if (activeCollection !== "lc0" && !item.collections.includes(activeCollection)) return false;
      return true;
    })
    .sort((a, b) => yearSort === "desc" ? b.year - a.year : a.year - b.year);

  const allTags = [...new Set(scopedItems.flatMap((i) => i.tags))].sort();
  const showingDetailMobile = isMobile && selectedItem !== null;
  const currentUserRole = (teamMembers.find((m) => m.id === currentUserId)?.role ?? "researcher") as UserRole;

  const listColumnRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(9999);
  useEffect(() => {
    const el = listColumnRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setListWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Hide Authors+Year when the list is too narrow to fit all fixed columns without squishing the title
  const narrowList = isMobile || listWidth < 380;

  const litBadgeName = !isLabHome && activeScope === "project"
    ? subProjects.find((sp) => sp.id === subProjectId)?.name ?? null
    : null;

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-roboto)" }}>

      <PageHeader
        title="Literature"
        badge={litBadgeName ? (
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", backgroundColor: "rgba(27,46,75,0.10)", color: "var(--color-navy)", padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {litBadgeName}
          </span>
        ) : undefined}
        action={
          <button
            onClick={() => setAddItemOpen(true)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", height: 36, padding: "0 14px" }}
          >
            <Plus size={13} />
            <span className="hidden sm:inline">Add Item</span>
          </button>
        }
      />

      <div className="flex flex-1 overflow-hidden">

      {collectionsOpen && (
        <div className="fixed inset-0 z-20" style={{ display: isMobile ? "block" : "none", backgroundColor: "rgba(0,0,0,0.3)" }} onClick={() => setCollectionsOpen(false)} aria-hidden="true" />
      )}

      {/* Left panel - collections sidebar with shared resize/collapse shell */}
      {!isMobile && (
        <ScopeSidebar
          sections={[{
            id: "library",
            label: "Library",
            color: "var(--color-navy)",
            icon: <Library size={17} />,
            isActive: true,
            onClick: () => setPanelCollapsed(false),
          }]}
          collapsed={panelCollapsed}
          onToggleCollapse={() => setPanelCollapsed(v => {
            const next = !v;
            try { localStorage.setItem("literature_sidebar_collapsed", String(next)); } catch { /* ignore */ }
            return next;
          })}
          storageKey="literature_sidebar"
          fullContent={panelCollapsed ? undefined : <CollectionsSidebar
              scope={scope} setScope={(s) => { setScope(s); setShowTrash(false); setSelectMode(false); setSelectedIds(new Set()); }}
              selectedSubProjectId={selectedSubProjectId} setSelectedSubProjectId={(id) => { setSelectedSubProjectId(id); setShowTrash(false); }}
              activeCollection={activeCollection} setActiveCollection={(id) => { setActiveCollection(id); setShowTrash(false); }}
              allTags={allTags} activeTag={activeTag} setActiveTag={(t) => { setActiveTag(t); setShowTrash(false); }}
              items={scopedItems} allItems={items} subProjects={subProjects} onAddItem={() => setAddItemOpen(true)}
              onCollapse={() => { setPanelCollapsed(true); try { localStorage.setItem("literature_sidebar_collapsed", "true"); } catch { /* ignore */ } }}
              onImportZotero={() => setZoteroImportOpen(true)}
              onAddByDOI={() => setDoiLookupOpen(true)}
              onReadingProgress={() => { setShowReadingProgress((v) => !v); setShowTrash(false); setSelectMode(false); setSelectedIds(new Set()); setSelectedItemId(null); }}
              showReadingProgress={showReadingProgress}
              showTrash={showTrash}
              setShowTrash={openTrash}
              showScopeFilter={isLabHome}
              projectBadge={!isLabHome && activeScope === "project" ? subProjects.find((sp) => sp.id === subProjectId)?.name : undefined}
            />
          }
        />
      )}

      {/* Mobile collections drawer */}
      <div className="fixed top-0 left-0 h-full z-30"
        style={{ display: isMobile ? "block" : "none", width: 260, transform: collectionsOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.22s ease-out", borderRight: "1px solid var(--color-border)", pointerEvents: collectionsOpen ? "auto" : "none" }}
        aria-hidden={!collectionsOpen}
      >
        <CollectionsSidebar
          scope={scope} setScope={(s) => { setScope(s); setShowTrash(false); setSelectMode(false); setSelectedIds(new Set()); setCollectionsOpen(false); }}
          selectedSubProjectId={selectedSubProjectId} setSelectedSubProjectId={(id) => { setSelectedSubProjectId(id); setShowTrash(false); setCollectionsOpen(false); }}
          activeCollection={activeCollection} setActiveCollection={(id) => { setActiveCollection(id); setShowTrash(false); setCollectionsOpen(false); }}
          allTags={allTags} activeTag={activeTag} setActiveTag={(t) => { setActiveTag(t); setShowTrash(false); setCollectionsOpen(false); }}
          items={scopedItems} allItems={items} showClose onClose={() => setCollectionsOpen(false)}
          onAddItem={() => { setAddItemOpen(true); setCollectionsOpen(false); }}
          onImportZotero={() => { setZoteroImportOpen(true); setCollectionsOpen(false); }}
          onAddByDOI={() => { setDoiLookupOpen(true); setCollectionsOpen(false); }}
          onReadingProgress={() => { setShowReadingProgress((v) => !v); setShowTrash(false); setSelectMode(false); setSelectedIds(new Set()); setSelectedItemId(null); setCollectionsOpen(false); }}
          showReadingProgress={showReadingProgress}
          showTrash={showTrash}
          setShowTrash={(v) => { if (v) { openTrash(); } else { closeTrash(); } setCollectionsOpen(false); }}
          showScopeFilter={isLabHome}
          projectBadge={!isLabHome && activeScope === "project" ? subProjects.find((sp) => sp.id === subProjectId)?.name : undefined}
        />
      </div>

      {/* Center list / reading progress dashboard / trash */}
      {!showingDetailMobile && (
        <div ref={listColumnRef} className="flex flex-col flex-1 min-w-0" style={{ minWidth: 240, overflow: "hidden", borderRight: selectedItem && !isMobile && !showReadingProgress && !showTrash ? "1px solid var(--color-border)" : undefined }}>
        {showReadingProgress ? (
          <ReadingProgressDashboard
            projectId={projectId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            teamMembers={teamMembers}
            scope={scope}
            selectedSubProjectId={selectedSubProjectId}
          />
        ) : showTrash ? (
          <>
            {/* Trash toolbar */}
            <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 flex-wrap" style={{ backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", minHeight: 52 }}>
              <button onClick={closeTrash} className="flex items-center gap-1.5 shrink-0"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 36 }}>
                <ChevronLeft size={14} /> Back
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", flex: 1 }}>Recently removed</span>
              {selectMode && selectedIds.size > 0 && (
                <button onClick={() => restoreBulk([...selectedIds])}
                  style={{ fontSize: 12, fontWeight: 600, color: "#2E7D52", border: "1px solid #2E7D52", borderRadius: 7, padding: "6px 12px", backgroundColor: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, minHeight: 36 }}>
                  <Undo2 size={13} /> Restore selected ({selectedIds.size})
                </button>
              )}
              {selectMode && (
                <button onClick={() => setSelectedIds(new Set(trashItems.map((i) => i.id)))}
                  style={{ fontSize: 12, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 36 }}>
                  Select all
                </button>
              )}
              <button onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                style={{ fontSize: 12, fontWeight: selectMode ? 600 : 400, color: selectMode ? "var(--color-navy)" : "var(--color-secondary)", border: `1px solid ${selectMode ? "var(--color-navy)" : "var(--color-border)"}`, borderRadius: 7, padding: "6px 10px", backgroundColor: selectMode ? "rgba(27,46,75,0.06)" : "transparent", cursor: "pointer", minHeight: 36 }}>
                {selectMode ? "Cancel" : "Select"}
              </button>
            </div>

            {/* Trash list */}
            <div className="flex-1 overflow-y-auto">
              {loadingTrash
                ? <div className="flex items-center justify-center h-40"><p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Loading…</p></div>
                : trashItems.length === 0
                ? <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                    <Trash2 size={40} color="var(--color-border)" />
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>Nothing removed</p>
                    <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>Items you delete will appear here and can be restored at any time.</p>
                  </div>
                : trashItems.map((item) => (
                    <div key={item.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderBottom: "1px solid var(--color-border)", minHeight: 48 }}
                    >
                      {selectMode && (
                        <input type="checkbox" checked={selectedIds.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            e.target.checked ? next.add(item.id) : next.delete(item.id);
                            setSelectedIds(next);
                          }}
                          style={{ flexShrink: 0, width: 16, height: 16, cursor: "pointer", accentColor: "var(--color-navy)" }}
                          aria-label={`Select ${item.title}`}
                        />
                      )}
                      <span style={{ flexShrink: 0, width: 24 }}>{TYPE_ICONS[item.type]}</span>
                      <span title={stripHtml(item.title)} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripHtml(item.title)}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, color: "var(--color-secondary)", whiteSpace: "nowrap", marginRight: 8 }}>
                        {item.deletedAt ? timeAgo(item.deletedAt) : ""}
                      </span>
                      <button onClick={() => restoreItem(item.id)}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#2E7D52", border: "1px solid #2E7D52", borderRadius: 6, padding: "4px 10px", backgroundColor: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                        <Undo2 size={12} /> Restore
                      </button>
                    </div>
                  ))}
            </div>
          </>
        ) : (<>
          {/* Normal list toolbar */}
          {selectMode ? (
            <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 flex-wrap" style={{ backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", minHeight: 52 }}>
              <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 36 }}>
                Cancel
              </button>
              {selectedIds.size > 0 && (
                <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{selectedIds.size} selected</span>
              )}
              <button onClick={() => setSelectedIds(new Set(filtered.map((i) => i.id)))}
                style={{ fontSize: 12, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 36 }}>
                Select all
              </button>
              {selectedIds.size > 0 && (
                <button onClick={() => setBulkDeleteConfirmOpen(true)}
                  style={{ fontSize: 12, fontWeight: 600, color: "#fff", backgroundColor: "#C0392B", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, minHeight: 36 }}>
                  <Trash2 size={13} /> Delete selected ({selectedIds.size})
                </button>
              )}
              <span style={{ fontSize: 11, color: "var(--color-secondary)", marginLeft: "auto", whiteSpace: "nowrap" }}>{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 flex-wrap" style={{ backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", minHeight: 52 }}>
              <button onClick={() => setCollectionsOpen(true)} className="flex items-center gap-1.5 shrink-0"
                style={{ display: isMobile ? "flex" : "none", fontSize: 12, fontWeight: 600, color: "var(--color-navy)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 44 }}>
                <ChevronLeft size={14} /> Collections
              </button>
              <div className="relative" style={{ minWidth: 0, flex: 1 }}>
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" color="var(--color-secondary)" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
                  style={{ width: "100%", paddingLeft: 30, paddingRight: 8, height: 36, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 12, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", outline: "none" }} />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReadStatus | "all")}
                style={{ height: 36, paddingLeft: 8, paddingRight: 8, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 12, fontFamily: "var(--font-roboto)", backgroundColor: statusFilter !== "all" ? "rgba(27,46,75,0.06)" : "var(--color-canvas)", color: "var(--color-body)", outline: "none", cursor: "pointer" }}>
                <option value="all">All Status</option>
                <option value="read">Read</option>
                <option value="reading">Reading</option>
                <option value="unread">Unread</option>
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as LiteratureType | "all")}
                style={{ height: 36, paddingLeft: 8, paddingRight: 8, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 12, fontFamily: "var(--font-roboto)", backgroundColor: typeFilter !== "all" ? "rgba(27,46,75,0.06)" : "var(--color-canvas)", color: "var(--color-body)", outline: "none", cursor: "pointer" }}>
                <option value="all">All Types</option>
                <option value="article">Article</option>
                <option value="book">Book</option>
                <option value="preprint">Preprint</option>
                <option value="report">Report</option>
                <option value="thesis">Thesis</option>
              </select>
              <div className="flex items-center gap-1">
                <select value={yearFilter === "all" ? "all" : String(yearFilter)} onChange={(e) => setYearFilter(e.target.value === "all" ? "all" : parseInt(e.target.value))}
                  style={{ height: 36, paddingLeft: 8, paddingRight: 8, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 12, fontFamily: "var(--font-roboto)", backgroundColor: yearFilter !== "all" ? "rgba(27,46,75,0.06)" : "var(--color-canvas)", color: "var(--color-body)", outline: "none", cursor: "pointer" }}>
                  <option value="all">All Years</option>
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <button
                  onClick={() => setYearSort((s) => s === "desc" ? "asc" : "desc")}
                  title={yearSort === "desc" ? "Oldest first" : "Newest first"}
                  style={{ height: 36, width: 36, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 13, backgroundColor: "var(--color-canvas)", color: "var(--color-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {yearSort === "desc" ? "↓" : "↑"}
                </button>
              </div>
              <button onClick={() => setSelectMode(true)} className="flex items-center gap-1 shrink-0"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 10px", backgroundColor: "transparent", cursor: "pointer", minHeight: 36, fontFamily: "var(--font-roboto)" }}>
                Select
              </button>
              {activeTag && (
                <span className="flex items-center gap-1.5 px-2.5 py-1" style={{ backgroundColor: "rgba(27,46,75,0.06)", border: "1px solid var(--color-navy)", borderRadius: 5, fontSize: 11, color: "var(--color-navy)" }}>
                  <Tag size={11} />{activeTag}
                  <button onClick={() => setActiveTag(null)} style={{ display: "flex" }}><X size={11} /></button>
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--color-secondary)", marginLeft: "auto", whiteSpace: "nowrap" }}>{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Column headers */}
          <div className="flex items-center px-4 py-2" style={{ display: isMobile ? "none" : "flex", gap: 8, backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
            {selectMode && <span style={{ flexShrink: 0, width: 24 }}>
              <input type="checkbox"
                checked={filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))}
                ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && !filtered.every((i) => selectedIds.has(i.id)); }}
                onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map((i) => i.id)) : new Set())}
                style={{ cursor: "pointer", accentColor: "var(--color-navy)" }}
                aria-label="Select all"
              />
            </span>}
            <span style={{ flexShrink: 0, width: 28 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--color-secondary)" }}>Title</span>
            {!narrowList && <span style={{ flexShrink: 0, width: 100, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--color-secondary)" }}>Authors</span>}
            {!narrowList && <span style={{ flexShrink: 0, width: 70, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--color-secondary)" }}>Year</span>}
            <span style={{ flexShrink: 0, width: 90, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--color-secondary)" }}>Status</span>
          </div>

          {/* Item rows */}
          <div className="flex-1 overflow-y-auto">
            {loadingItems
              ? <div className="flex items-center justify-center h-40"><p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Loading…</p></div>
              : filtered.length === 0 && items.length === 0
              ? <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
                  <svg width="64" height="52" viewBox="0 0 80 64" fill="none" aria-hidden="true" style={{ opacity: 0.6 }}>
                    <rect x="14" y="12" width="22" height="40" rx="3" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
                    <rect x="42" y="16" width="22" height="36" rx="3" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
                    <path d="M18 20h14M18 26h10M18 32h12" stroke="var(--color-border)" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M46 24h14M46 30h10M46 36h12" stroke="var(--color-border)" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <div><p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>Your library is empty</p><p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "4px 0 0" }}>Add your first paper or import from Zotero.</p></div>
                </div>
              : filtered.length === 0
              ? <div className="flex items-center justify-center h-40"><p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No items match your filters.</p></div>
              : filtered.map((item) => {
                  const isSelected = selectedItem?.id === item.id && !isMobile;
                  const isChecked = selectedIds.has(item.id);
                  return (
                    <button key={item.id} onClick={() => setSelectedItemId(isSelected ? null : item.id)} className="w-full text-left"
                      style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: isMobile ? 12 : 16, paddingRight: isMobile ? 12 : 16, paddingTop: 10, paddingBottom: 10, backgroundColor: isSelected ? "var(--color-navy-dim)" : isChecked ? "var(--color-navy-dim)" : "transparent", borderLeft: isSelected ? "3px solid var(--color-navy)" : "3px solid transparent", borderBottom: "1px solid var(--color-border)", minHeight: 48 }}
                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-dim)"; }}
                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = isChecked ? "var(--color-navy-dim)" : ""; }}
                    >
                      {selectMode && (
                        <input type="checkbox" checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            const next = new Set(selectedIds);
                            e.target.checked ? next.add(item.id) : next.delete(item.id);
                            setSelectedIds(next);
                          }}
                          style={{ flexShrink: 0, width: 16, height: 16, cursor: "pointer", accentColor: "var(--color-navy)" }}
                          aria-label={`Select ${item.title}`}
                        />
                      )}
                      <span style={{ flexShrink: 0, width: 28 }}>{TYPE_ICONS[item.type]}</span>
                      <span title={stripHtml(item.title)} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripHtml(item.title)}</span>
                      {!narrowList && <span style={{ flexShrink: 0, width: 100, fontSize: 12, color: "var(--color-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatAuthors(item.authors)}</span>}
                      {!narrowList && <span style={{ flexShrink: 0, width: 70, fontSize: 12, color: "var(--color-secondary)" }}>{item.year > 0 ? item.year : ""}</span>}
                      <span style={{ flexShrink: 0, width: 90 }}><StatusBadge status={item.status} /></span>
                    </button>
                  );
                })}
          </div>
        </>)}
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      {bulkDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={() => setBulkDeleteConfirmOpen(false)}>
          <div style={{ backgroundColor: "var(--color-surface)", borderRadius: 10, padding: 24, maxWidth: 360, width: "calc(100% - 32px)", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontFamily: "var(--font-lora)", fontSize: 15, fontWeight: 600, color: "var(--color-navy)", marginTop: 0, marginBottom: 8 }}>
              Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}?
            </h3>
            <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
              These items will be moved to <strong>Recently removed</strong> and can be recovered at any time.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setBulkDeleteConfirmOpen(false)}
                style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "8px 16px", backgroundColor: "transparent", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={() => { setBulkDeleteConfirmOpen(false); deleteBulk([...selectedIds]); }}
                style={{ fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "#C0392B", border: "none", borderRadius: 7, padding: "8px 16px", cursor: "pointer" }}>
                Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right detail panel */}
      {selectedItem && (
        <>
          {isMobile ? (
            <div className="fixed inset-0 z-40 animate-slide-in-bottom" style={{ backgroundColor: "var(--color-surface)" }}>
              <DetailPanelContent item={selectedItem} onClose={() => setSelectedItemId(null)} onUpdateItem={updateItem} onDeleteItem={deleteItem} allItems={items} currentUserId={currentUserId} projectId={projectId} onAddItem={addItem} subProjectId={subProjectId ?? null} teamMembers={teamMembers} onNavigateToItem={(id) => setSelectedItemId(id)} />
            </div>
          ) : (
            <div className="flex flex-col shrink-0" style={{ width: 340, borderLeft: "1px solid var(--color-border)" }}>
              <DetailPanelContent item={selectedItem} onClose={() => setSelectedItemId(null)} onUpdateItem={updateItem} onDeleteItem={deleteItem} allItems={items} currentUserId={currentUserId} projectId={projectId} onAddItem={addItem} subProjectId={subProjectId ?? null} teamMembers={teamMembers} onNavigateToItem={(id) => setSelectedItemId(id)} />
            </div>
          )}
        </>
      )}

      {addItemOpen && <AddItemModal onSave={addItem} onClose={() => setAddItemOpen(false)} projectId={projectId} currentUserId={currentUserId} subProjectId={subProjectId ?? null} subProjects={subProjects} />}
      {zoteroImportOpen && <ZoteroImportModal existingItems={items} onImport={importItems} onUpdateItem={updateItem} onClose={() => setZoteroImportOpen(false)} projectId={projectId} currentUserId={currentUserId} subProjectId={subProjectId ?? null} subProjects={subProjects} />}
      {doiLookupOpen && <DOILookupModal onSave={addItemFromDOI} onMerge={updateItem} onClose={() => setDoiLookupOpen(false)} projectId={projectId} currentUserId={currentUserId} subProjectId={subProjectId ?? null} subProjects={subProjects} existingItems={items} />}
      </div>
    </div>
  );
}
