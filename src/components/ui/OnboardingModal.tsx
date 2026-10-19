"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { APP_NAME } from "@/lib/brand";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

const LS_PREFIX = "aiesec_tour_v3:";
const lsKey = (role: TourRole) => LS_PREFIX + role;

// ── Tour steps ─────────────────────────────────────────────────────────────────

interface TourStep {
  /** querySelector for the element to spotlight. null = centered welcome card. */
  selector?: string;
  /** Which side to place the tooltip relative to the target. Defaults to "right". */
  side?: "right" | "left" | "bottom" | "top";
  title: string;
  body: string;
}

export type TourRole = "president" | "vp" | "member" | "mc";

const welcome = (body: string): TourStep => ({ title: `Welcome to ${APP_NAME}`, body: `${body} Use the arrow keys to move between steps.` });

/** A short tour per role: only what that person uses. */
export const TOURS: Record<TourRole, TourStep[]> = {
  member: [
    welcome("Your LC's workspace. Four quick stops."),
    { selector: 'a[href="/"]', title: "Dashboard", body: "What's due today, your onboarding checklist and what's coming up in the LC." },
    { selector: 'a[href="/tasks"]', title: "Tasks", body: "Your department's work, from Backlog to Done. Anything assigned to you shows on the dashboard." },
    { selector: 'a[href="/tabling"]', title: "Tabling", body: "Sign up for shifts. You get a reminder the day before, and attended shifts count as your hours." },
    { selector: 'a[href="/checkin"]', title: "Check-in", body: "One minute every two weeks. Your answers only count towards anonymous averages; nobody sees them." },
  ],
  vp: [
    welcome("Everything for running your department."),
    { selector: 'a[href="/"]', title: "This week", body: "Your departments' approvals vs last week, stuck exchanges and overdue tasks, every Monday." },
    { selector: 'a[href="/pipeline"]', title: "Pipeline", body: "Every exchange per product, with term numbers and conversion. Import your EXPA export or tracker in one go." },
    { selector: 'a[href="/members"]', title: "Members", body: "Onboarding and activity signals for the people in your departments." },
    { selector: 'a[href="/import"]', title: "Import", body: "Bring your Google Sheets trackers (exchanges, partners, tasks, recruitment) into the app." },
  ],
  president: [
    welcome("Set up your LC in a few minutes; the checklist on the dashboard walks you through it."),
    { selector: 'a[href="/"]', title: "Dashboard", body: "This week's numbers, the getting-started checklist, and the Exec and Member Pulse." },
    { selector: 'a[href="/import"]', title: "Import your trackers", body: "Paste a Google Sheets link to bring in exchanges, partners, tasks and recruitment." },
    { selector: 'a[href="/members"]', title: "Members", body: "Recruitment, onboarding, term dates and who might need a conversation." },
    { selector: 'a[href="/team"]', title: "Team", body: "Your exec board and departments. Invite VPs and members from Settings." },
  ],
  mc: [
    welcome("The national view."),
    { selector: 'a[href="/mc"]', title: "National", body: "Every linked LC's applications, approvals and realizations this term, side by side. Counts only." },
  ],
};

const PAD = 8;    // spotlight padding around the target element
const W   = 300;  // tooltip card width

// ── Helpers ────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function tooltipPos(
  rect: DOMRect,
  side: "right" | "left" | "bottom" | "top",
  tooltipH: number,
): { left: number; top: number } {
  const GAP = 16;
  switch (side) {
    case "right":
      return {
        left: clamp(rect.right + PAD + GAP, 8, window.innerWidth - W - 8),
        top:  clamp(rect.top + rect.height / 2 - tooltipH / 2, 8, window.innerHeight - tooltipH - 8),
      };
    case "left":
      return {
        left: clamp(rect.left - PAD - GAP - W, 8, window.innerWidth - W - 8),
        top:  clamp(rect.top + rect.height / 2 - tooltipH / 2, 8, window.innerHeight - tooltipH - 8),
      };
    case "bottom":
      return {
        left: clamp(rect.left + rect.width / 2 - W / 2, 8, window.innerWidth - W - 8),
        top:  clamp(rect.bottom + PAD + GAP, 8, window.innerHeight - tooltipH - 8),
      };
    case "top":
      return {
        left: clamp(rect.left + rect.width / 2 - W / 2, 8, window.innerWidth - W - 8),
        top:  clamp(rect.top - PAD - GAP - tooltipH, 8, window.innerHeight - tooltipH - 8),
      };
  }
}

// ── Caret pointing toward the spotlight ────────────────────────────────────────

function Caret({ side }: { side: "right" | "left" | "bottom" | "top" }) {
  const SIZE = 8;
  const base: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    border: `${SIZE}px solid transparent`,
  };
  if (side === "right") {
    return <div style={{ ...base, left: -SIZE * 2, top: "50%", transform: "translateY(-50%)", borderRightColor: "var(--color-surface)", borderLeft: "none" }} />;
  }
  if (side === "left") {
    return <div style={{ ...base, right: -SIZE * 2, top: "50%", transform: "translateY(-50%)", borderLeftColor: "var(--color-surface)", borderRight: "none" }} />;
  }
  if (side === "bottom") {
    return <div style={{ ...base, top: -SIZE * 2, left: "50%", transform: "translateX(-50%)", borderBottomColor: "var(--color-surface)", borderTop: "none" }} />;
  }
  return <div style={{ ...base, bottom: -SIZE * 2, left: "50%", transform: "translateX(-50%)", borderTopColor: "var(--color-surface)", borderBottom: "none" }} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingModal({ role, onClose }: { role: TourRole; onClose: () => void }) {
  const STEPS = TOURS[role];
  const [step, setStep]         = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipH, setTooltipH] = useState(220);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const side    = current.side ?? "right";

  function dismiss() {
    try { localStorage.setItem(lsKey(role), "1"); } catch { /* storage blocked: the tour shows again next time */ }
    onClose();
  }

  function goNext() {
    if (isLast) { dismiss(); return; }
    setStep((s) => s + 1);
  }

  function goBack() {
    if (isFirst) return;
    setStep((s) => s - 1);
  }

  // The layout effect measures the actual target before the spotlight is painted.
  const targetRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    targetRef.current = current.selector ? document.querySelector(current.selector) : null;
    setTargetRect(targetRef.current?.getBoundingClientRect() ?? null);
    function measure() { setTargetRect(targetRef.current?.getBoundingClientRect() ?? null); }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current.selector]);

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape")     { dismiss(); return; }
      if (e.key === "ArrowRight") { goNext(); }
      if (e.key === "ArrowLeft")  { goBack(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Tooltip position
  const tooltipStyle: React.CSSProperties = targetRect
    ? { position: "fixed", ...tooltipPos(targetRect, side, tooltipH), width: W, zIndex: 1202 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: Math.min(W + 40, window.innerWidth - 32), zIndex: 1202 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200 }} onClick={dismiss}>
      {/* Backdrop (shown only when no spotlight is active) */}
      {!targetRect && (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.55)" }} />
      )}

      {/* Spotlight ring — creates dark overlay via box-shadow */}
      {targetRect && (
        <div
          style={{
            position: "fixed",
            left:   targetRect.left - PAD,
            top:    targetRect.top  - PAD,
            width:  targetRect.width  + PAD * 2,
            height: targetRect.height + PAD * 2,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
            zIndex: 1201,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={(el) => { if (el) setTooltipH(el.offsetHeight); }}
        style={{
          ...tooltipStyle,
          backgroundColor: "var(--color-surface)",
          borderRadius: 14,
          boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
          fontFamily: "var(--font-roboto)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Caret (only when spotlighting a target) */}
        {targetRect && <Caret side={side} />}

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={dismiss}
            title="Skip tour"
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "var(--font-roboto)" }}
          >
            <X size={13} /> Skip tour
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "14px 20px 20px" }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 17, color: "var(--color-navy)", margin: "0 0 8px", lineHeight: 1.3 }}>
            {current.title}
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.6, margin: 0 }}>
            {current.body}
          </p>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {/* Back */}
          <button
            onClick={goBack}
            disabled={isFirst}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 12, fontWeight: 600,
              color: isFirst ? "transparent" : "var(--color-secondary)",
              background: "none", border: "none", cursor: isFirst ? "default" : "pointer",
              padding: "4px 0", fontFamily: "var(--font-roboto)",
            }}
          >
            <ArrowLeft size={13} /> Back
          </button>

          {/* Dot indicators */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setStep(i); }}
                style={{
                  width: i === step ? 16 : 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: i === step ? "var(--color-navy)" : "var(--color-border)",
                  border: "none", cursor: "pointer", padding: 0,
                  transition: "width 180ms ease, background-color 180ms ease",
                }}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Skip step + Next */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!isLast && (
              <button
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                style={{ fontSize: 12, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontFamily: "var(--font-roboto)" }}
              >
                Skip
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 12, fontWeight: 700,
                backgroundColor: "var(--color-navy)", color: "#fff",
                border: "none", borderRadius: 7,
                padding: "6px 14px", cursor: "pointer",
                fontFamily: "var(--font-roboto)",
              }}
            >
              {isLast ? "Done" : (<>Next <ArrowRight size={12} /></>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useOnboarding(role: TourRole | null) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !role) return;
    let seen = true;
    try { seen = Boolean(localStorage.getItem(lsKey(role))); } catch { /* storage blocked */ }
    // Showing the tour once per role is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setShow(true);

    function handleRetrigger() {
      try { localStorage.removeItem(lsKey(role!)); } catch { /* ignore */ }
      setShow(true);
    }
    window.addEventListener("app:show-onboarding", handleRetrigger);
    return () => window.removeEventListener("app:show-onboarding", handleRetrigger);
  }, [role]);

  return { show, open: () => setShow(true), close: () => setShow(false) };
}
