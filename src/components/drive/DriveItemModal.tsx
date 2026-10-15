"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { DRIVE_BUCKET, DRIVE_MAX_BYTES, drivePath, type DriveItem } from "@/lib/drive";
import type { SubProject } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

export interface DriveFolder { id: string; name: string; sortOrder: number }

type Where = "lab" | "personal" | `group:${string}`;

/** Add a link or upload a file to the LC Drive, or edit an item's title / folder. */
export default function DriveItemModal({ projectId, userId, folders, groups, item, initialFolderId, initialKind, onClose, onSaved }: {
  projectId: string; userId: string; folders: DriveFolder[]; groups: SubProject[];
  item?: DriveItem; initialFolderId: string | null; initialKind: "link" | "file";
  onClose: () => void; onSaved: () => void;
}) {
  const [kind, setKind] = useState<"link" | "file">(item?.kind ?? initialKind);
  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.kind === "link" ? item.url : "");
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState(item?.folderId ?? initialFolderId ?? "");
  const [where, setWhere] = useState<Where>(item ? (item.scope === "project" && item.subProjectId ? `group:${item.subProjectId}` : item.scope) as Where : "lab");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (kind === "link" && !/^https?:\/\//i.test(url.trim())) { setError("Links must start with http:// or https://"); return; }
    if (kind === "file" && !item && !file) { setError("Choose a file to upload."); return; }
    if (file && file.size > DRIVE_MAX_BYTES) { setError("Files can be at most 25 MB."); return; }
    const scope = where.startsWith("group:") ? "project" : where;
    const subProjectId = where.startsWith("group:") ? where.slice(6) : null;
    setSaving(true);
    let uploaded: string | null = null;
    try {
      if (file) {
        uploaded = drivePath(projectId, file.name);
        const { error: upErr } = await supabase.storage.from(DRIVE_BUCKET).upload(uploaded, file, { contentType: file.type || undefined });
        if (upErr) { uploaded = null; throw new Error(`upload failed: ${upErr.message}`); }
      }
      const fields = {
        title: title.trim() || file?.name || url.trim(),
        folder_id: scope === "lab" ? folderId || null : null,
        scope, sub_project_id: subProjectId,
        ...(kind === "link" ? { kind: "link", url: url.trim(), storage_path: null } : {}),
        ...(uploaded ? { kind: "file", url: "", storage_path: uploaded, file_name: file!.name, mime_type: file!.type || null, size_bytes: file!.size } : {}),
      };
      const { error: err } = item
        ? await supabase.from("bookmarks").update(fields).eq("id", item.id)
        : await supabase.from("bookmarks").insert({ ...fields, project_id: projectId, added_by: userId });
      if (err) throw new Error(err.message);
      if (uploaded && item?.storagePath) await supabase.storage.from(DRIVE_BUCKET).remove([item.storagePath]).catch(() => {});
      onSaved();
    } catch (e) {
      if (uploaded) await supabase.storage.from(DRIVE_BUCKET).remove([uploaded]).catch(() => {});
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={item ? "Edit item" : kind === "file" ? "Upload a file" : "Add a link"} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      {!item && (
        <div role="radiogroup" aria-label="Type" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Button variant={kind === "link" ? "primary" : "secondary"} aria-pressed={kind === "link"} onClick={() => setKind("link")} style={{ flex: 1 }}>Link</Button>
          <Button variant={kind === "file" ? "primary" : "secondary"} aria-pressed={kind === "file"} onClick={() => setKind("file")} style={{ flex: 1 }}>File</Button>
        </div>
      )}
      {kind === "link" ? (
        <Field label="Link" htmlFor="drive-url"><input id="drive-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" style={inputStyle} autoFocus /></Field>
      ) : (
        <Field label={item ? "Replace the file (optional)" : "File"} htmlFor="drive-file" hint="Up to 25 MB. Only members of your LC can open it.">
          <input id="drive-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
        </Field>
      )}
      <Field label="Title" htmlFor="drive-title"><input id="drive-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shown in the Drive" style={inputStyle} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Who can see it" htmlFor="drive-where">
          <select id="drive-where" value={where} onChange={(e) => setWhere(e.target.value as Where)} style={selectStyle}>
            <option value="lab">Whole LC</option>
            <option value="personal">Only me</option>
            {groups.map((g) => <option key={g.id} value={`group:${g.id}`}>Group: {g.name}</option>)}
          </select>
        </Field>
        <Field label="Folder" htmlFor="drive-folder">
          <select id="drive-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} style={selectStyle} disabled={where !== "lab"}>
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
