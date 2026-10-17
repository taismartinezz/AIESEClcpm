"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderPlus, Download, Pencil, Plus, Trash2, Upload, Folder, User as UserIcon, Users, Search, Library } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { DRIVE_BUCKET, TYPE_CONFIG, formatBytes, hostname, itemType, mapDriveItem, type DriveItem } from "@/lib/drive";
import { useLcMembers } from "@/hooks/useLcMembers";
import { Button, ErrorText, inputStyle } from "@/components/lc/ui";
import DriveItemModal, { type DriveFolder } from "@/components/drive/DriveItemModal";

type View = { kind: "all" } | { kind: "folder"; id: string | null } | { kind: "personal" } | { kind: "group"; id: string };

/**
 * LC Drive (formerly Bookmarks): links and uploaded files in LC folders
 * (templates, brand kit, job descriptions, …), plus personal and group items.
 */
export default function DrivePage() {
  const { projectId, userId, role, subProjects, isLoading } = useProject();
  const exec = isExec(role);
  const { names } = useLcMembers(projectId);

  const [items, setItems] = useState<DriveItem[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [editing, setEditing] = useState<{ item?: DriveItem; kind: "link" | "file" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [f, b] = await Promise.all([
          supabase.from("drive_folders").select("id, name, sort_order").eq("project_id", projectId).order("sort_order").order("name"),
          supabase.from("bookmarks").select("*").eq("project_id", projectId).order("added_at", { ascending: false }),
        ]);
        if (f.error) throw new Error(f.error.message);
        if (b.error) throw new Error(b.error.message);
        if (cancelled) return;
        setFolders((f.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, sortOrder: r.sort_order as number })));
        setItems((b.data ?? []).map(mapDriveItem));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load the Drive: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  const shown = useMemo(() => items.filter((it) => {
    const inView = view.kind === "all" ? true
      : view.kind === "personal" ? it.scope === "personal"
      : view.kind === "group" ? it.scope === "project" && it.subProjectId === view.id
      : it.scope === "lab" && it.folderId === view.id;
    return inView && (!query || [it.title, it.fileName, it.url].some((v) => v?.toLowerCase().includes(query.toLowerCase())));
  }), [items, view, query]);

  async function act(id: string, what: string, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  function open(it: DriveItem) {
    if (it.kind === "link") { window.open(it.url, "_blank", "noopener,noreferrer"); return; }
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    void act(it.id, "open the file", async () => {
      const { data, error: err } = await supabase.storage.from(DRIVE_BUCKET).createSignedUrl(it.storagePath!, 120);
      if (err || !data?.signedUrl) { tab?.close(); throw new Error(err?.message ?? "no URL returned"); }
      if (tab) tab.location.href = data.signedUrl; else window.location.assign(data.signedUrl);
    });
  }

  function remove(it: DriveItem) {
    if (!window.confirm(`Delete "${it.title}"?`)) return;
    void act(it.id, "delete", async () => {
      const { data, error: err } = await supabase.from("bookmarks").delete().eq("id", it.id).select("id");
      if (err) throw new Error(err.message);
      if (!data?.length) throw new Error("you can't delete this item");
      if (it.storagePath) await supabase.storage.from(DRIVE_BUCKET).remove([it.storagePath]);
    });
  }

  function addFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim() || !projectId) return;
    void act("folder", "create the folder", async () => {
      const { error: err } = await supabase.from("drive_folders").insert({ project_id: projectId, name: name.trim(), sort_order: folders.length + 1, created_by: userId });
      if (err) throw new Error(err.message);
    });
  }

  function renameFolder(f: DriveFolder) {
    const name = window.prompt("Rename folder", f.name);
    if (!name?.trim() || name.trim() === f.name) return;
    void act(f.id, "rename the folder", async () => {
      const { error: err } = await supabase.from("drive_folders").update({ name: name.trim() }).eq("id", f.id);
      if (err) throw new Error(err.message);
    });
  }

  function deleteFolder(f: DriveFolder) {
    if (!window.confirm(`Delete the folder "${f.name}"? Its items stay in the Drive, without a folder.`)) return;
    void act(f.id, "delete the folder", async () => {
      const { error: err } = await supabase.from("drive_folders").delete().eq("id", f.id);
      if (err) throw new Error(err.message);
      setView({ kind: "all" });
    });
  }

  const navItem = (key: string, label: string, icon: React.ReactNode, active: boolean, onClick: () => void, count: number, extra?: React.ReactNode) => (
    <li key={key} style={{ display: "flex", alignItems: "center" }}>
      <button type="button" onClick={onClick} aria-current={active ? "true" : undefined}
        style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer", textAlign: "left",
          backgroundColor: active ? "var(--color-navy-dim)" : "transparent", color: active ? "var(--color-navy)" : "var(--color-body)", fontWeight: active ? 700 : 400, fontSize: 13 }}>
        {icon}<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{count}</span>
      </button>
      {extra}
    </li>
  );

  const loading = isLoading || (enabled && !loaded);
  const currentFolder = view.kind === "folder" ? view.id : null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="LC Drive"
        subtitle="Templates, brand kit, job descriptions and the links your LC needs, in one place."
        action={<>
          <Button variant="secondary" onClick={() => setEditing({ kind: "file" })}><Upload size={14} aria-hidden="true" /> Upload</Button>
          <Button onClick={() => setEditing({ kind: "link" })}><Plus size={14} aria-hidden="true" /> Add link</Button>
        </>}
      />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 240, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <NeedsDatabase what="LC Drive">Templates, brand kit, job descriptions and important links, in folders for the whole LC.</NeedsDatabase>
        ) : (
          <div className="grid gap-5 items-start md:grid-cols-[minmax(180px,230px)_1fr]">
            <nav aria-label="Drive folders">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {navItem("all", "Everything", <Library size={14} aria-hidden="true" />, view.kind === "all", () => setView({ kind: "all" }), items.length)}
                <li style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-secondary)", padding: "10px 10px 4px", display: "flex", alignItems: "center" }}>
                  <span style={{ flex: 1 }}>LC folders</span>
                  {exec && <button type="button" onClick={addFolder} aria-label="New folder" style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><FolderPlus size={13} color="var(--color-secondary)" /></button>}
                </li>
                {folders.map((f) => navItem(f.id, f.name, <Folder size={14} aria-hidden="true" />, view.kind === "folder" && view.id === f.id,
                  () => setView({ kind: "folder", id: f.id }), items.filter((i) => i.scope === "lab" && i.folderId === f.id).length,
                  exec && view.kind === "folder" && view.id === f.id ? (
                    <span style={{ display: "flex" }}>
                      <button type="button" aria-label={`Rename ${f.name}`} onClick={() => renameFolder(f)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={12} color="var(--color-secondary)" /></button>
                      <button type="button" aria-label={`Delete ${f.name}`} onClick={() => deleteFolder(f)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={12} color="var(--color-secondary)" /></button>
                    </span>
                  ) : undefined))}
                {navItem("none", "Not in a folder", <Folder size={14} aria-hidden="true" />, view.kind === "folder" && view.id === null, () => setView({ kind: "folder", id: null }), items.filter((i) => i.scope === "lab" && !i.folderId).length)}
                <li style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-secondary)", padding: "10px 10px 4px" }}>More</li>
                {navItem("personal", "Only me", <UserIcon size={14} aria-hidden="true" />, view.kind === "personal", () => setView({ kind: "personal" }), items.filter((i) => i.scope === "personal").length)}
                {subProjects.map((g) => navItem(g.id, g.name, <Users size={14} aria-hidden="true" />, view.kind === "group" && view.id === g.id, () => setView({ kind: "group", id: g.id }), items.filter((i) => i.scope === "project" && i.subProjectId === g.id).length))}
              </ul>
            </nav>

            <section aria-label="Items">
              <div style={{ position: "relative", maxWidth: 320, marginBottom: 12 }}>
                <Search size={14} color="var(--color-secondary)" aria-hidden="true" style={{ position: "absolute", left: 10, top: 12 }} />
                <input aria-label="Search the Drive" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, paddingLeft: 30 }} />
              </div>
              {shown.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Nothing here yet. Add a link or upload a file.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {shown.map((it) => {
                    const t = TYPE_CONFIG[itemType(it)];
                    const Icon = t.icon;
                    const folder = folders.find((f) => f.id === it.folderId);
                    return (
                      <li key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10, backgroundColor: "var(--color-surface)", opacity: busyId === it.id ? 0.6 : 1 }}>
                        <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: t.bg, flexShrink: 0 }}><Icon size={16} color={t.color} /></span>
                        <button type="button" onClick={() => open(it)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)", marginTop: 2 }}>
                            {it.kind === "file" ? [it.fileName, formatBytes(it.sizeBytes)].filter(Boolean).join(" · ") : hostname(it.url)}
                            {folder && view.kind === "all" ? ` · ${folder.name}` : ""}
                            {it.addedBy && names[it.addedBy] ? ` · ${names[it.addedBy]}` : ""}
                          </span>
                        </button>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t.color, backgroundColor: t.bg, borderRadius: 4, padding: "2px 6px" }}>{t.badge}</span>
                        {it.kind === "file" ? <Download size={14} color="var(--color-secondary)" aria-hidden="true" /> : <ExternalLink size={14} color="var(--color-secondary)" aria-hidden="true" />}
                        <button type="button" aria-label={`Edit ${it.title}`} onClick={() => setEditing({ item: it, kind: it.kind })} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={13} color="var(--color-secondary)" /></button>
                        <button type="button" aria-label={`Delete ${it.title}`} onClick={() => remove(it)} disabled={busyId === it.id} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={13} color="var(--color-secondary)" /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {editing && projectId && userId && (
        <DriveItemModal
          projectId={projectId} userId={userId} folders={folders} groups={subProjects}
          item={editing.item} initialKind={editing.kind} initialFolderId={currentFolder}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
