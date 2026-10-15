"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { useUndoToast } from "@/context/UndoToastContext";
import Avatar from "@/components/ui/Avatar";
import type { User } from "@/types";
import { MessageSquare, Hash, ChevronDown, Search, Pin, X } from "lucide-react";
import { ChatComposer } from "./_components/ChatComposer";
import ScopeSidebar, { type ScopeSection } from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";
import { computeInitials } from "@/lib/utils";
import type { ChatMessage, ActiveChannel, MessageReaction, MessageAttachment } from "./_components/types";
import { buildUser, resolveChannelKey, sameDay, DateDivider, TypingIndicator } from "./_components/chatUtils";
import { MessageRow } from "./_components/MessageRow";
import { ThreadPanel } from "./_components/ThreadPanel";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatPage() {
  const { show: showUndoToast } = useUndoToast();
  const { projectId, subProjects, activeScope, subProjectId, isLoading: projectLoading } = useProject();
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserName, setCurrentUserName] = useState("");
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const isProjectView = activeScope === "project" && !!subProjectId;

  const defaultChannel = isProjectView && subProjects.find(sp => sp.id === subProjectId) ? (subProjectId ?? "lab") : "lab";
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(defaultChannel);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("chat_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [threadMsg, setThreadMsg] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<{ userId: string; name: string }[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  // F1: Presence
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // F2: Unread
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Read receipts: map of userId -> last_read_at for the active channel
  const [peerReadStates, setPeerReadStates] = useState<Record<string, string>>({});


  // F4: Pinned panel
  const [showPinned, setShowPinned] = useState(false);

  // F5: Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);

  // F7: Attachments
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ file: File; preview?: string }>>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastCountRef = useRef(0);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const typingChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const msgRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeChannelRef = useRef(activeChannel);
  activeChannelRef.current = activeChannel;

  // Auth
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCurrentUserId("demo-user"); setCurrentUserName("You");
      setTeamMembers([buildUser("demo-pi", "Dr. Sarah Chen"), buildUser("demo-ra", "Marcus Johnson"), buildUser("demo-grad", "Priya Patel")]);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setCurrentUserId(session.user.id);
      supabase.from("user_profiles").select("name").eq("id", session.user.id).single().then(({ data }) => { if (data?.name) setCurrentUserName(data.name as string); });
    });
  }, []);

  // Team members
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    async function load() {
      const table = isProjectView && subProjectId ? "sub_project_members" : "team_members";
      const fk = isProjectView && subProjectId ? "sub_project_id" : "project_id";
      const fv = isProjectView && subProjectId ? subProjectId : projectId;
      const { data } = await supabase.from(table).select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url)").eq(fk, fv as string);
      if (!data) return;
      setTeamMembers(data.filter(r => r.user_id !== currentUserId).map(r => {
        const p = (Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles) as Record<string, string> | null;
        const name = p?.name ?? "Unknown";
        return { id: r.user_id as string, name, email: "", role: "researcher" as const, avatarColor: p?.avatar_color ?? "#CBD5E1", avatarInitials: computeInitials(name) || (p?.avatar_initials ?? "??"), avatarUrl: p?.avatar_url ?? undefined };
      }));
    }
    load();
  }, [projectId, currentUserId, isProjectView, subProjectId]);

  // Persist active channel per project so navigating away and back restores position
  const channelRestoredRef = useRef(false);
  useEffect(() => {
    if (!projectId || channelRestoredRef.current) return;
    channelRestoredRef.current = true;
    try {
      const saved = localStorage.getItem(`chat_channel:${projectId}`) as ActiveChannel | null;
      if (saved) setActiveChannel(saved);
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    try { localStorage.setItem(`chat_channel:${projectId}`, String(activeChannel)); } catch { /* ignore */ }
  }, [activeChannel, projectId]);

  // Reset channel when scope changes (intentional navigation)
  useEffect(() => { setActiveChannel(defaultChannel); setThreadMsg(null); channelRestoredRef.current = false; }, [activeScope, subProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // F1: Presence
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    const presenceCh = supabase.channel(`presence:${projectId}`, {
      config: { presence: { key: currentUserId } },
    })
      .on("presence", { event: "sync" }, () => {
        const state = presenceCh.presenceState();
        setOnlineUserIds(new Set(Object.keys(state)));
      })
      .on("presence", { event: "join" }, ({ key }) => {
        setOnlineUserIds(prev => new Set([...prev, key as string]));
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        setOnlineUserIds(prev => { const n = new Set(prev); n.delete(key as string); return n; });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceCh.track({ user: currentUserId, at: Date.now() });
        }
      });
    return () => { supabase.removeChannel(presenceCh); };
  }, [projectId, currentUserId]);

  // F2: Unread counts -- filtered to current user only
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    async function loadUnread() {
      const { data } = await supabase
        .from("chat_read_state")
        .select("channel, last_read_at")
        .eq("user_id", currentUserId);
      if (!data || !data.length) return;
      const counts: Record<string, number> = {};
      await Promise.all(data.map(async row => {
        const { count } = await supabase
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("channel", row.channel as string)
          .is("thread_parent_id", null)
          .is("deleted_at", null)
          .gt("created_at", row.last_read_at as string);
        if ((count ?? 0) > 0) counts[row.channel as string] = count ?? 0;
      }));
      setUnreadCounts(counts);
    }
    loadUnread();
  }, [currentUserId, projectId]);

  // F2: Mark current channel read on switch
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);
    supabase.from("chat_read_state").upsert({ user_id: currentUserId, channel: key, last_read_at: new Date().toISOString() });
    setUnreadCounts(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, [activeChannel, currentUserId, projectId]);

  // Read receipts: load peer read states for active channel, subscribe to realtime
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);

    async function loadReadStates() {
      const { data } = await supabase
        .from("chat_read_state")
        .select("user_id, last_read_at")
        .eq("channel", key)
        .neq("user_id", currentUserId);
      if (!data) return;
      const states: Record<string, string> = {};
      for (const row of data) {
        states[row.user_id as string] = row.last_read_at as string;
      }
      setPeerReadStates(states);
    }

    loadReadStates();

    const ch = supabase.channel(`read_state:${key}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_read_state", filter: `channel=eq.${key}` }, payload => {
        if (payload.eventType === "DELETE") return;
        const row = payload.new as Record<string, unknown>;
        if (row.user_id === currentUserId) return;
        setPeerReadStates(prev => ({ ...prev, [row.user_id as string]: row.last_read_at as string }));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [projectId, currentUserId, activeChannel]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!projectId || !currentUserId) return;
    setLoading(true);
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);

    if (!isSupabaseConfigured) {
      setMessages([
        { id: "d1", channel: key, senderId: "demo-pi", senderName: "Dr. Sarah Chen", content: "Good morning! Lab meeting moved to Thursday.", createdAt: new Date(Date.now() - 7200000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 2, reactions: [{ emoji: "👍", count: 3, hasReacted: true }], mentionedUserIds: [], isPinned: false, threadLastReplierId: "demo-ra", attachments: [] },
        { id: "d2", channel: key, senderId: "demo-ra", senderName: "Marcus Johnson", content: "Thanks for the heads up! I'll update my calendar.", createdAt: new Date(Date.now() - 3300000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] },
        { id: "d3", channel: key, senderId: "demo-grad", senderName: "Priya Patel", content: "Will the agenda be the same? I was going to present my prelim results.", createdAt: new Date(Date.now() - 2400000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [{ emoji: "🎉", count: 2, hasReacted: false }], mentionedUserIds: [], isPinned: true, attachments: [] },
        { id: "d4", channel: key, senderId: "demo-pi", senderName: "Dr. Sarah Chen", content: "Yes! Priya you're still presenting first - looking forward to it.", createdAt: new Date(Date.now() - 1800000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: ["demo-grad"], isPinned: false, attachments: [] },
        { id: "d5", channel: key, senderId: "demo-user", senderName: "You", content: "See everyone Thursday!", createdAt: new Date(Date.now() - 300000).toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [] },
      ]);
      setLoading(false); return;
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, channel, sender_id, content, created_at, thread_parent_id, deleted_at, is_pinned, mentioned_user_ids, attachments")
      .eq("channel", key).is("thread_parent_id", null)
      .order("created_at", { ascending: true }).limit(200);
    if (error) { console.error("[Chat] fetch:", error); setLoading(false); return; }
    const rows = data ?? [];
    const sids = [...new Set(rows.map(r => r.sender_id as string))];
    const mids = rows.map(r => r.id as string);

    const [ps, tc, rx] = await Promise.all([
      sids.length
        ? supabase.from("user_profiles").select("id, name").in("id", sids).then(r => r.data ?? [])
        : Promise.resolve([]),
      mids.length
        ? supabase.from("chat_messages").select("thread_parent_id, sender_id").in("thread_parent_id", mids).is("deleted_at", null).order("created_at", { ascending: false }).then(r => r.data ?? [])
        : Promise.resolve([]),
      mids.length
        ? supabase.from("message_reactions").select("message_id, emoji, user_id").in("message_id", mids).then(r => r.data ?? [])
        : Promise.resolve([]),
    ]);

    const nameMap: Record<string, string> = {};
    for (const p of ps) nameMap[p.id as string] = p.name as string;

    const tcMap: Record<string, number> = {};
    const rxMap: Record<string, MessageReaction[]> = {};
    const lastReplierMap: Record<string, string> = {};
    for (const t of tc) {
      const pid = t.thread_parent_id as string;
      tcMap[pid] = (tcMap[pid] ?? 0) + 1;
      if (!lastReplierMap[pid]) lastReplierMap[pid] = t.sender_id as string;
    }
    for (const r of rx) {
      if (!rxMap[r.message_id]) rxMap[r.message_id] = [];
      const ex = rxMap[r.message_id].find(x => x.emoji === r.emoji);
      if (ex) { ex.count++; if (r.user_id === currentUserId) ex.hasReacted = true; }
      else rxMap[r.message_id].push({ emoji: r.emoji, count: 1, hasReacted: r.user_id === currentUserId });
    }

    setMessages(rows.map(row => ({
      id: row.id as string,
      channel: row.channel as string,
      senderId: row.sender_id as string,
      senderName: nameMap[row.sender_id as string] ?? "Unknown",
      content: row.content as string,
      createdAt: row.created_at as string,
      threadParentId: null,
      deletedAt: (row.deleted_at as string | null) ?? null,
      threadCount: tcMap[row.id as string] ?? 0,
      reactions: rxMap[row.id as string] ?? [],
      mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
      isPinned: (row.is_pinned as boolean) ?? false,
      threadLastReplierId: lastReplierMap[row.id as string],
      attachments: (row.attachments as MessageAttachment[]) ?? [],
    })));
    setLoading(false);
  }, [projectId, currentUserId, activeChannel]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Scroll handling
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNewMessages(false);
  }

  function scrollToBottom() { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setHasNewMessages(false); }

  useEffect(() => {
    const count = messages.length;
    if (count > lastCountRef.current) {
      if (isAtBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      else if (lastCountRef.current > 0) setHasNewMessages(true);
    }
    lastCountRef.current = count;
  }, [messages.length, isAtBottom]);

  // Realtime
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);
    const ch = supabase.channel(`chat:${key}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel=eq.${key}` }, async payload => {
        const row = payload.new as Record<string, unknown>;
        if (row.thread_parent_id) {
          setMessages(prev => prev.map(m => m.id === row.thread_parent_id ? { ...m, threadCount: m.threadCount + 1, threadLastReplierId: row.sender_id as string } : m));
          return;
        }
        let name = "Unknown";
        const { data: p } = await supabase.from("user_profiles").select("name").eq("id", row.sender_id as string).single();
        if (p?.name) name = p.name as string;
        const nm: ChatMessage = {
          id: row.id as string, channel: row.channel as string,
          senderId: row.sender_id as string, senderName: name,
          content: row.content as string, createdAt: row.created_at as string,
          threadParentId: null, deletedAt: null, threadCount: 0, reactions: [],
          mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
          isPinned: (row.is_pinned as boolean) ?? false,
          attachments: (row.attachments as MessageAttachment[]) ?? [],
        };
        setMessages(prev => prev.some(m => m.id === nm.id) ? prev : [...prev, nm]);
        if (projectId && row.channel !== resolveChannelKey(projectId, currentUserId, activeChannelRef.current)) {
          setUnreadCounts(prev => ({ ...prev, [row.channel as string]: (prev[row.channel as string] ?? 0) + 1 }));
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `channel=eq.${key}` }, payload => {
        const row = payload.new as Record<string, unknown>;
        if (row.thread_parent_id) return;
        setMessages(prev => prev.map(m => m.id === row.id ? {
          ...m,
          content: row.content as string,
          deletedAt: (row.deleted_at as string | null) ?? null,
          isPinned: (row.is_pinned as boolean) ?? m.isPinned,
          threadLastReplierId: (row.thread_last_replier_id as string | undefined) ?? m.threadLastReplierId,
        } : m));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, payload => {
        const row = payload.new as Record<string, unknown>;
        setMessages(prev => prev.map(m => {
          if (m.id !== row.message_id) return m;
          const ex = m.reactions.find(r => r.emoji === row.emoji);
          if (ex) return { ...m, reactions: m.reactions.map(r => r.emoji === row.emoji ? { ...r, count: r.count + 1, hasReacted: r.hasReacted || row.user_id === currentUserId } : r) };
          return { ...m, reactions: [...m.reactions, { emoji: row.emoji as string, count: 1, hasReacted: row.user_id === currentUserId }] };
        }));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, payload => {
        const row = payload.old as Record<string, unknown>;
        setMessages(prev => prev.map(m => {
          if (m.id !== row.message_id) return m;
          return { ...m, reactions: m.reactions.map(r => r.emoji === row.emoji ? { ...r, count: Math.max(0, r.count - 1), hasReacted: row.user_id === currentUserId ? false : r.hasReacted } : r).filter(r => r.count > 0) };
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, currentUserId, activeChannel]);

  // Typing
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);
    const ch = supabase.channel(`typing:${key}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { userId, name } = payload as { userId: string; name: string };
        if (userId === currentUserId) return;
        setTypingUsers(prev => prev.some(u => u.userId === userId) ? prev : [...prev, { userId, name }]);
        const old = typingTimers.current.get(userId);
        if (old) clearTimeout(old);
        const tid = setTimeout(() => { setTypingUsers(p => p.filter(u => u.userId !== userId)); typingTimers.current.delete(userId); }, 3000);
        typingTimers.current.set(userId, tid);
      })
      .subscribe();
    typingChRef.current = ch;
    return () => { supabase.removeChannel(ch); typingTimers.current.forEach(t => clearTimeout(t)); typingTimers.current.clear(); };
  }, [projectId, currentUserId, activeChannel]);

  function broadcastTyping() {
    if (!isSupabaseConfigured || !typingChRef.current) return;
    try { typingChRef.current.send({ type: "broadcast", event: "typing", payload: { userId: currentUserId, name: currentUserName } }); } catch { /* ignore */ }
  }

  // F7: File handling
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    for (const file of files) {
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setPendingAttachments(prev => [...prev, { file, preview }]);
    }
    e.target.value = "";
  }

  async function uploadAttachments(): Promise<MessageAttachment[]> {
    if (!pendingAttachments.length) return [];
    if (!isSupabaseConfigured) {
      return pendingAttachments.map(a => ({ url: a.preview ?? "", name: a.file.name, type: a.file.type, size: a.file.size }));
    }
    const results: MessageAttachment[] = [];
    for (const { file, preview } of pendingAttachments) {
      const path = `${currentUserId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("chat-attachments").upload(path, file);
      if (error) { console.error("[Chat] upload:", error); continue; }
      const { data: { publicUrl } } = supabase.storage.from("chat-attachments").getPublicUrl(path);
      if (preview) URL.revokeObjectURL(preview);
      results.push({ url: publicUrl, name: file.name, type: file.type, size: file.size });
    }
    return results;
  }

  async function sendMessage(text: string, capturedMentionIds: string[]) {
    if (!text && !pendingAttachments.length || sending || !currentUserId || !projectId) return;
    setSending(true);
    setSendError(null);
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);

    if (!isSupabaseConfigured) {
      try {
        const attachments = await uploadAttachments();
        setMessages(p => [...p, { id: crypto.randomUUID(), channel: key, senderId: currentUserId, senderName: currentUserName, content: text, createdAt: new Date().toISOString(), threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: capturedMentionIds, isPinned: false, attachments }]);
        setPendingAttachments([]);
      } finally {
        setSending(false);
      }
      return;
    }

    try {
      const attachments = await uploadAttachments();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const { error } = await supabase.from("chat_messages").insert({
        id, channel: key, sender_id: currentUserId, content: text,
        created_at: createdAt, thread_parent_id: null,
        mentioned_user_ids: capturedMentionIds, attachments,
      });
      if (error) throw error;

      setMessages(p => [...p, { id, channel: key, senderId: currentUserId, senderName: currentUserName, content: text, createdAt, threadParentId: null, deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: capturedMentionIds, isPinned: false, attachments }]);
      setPendingAttachments([]);

      const toNotify = capturedMentionIds.filter(uid => uid !== currentUserId);
      if (toNotify.length) {
        const notifs = toNotify.map(uid => ({
          user_id: uid, type: "task_mention",
          title: `${currentUserName} mentioned you in ${channelLabel()}`,
          body: text.slice(0, 100), related_id: id, read: false,
        }));
        supabase.from("notifications").insert(notifs).then(({ error: ne }) => {
          if (ne) console.error("[Chat] mention notif:", { message: ne.message, code: ne.code });
        });
      }
    } catch (err) {
      const e = err as { message?: string; details?: string; hint?: string; code?: string };
      console.error("[Chat] send error:", { message: e?.message, details: e?.details, hint: e?.hint, code: e?.code });
      setSendError(e?.message ?? "Message failed to send.");
    } finally {
      setSending(false);
    }
  }

  function handleEdit(id: string, content: string) {
    setMessages(p => p.map(m => m.id === id ? { ...m, content } : m));
    if (threadMsg?.id === id) setThreadMsg(t => t ? { ...t, content } : t);
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ content }).eq("id", id).then(({ error }) => { if (error) console.error("[Chat] edit:", error); });
  }

  function handleDelete(id: string) {
    const msg = messages.find(m => m.id === id);
    if (!msg) return;
    const now = new Date().toISOString();
    setMessages(p => p.map(m => m.id === id ? { ...m, deletedAt: now } : m));
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ deleted_at: now }).eq("id", id).then(({ error }) => { if (error) console.error("[Chat] delete:", error); });
    showUndoToast("Message deleted",
      () => { setMessages(p => p.map(m => m.id === id ? { ...m, deletedAt: null } : m)); if (isSupabaseConfigured) supabase.from("chat_messages").update({ deleted_at: null }).eq("id", id).then(({ error }) => { if (error) console.error("[Chat] undo delete:", error); }); },
      async () => { /* already applied */ },
    );
  }

  // F4: Pin handler
  function handlePin(id: string, pin: boolean) {
    setMessages(p => p.map(m => m.id === id ? { ...m, isPinned: pin } : m));
    if (isSupabaseConfigured) supabase.from("chat_messages").update({ is_pinned: pin }).eq("id", id).then(({ error }) => { if (error) console.error("[Chat] pin:", error); });
  }

  async function handleReact(msgId: string, emoji: string) {
    const msg = messages.find(m => m.id === msgId);
    const alreadyReacted = msg?.reactions.find(r => r.emoji === emoji)?.hasReacted;

    // Optimistic update - applies immediately regardless of Supabase status
    setMessages(p => p.map(m => {
      if (m.id !== msgId) return m;
      const ex = m.reactions.find(r => r.emoji === emoji);
      if (alreadyReacted) {
        return { ...m, reactions: m.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count - 1, hasReacted: false } : r).filter(r => r.count > 0) };
      }
      if (ex) return { ...m, reactions: m.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, hasReacted: true } : r) };
      return { ...m, reactions: [...m.reactions, { emoji, count: 1, hasReacted: true }] };
    }));

    if (!isSupabaseConfigured) return;
    if (alreadyReacted) {
      await supabase.from("message_reactions").delete().eq("message_id", msgId).eq("user_id", currentUserId).eq("emoji", emoji);
    } else {
      await supabase.from("message_reactions").upsert({ message_id: msgId, user_id: currentUserId, emoji });
    }
  }

  function handleReplyAdded(parentId: string, replierId: string) {
    setMessages(prev => prev.map(m => m.id === parentId ? { ...m, threadCount: m.threadCount + 1, threadLastReplierId: replierId } : m));
  }

  // F5: Search
  async function runSearch(q: string) {
    if (!q.trim() || !projectId || !currentUserId) return;
    setSearching(true);
    const key = resolveChannelKey(projectId, currentUserId, activeChannel);
    if (!isSupabaseConfigured) {
      const results = messages.filter(m => !m.deletedAt && m.content.toLowerCase().includes(q.toLowerCase()));
      setSearchResults(results);
      setSearching(false);
      return;
    }
    const { data } = await supabase.from("chat_messages")
      .select("id, channel, sender_id, content, created_at, is_pinned, mentioned_user_ids, attachments")
      .eq("channel", key).is("thread_parent_id", null).is("deleted_at", null)
      .ilike("content", `%${q}%`)
      .order("created_at", { ascending: false }).limit(20);
    const nameMap: Record<string, string> = {};
    const sids = [...new Set((data ?? []).map(r => r.sender_id as string))];
    if (sids.length) {
      const { data: ps } = await supabase.from("user_profiles").select("id, name").in("id", sids);
      for (const p of ps ?? []) nameMap[p.id as string] = p.name as string;
    }
    setSearchResults((data ?? []).map(row => ({
      id: row.id as string, channel: row.channel as string,
      senderId: row.sender_id as string, senderName: nameMap[row.sender_id as string] ?? "Unknown",
      content: row.content as string, createdAt: row.created_at as string,
      threadParentId: null, deletedAt: null, threadCount: 0, reactions: [],
      mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
      isPinned: (row.is_pinned as boolean) ?? false, attachments: (row.attachments as MessageAttachment[]) ?? [],
    })));
    setSearching(false);
  }

  function jumpToMessage(id: string) {
    setSearchOpen(false);
    setHighlightedMsgId(id);
    setTimeout(() => { msgRefsMap.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50);
    setTimeout(() => setHighlightedMsgId(null), 2000);
  }

  function toggleSidebar() {
    setChatSidebarCollapsed(v => { const next = !v; try { localStorage.setItem("chat_sidebar_collapsed", String(next)); } catch { /* ignore */ } return next; });
  }

  function channelLabel(): string {
    if (activeChannel === "lab") return "Lab";
    if (activeChannel.startsWith("dm:")) { const pid = activeChannel.slice(3); return teamMembers.find(m => m.id === pid)?.name ?? "Direct Message"; }
    return subProjects.find(sp => sp.id === activeChannel)?.name ?? "Channel";
  }

  const visibleSubProjects = isProjectView ? subProjects.filter(sp => sp.id === subProjectId) : subProjects;

  const isDm = activeChannel.startsWith("dm:");
  const dmPeer = isDm ? teamMembers.find(m => m.id === activeChannel.slice(3)) ?? null : null;
  const dmPeerOnline = dmPeer ? onlineUserIds.has(dmPeer.id) : false;

  const chatSections: ScopeSection[] = !isProjectView
    ? [{
        id: "lab", label: "Lab", color: "var(--color-navy)", icon: <Hash size={17} />, isActive: activeChannel === "lab",
        onClick: () => { setActiveChannel("lab"); setMessages([]); setThreadMsg(null); },
        count: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, "lab")] || undefined,
      }]
    : visibleSubProjects.map(sp => ({
        id: sp.id, label: sp.name, color: sp.color ?? "var(--color-navy)", icon: <Hash size={17} />,
        isActive: activeChannel === sp.id,
        onClick: () => { setActiveChannel(sp.id); setMessages([]); setThreadMsg(null); },
        count: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, sp.id)] || undefined,
      }));

  // Full collapsed rail: all channels + DMs as icon items
  const collapsedRailItems: ScopeSection[] = [
    ...chatSections,
    ...teamMembers.map(peer => ({
      id: `dm:${peer.id}`,
      label: peer.name,
      color: "var(--color-navy)",
      icon: (
        <span style={{ position: "relative", display: "inline-flex" }}>
          <Avatar user={peer} size={22} />
          <span style={{ position: "absolute", bottom: 0, right: 0, width: 7, height: 7, borderRadius: "50%", backgroundColor: onlineUserIds.has(peer.id) ? "#22c55e" : "var(--color-secondary)", border: "1.5px solid var(--color-canvas)", opacity: onlineUserIds.has(peer.id) ? 1 : 0.45 }} />
        </span>
      ),
      isActive: activeChannel === `dm:${peer.id}`,
      onClick: () => { setActiveChannel(`dm:${peer.id}`); setMessages([]); setThreadMsg(null); },
      count: unreadCounts[resolveChannelKey(projectId ?? "", currentUserId, `dm:${peer.id}`)] || undefined,
    })),
  ];

  const chatExtra = (
    <>
      {!isProjectView && visibleSubProjects.length > 0 && (
        <>
          <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "5px 2px" }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 11px 4px", margin: 0 }}>Projects</p>
          {visibleSubProjects.map(sp => {
            const act = activeChannel === sp.id;
            const c = sp.color ?? "var(--color-navy)";
            const chKey = resolveChannelKey(projectId ?? "", currentUserId, sp.id);
            const unread = unreadCounts[chKey] ?? 0;
            return (
              <button key={sp.id} onClick={() => { setActiveChannel(sp.id); setMessages([]); setThreadMsg(null); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${act ? c : "transparent"}`, cursor: "pointer", backgroundColor: act ? `${c}18` : "transparent", fontFamily: "var(--font-roboto)", textAlign: "left", boxSizing: "border-box", marginBottom: 1 }}
                onMouseEnter={e => { if (!act) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { if (!act) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <MessageSquare size={13} style={{ color: act ? c : "var(--color-secondary)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: act ? c : "var(--color-body)", fontWeight: act || unread > 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{sp.name}</span>
                {unread > 0 && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: "var(--color-navy)", color: "#fff", borderRadius: 10, padding: "1px 6px", flexShrink: 0 }}>{unread}</span>}
              </button>
            );
          })}
        </>
      )}
      {teamMembers.length > 0 && (
        <>
          <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "5px 2px" }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 11px 4px", margin: 0 }}>Direct Messages</p>
          {teamMembers.map(peer => {
            const id = `dm:${peer.id}`;
            const act = activeChannel === id;
            const c = "var(--color-navy)";
            const isOnline = onlineUserIds.has(peer.id);
            const chKey = resolveChannelKey(projectId ?? "", currentUserId, id);
            const unread = unreadCounts[chKey] ?? 0;
            return (
              <button key={id} onClick={() => { setActiveChannel(id); setMessages([]); setThreadMsg(null); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px 6px 11px", borderRadius: 7, border: "none", borderLeft: `3px solid ${act ? c : "transparent"}`, cursor: "pointer", backgroundColor: act ? `${c}18` : "transparent", fontFamily: "var(--font-roboto)", textAlign: "left", boxSizing: "border-box", marginBottom: 1 }}
                onMouseEnter={e => { if (!act) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { if (!act) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <span style={{ flexShrink: 0, position: "relative", display: "inline-flex" }}>
                  <span style={{ borderRadius: "50%", boxShadow: "0 0 0 2px var(--color-canvas)", display: "flex" }}><Avatar user={peer} size={22} /></span>
                  <span style={{ position: "absolute", bottom: 0, right: 0, width: 7, height: 7, borderRadius: "50%", backgroundColor: isOnline ? "#22c55e" : "var(--color-secondary)", border: "1.5px solid var(--color-canvas)", opacity: isOnline ? 1 : 0.45 }} aria-hidden="true" />
                </span>
                <span style={{ fontSize: 13, color: act ? c : "var(--color-body)", fontWeight: act || unread > 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{peer.name}</span>
                {unread > 0 && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: "var(--color-navy)", color: "#fff", borderRadius: 10, padding: "1px 6px", flexShrink: 0 }}>{unread}</span>}
              </button>
            );
          })}
        </>
      )}
    </>
  );

  if (projectLoading) return <div className="flex h-full items-center justify-center" style={{ color: "var(--color-secondary)", fontSize: 13 }}>Loading...</div>;

  const memberCount = teamMembers.length + 1;
  const pinnedCount = messages.filter(m => m.isPinned && !m.deletedAt).length;

  // Read receipt: which peers have seen the last visible message
  const lastMsg = messages.filter(m => !m.deletedAt).at(-1);
  const seenPeerIds = lastMsg
    ? Object.entries(peerReadStates)
        .filter(([, ts]) => ts >= lastMsg.createdAt)
        .map(([uid]) => uid)
    : [];
  // For demo mode, simulate "seen" after 5 minutes
  const demoSeen = !isSupabaseConfigured && lastMsg && Date.now() - new Date(lastMsg.createdAt).getTime() > 300000;

  return (
    <>
      <style>{`@keyframes typBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}`}</style>
      <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx" style={{ display: "none" }} onChange={handleFileSelect} />
      <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-roboto)", overflow: "hidden" }}>
        <PageHeader title={channelLabel()} eyebrow="Chat">
          <div className="flex items-center gap-2 flex-1">
            {isDm && dmPeer ? (
              <>
                <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                  <Avatar user={dmPeer} size={22} />
                  <span style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", backgroundColor: dmPeerOnline ? "#22c55e" : "var(--color-secondary)", border: "1.5px solid var(--color-surface)", opacity: dmPeerOnline ? 1 : 0.45 }} aria-label={dmPeerOnline ? "Online" : "Offline"} />
                </span>
                <span style={{ fontSize: 13, color: "var(--color-secondary)" }}>{dmPeerOnline ? "Online" : "Offline"}</span>
              </>
            ) : (
              <>
                {!isDm && <Hash size={14} style={{ color: "var(--color-secondary)", flexShrink: 0 }} />}
                <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{memberCount} members</span>
              </>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setShowPinned(v => !v)}
                title="Pinned messages"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "none", background: showPinned ? "rgba(27,46,75,0.08)" : "transparent", cursor: "pointer", color: showPinned ? "var(--color-navy)" : "var(--color-secondary)", fontSize: 12 }}
              >
                <Pin size={13} />
                {pinnedCount > 0 && <span style={{ fontWeight: 600 }}>{pinnedCount}</span>}
              </button>
              <button
                onClick={() => { setSearchOpen(v => !v); if (searchOpen) { setSearchQuery(""); setSearchResults([]); } }}
                title="Search messages"
                style={{ display: "flex", alignItems: "center", padding: "4px 6px", borderRadius: 6, border: "none", background: searchOpen ? "rgba(27,46,75,0.08)" : "transparent", cursor: "pointer", color: searchOpen ? "var(--color-navy)" : "var(--color-secondary)" }}
              >
                <Search size={14} />
              </button>
            </div>
          </div>
        </PageHeader>

        {searchOpen && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", flexShrink: 0, display: "flex", gap: 8, alignItems: "center" }}>
            <Search size={14} color="var(--color-secondary)" style={{ flexShrink: 0 }} />
            <input
              autoFocus
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); runSearch(e.target.value); }}
              placeholder={`Search in ${channelLabel()}...`}
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}
            />
            {searching && <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>Searching...</span>}
            <button onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)", display: "flex", padding: 2 }}><X size={14} /></button>
          </div>
        )}

        {searchOpen && searchResults.length > 0 && (
          <div style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", flexShrink: 0, maxHeight: 260, overflowY: "auto" }}>
            {searchResults.map(r => (
              <button key={r.id} onClick={() => jumpToMessage(r.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 16px", borderBottom: "1px solid var(--color-border)", border: "none", background: "none", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-surface-2)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 2 }}>{r.senderName}</div>
                <div style={{ fontSize: 13, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.content}</div>
              </button>
            ))}
          </div>
        )}
        {searchOpen && searchQuery && !searching && searchResults.length === 0 && (
          <div style={{ padding: "10px 16px", backgroundColor: "var(--color-canvas)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>No results for "{searchQuery}"</span>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <ScopeSidebar
            storageKey="chat_sidebar"
            sections={chatSections}
            extraContent={chatExtra}
            collapsed={chatSidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            headerLabel="Chats"
            collapsedRailItems={collapsedRailItems}
          />

          <div className="flex flex-col flex-1 overflow-hidden" style={{ position: "relative" }}>
            <div
              className="flex-1 overflow-y-auto"
              style={{ backgroundColor: "var(--color-canvas)", position: "relative" }}
              onScroll={handleScroll}
            >
              {loading && <div className="flex items-center justify-center py-10" style={{ color: "var(--color-secondary)", fontSize: 13 }}>Loading messages...</div>}
              {!loading && messages.length === 0 && (
                isDm && dmPeer ? (
                  <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center gap-4">
                    <span style={{ position: "relative", display: "inline-flex" }}>
                      <Avatar user={dmPeer} size={64} />
                      <span style={{ position: "absolute", bottom: 2, right: 2, width: 14, height: 14, borderRadius: "50%", backgroundColor: dmPeerOnline ? "#22c55e" : "var(--color-secondary)", border: "2px solid var(--color-canvas)", opacity: dmPeerOnline ? 1 : 0.45 }} />
                    </span>
                    <div>
                      <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-body)", margin: 0 }}>{dmPeer.name}</p>
                      <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "6px 0 0" }}>This is the start of your conversation with {dmPeer.name}.</p>
                    </div>
                    <button onClick={() => {}} style={{ marginTop: 4, fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 7, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer" }}>Say hello</button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center gap-3">
                    <Hash size={40} style={{ color: "var(--color-border)" }} />
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>Welcome to #{channelLabel()}</p>
                    <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>This is the beginning of the #{channelLabel()} channel. Be the first to post something.</p>
                    <button onClick={() => {}} style={{ marginTop: 6, fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 7, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer" }}>Send a message</button>
                  </div>
                )
              )}
              {!loading && messages.length > 0 && (
                <div style={{ paddingTop: 12, paddingBottom: 4 }}>
                  {messages.map((msg, i) => {
                    const prev = i > 0 ? messages[i - 1] : null;
                    const showDiv = !prev || !sameDay(prev.createdAt, msg.createdAt);
                    const isLastVisible = i === messages.length - 1;
                    return (
                      <div
                        key={msg.id}
                        ref={el => { if (el) msgRefsMap.current.set(msg.id, el); else msgRefsMap.current.delete(msg.id); }}
                        style={{ transition: "background-color 0.3s", backgroundColor: highlightedMsgId === msg.id ? "rgba(14,165,233,0.10)" : "transparent" }}
                      >
                        {showDiv && <DateDivider iso={msg.createdAt} />}
                        <MessageRow msg={msg} prevMsg={prev} currentUserId={currentUserId} onEdit={handleEdit} onDelete={handleDelete} onReact={handleReact} onOpenThread={setThreadMsg} onPin={handlePin} teamMembers={teamMembers} />
                        {/* Read receipts under last message */}
                        {isLastVisible && (seenPeerIds.length > 0 || demoSeen) && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px 4px 52px" }}>
                            {isDm ? (
                              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>Seen</span>
                            ) : (
                              <>
                                {(demoSeen ? teamMembers.slice(0, 2) : seenPeerIds.slice(0, 5).map(uid => teamMembers.find(m => m.id === uid)).filter(Boolean) as User[]).map((peer, idx) => (
                                  <span key={peer.id} title={`Seen by ${peer.name}`} style={{ display: "inline-flex", borderRadius: "50%", border: "1.5px solid var(--color-canvas)", marginLeft: idx > 0 ? -6 : 0 }}>
                                    <Avatar user={peer} size={14} />
                                  </span>
                                ))}
                                <span style={{ fontSize: 11, color: "var(--color-secondary)", marginLeft: 4 }}>Seen</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
              {hasNewMessages && (
                <button onClick={scrollToBottom} style={{ position: "sticky", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", whiteSpace: "nowrap" }}>
                  New messages <ChevronDown size={13} />
                </button>
              )}
            </div>

            <TypingIndicator names={typingUsers.map(u => u.name)} />

            <ChatComposer
              channelLabel={channelLabel()}
              teamMembers={teamMembers}
              sending={sending}
              sendError={sendError}
              onSend={sendMessage}
              onTyping={broadcastTyping}
              onAttach={() => fileInputRef.current?.click()}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={i => setPendingAttachments(p => p.filter((_, j) => j !== i))}
            />
          </div>

          {showPinned && (
            <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Pin size={13} color="var(--color-navy)" />
                  <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 14, color: "var(--color-navy)" }}>Pinned Messages</span>
                </div>
                <button onClick={() => setShowPinned(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 6, color: "var(--color-secondary)" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-surface-2)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                ><X size={15} /></button>
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {messages.filter(m => m.isPinned && !m.deletedAt).length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--color-secondary)", textAlign: "center", padding: "24px 16px" }}>No pinned messages in this channel.</p>
                ) : messages.filter(m => m.isPinned && !m.deletedAt).map(m => (
                  <button key={m.id} onClick={() => jumpToMessage(m.id)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--color-border)", border: "none", background: "none", cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 2 }}>{m.senderName}</div>
                    <div style={{ fontSize: 13, color: "var(--color-body)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>{m.content}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {threadMsg && (
            <ThreadPanel
              parent={threadMsg}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              projectId={projectId ?? ""}
              onClose={() => setThreadMsg(null)}
              onReact={handleReact}
              onReplyAdded={handleReplyAdded}
            />
          )}
        </div>
      </div>
    </>
  );
}
