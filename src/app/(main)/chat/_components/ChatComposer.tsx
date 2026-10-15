"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold, Italic, Strikethrough, Link2, List, ListOrdered,
  Quote, Code, Code2, Mic, MicOff, Send, Loader2, AlertCircle,
  RotateCcw,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import type { User } from "@/types";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingAttachment {
  file: File;
  preview?: string;
}

interface ComposerProps {
  channelLabel: string;
  teamMembers: User[];
  sending: boolean;
  sendError: string | null;
  onSend: (text: string, mentionIds: string[]) => void;
  onTyping: () => void;
  onAttach: () => void;
  pendingAttachments: PendingAttachment[];
  onRemoveAttachment: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
}

// ── Speech recognition ────────────────────────────────────────────────────────

interface ISpeechRecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface ISpeechRecognitionResultList { length: number; [i: number]: ISpeechRecognitionResult }
interface ISpeechRecognitionEvent { resultIndex: number; results: ISpeechRecognitionResultList }
interface ISpeechRecognitionErrorEvent { error: string }
interface ISpeechRecognition {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: ISpeechRecognitionErrorEvent) => void) | null;
}
interface ISpeechRecognitionWindow {
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
}

function hasSpeechSupport(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as ISpeechRecognitionWindow;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

function getSpeechClass(): (new () => ISpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as ISpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Formatting helper ─────────────────────────────────────────────────────────

function wrapSelection(
  el: HTMLTextAreaElement,
  prefix: string,
  suffix: string,
  setter: (v: string) => void,
) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  const before = value.slice(0, s);
  const sel = value.slice(s, e);
  const after = value.slice(e);
  const next = before + prefix + sel + suffix + after;
  setter(next);
  requestAnimationFrame(() => {
    el.focus();
    const cursor = s + prefix.length + sel.length;
    el.setSelectionRange(cursor, cursor);
  });
}

function prependLines(
  el: HTMLTextAreaElement,
  linePrefix: string,
  setter: (v: string) => void,
) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  const beforeSel = value.slice(0, s);
  const lineStart = beforeSel.lastIndexOf("\n") + 1;
  const selBlock = value.slice(lineStart, e);
  const prefixed = selBlock
    .split("\n")
    .map((line, i) => {
      if (linePrefix === "1. ") return `${i + 1}. ${line.replace(/^\d+\.\s?/, "")}`;
      return linePrefix + line.replace(new RegExp(`^${linePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
    })
    .join("\n");
  const next = value.slice(0, lineStart) + prefixed + value.slice(e);
  setter(next);
  requestAnimationFrame(() => { el.focus(); });
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function TB({
  label, onClick, active, children, kbd,
}: {
  label: string; onClick: () => void; active?: boolean; children: React.ReactNode; kbd?: string;
}) {
  return (
    <button
      type="button"
      title={kbd ? `${label} (${kbd})` : label}
      aria-label={label}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 5, border: "none", cursor: "pointer",
        backgroundColor: active ? "rgba(14,165,233,0.12)" : "transparent",
        color: active ? "var(--color-navy)" : "var(--color-secondary)",
        transition: "background-color 0.1s, color 0.1s",
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.06)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-body)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-secondary)";
        }
      }}
    >
      {children}
    </button>
  );
}

const DIVIDER = (
  <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)", flexShrink: 0, margin: "0 2px" }} />
);

// ── ChatComposer ──────────────────────────────────────────────────────────────

export function ChatComposer({
  channelLabel, teamMembers, sending, sendError, onSend, onTyping,
  onAttach, pendingAttachments, onRemoveAttachment, disabled, placeholder,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [capturedMentionIds, setCapturedMentionIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Grammar
  const [grammarState, setGrammarState] = useState<"idle" | "loading" | "preview">("idle");
  const [originalText, setOriginalText] = useState("");
  const [correctedText, setCorrectedText] = useState("");

  // Voice
  const [micSupported, setMicSupported] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const draftBaseRef = useRef("");

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMicSupported(hasSpeechSupport());
  }, []);

  // Grammar fix
  async function handleFixGrammar() {
    if (!draft.trim() || grammarState === "loading") return;
    setOriginalText(draft);
    setGrammarState("loading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/fix-grammar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ text: draft }),
      });
      if (!res.ok) throw new Error("failed");
      const { corrected } = (await res.json()) as { corrected: string };
      setCorrectedText(corrected);
      setGrammarState("preview");
    } catch {
      setGrammarState("idle");
    }
  }

  // Voice
  function startRecording() {
    const SR = getSpeechClass();
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    draftBaseRef.current = draft;
    r.onresult = (e: ISpeechRecognitionEvent) => {
      let added = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) added += e.results[i][0].transcript + " ";
      }
      const base = draftBaseRef.current;
      const combined = (base + (base && added ? " " : "") + added).trimStart().replace(/  +/g, " ");
      setDraft(combined);
      draftBaseRef.current = combined;
    };
    r.onend = () => setRecording(false);
    r.onerror = (e: ISpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") setMicDenied(true);
      setRecording(false);
    };
    recognitionRef.current = r;
    try { r.start(); setRecording(true); } catch { /* ignore */ }
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  // @mention autocomplete
  const mentionCandidates = mentionQuery === null ? [] :
    teamMembers.filter(m => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5);

  function insertMention(member: User) {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@\w*$/, `@${member.name} `);
    const after = draft.slice(cursor);
    const next = before + after;
    setDraft(next);
    setCapturedMentionIds(prev => prev.includes(member.id) ? prev : [...prev, member.id]);
    setMentionQuery(null);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    }, 10);
  }

  const canSend = (draft.trim().length > 0 || pendingAttachments.length > 0) && !sending && !disabled;

  function handleSend() {
    if (!canSend) return;
    const text = draft.trim();
    onSend(text, capturedMentionIds);
    // Parent is responsible for clearing draft on success.
    // We optimistically clear locally; parent will re-set on error via sendError.
    setDraft("");
    setCapturedMentionIds([]);
    setGrammarState("idle");
  }

  // Expose clear method for parent (via the sendError: when null after a send, draft already cleared)
  // If sendError appears, draft should be restored by parent keeping the text in view.
  // Since draft is internal, we need a way to restore it. Let's use a ref.
  const lastDraftRef = useRef("");
  function handleSendWithRestore() {
    if (!canSend) return;
    lastDraftRef.current = draft.trim();
    handleSend();
  }

  // If sendError appears, restore draft so user can retry
  const prevSendError = useRef<string | null>(null);
  useEffect(() => {
    if (sendError && !prevSendError.current && lastDraftRef.current && !draft) {
      setDraft(lastDraftRef.current);
    }
    prevSendError.current = sendError;
  }, [sendError, draft]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention autocomplete navigation
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionCandidates.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionCandidates[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }

    // Send
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendWithRestore(); return; }

    // Formatting shortcuts
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const el = inputRef.current;
    if (!el) return;
    if (e.key === "b") { e.preventDefault(); wrapSelection(el, "**", "**", setDraft); return; }
    if (e.key === "i") { e.preventDefault(); wrapSelection(el, "_", "_", setDraft); return; }
    if (e.key === "X" && e.shiftKey) { e.preventDefault(); wrapSelection(el, "~~", "~~", setDraft); return; }
    if (e.key === "k") { e.preventDefault(); wrapSelection(el, "[", "](url)", setDraft); return; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionQuery, mentionCandidates, mentionIndex, draft, canSend]);

  const toolbarEl = inputRef.current;

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", flexShrink: 0 }}>

      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {pendingAttachments.map((a, i) => (
            <div key={i} style={{ position: "relative", display: "inline-flex" }}>
              {a.preview ? (
                <img src={a.preview} alt={a.file.name} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border)" }} />
              ) : (
                <div style={{ width: 72, height: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", gap: 3 }}>
                  <span style={{ fontSize: 9, color: "var(--color-secondary)", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{a.file.name}</span>
                  <span style={{ fontSize: 9, color: "var(--color-secondary)" }}>{formatBytes(a.file.size)}</span>
                </div>
              )}
              <button onClick={() => onRemoveAttachment(i)}
                style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", backgroundColor: "var(--color-error, #dc2626)", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Error banner */}
      {sendError && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 10px", backgroundColor: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 7, fontSize: 12, color: "var(--color-error, #dc2626)" }}>
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{sendError}</span>
          <button
            onClick={handleSendWithRestore}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--color-error, #dc2626)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(220,38,38,0.10)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <RotateCcw size={11} /> Retry
          </button>
        </div>
      )}

      {/* Grammar diff preview */}
      {grammarState === "preview" && (
        <div style={{ marginBottom: 8, borderRadius: 8, border: "1px solid var(--color-border)", overflow: "hidden", fontSize: 12 }}>
          <div style={{ padding: "8px 12px", backgroundColor: "#FFF5F5", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#C0392B", display: "block", marginBottom: 3 }}>Original</span>
            <span style={{ color: "#C0392B", textDecoration: "line-through", lineHeight: 1.6 }}>{originalText}</span>
          </div>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#2E7D52", display: "block", marginBottom: 3 }}>Corrected</span>
            <span style={{ color: "#2E7D52", lineHeight: 1.6 }}>{correctedText}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: "7px 12px", backgroundColor: "var(--color-canvas)" }}>
            <button onClick={() => setGrammarState("idle")} style={{ fontSize: 11, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 5, padding: "4px 10px", backgroundColor: "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>Discard</button>
            <button onClick={() => { setDraft(correctedText); setGrammarState("idle"); inputRef.current?.focus(); }} style={{ fontSize: 11, fontWeight: 700, color: "#fff", backgroundColor: "#2E7D52", border: "none", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>Accept</button>
          </div>
        </div>
      )}

      {/* @mention autocomplete */}
      <div style={{ position: "relative" }}>
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden" }}>
            {mentionCandidates.map((m, i) => (
              <button key={m.id} onMouseDown={e => { e.preventDefault(); insertMention(m); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", border: "none", background: i === mentionIndex ? "rgba(14,165,233,0.08)" : "transparent", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(14,165,233,0.08)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = i === mentionIndex ? "rgba(14,165,233,0.08)" : "transparent")}
              >
                <Avatar user={m} size={20} />
                <span style={{ fontSize: 13, color: "var(--color-body)" }}>{m.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Main composer box */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, backgroundColor: "var(--color-canvas)", overflow: "hidden" }}>

          {/* Formatting toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "5px 8px 0", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
            <TB label="Bold" kbd="Cmd+B" onClick={() => toolbarEl && wrapSelection(toolbarEl, "**", "**", setDraft)}>
              <Bold size={13} />
            </TB>
            <TB label="Italic" kbd="Cmd+I" onClick={() => toolbarEl && wrapSelection(toolbarEl, "_", "_", setDraft)}>
              <Italic size={13} />
            </TB>
            <TB label="Strikethrough" kbd="Cmd+Shift+X" onClick={() => toolbarEl && wrapSelection(toolbarEl, "~~", "~~", setDraft)}>
              <Strikethrough size={13} />
            </TB>
            <TB label="Link" kbd="Cmd+K" onClick={() => toolbarEl && wrapSelection(toolbarEl, "[", "](url)", setDraft)}>
              <Link2 size={13} />
            </TB>
            {DIVIDER}
            <TB label="Bulleted list" onClick={() => toolbarEl && prependLines(toolbarEl, "- ", setDraft)}>
              <List size={13} />
            </TB>
            <TB label="Ordered list" onClick={() => toolbarEl && prependLines(toolbarEl, "1. ", setDraft)}>
              <ListOrdered size={13} />
            </TB>
            <TB label="Blockquote" onClick={() => toolbarEl && prependLines(toolbarEl, "> ", setDraft)}>
              <Quote size={13} />
            </TB>
            {DIVIDER}
            <TB label="Inline code" onClick={() => toolbarEl && wrapSelection(toolbarEl, "`", "`", setDraft)}>
              <Code size={13} />
            </TB>
            <TB label="Code block" onClick={() => toolbarEl && wrapSelection(toolbarEl, "```\n", "\n```", setDraft)}>
              <Code2 size={13} />
            </TB>
            {DIVIDER}
          </div>

          {/* Textarea row */}
          <div style={{ display: "flex", alignItems: "flex-end", padding: "6px 6px 6px 10px", gap: 4 }}>
            {/* Attach */}
            <button
              type="button"
              title="Attach file"
              aria-label="Attach file"
              onClick={onAttach}
              style={{ width: 28, height: 28, borderRadius: 7, border: "none", backgroundColor: "transparent", color: "var(--color-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-body)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-secondary)"; }}
            >+</button>
            {/* Grammar fix - moved here so it doesn't overflow the toolbar */}
            {draft.trim() && grammarState !== "preview" && (
              <button
                type="button"
                onClick={handleFixGrammar}
                disabled={grammarState === "loading"}
                title="Fix grammar (Anthropic)"
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 5, padding: "3px 8px", backgroundColor: "transparent", cursor: grammarState === "loading" ? "default" : "pointer", fontFamily: "var(--font-roboto)", height: 22, flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {grammarState === "loading" ? <><Loader2 size={10} className="animate-spin" /> Fixing...</> : <>✦ Fix grammar</>}
              </button>
            )}

            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => {
                const val = e.target.value;
                setDraft(val);
                onTyping();
                const cursor = e.target.selectionStart ?? val.length;
                const atMatch = val.slice(0, cursor).match(/@(\w*)$/);
                if (atMatch) { setMentionQuery(atMatch[1]); setMentionIndex(0); }
                else setMentionQuery(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? `Message ${channelLabel}...`}
              rows={1}
              disabled={disabled}
              aria-label={`Message ${channelLabel}`}
              style={{
                flex: 1, resize: "none", border: "none", outline: "none",
                background: "transparent", color: "var(--color-body)",
                fontSize: 14, lineHeight: 1.5, fontFamily: "var(--font-roboto)",
                maxHeight: 160, overflowY: "auto",
              }}
            />

            {/* Mic */}
            {micSupported && (
              <button
                type="button"
                title={micDenied ? "Microphone access denied" : recording ? "Stop recording" : "Voice input"}
                aria-label={recording ? "Stop recording" : "Voice input"}
                onClick={recording ? stopRecording : (micDenied ? undefined : startRecording)}
                style={{
                  width: 28, height: 28, borderRadius: 7, border: "none",
                  backgroundColor: recording ? "rgba(220,38,38,0.12)" : "transparent",
                  color: recording ? "#dc2626" : micDenied ? "var(--color-border)" : "var(--color-secondary)",
                  cursor: micDenied ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transition: "background-color 0.15s",
                }}
              >
                {recording ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
            )}
            {micDenied && (
              <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap", alignSelf: "center" }}>Mic denied</span>
            )}
            {recording && (
              <span style={{ fontSize: 10, color: "#dc2626", whiteSpace: "nowrap", alignSelf: "center" }}>Recording</span>
            )}

            {/* Send */}
            <button
              type="button"
              onClick={handleSendWithRestore}
              disabled={!canSend}
              aria-label="Send message"
              style={{
                width: 32, height: 32, borderRadius: 7, border: "none",
                backgroundColor: canSend ? "var(--color-btn-primary, var(--color-navy))" : "transparent",
                color: canSend ? "#fff" : "var(--color-secondary)",
                cursor: canSend ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                transition: "background-color 0.15s",
              }}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
