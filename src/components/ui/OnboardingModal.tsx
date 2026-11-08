"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { TOURS, type TourRole, type TourStep } from "@/lib/tours";

// v4: the tour now opens each page. Everyone sees it once more.
const LS_PREFIX = "aiesec_tour_v4:";
const lsKey = (role: TourRole) => LS_PREFIX + role;

export type { TourRole, TourStep };
export { TOURS };

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

// ── Finding a step's target ───────────────────────────────────────────────────

/** The first visible element among the selectors, in the order given. */
export function findTarget(selectors: string[] | undefined): Element | null {
  for (const sel of selectors ?? []) {
    let all: Element[] = [];
    try { all = Array.from(document.querySelectorAll(sel)); } catch { continue; }
    const visible = all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (visible) return visible;
  }
  return null;
}

/** Wait up to `ms` for a target to render (pages load their data first). */
function waitForTarget(selectors: string[] | undefined, ms: number, cancelled: () => boolean): Promise<Element | null> {
  return new Promise((resolve) => {
    if (!selectors?.length) { resolve(null); return; }
    const started = Date.now();
    const tick = () => {
      if (cancelled()) { resolve(null); return; }
      const el = findTarget(selectors);
      if (el || Date.now() - started > ms) resolve(el);
      else setTimeout(tick, 100);
    };
    tick();
  });
}

const routeOf = (path: string) => path.split("?")[0];

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingModal({ role, onClose, steps, remember = true }: {
  role: TourRole; onClose: () => void;
  /** Steps other than the role's tour (the helper's "Take me there"). */
  steps?: TourStep[];
  /** Whether finishing counts as having done the tour. */
  remember?: boolean;
}) {
  const STEPS = steps ?? TOURS[role];
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep]         = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  // Which step/page the spotlight is measured for: anything else is still opening.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = readyFor === `${step}@${pathname}`;
  const [tooltipH, setTooltipH] = useState(220);
  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const side    = current.side ?? "right";
  const titleId = "tour-step-title";

  function dismiss() {
    if (remember) {
      try { localStorage.setItem(lsKey(role), "1"); } catch { /* storage blocked: the tour shows again next time */ }
    }
    onClose();
  }
  function goNext() {
    if (isLast) { dismiss(); return; }
    setDirection(1);
    setStep((s) => s + 1);
  }
  function goBack() {
    if (isFirst) return;
    setDirection(-1);
    setStep((s) => s - 1);
  }

  // Open the step's page, click what it asks, wait for the target, scroll it into view.
  const targetRef = useRef<Element | null>(null);
  // When we arrived on this page: a page that's had time to load needs little waiting.
  const arrived = useRef<{ path: string; at: number }>({ path: "", at: 0 });
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    (async () => {
      if (current.route && routeOf(current.route) !== pathname) {
        router.push(current.route);
        return;                                   // runs again once the pathname changes
      }
      if (arrived.current.path !== pathname) arrived.current = { path: pathname, at: Date.now() };
      const patience = Math.max(600, 3000 - (Date.now() - arrived.current.at));
      let el: Element | null = null;
      let missing = false;
      if (current.click) {
        const clickable = await waitForTarget([current.click], patience, isCancelled);
        if (clickable instanceof HTMLElement && clickable.getAttribute("aria-selected") !== "true") clickable.click();
        missing = !clickable;                      // no such tab for this person: nothing to show
      }
      if (!missing) el = await waitForTarget(current.targets, current.targets?.length ? patience : 0, isCancelled);
      if (cancelled) return;
      if (!el && current.optional) {
        // Not there for this person (a role-only button, an empty panel): move on.
        const next = step + direction;
        if (next >= 0 && next < STEPS.length) { setStep(next); return; }
      }
      targetRef.current = el;
      if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
      setTargetRect(el?.getBoundingClientRect() ?? null);
      setReadyFor(`${step}@${pathname}`);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pathname]);

  // Follow the target when the page scrolls or resizes.
  useEffect(() => {
    if (!ready) return;
    const measure = () => setTargetRect(targetRef.current?.isConnected ? targetRef.current.getBoundingClientRect() : null);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [ready]);

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

  const spot = ready ? targetRect : null;
  const tooltipStyle: React.CSSProperties = spot
    ? { position: "fixed", ...tooltipPos(spot, side, tooltipH), width: W, zIndex: 1202 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: Math.min(W + 40, window.innerWidth - 32), zIndex: 1202 };

  return (
    // A long tour: clicking outside doesn't end it (Skip tour and Escape do).
    <div style={{ position: "fixed", inset: 0, zIndex: 1200 }}>
      {/* Backdrop (shown only when no spotlight is active) */}
      {!spot && (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.55)" }} />
      )}

      {/* Spotlight ring: creates dark overlay via box-shadow */}
      {spot && (
        <div
          style={{
            position: "fixed",
            left:   spot.left - PAD,
            top:    spot.top  - PAD,
            width:  spot.width  + PAD * 2,
            height: spot.height + PAD * 2,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
            zIndex: 1201,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!ready}
        ref={(el) => { if (el) setTooltipH(el.offsetHeight); }}
        style={{
          ...tooltipStyle,
          backgroundColor: "var(--color-surface)",
          borderRadius: 14,
          boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
          fontFamily: "var(--font-roboto)",
          overflow: "hidden",
          opacity: ready ? 1 : 0.85,
        }}
      >
        {/* Caret (only when spotlighting a target) */}
        {spot && <Caret side={side} />}

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={dismiss}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "var(--font-roboto)" }}
          >
            <X size={13} aria-hidden="true" /> Skip tour
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "14px 20px 20px" }} aria-live="polite">
          <h2 id={titleId} style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 17, color: "var(--color-navy)", margin: "0 0 8px", lineHeight: 1.3 }}>
            {ready ? current.title : "Opening…"}
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.6, margin: 0 }}>
            {ready ? current.body : ""}
          </p>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
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
            <ArrowLeft size={13} aria-hidden="true" /> Back
          </button>

          {/* Progress: a bar, since the tours are long now */}
          <div role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}
            style={{ flex: 1, maxWidth: 120, height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
            <div style={{ width: `${((step + 1) / STEPS.length) * 100}%`, height: "100%", backgroundColor: "var(--color-navy)", transition: "width 180ms ease" }} />
          </div>

          <button
            onClick={goNext}
            autoFocus
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, fontWeight: 600, color: "#fff",
              backgroundColor: "var(--color-navy)", border: "none", borderRadius: 8,
              padding: "8px 14px", cursor: "pointer", fontFamily: "var(--font-roboto)",
            }}
          >
            {isLast ? "Done" : "Next"} {!isLast && <ArrowRight size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

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
