"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

const LS_KEY = "canopy_tour_v2";

// ── Tour steps ─────────────────────────────────────────────────────────────────

interface TourStep {
  /** querySelector for the element to spotlight. null = centered welcome card. */
  selector?: string;
  /** Which side to place the tooltip relative to the target. Defaults to "right". */
  side?: "right" | "left" | "bottom" | "top";
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: "Welcome to Canopy",
    body: "Your research lab's all-in-one workspace. This tour highlights the main areas. Use arrow keys to move between steps.",
  },
  {
    selector: 'a[href="/"]',
    title: "Dashboard",
    body: "Your home base. See open tasks, team activity, lab wins, and opportunities at a glance.",
  },
  {
    selector: 'a[href="/tasks"]',
    title: "Tasks",
    body: "Track research work on a Kanban board. Drag cards between stages, assign teammates, and set due dates.",
  },
  {
    selector: 'a[href="/journal"]',
    title: "Journal",
    body: "Your private research space. Notes and reflections here are visible only to you, not to PIs or teammates.",
  },
  {
    selector: 'a[href="/reminders"]',
    title: "Reminders",
    body: "Keep track of deadlines and follow-ups. Create reminders from here or with the + New button on the dashboard.",
  },
  {
    selector: 'a[href="/literature"]',
    title: "Literature",
    body: "Your lab's shared citation library. Import from Zotero, attach PDFs, and track reading status for the team.",
  },
  {
    selector: 'a[href="/team"]',
    title: "Team",
    body: "See what everyone is working on, share your weekly update, and check availability for meetings.",
  },
];

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

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep]         = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipH, setTooltipH] = useState(220);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const side    = current.side ?? "right";

  function dismiss() {
    localStorage.setItem(LS_KEY, "1");
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

  // Measure target on step change
  const measureTarget = useCallback(() => {
    if (!current.selector) { setTargetRect(null); return; }
    const el = document.querySelector(current.selector);
    if (!el) { setTargetRect(null); return; }
    setTargetRect(el.getBoundingClientRect());
  }, [current.selector]);

  useEffect(() => {
    measureTarget();
    window.addEventListener("resize", measureTarget);
    return () => window.removeEventListener("resize", measureTarget);
  }, [measureTarget]);

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

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(LS_KEY)) setShow(true);

    function handleRetrigger() {
      localStorage.removeItem(LS_KEY);
      setShow(true);
    }
    window.addEventListener("canopy:show-onboarding", handleRetrigger);
    return () => window.removeEventListener("canopy:show-onboarding", handleRetrigger);
  }, []);

  return { show, open: () => setShow(true), close: () => setShow(false) };
}
