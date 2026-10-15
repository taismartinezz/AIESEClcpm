"use client";

import { useState, useEffect, useRef } from "react";
import { Send, X } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Avatar from "@/components/ui/Avatar";
import type { ChatMessage } from "./types";
import { buildUser, formatTime, renderMd } from "./chatUtils";
import { MessageRow } from "./MessageRow";

export function ThreadPanel({ parent, currentUserId, currentUserName, projectId, onClose, onReact, onReplyAdded }: {
  parent: ChatMessage; currentUserId: string; currentUserName: string;
  projectId: string; onClose: () => void; onReact: (id: string, em: string) => void;
  onReplyAdded?: (parentId: string, replierId: string) => void;
}) {
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const avUser = buildUser(parent.senderId, parent.senderName, parent.senderColor);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReplies([{ id: "tr-1", channel: parent.channel, senderId: "demo-pi", senderName: "Dr. Sarah Chen", content: "Great point! Let's revisit Thursday.", createdAt: new Date(Date.now() - 60000 * 3).toISOString(), threadParentId: parent.id, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] }]);
      return;
    }
    supabase.from("chat_messages").select("id, channel, sender_id, content, created_at, deleted_at").eq("thread_parent_id", parent.id).order("created_at", { ascending: true })
      .then(async ({ data }) => {
        if (!data) return;
        const ids = [...new Set(data.map(r => r.sender_id as string))];
        const nameMap: Record<string, string> = {};
        if (ids.length) {
          const { data: ps } = await supabase.from("user_profiles").select("id, name").in("id", ids);
          for (const p of ps ?? []) nameMap[p.id as string] = p.name as string;
        }
        setReplies(data.map(row => ({ id: row.id as string, channel: row.channel as string, senderId: row.sender_id as string, senderName: nameMap[row.sender_id as string] ?? "Unknown", content: row.content as string, createdAt: row.created_at as string, threadParentId: parent.id, deletedAt: (row.deleted_at as string | null) ?? null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] })));
      });
  }, [parent.id, parent.channel]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [replies]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const ch = supabase.channel(`thread:${parent.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_parent_id=eq.${parent.id}` }, async payload => {
        const row = payload.new as Record<string, unknown>;
        let name = "Unknown";
        const { data: p } = await supabase.from("user_profiles").select("name").eq("id", row.sender_id as string).single();
        if (p?.name) name = p.name as string;
        const nm: ChatMessage = { id: row.id as string, channel: row.channel as string, senderId: row.sender_id as string, senderName: name, content: row.content as string, createdAt: row.created_at as string, threadParentId: parent.id, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] };
        setReplies(prev => prev.some(m => m.id === nm.id) ? prev : [...prev, nm]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `thread_parent_id=eq.${parent.id}` }, payload => {
        const row = payload.new as Record<string, unknown>;
        setReplies(prev => prev.map(m => m.id === row.id ? { ...m, content: row.content as string, deletedAt: (row.deleted_at as string | null) ?? null } : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [parent.id]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || sending || !currentUserId || !projectId) return;
    setSending(true);
    setSendError(null);
    if (!isSupabaseConfigured) {
      try {
        setReplies(p => [...p, { id: crypto.randomUUID(), channel: parent.channel, senderId: currentUserId, senderName: currentUserName, content: text, createdAt: new Date().toISOString(), threadParentId: parent.id, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] }]);
        setDraft("");
      } finally {
        setSending(false);
      }
      return;
    }
    try {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const { error } = await supabase.from("chat_messages").insert({ id, channel: parent.channel, sender_id: currentUserId, content: text, created_at: createdAt, thread_parent_id: parent.id });
      if (error) throw error;
      supabase.from("chat_messages").update({ thread_last_replier_id: currentUserId }).eq("id", parent.id).then(({ error: ue }) => {
        if (ue) console.error("[Chat] thread_last_replier update:", { message: ue.message, code: ue.code });
      });
      setReplies(p => [...p, { id, channel: parent.channel, senderId: currentUserId, senderName: currentUserName, content: text, createdAt, threadParentId: parent.id, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] }]);
      onReplyAdded?.(parent.id, currentUserId);
      setDraft("");
    } catch (err) {
      const e = err as { message?: string; details?: string; hint?: string; code?: string };
      console.error("[Chat] reply error:", { message: e?.message, details: e?.details, hint: e?.hint, code: e?.code });
      setSendError(e?.message ?? "Reply failed. Tap to retry.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 15, color: "var(--color-navy)" }}>Thread</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 6, color: "var(--color-secondary)" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-surface-2)")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
        ><X size={16} /></button>
      </div>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Avatar user={avUser} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-body)" }}>{parent.senderName}</span>
              <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>{formatTime(parent.createdAt)}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-body)", wordBreak: "break-word" }}>{renderMd(parent.content)}</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {replies.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-secondary)", textAlign: "center", marginTop: 24 }}>No replies yet.</p>
        ) : replies.map((reply, i) => (
          <MessageRow key={reply.id} msg={reply} prevMsg={i > 0 ? replies[i - 1] : null} currentUserId={currentUserId}
            onEdit={(id, c) => { setReplies(p => p.map(r => r.id === id ? { ...r, content: c } : r)); if (isSupabaseConfigured) supabase.from("chat_messages").update({ content: c }).eq("id", id); }}
            onDelete={id => { const now = new Date().toISOString(); setReplies(p => p.map(r => r.id === id ? { ...r, deletedAt: now } : r)); if (isSupabaseConfigured) supabase.from("chat_messages").update({ deleted_at: now }).eq("id", id); }}
            onReact={onReact}
            onPin={() => {}}
            onOpenThread={() => {}}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", flexShrink: 0 }}>
        {sendError && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, padding: "5px 8px", backgroundColor: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, fontSize: 11, color: "#dc2626" }}>
            <span style={{ flex: 1 }}>{sendError}</span>
            <button onClick={sendReply} style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", background: "none", border: "none", cursor: "pointer", padding: "1px 4px" }}>Retry</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, border: "1px solid var(--color-border)", borderRadius: 10, backgroundColor: "var(--color-canvas)", padding: "6px 6px 6px 10px" }}>
          <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
            placeholder="Reply in thread…" rows={1}
            style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--color-body)", fontSize: 13, lineHeight: 1.5, fontFamily: "var(--font-roboto)", maxHeight: 100, overflowY: "auto" }} />
          <button onClick={sendReply} disabled={!draft.trim() || sending} aria-label="Send reply"
            style={{ width: 30, height: 30, borderRadius: 7, border: "none", backgroundColor: draft.trim() ? "var(--color-btn-primary)" : "transparent", color: draft.trim() ? "#fff" : "var(--color-secondary)", cursor: draft.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background-color 0.15s" }}>
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
