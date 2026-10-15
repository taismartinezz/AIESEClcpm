"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { User } from "@/types";
import { computeInitials } from "@/lib/utils";
import { COMMON_EMOJIS } from "./types";

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function resolveChannelKey(projectId: string, currentUserId: string, active: string): string {
  if (active === "lab") return `lab:${projectId}`;
  if (active.startsWith("dm:")) {
    const peerId = active.slice(3);
    return `dm:${[currentUserId, peerId].sort().join(":")}`;
  }
  return `project:${active}`;
}

export function buildUser(id: string, name: string, color?: string): User {
  return {
    id, name, email: "", role: "researcher",
    avatarColor: color ?? "#CBD5E1",
    avatarInitials: computeInitials(name) || name.slice(0, 2).toUpperCase(),
  };
}

export function renderMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const codeBlock = /```([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeBlock.exec(text)) !== null) {
    if (m.index > last) out.push(...renderBlock(text.slice(last, m.index), last));
    out.push(
      <pre key={`cb${m.index}`} style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: "var(--color-surface-2)", borderRadius: 6, padding: "8px 10px", margin: "4px 0", overflowX: "auto", whiteSpace: "pre", color: "var(--color-body)", display: "block" }}>
        {m[1].replace(/^\n/, "")}
      </pre>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...renderBlock(text.slice(last), last));
  return out;
}

function renderBlock(text: string, offset: number): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];

  function flushLists(key: number) {
    if (ulItems.length) {
      out.push(
        <ul key={`ul${key}`} style={{ margin: "4px 0 4px 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
          {ulItems.map((li, i) => <li key={i} style={{ listStyleType: "disc" }}>{renderInline(li, offset + key + i)}</li>)}
        </ul>
      );
      ulItems = [];
    }
    if (olItems.length) {
      out.push(
        <ol key={`ol${key}`} style={{ margin: "4px 0 4px 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
          {olItems.map((li, i) => <li key={i} style={{ listStyleType: "decimal" }}>{renderInline(li, offset + key + i)}</li>)}
        </ol>
      );
      olItems = [];
    }
  }

  lines.forEach((line, li) => {
    // Blockquote
    if (/^>\s?/.test(line)) {
      flushLists(li);
      const content = line.replace(/^>\s?/, "");
      out.push(
        <blockquote key={`bq${offset}${li}`} style={{ borderLeft: "3px solid var(--color-border)", paddingLeft: 10, margin: "2px 0", color: "var(--color-secondary)", fontStyle: "italic", fontSize: 13 }}>
          {renderInline(content, offset + li)}
        </blockquote>
      );
      return;
    }
    // Unordered list
    if (/^[-*]\s/.test(line)) {
      flushLists(li); // flush ol if switching
      if (olItems.length === 0) { // only reset ul if no pending ol
        ulItems.push(line.replace(/^[-*]\s/, ""));
      }
      return;
    }
    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      flushLists(li);
      olItems.push(line.replace(/^\d+\.\s/, ""));
      return;
    }
    // Normal line
    flushLists(li);
    if (li < lines.length - 1) {
      out.push(<span key={`l${offset}${li}`}>{renderInline(line, offset + li)}<br /></span>);
    } else {
      out.push(...renderInline(line, offset + li).map((n, i) => <span key={`lt${offset}${li}${i}`}>{n}</span>));
    }
  });
  flushLists(lines.length);
  return out;
}

export function renderInline(text: string, offset: number): ReactNode[] {
  const tokens = text.split(/(\*\*[\s\S]*?\*\*|__[\s\S]*?__|~~[\s\S]*?~~|_[\s\S]*?_|\*[^*][\s\S]*?\*|`[^`]*`|\[[\s\S]*?\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s]+|@\w+)/);
  return tokens.map((tok, i) => {
    const k = `i${offset}${i}`;
    if (/^\*\*[\s\S]*\*\*$/.test(tok) && tok.length > 4) return <strong key={k}>{tok.slice(2, -2)}</strong>;
    if (/^__[\s\S]*__$/.test(tok) && tok.length > 4) return <strong key={k}>{tok.slice(2, -2)}</strong>;
    if (/^~~[\s\S]*~~$/.test(tok) && tok.length > 4) return <del key={k}>{tok.slice(2, -2)}</del>;
    if (/^_[\s\S]*_$/.test(tok) && tok.length > 2) return <em key={k}>{tok.slice(1, -1)}</em>;
    if (/^\*[^*][\s\S]*\*$/.test(tok) && tok.length > 2) return <em key={k}>{tok.slice(1, -1)}</em>;
    if (/^`[^`]*`$/.test(tok) && tok.length > 2) return <code key={k} style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: "var(--color-surface-2)", borderRadius: 3, padding: "1px 4px" }}>{tok.slice(1, -1)}</code>;
    const lm = tok.match(/^\[([\s\S]+?)\]\((https?:\/\/[^\s)]+)\)$/);
    if (lm) return <a key={k} href={lm[2]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-navy)", textDecoration: "underline" }}>{lm[1]}</a>;
    if (/^https?:\/\//.test(tok)) return <a key={k} href={tok} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-navy)", textDecoration: "underline" }}>{tok}</a>;
    if (/^@\w+$/.test(tok)) return <span key={k} style={{ color: "var(--color-navy)", fontWeight: 600, backgroundColor: "rgba(14,165,233,0.10)", borderRadius: 3, padding: "0 3px" }}>{tok}</span>;
    return tok;
  });
}

export function DateDivider({ iso }: { iso: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 4px", userSelect: "none" }}>
      <div style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{formatDateLabel(iso)}</span>
      <div style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
    </div>
  );
}

export function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function down(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: "absolute", zIndex: 200, bottom: "calc(100% + 4px)", right: 0, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.14)", padding: 8, width: 228 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
        {COMMON_EMOJIS.map(em => (
          <button key={em} onClick={() => { onSelect(em); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: "4px 2px", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--color-surface-2)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          >{em}</button>
        ))}
      </div>
    </div>
  );
}

export function TBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  const base = danger ? "var(--color-error)" : "var(--color-secondary)";
  const hover = danger ? "var(--color-error)" : "var(--color-body)";
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 5px", borderRadius: 5, display: "flex", alignItems: "center", color: base, transition: "background-color 0.1s, color 0.1s" }}
      onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = "var(--color-surface-2)"; b.style.color = hover; }}
      onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = "transparent"; b.style.color = base; }}
    >{children}</button>
  );
}

export function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const txt = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : "Several people are typing…";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 16px 5px 64px" }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "var(--color-secondary)", animation: `typBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
      </div>
      <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{txt}</span>
    </div>
  );
}
