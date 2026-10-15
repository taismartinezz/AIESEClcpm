"use client";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { SmilePlus, MessageCircle, Pin, Pencil, Trash2, FileText } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import type { User } from "@/types";
import type { ChatMessage } from "./types";
import { GROUP_GAP_MS } from "./types";
import { buildUser, formatTime, formatHM, renderMd, EmojiPicker, TBtn } from "./chatUtils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageRow({
  msg, prevMsg, currentUserId, onEdit, onDelete, onReact, onOpenThread, onPin, teamMembers = [],
}: {
  msg: ChatMessage; prevMsg: ChatMessage | null; currentUserId: string;
  onEdit: (id: string, c: string) => void; onDelete: (id: string) => void;
  onReact: (id: string, em: string) => void; onOpenThread: (m: ChatMessage) => void;
  onPin: (id: string, pin: boolean) => void;
  teamMembers?: User[];
}) {
  const isOwn = msg.senderId === currentUserId;
  const isCont = prevMsg !== null && !prevMsg.deletedAt && prevMsg.threadParentId === null && prevMsg.senderId === msg.senderId &&
    new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < GROUP_GAP_MS;
  const avUser = buildUser(msg.senderId, msg.senderName, msg.senderColor);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) { setDraft(msg.content); setTimeout(() => editRef.current?.focus(), 30); } }, [editing, msg.content]);

  function commitEdit() {
    const t = draft.trim();
    if (!t || t === msg.content) { setEditing(false); return; }
    onEdit(msg.id, t); setEditing(false);
  }

  const showBar = (hovered || emojiOpen || deleteConfirm) && !editing;

  // Thread preview avatar
  const lastReplier = msg.threadLastReplierId
    ? (teamMembers.find(m => m.id === msg.threadLastReplierId) ?? buildUser(msg.threadLastReplierId, "?"))
    : null;

  if (msg.deletedAt) {
    return (
      <div style={{ display: "flex", padding: "1px 48px 1px 0" }}>
        <div style={{ width: 52, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: "var(--color-secondary)", fontStyle: "italic" }}>This message was deleted.</span>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setDeleteConfirm(false); }}
      style={{ display: "flex", flexDirection: "column", padding: isCont ? "1px 48px 1px 0" : "6px 48px 1px 0", position: "relative", backgroundColor: (hovered || emojiOpen) ? "var(--color-surface-2)" : "transparent", transition: "background-color 0.06s" }}
    >
      {msg.isPinned && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 0 2px 52px", fontSize: 10, color: "var(--color-navy)", fontWeight: 600 }}>
          <Pin size={9} /> Pinned
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ width: 52, flexShrink: 0, paddingTop: 2, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          {!isCont ? <Avatar user={avUser} size={32} /> : hovered ? <span style={{ fontSize: 10, color: "var(--color-secondary)", lineHeight: "20px", whiteSpace: "nowrap" }}>{formatHM(msg.createdAt)}</span> : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!isCont && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-body)" }}>{isOwn ? "You" : msg.senderName}</span>
              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{formatTime(msg.createdAt)}</span>
            </div>
          )}
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 16 }}>
              <textarea ref={editRef} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setEditing(false); }}
                rows={2} style={{ fontSize: 14, lineHeight: 1.5, padding: "8px 10px", borderRadius: 8, border: "1.5px solid var(--color-navy)", outline: "none", resize: "none", fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-surface)", color: "var(--color-body)", width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setEditing(false)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-secondary)" }}>Cancel</button>
                <button onClick={commitEdit} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "none", background: "var(--color-btn-primary)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Save</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-body)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{renderMd(msg.content)}</div>
          )}

          {/* Attachments */}
          {msg.attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {msg.attachments.map((att, i) =>
                att.type.startsWith("image/") ? (
                  <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
                    <img src={att.url} alt={att.name} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: "1px solid var(--color-border)", display: "block", objectFit: "cover" }} />
                  </a>
                ) : (
                  <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, backgroundColor: "var(--color-surface-2)", border: "1px solid var(--color-border)", fontSize: 12, color: "var(--color-body)", textDecoration: "none" }}>
                    <FileText size={13} color="var(--color-secondary)" />
                    <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
                    <span style={{ color: "var(--color-secondary)", fontSize: 11, flexShrink: 0 }}>{formatBytes(att.size)}</span>
                  </a>
                )
              )}
            </div>
          )}

          {msg.reactions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {msg.reactions.map(r => (
                <button key={r.emoji} onClick={() => onReact(msg.id, r.emoji)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 12, fontSize: 12, backgroundColor: r.hasReacted ? "rgba(14,165,233,0.12)" : "var(--color-surface-2)", border: `1px solid ${r.hasReacted ? "var(--color-navy)" : "var(--color-border)"}`, cursor: "pointer", fontFamily: "var(--font-roboto)", color: "var(--color-body)" }}>
                  <span>{r.emoji}</span><span style={{ fontSize: 11, fontWeight: 600 }}>{r.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Thread preview */}
          {msg.threadCount > 0 && !editing && (
            <button onClick={() => onOpenThread(msg)} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, background: "none", border: "none", cursor: "pointer", padding: "2px 0", color: "var(--color-navy)", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-roboto)" }}>
              {lastReplier ? <Avatar user={lastReplier} size={16} /> : <MessageCircle size={12} />}
              {msg.threadCount} {msg.threadCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      </div>

      {showBar && (
        <div style={{ position: "absolute", top: 0, right: 0, zIndex: 10 }}>
          <div style={{ position: "relative" }}>
            <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "2px 3px", boxShadow: "0 2px 8px rgba(0,0,0,0.10)", display: "flex", alignItems: "center", gap: 1 }}>
              <TBtn label="Add reaction" onClick={() => setEmojiOpen(v => !v)}><SmilePlus size={14} /></TBtn>
              <TBtn label="Reply in thread" onClick={() => onOpenThread(msg)}><MessageCircle size={14} /></TBtn>
              <TBtn label={msg.isPinned ? "Unpin message" : "Pin message"} onClick={() => onPin(msg.id, !msg.isPinned)}>
                <Pin size={14} style={{ color: msg.isPinned ? "var(--color-navy)" : undefined }} />
              </TBtn>
              {isOwn && <TBtn label="Edit message" onClick={() => setEditing(true)}><Pencil size={14} /></TBtn>}
              {isOwn && !deleteConfirm && <TBtn label="Delete message" onClick={() => setDeleteConfirm(true)} danger><Trash2 size={14} /></TBtn>}
              {isOwn && deleteConfirm && (
                <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 2px" }}>
                  <span style={{ fontSize: 11, color: "var(--color-body)", whiteSpace: "nowrap", padding: "0 3px" }}>Delete?</span>
                  <button onClick={() => setDeleteConfirm(false)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>No</button>
                  <button onClick={() => { onDelete(msg.id); setDeleteConfirm(false); }} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "none", backgroundColor: "var(--color-error)", color: "#fff", cursor: "pointer", fontFamily: "var(--font-roboto)", fontWeight: 700 }}>Yes</button>
                </div>
              )}
            </div>
            {emojiOpen && <EmojiPicker onSelect={em => { onReact(msg.id, em); setEmojiOpen(false); }} onClose={() => setEmojiOpen(false)} />}
          </div>
        </div>
      )}
    </div>
  );
}
