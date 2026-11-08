"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, Flag, Search, Sparkles, X, XCircle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { APP_NAME } from "@/lib/brand";
import { guideEntry, keywordAnswer, searchGuide, type GuideRole } from "@/lib/appGuide";
import type { HelperAnswer } from "@/app/api/helper/route";
import OnboardingModal from "@/components/ui/OnboardingModal";
import type { TourStep } from "@/lib/tours";

// "Ask the helper": a button in the top bar and a small panel. It says how long
// the answer will take, then either "Yes, it's here" with the way there (and a
// button that opens the page and highlights it), or "No, it doesn't exist yet"
// and reports the question to the app's moderators as a feature request.

const TIMING_KEY = "aiesec_helper_ms";
const DEFAULT_MS = 4000;
const ROLE_NAME: Record<GuideRole, string> = { member: "members", vp: "VPs", president: "the LC president", mc: "the national team (MC)" };

/** How long answers have taken in this browser (a rolling average), to say up front. */
function expectedMs(): number {
  try { const v = Number(localStorage.getItem(TIMING_KEY)); return v > 0 ? v : DEFAULT_MS; } catch { return DEFAULT_MS; }
}
function recordMs(ms: number) {
  try { localStorage.setItem(TIMING_KEY, String(Math.round(expectedMs() * 0.6 + ms * 0.4))); } catch { /* storage blocked */ }
}
const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

type Report = "idle" | "sending" | "sent" | "failed";

/** Ask the server; in demo mode (no backend) or if it fails, match keywords here. */
async function ask(question: string, role: GuideRole | null): Promise<HelperAnswer> {
  const local = (): HelperAnswer => {
    const e = keywordAnswer(question, role);
    return {
      found: Boolean(e), source: "keywords", closest: searchGuide(question, 3, role).map((r) => r.entry.id),
      notForYou: Boolean(e && role && !e.roles.includes(role)),
      entry: e ? { id: e.id, title: e.title, route: e.route, where: e.where, how: e.how, roles: e.roles, target: e.target, click: e.click } : null,
      answer: e ? `It's in ${e.where}.` : `${APP_NAME} doesn't do that yet.`,
    };
  };
  if (!isSupabaseConfigured) return local();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/helper", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ question, role }),
    });
    if (!res.ok) return local();
    return (await res.json()) as HelperAnswer;
  } catch {
    return local();
  }
}

export default function Helper({ role, projectId, compact }: { role: GuideRole | null; projectId: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showMe, setShowMe] = useState<TourStep[] | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={buttonRef} type="button" data-tour="helper" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label="Ask"
        className="px-2 sm:px-3 shrink-0"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, height: 34, borderRadius: 8,
          border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-navy)",
          fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {/* On phones just the icon: the top bar has no room for the word. */}
        <Sparkles size={15} aria-hidden="true" />{!compact && <span className="hidden sm:inline">Ask</span>}
      </button>
      {open && (
        <HelperPanel
          role={role} projectId={projectId}
          onClose={() => { setOpen(false); buttonRef.current?.focus(); }}
          onShowMe={(steps) => { setOpen(false); setShowMe(steps); }}
        />
      )}
      {showMe && <OnboardingModal role={role ?? "member"} steps={showMe} remember={false} onClose={() => setShowMe(null)} />}
    </>
  );
}

function HelperPanel({ role, projectId, onClose, onShowMe }: {
  role: GuideRole | null; projectId: string | null; onClose: () => void; onShowMe: (steps: TourStep[]) => void;
}) {
  const pathname = usePathname();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState(DEFAULT_MS);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<HelperAnswer | null>(null);
  const [report, setReport] = useState<Report>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The clock while it looks.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(t);
  }, [busy]);

  async function sendReport(q: string, answer: HelperAnswer) {
    if (!isSupabaseConfigured) { setReport("sent"); return; }      // demo: nothing to store
    setReport("sending");
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from("feature_requests").insert({
      created_by: session?.user?.id, project_id: projectId, role, question: q, page: pathname, closest: answer.closest,
    });
    setReport(error ? "failed" : "sent");
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setAsked(q);
    setResult(null);
    setReport("idle");
    setEstimate(expectedMs());
    setElapsed(0);
    setBusy(true);
    const started = Date.now();
    const answer = await ask(q, role);
    recordMs(Date.now() - started);
    setBusy(false);
    setResult(answer);
    if (!answer.found) void sendReport(q, answer);
  }

  function showMe() {
    const entry = result?.entry ? guideEntry(result.entry.id) : null;
    if (!entry) return;
    onShowMe([{
      title: entry.title, route: entry.route, click: entry.click,
      targets: entry.target ?? (entry.click ? [entry.click] : ['[data-tour="page-header"]']),
      side: "bottom",
      // The steps usually start with the place already ("Settings → Invites: …"); don't say it twice.
      body: entry.how[0]?.startsWith(entry.where) ? entry.how.join(" ") : `${entry.where}. ${entry.how.join(" ")}`,
    }]);
  }

  const over = elapsed > estimate;
  const examples = role === "mc"
    ? ["Where do I set targets for each LC?", "How do I hand the MC over?", "Can I see every LC's balance?"]
    : ["Where do I add a partner?", "How do I invite my VPs?", "Where do I submit a receipt?"];

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="helper-title"
      style={{
        position: "fixed", top: 60, right: 16, width: "min(400px, calc(100vw - 32px))", maxHeight: "calc(100vh - 80px)", overflow: "auto",
        zIndex: 1100, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <Sparkles size={16} color="var(--color-navy)" aria-hidden="true" />
        <h2 id="helper-title" style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>Ask the helper</h2>
        <button type="button" onClick={onClose} aria-label="Close the helper" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <X size={16} color="var(--color-secondary)" />
        </button>
      </div>

      <form onSubmit={submit} style={{ padding: 14, display: "flex", gap: 8 }}>
        <label htmlFor="helper-q" className="sr-only">What are you looking for?</label>
        <input
          id="helper-q" ref={inputRef} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)}
          placeholder="What are you looking for?"
          style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 14, backgroundColor: "var(--color-surface)", color: "var(--color-body)" }}
        />
        <button type="submit" disabled={busy || question.trim().length < 3}
          style={{ height: 38, padding: "0 14px", borderRadius: 8, border: "none", backgroundColor: "var(--color-navy)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: busy || question.trim().length < 3 ? 0.6 : 1 }}>
          <Search size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Ask
        </button>
      </form>

      <div style={{ padding: "0 14px 14px" }} aria-live="polite">
        {!busy && !result && (
          <>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 8px" }}>
              Ask in your own words. If {APP_NAME} can do it, you&apos;ll get the way there; if not, your question goes to the app&apos;s moderators as a request.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {examples.map((ex) => (
                <button key={ex} type="button" onClick={() => { setQuestion(ex); inputRef.current?.focus(); }}
                  style={{ fontSize: 12, padding: "5px 9px", borderRadius: 999, border: "1px solid var(--color-border)", background: "none", color: "var(--color-body)", cursor: "pointer" }}>
                  {ex}
                </button>
              ))}
            </div>
          </>
        )}

        {busy && (
          <div role="status" style={{ padding: "6px 0" }}>
            <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, margin: "0 0 6px", color: "var(--color-body)" }}>
              <Clock size={14} aria-hidden="true" /> Looking… this usually takes about {seconds(estimate)} second{seconds(estimate) === 1 ? "" : "s"}.
            </p>
            <div aria-hidden="true" style={{ height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(95, (elapsed / estimate) * 100)}%`, height: "100%", backgroundColor: "var(--color-navy)", transition: "width 250ms linear" }} />
            </div>
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "6px 0 0" }}>
              {over ? `Taking a little longer than usual (${seconds(elapsed)} s)…` : `${seconds(elapsed)} s so far`}
            </p>
          </div>
        )}

        {result && !busy && (
          <section aria-label="Answer" style={{ borderRadius: 10, padding: 12, border: `1px solid ${result.found ? "var(--color-border)" : "var(--color-border)"}`, backgroundColor: "var(--color-dimmed-bg)" }}>
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "0 0 6px" }}>You asked: &ldquo;{asked}&rdquo;</p>
            {result.found && result.entry ? (
              <>
                <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: "var(--color-success)" }}>
                  <CheckCircle2 size={17} aria-hidden="true" /> Yes, it&apos;s here
                </p>
                <p style={{ fontSize: 13, margin: "0 0 8px", color: "var(--color-body)" }}>{result.answer}</p>
                <p style={{ fontSize: 13, margin: "0 0 4px", color: "var(--color-body)" }}>
                  <strong>Where:</strong> {result.entry.where}
                </p>
                <ol style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13, lineHeight: 1.5, color: "var(--color-body)" }}>
                  {result.entry.how.map((h, i) => <li key={i}>{h}</li>)}
                </ol>
                {result.notForYou && (
                  <p style={{ fontSize: 12, margin: "0 0 10px", padding: "6px 8px", borderRadius: 6, backgroundColor: "var(--color-surface)", color: "var(--color-body)" }}>
                    This is for {result.entry.roles.map((r) => ROLE_NAME[r]).join(" or ")}, so you may not see it. Ask them, or your LCP.
                  </p>
                )}
                <button type="button" onClick={showMe}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 8, border: "none", backgroundColor: "var(--color-navy)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Take me there <ArrowRight size={14} aria-hidden="true" />
                </button>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "10px 0 0" }}>
                  Not what you meant?{" "}
                  {report === "sent" ? "Reported to the moderators. Thanks." : (
                    <button type="button" onClick={() => sendReport(asked, result)} disabled={report === "sending"}
                      style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: "var(--color-navy)", textDecoration: "underline", cursor: "pointer" }}>
                      Report it as missing
                    </button>
                  )}
                </p>
              </>
            ) : (
              <>
                <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: "var(--color-error)" }}>
                  <XCircle size={17} aria-hidden="true" /> No, that doesn&apos;t exist yet
                </p>
                <p style={{ fontSize: 13, margin: "0 0 8px", color: "var(--color-body)" }}>{result.answer}</p>
                <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: 0, color: "var(--color-body)" }}>
                  <Flag size={14} aria-hidden="true" />
                  {report === "sending" && "Reporting it to the app's moderators…"}
                  {report === "sent" && "Reported to the app's moderators as a feature request. You can follow it on Help → Your requests."}
                  {report === "failed" && (
                    <span>
                      Couldn&apos;t report it.{" "}
                      <button type="button" onClick={() => sendReport(asked, result)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, color: "var(--color-navy)", textDecoration: "underline", cursor: "pointer" }}>Try again</button>
                    </span>
                  )}
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
