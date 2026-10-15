import {
  FileText, ClipboardList, Link2, Play, Table, Presentation, Folder, Globe, Paperclip,
} from "lucide-react";

// LC Drive items: links (typed by where they point) and uploaded files.

export type LinkType = "doc" | "sheet" | "slides" | "form" | "folder" | "aiesec" | "video" | "link";
export type DriveItemType = LinkType | "file";

// ── Type config ───────────────────────────────────────────────────────────────

export const TYPE_CONFIG: Record<DriveItemType, {
  label: string;
  badge: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}> = {
  doc:      { label: "Docs",             badge: "doc",    icon: FileText,      color: "#0263C4", bg: "rgba(3,126,243,0.10)" },
  sheet:    { label: "Sheets",           badge: "sheet",  icon: Table,         color: "#15803D", bg: "rgba(21,128,61,0.10)" },
  slides:   { label: "Slides & design",  badge: "slides", icon: Presentation,  color: "#B45309", bg: "rgba(244,137,36,0.12)" },
  form:     { label: "Forms",            badge: "form",   icon: ClipboardList, color: "#6D28D9", bg: "rgba(117,82,204,0.10)" },
  folder:   { label: "Folders",          badge: "folder", icon: Folder,        color: "#475569", bg: "rgba(71,85,105,0.10)" },
  aiesec:   { label: "AIESEC & EXPA",    badge: "aiesec", icon: Globe,         color: "#0263C4", bg: "rgba(3,126,243,0.10)" },
  video:    { label: "Videos",           badge: "video",  icon: Play,          color: "#B91C1C", bg: "rgba(185,28,28,0.10)" },
  link:     { label: "Links",            badge: "link",   icon: Link2,         color: "#475569", bg: "rgba(71,85,105,0.10)" },
  file:     { label: "Files",            badge: "file",   icon: Paperclip,     color: "#0263C4", bg: "rgba(3,126,243,0.10)" },
};

export function inferType(url: string): LinkType {
  try {
    const { hostname: h, pathname: p } = new URL(url);
    const host = h.replace(/^www\./, "");
    if (host === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "sheet";
      if (p.startsWith("/presentation/")) return "slides";
      if (p.startsWith("/forms/")) return "form";
      return "doc";
    }
    if (host === "sheets.google.com") return "sheet";
    if (host === "slides.google.com" || host.includes("canva.com") || host.includes("figma.com")) return "slides";
    if (host === "forms.gle" || host.includes("typeform.com") || host.includes("forms.office.com")) return "form";
    if (host === "drive.google.com" || host.includes("dropbox.com") || host.includes("onedrive.live.com")) return "folder";
    if (host.includes("notion.so") || host.includes("confluence") || host.includes("sharepoint.com")) return "doc";
    if (host === "aiesec.org" || host.endsWith(".aiesec.org") || host.includes("expa.aiesec") || host.includes("aiesec.")) return "aiesec";
    if (host === "youtube.com" || host === "youtu.be" || host.includes("vimeo.com")) return "video";
    return "link";
  } catch { return "link"; }
}


export const DRIVE_BUCKET = "lc-drive";
export const DRIVE_MAX_BYTES = 25 * 1024 * 1024;

export interface DriveItem {
  id: string;
  projectId: string;
  title: string;
  url: string;
  kind: "link" | "file";
  storagePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  folderId: string | null;
  scope: "lab" | "personal" | "project";
  subProjectId: string | null;
  addedBy: string | null;
  addedAt: string;
}

export function mapDriveItem(row: Record<string, unknown>): DriveItem {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    url: (row.url as string) ?? "",
    kind: ((row.kind as string) === "file" ? "file" : "link"),
    storagePath: (row.storage_path as string | null) ?? null,
    fileName: (row.file_name as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
    scope: ((row.scope as string) ?? "lab") as DriveItem["scope"],
    subProjectId: (row.sub_project_id as string | null) ?? null,
    addedBy: (row.added_by as string | null) ?? null,
    addedAt: row.added_at as string,
  };
}

export function itemType(item: Pick<DriveItem, "kind" | "url">): DriveItemType {
  return item.kind === "file" ? "file" : inferType(item.url);
}

export function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Storage key for an upload: <lc>/<uuid>-<safe file name>. */
export function drivePath(projectId: string, fileName: string): string {
  const safe = fileName.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  return `${projectId}/${crypto.randomUUID()}-${safe}`;
}
