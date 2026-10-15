"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, X, ChevronDown, Hash, Send } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { computeInitials } from "@/lib/utils";
import { resolveChannelKey, buildUser } from "@/app/(main)/chat/_components/chatUtils";
import { MessageRow } from "@/app/(main)/chat/_components/MessageRow";
import type { ChatMessage, MessageAttachment, MessageReaction } from "@/app/(main)/chat/_components/types";
import type { User } from "@/types";

// ChatDock: a LinkedIn-style floating dock that persists across route changes.
// It is hidden on /chat (the full page) to avoid redundancy.
//
// Scope-downs vs full /chat page:
//   - No file attachments
//   - No @mention autocomplete
//   - No emoji picker / reactions
//   - No thread panel
//   - No pinned panel / search
//   - No typing indicators
//   - Edit/delete stubs passed as no-ops (MessageRow still renders correctly)

interface ConvItem {
  id: string;
  label: string;
  isDm: boolean;
  peer?: User;
  unread: number;
  isOnline?: boolean;
}

function formatHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ChatDock() {
  const pathname = usePathname();
  const { projectId, subProjects, activeScope, subProjectId } = useProject();

  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserName, setCurrentUserName] = useState("");
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [dockOpen, setDockOpen] = useState(false);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [capturedMentionIds, setCapturedMentionIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mentionCandidates = mentionQuery === null ? [] :
    teamMembers.filter(m => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5);

  function insertMention(member: User) {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@\w*$/, `@${member.name} `);
    const after = draft.slice(cursor);
    setDraft(before + after);
    setCapturedMentionIds(prev => prev.includes(member.id) ? prev : [...prev, member.id]);
    setMentionQuery(null);
    setTimeout(() => { el.focus(); el.setSelectionRange(before.length, before.length); }, 10);
  }

  function handleReact(msgId: string, emoji: string) {
    const msg = messages.find(m => m.id === msgId);
    const alreadyReacted = msg?.reactions.find(r => r.emoji === emoji)?.hasReacted;
    setMessages(p => p.map(m => {
      if (m.id !== msgId) return m;
      const ex = m.reactions.find(r => r.emoji === emoji);
      if (alreadyReacted) return { ...m, reactions: m.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count - 1, hasReacted: false } : r).filter(r => r.count > 0) };
      if (ex) return { ...m, reactions: m.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, hasReacted: true } : r) };
      return { ...m, reactions: [...m.reactions, { emoji, count: 1, hasReacted: true }] };
    }));
    if (!isSupabaseConfigured) return;
    if (alreadyReacted) {
      supabase.from("message_reactions").delete().eq("message_id", msgId).eq("user_id", currentUserId).eq("emoji", emoji).then(() => {});
    } else {
      supabase.from("message_reactions").upsert({ message_id: msgId, user_id: currentUserId, emoji }).then(() => {});
    }
  }

  function handleEdit(id: string, content: string) {
    setMessages(p => p.map(m => m.id === id ? { ...m, content } : m));
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ content }).eq("id", id).then(({ error }) => { if (error) console.error("[ChatDock] edit:", error); });
  }

  function handleDelete(id: string) {
    const now = new Date().toISOString();
    setMessages(p => p.map(m => m.id === id ? { ...m, deletedAt: now } : m));
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ deleted_at: now }).eq("id", id).then(({ error }) => { if (error) console.error("[ChatDock] delete:", error); });
  }

  function handlePin(id: string, pin: boolean) {
    setMessages(p => p.map(m => m.id === id ? { ...m, isPinned: pin } : m));
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ is_pinned: pin }).eq("id", id).then(({ error }) => { if (error) console.error("[ChatDock] pin:", error); });
  }

  // Hide on full chat page
  const hidden = pathname.startsWith("/chat");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCurrentUserId("demo-user");
      setCurrentUserName("You");
      setTeamMembers([
        buildUser("demo-pi", "Dr. Sarah Chen"),
        buildUser("demo-ra", "Marcus Johnson"),
        buildUser("demo-grad", "Priya Patel"),
      ]);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setCurrentUserId(session.user.id);
      supabase.from("user_profiles").select("name").eq("id", session.user.id).single()
        .then(({ data }) => { if (data?.name) setCurrentUserName(data.name as string); });
    });
  }, []);

  // Team members
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    const isProjectView = activeScope === "project" && !!subProjectId;
    const table = isProjectView && subProjectId ? "sub_project_members" : "team_members";
    const fk = isProjectView && subProjectId ? "sub_project_id" : "project_id";
    const fv = isProjectView && subProjectId ? subProjectId : projectId;
    supabase.from(table).select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url)").eq(fk, fv as string)
      .then(({ data }) => {
        if (!data) return;
        setTeamMembers(data.filter(r => r.user_id !== currentUserId).map(r => {
          const p = (Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles) as Record<string, string> | null;
          const name = p?.name ?? "Unknown";
          return { id: r.user_id as string, name, email: "", role: "researcher" as const, avatarColor: p?.avatar_color ?? "#CBD5E1", avatarInitials: computeInitials(name) || (p?.avatar_initials ?? "??"), avatarUrl: p?.avatar_url ?? undefined };
        }));
      });
  }, [projectId, currentUserId, activeScope, subProjectId]);

  // Presence
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    const ch = supabase.channel(`dock_presence:${projectId}`, { config: { presence: { key: currentUserId } } })
      .on("presence", { event: "sync" }, () => { setOnlineUserIds(new Set(Object.keys(ch.presenceState()))); })
      .on("presence", { event: "join" }, ({ key }) => { setOnlineUserIds(p => new Set([...p, key as string])); })
      .on("presence", { event: "leave" }, ({ key }) => { setOnlineUserIds(p => { const n = new Set(p); n.delete(key as string); return n; }); })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") await ch.track({ user: currentUserId, at: Date.now() }); });
    return () => { supabase.removeChannel(ch); };
  }, [projectId, currentUserId]);

  // Unread counts (same logic as full page)
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    supabase.from("chat_read_state").select("channel, last_read_at").eq("user_id", currentUserId)
      .then(async ({ data }) => {
        if (!data?.length) return;
        const counts: Record<string, number> = {};
        await Promise.all(data.map(async row => {
          const { count } = await supabase.from("chat_messages")
            .select("*", { count: "exact", head: true })
            .eq("channel", row.channel as string)
            .is("thread_parent_id", null)
            .is("deleted_at", null)
            .gt("created_at", row.last_read_at as string);
          if ((count ?? 0) > 0) counts[row.channel as string] = count ?? 0;
        }));
        setUnreadCounts(counts);
      });
  }, [currentUserId, projectId]);

  // Build conversation list
  const isProjectView = activeScope === "project" && !!subProjectId;
  const visibleSubProjects = isProjectView ? subProjects.filter(sp => sp.id === subProjectId) : subProjects;

  const conversations: ConvItem[] = [
    ...(!isProjectView ? [{
      id: "lab", label: "Lab", isDm: false,
      unread: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, "lab")] ?? 0,
    }] : visibleSubProjects.map(sp => ({
      id: sp.id, label: sp.name, isDm: false,
      unread: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, sp.id)] ?? 0,
    }))),
    ...teamMembers.map(peer => ({
      id: `dm:${peer.id}`, label: peer.name, isDm: true, peer,
      isOnline: onlineUserIds.has(peer.id),
      unread: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, `dm:${peer.id}`)] ?? 0,
    })),
  ];

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0);
  const activeConvInfo = activeConv ? conversations.find(c => c.id === activeConv) ?? null : null;

  // Fetch messages for active conversation
  const fetchMessages = useCallback(async () => {
    if (!activeConv || !projectId || !currentUserId) return;
    setLoadingMsgs(true);
    const key = resolveChannelKey(projectId, currentUserId, activeConv);

    if (!isSupabaseConfigured) {
      setMessages([
        { id: "d1", channel: key, senderId: "demo-pi", senderName: "Dr. Sarah Chen", content: "Good morning!", createdAt: new Date(Date.now() - 7200000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] },
        { id: "d2", channel: key, senderId: "demo-user", senderName: "You", content: "Morning!", createdAt: new Date(Date.now() - 3600000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] },
      ]);
      setLoadingMsgs(false);
      return;
    }

    const { data } = await supabase.from("chat_messages")
      .select("id, channel, sender_id, content, created_at, thread_parent_id, deleted_at, is_pinned, mentioned_user_ids, attachments")
      .eq("channel", key).is("thread_parent_id", null)
      .order("created_at", { ascending: true }).limit(50);

    const rows = data ?? [];
    const sids = [...new Set(rows.map(r => r.sender_id as string))];
    const nameMap: Record<string, string> = {};
    if (sids.length) {
      const { data: ps } = await supabase.from("user_profiles").select("id, name").in("id", sids);
      for (const p of ps ?? []) nameMap[p.id as string] = p.name as string;
    }

    const mids = rows.map(r => r.id as string);
    const rxMap: Record<string, MessageReaction[]> = {};
    if (mids.length) {
      const { data: rx } = await supabase.from("message_reactions").select("message_id, emoji, user_id").in("message_id", mids);
      for (const r of rx ?? []) {
        if (!rxMap[r.message_id]) rxMap[r.message_id] = [];
        const ex = rxMap[r.message_id].find(x => x.emoji === r.emoji);
        if (ex) { ex.count++; if (r.user_id === currentUserId) ex.hasReacted = true; }
        else rxMap[r.message_id].push({ emoji: r.emoji, count: 1, hasReacted: r.user_id === currentUserId });
      }
    }

    setMessages(rows.map(row => ({
      id: row.id as string, channel: row.channel as string,
      senderId: row.sender_id as string, senderName: nameMap[row.sender_id as string] ?? "Unknown",
      content: row.content as string, createdAt: row.created_at as string,
      threadParentId: null, deletedAt: (row.deleted_at as string | null) ?? null,
      threadCount: 0, reactions: rxMap[row.id as string] ?? [],
      mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
      isPinned: (row.is_pinned as boolean) ?? false,
      attachments: (row.attachments as MessageAttachment[]) ?? [],
    })));
    setLoadingMsgs(false);

    // Mark as read
    supabase.from("chat_read_state").upsert({ user_id: currentUserId, channel: key, last_read_at: new Date().toISOString() });
    setUnreadCounts(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, [activeConv, projectId, currentUserId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (messages.length) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length, activeConv]);

  // Realtime for active conversation
  useEffect(() => {
    if (!isSupabaseConfigured || !activeConv || !projectId || !currentUserId) return;
    const key = resolveChannelKey(projectId, currentUserId, activeConv);
    const ch = supabase.channel(`dock_chat:${key}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel=eq.${key}` }, async payload => {
        const row = payload.new as Record<string, unknown>;
        if (row.thread_parent_id) return;
        let name = "Unknown";
        const { data: p } = await supabase.from("user_profiles").select("name").eq("id", row.sender_id as string).single();
        if (p?.name) name = p.name as string;
        const nm: ChatMessage = {
          id: row.id as string, channel: row.channel as string,
          senderId: row.sender_id as string, senderName: name,
          content: row.content as string, createdAt: row.created_at as string,
          threadParentId: null, deletedAt: null, threadCount: 0, reactions: [],
          mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
          isPinned: false, attachments: (row.attachments as MessageAttachment[]) ?? [],
        };
        setMessages(prev => prev.some(m => m.id === nm.id) ? prev : [...prev, nm]);
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeConv, projectId, currentUserId]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending || !currentUserId || !projectId || !activeConv) return;
    setSending(true);
    const key = resolveChannelKey(projectId, currentUserId, activeConv);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    if (!isSupabaseConfigured) {
      setMessages(p => [...p, { id, channel: key, senderId: currentUserId, senderName: currentUserName, content: text, createdAt, threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: capturedMentionIds, isPinned: false, attachments: [] }]);
      setDraft(""); setCapturedMentionIds([]); setSending(false);
      return;
    }

    await supabase.from("chat_messages").insert({ id, channel: key, sender_id: currentUserId, content: text, created_at: createdAt, thread_parent_id: null, mentioned_user_ids: capturedMentionIds });
    setMessages(p => [...p, { id, channel: key, senderId: currentUserId, senderName: currentUserName, content: text, createdAt, threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: capturedMentionIds, isPinned: false, attachments: [] }]);
    setDraft("");
    setCapturedMentionIds([]);
    setSending(false);
    inputRef.current?.focus();
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  if (hidden) return null;

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0 }}>
      {/* Expanded dock panel */}
      {dockOpen && (
        <div style={{ width: 340, height: activeConv ? 460 : 320, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "12px 12px 0 0", boxShadow: "0 -4px 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", overflow: "visible" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", flexShrink: 0, borderRadius: "12px 12px 0 0", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {activeConv && (
                <button onClick={() => { setActiveConv(null); setMessages([]); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)", display: "flex", padding: 4, borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-navy-dim)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  title="Back to conversations"
                >
                  <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
                </button>
              )}
              {activeConvInfo ? (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {activeConvInfo.isDm && activeConvInfo.peer ? (
                    <span style={{ position: "relative", display: "inline-flex" }}>
                      <Avatar user={activeConvInfo.peer} size={24} />
                      <span style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", backgroundColor: activeConvInfo.isOnline ? "#22c55e" : "var(--color-secondary)", border: "1.5px solid var(--color-surface)", opacity: activeConvInfo.isOnline ? 1 : 0.45 }} />
                    </span>
                  ) : (
                    <Hash size={14} color="var(--color-secondary)" />
                  )}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-navy)" }}>{activeConvInfo.label}</span>
                </div>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", fontFamily: "var(--font-lora)" }}>Messaging</span>
              )}
            </div>
            <button onClick={() => setDockOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)", display: "flex", padding: 4, borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-navy-dim)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Content */}
          {!activeConv ? (
            // Conversation list
            <div style={{ flex: 1, overflowY: "auto" }}>
              {conversations.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--color-secondary)", textAlign: "center", padding: "24px 16px" }}>No conversations yet.</p>
              )}
              {conversations.map(conv => (
                <button key={conv.id} onClick={() => setActiveConv(conv.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-navy-dim)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  {conv.isDm && conv.peer ? (
                    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                      <Avatar user={conv.peer} size={36} />
                      <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", backgroundColor: conv.isOnline ? "#22c55e" : "var(--color-secondary)", border: "2px solid var(--color-surface)", opacity: conv.isOnline ? 1 : 0.45 }} />
                    </span>
                  ) : (
                    <span style={{ width: 36, height: 36, borderRadius: "50%", backgroundColor: "var(--color-navy-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Hash size={16} color="var(--color-navy)" />
                    </span>
                  )}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: conv.unread > 0 ? 700 : 400, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.label}</span>
                  {conv.unread > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: "var(--color-navy)", color: "#fff", borderRadius: 10, padding: "2px 6px", flexShrink: 0 }}>{conv.unread}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            // Message view
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {loadingMsgs && <p style={{ fontSize: 12, color: "var(--color-secondary)", textAlign: "center", padding: "16px" }}>Loading...</p>}
                {!loadingMsgs && messages.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--color-secondary)", textAlign: "center", padding: "24px 16px" }}>No messages yet. Say hello!</p>
                )}
                {messages.map((msg, i) => (
                  <MessageRow
                    key={msg.id}
                    msg={msg}
                    prevMsg={i > 0 ? messages[i - 1] : null}
                    currentUserId={currentUserId}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onReact={handleReact}
                    onOpenThread={() => {}}
                    onPin={handlePin}
                    teamMembers={teamMembers}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
              {/* Composer */}
              <div style={{ borderTop: "1px solid var(--color-border)", padding: "8px 12px", flexShrink: 0, position: "relative" }}>
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 2px)", left: 12, right: 12, zIndex: 200, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                    {mentionCandidates.map((m, i) => (
                      <button key={m.id} onMouseDown={e => { e.preventDefault(); insertMention(m); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", border: "none", background: i === mentionIndex ? "rgba(14,165,233,0.08)" : "transparent", cursor: "pointer", textAlign: "left" }}
                      >
                        <Avatar user={m} size={20} />
                        <span style={{ fontSize: 13, color: "var(--color-body)" }}>{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={e => {
                      setDraft(e.target.value);
                      const cursor = e.target.selectionStart ?? e.target.value.length;
                      const atMatch = e.target.value.slice(0, cursor).match(/@(\w*)$/);
                      if (atMatch) { setMentionQuery(atMatch[1]); setMentionIndex(0); }
                      else setMentionQuery(null);
                    }}
                    onKeyDown={e => {
                      if (mentionQuery !== null && mentionCandidates.length > 0) {
                        if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionCandidates.length - 1)); return; }
                        if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionCandidates[mentionIndex]); return; }
                        if (e.key === "Escape") { setMentionQuery(null); return; }
                      }
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder={`Message ${activeConvInfo?.label ?? ""}...`}
                    rows={1}
                    style={{ flex: 1, resize: "none", border: "1px solid var(--color-border)", borderRadius: 8, outline: "none", padding: "6px 10px", background: "var(--color-canvas)", color: "var(--color-body)", fontSize: 13, lineHeight: 1.5, fontFamily: "var(--font-roboto)", maxHeight: 80, overflowY: "auto" }}
                  />
                  <button onClick={sendMessage} disabled={!draft.trim() || sending} aria-label="Send"
                    style={{ width: 32, height: 32, borderRadius: 7, border: "none", backgroundColor: draft.trim() ? "var(--color-btn-primary)" : "var(--color-border)", color: draft.trim() ? "#fff" : "var(--color-secondary)", cursor: draft.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Dock tab button — icon-only FAB when closed, expands on hover/focus */}
      {dockOpen ? (
        // Open: full pill connecting to panel above
        <button
          onClick={() => setDockOpen(false)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: "0 0 8px 8px", cursor: "pointer", fontSize: 13, fontWeight: 600, position: "relative", minWidth: 140, fontFamily: "var(--font-roboto)" }}
          aria-label="Close messaging"
        >
          <MessageSquare size={15} />
          <span>Messaging</span>
          <ChevronDown size={13} style={{ marginLeft: "auto" }} />
        </button>
      ) : (
        // Closed: 48px circular FAB, icon only
        <button
          onClick={() => setDockOpen(true)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 24, cursor: "pointer", position: "relative", width: 48, height: 48 }}
          aria-label="Open messaging"
        >
          <MessageSquare size={18} />
          {totalUnread > 0 && (
            <span style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, backgroundColor: "#ef4444", borderRadius: 8, fontSize: 10, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", border: "2px solid var(--color-canvas)" }}>
              {totalUnread > 9 ? "9+" : totalUnread}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
