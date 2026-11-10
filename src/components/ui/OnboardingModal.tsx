"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, ArrowRight, ArrowLeft, Check, Play } from "lucide-react";
import {
  CORE, chapterSteps, chaptersFor, markDone, pageSteps, readProgress, stepsFor,
  type TourContext, type TourRole, type TourStep,
} from "@/lib/tours";

// v5: a short core tour with chapters. Everyone sees it once more.
const LS_PREFIX = "aiesec_tour_v5:";
const lsKey = (role: TourRole) => LS_PREFIX + role;

export type { TourRole, TourStep };

const PAD = 8;        // spotlight padding around the target element
const GAP = 14;       // between the spotlight and the card
const W = 320;        // card width
const NARROW = 640;   // below this, the card is a bottom sheet
const SETTLE_MS = 1500;
const GIVE_UP_MS = 8000;  // a step that still isn't showing by then is left out
const isDev = process.env.NODE_ENV !== "production";

type Side = "right" | "left" | "bottom" | "top";

// ── Finding a step's target ───────────────────────────────────────────────────

/** On screen horizontally and not collapsed (an off-canvas menu doesn't count). */
function isShown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= window.innerWidth) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** The first shown element among the selectors, in the order given. */
export function findTarget(selectors: string[] | undefined): Element | null {
  for (const sel of selectors ?? []) {
    let all: Element[] = [];
    try { all = Array.from(document.querySelectorAll(sel)); } catch { continue; }
    const hit = all.find(isShown);
    if (hit) return hit;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait up to `ms` for a target to render (pages load their data first). */
async function waitForTarget(selectors: string[] | undefined, ms: number, cancelled: () => boolean): Promise<Element | null> {
  if (!selectors?.length) return null;
  const started = Date.now();
  for (;;) {
    if (cancelled()) return null;
    const el = findTarget(selectors);
    if (el || Date.now() - started > ms) return el;
    await sleep(100);
  }
}

/** A loading skeleton still showing on the page (outside the tour). */
function skeletonShowing(): boolean {
  return Array.from(document.querySelectorAll(".animate-pulse")).some((el) => !el.closest("[data-tour-ui]") && isShown(el));
}

/** Wait until the page's skeletons are gone, or `ms` since we arrived. */
async function waitSettled(until: number, cancelled: () => boolean) {
  while (!cancelled() && skeletonShowing() && Date.now() < until) await sleep(100);
}

const routeOf = (path: string) => path.split("?")[0];

// ── Placing the card next to its anchor, never on it ─────────────────────────

interface Placement { left: number; top: number; side: Side | null; caret: number }

function clamp(v: number, min: number, max: number) { return Math.min(Math.max(v, min), Math.max(min, max)); }

export function placeCard(rect: DOMRect, preferred: Side, w: number, h: number, vw: number, vh: number): Placement {
  const g = PAD + GAP;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const order = [preferred, "bottom", "right", "left", "top"].filter((s, i, a) => a.indexOf(s) === i) as Side[];
  for (const side of order) {
    let left: number; let top: number; let fits: boolean;
    if (side === "bottom" || side === "top") {
      left = clamp(cx - w / 2, 8, vw - w - 8);
      top = side === "bottom" ? rect.bottom + g : rect.top - g - h;
      fits = top >= 8 && top + h <= vh - 8;
    } else {
      top = clamp(cy - h / 2, 8, vh - h - 8);
      left = side === "right" ? rect.right + g : rect.left - g - w;
      fits = left >= 8 && left + w <= vw - 8;
    }
    if (fits) {
      const caret = side === "bottom" || side === "top" ? clamp(cx - left, 18, w - 18) : clamp(cy - top, 18, h - 18);
      return { left, top, side, caret };
    }
  }
  // A big anchor with no room beside it: the corner that covers the least of it,
  // bottom right first (top left is the logo and the menu).
  const corners = [[vw - w - 8, vh - h - 8], [vw - w - 8, 8], [8, vh - h - 8], [8, 8]];
  const overlap = ([l, t]: number[]) =>
    Math.max(0, Math.min(l + w, rect.right + PAD) - Math.max(l, rect.left - PAD)) *
    Math.max(0, Math.min(t + h, rect.bottom + PAD) - Math.max(t, rect.top - PAD));
  const [left, top] = corners.reduce((best, c) => (overlap(c) < overlap(best) ? c : best));
  return { left, top, side: null, caret: 0 };
}

// The card's side facing the anchor gets the arrow, coloured on that edge only.
const CARET_COLORS: Record<Side, string> = {
  right: "transparent var(--color-surface) transparent transparent",
  left: "transparent transparent transparent var(--color-surface)",
  bottom: "transparent transparent var(--color-surface) transparent",
  top: "var(--color-surface) transparent transparent transparent",
};

function Caret({ side, at }: { side: Side; at: number }) {
  const S = 8;
  const base: React.CSSProperties = { position: "absolute", width: 0, height: 0, borderWidth: S, borderStyle: "solid", borderColor: CARET_COLORS[side] };
  if (side === "right") return <div style={{ ...base, left: -S * 2, top: at - S }} />;
  if (side === "left") return <div style={{ ...base, right: -S * 2, top: at - S }} />;
  if (side === "bottom") return <div style={{ ...base, top: -S * 2, left: at - S }} />;
  return <div style={{ ...base, bottom: -S * 2, left: at - S }} />;
}

function Spinner() {
  return (
    <span role="status" aria-label="Loading the page" style={{ display: "inline-block", width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--color-border)", borderTopColor: "var(--color-navy)", animation: "tour-spin 0.8s linear infinite" }} />
  );
}

/** Only one element carries the highlight. */
function setActive(el: Element | null) {
  document.querySelectorAll("[data-tour-active]").forEach((x) => { if (x !== el) x.removeAttribute("data-tour-active"); });
  el?.setAttribute("data-tour-active", "");
}

// ── The tour card ─────────────────────────────────────────────────────────────

export interface ChapterChoice { id: string; title: string; summary: string; done: boolean }

export default function OnboardingModal({ role, onClose, steps, remember = true, chapters, onPickChapter, onReachEnd }: {
  role: TourRole;
  onClose: () => void;
  /** Steps to run. Default: the core tour for this role. */
  steps?: TourStep[];
  /** Whether closing counts as having seen the first-run tour. */
  remember?: boolean;
  /** For the "Pick what to learn next" card. */
  chapters?: ChapterChoice[];
  onPickChapter?: (id: string) => void;
  /** The last step was reached (counts the chapter as done). */
  onReachEnd?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Phone-only differences are settled once; steps not there for this person drop out as we go.
  const [all] = useState<TourStep[]>(() => {
    const given = steps ?? stepsFor(CORE, { role });
    return typeof window !== "undefined" && window.innerWidth < NARROW ? given.filter((s) => !s.wideOnly) : given;
  });
  const [skipped, setSkipped] = useState<Set<TourStep>>(() => new Set());
  const list = useMemo(() => all.filter((s) => !skipped.has(s)), [all, skipped]);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [cardH, setCardH] = useState(200);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const i = Math.min(index, Math.max(0, list.length - 1));
  const current = list[i];
  const key = `${i}:${current?.id ?? current?.title}@${pathname}`;
  const ready = readyFor === key;
  const isFirst = i === 0;
  const isLast = i === list.length - 1;
  const narrow = vw < NARROW;
  const titleId = "tour-step-title";
  const primaryRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<Element | null>(null);
  const arrived = useRef<{ path: string; at: number }>({ path: "", at: 0 });
  const left = useRef<TourStep | null>(null);
  const reachedEnd = useRef(false);

  const dismiss = useCallback(() => {
    if (remember) {
      try { localStorage.setItem(lsKey(role), "1"); } catch { /* storage blocked: the tour shows again next time */ }
    }
    onClose();
  }, [remember, role, onClose]);

  function goNext() {
    if (isLast) { dismiss(); return; }
    setDirection(1);
    setIndex(i + 1);
  }
  function goBack() {
    if (isFirst) return;
    setDirection(-1);
    setIndex(i - 1);
  }

  // Focus goes back to the page when the tour ends; the highlight and the menu are cleared.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      setActive(null);
      left.current?.leave?.();
      window.dispatchEvent(new CustomEvent("app:mobile-nav", { detail: { open: false } }));
      const main = document.querySelector("main") as HTMLElement | null;
      if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
      else if (main) { if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1"); main.focus({ preventScroll: true }); }
    };
  }, []);

  // Open the step's page, wait for its data, click what it asks, find and spotlight the anchor.
  useEffect(() => {
    if (!current) { onClose(); return; }
    if (paused) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    // Not there for this person (or never showed up): leave it out, and out of the count.
    const skip = (why: string) => {
      if (isDev && !current.optional) console.warn(`[tour] No anchor for step "${current.id ?? current.title}": ${why}`);
      setSkipped((prev) => new Set(prev).add(current));
      if (direction < 0) setIndex(Math.max(0, i - 1));
    };
    // Whatever goes wrong (a page that never loads, a redirect), a step never spins forever.
    const giveUp = setTimeout(() => { if (!cancelled) { cancelled = true; skip(`not showing after ${GIVE_UP_MS / 1000} s`); } }, GIVE_UP_MS);
    if (left.current && left.current !== current) { left.current.leave?.(); }
    left.current = current;
    (async () => {
      if (current.route && routeOf(current.route) !== pathname) {
        router.push(current.route);
        return;                                   // runs again once the pathname changes
      }
      if (arrived.current.path !== pathname) arrived.current = { path: pathname, at: Date.now() };
      if (isLast && !reachedEnd.current) { reachedEnd.current = true; onReachEnd?.(); }
      // Phones keep the menu in a drawer: open it for a menu step, close it otherwise.
      if (window.innerWidth < NARROW) {
        window.dispatchEvent(new CustomEvent("app:mobile-nav", { detail: { open: Boolean(current.inMenu) } }));
        if (current.inMenu) await sleep(300);
      }
      const settleBy = arrived.current.at + SETTLE_MS;
      const patience = Math.max(800, 3000 - (Date.now() - arrived.current.at));
      await waitSettled(settleBy, isCancelled);
      let el: Element | null = null;
      if (current.targets?.length) {
        if (current.click && !findTarget(current.targets)) {
          const clickable = await waitForTarget([current.click], patience, isCancelled);
          if (clickable instanceof HTMLElement && clickable.getAttribute("aria-selected") !== "true") clickable.click();
        }
        el = await waitForTarget(current.targets, patience, isCancelled);
        if (cancelled) return;
        if (!el) { clearTimeout(giveUp); skip(current.targets.join(", ")); return; }
        // The anchor's own part of the page may still be loading.
        await waitSettled(settleBy, isCancelled);
        if (cancelled) return;
        const scroll = (block: ScrollLogicalPosition) => el!.scrollIntoView({ block, inline: "nearest", behavior: "instant" as ScrollBehavior });
        scroll(window.innerWidth < NARROW ? "start" : "center");
        // A tall anchor centred leaves no room for the card: at the top of the page, it goes underneath.
        const fits = () => placeCard(el!.getBoundingClientRect(), current.side ?? "right", W, cardH, window.innerWidth, window.innerHeight).side !== null;
        if (window.innerWidth >= NARROW && !fits()) { scroll("start"); if (!fits()) scroll("center"); }
      }
      targetRef.current = el;
      setActive(el);
      // Nothing else keeps a focus ring (a menu link from an earlier step, say).
      const focused = document.activeElement as HTMLElement | null;
      if (focused && !focused.closest("[data-tour-ui]")) focused.blur();
      clearTimeout(giveUp);
      setTargetRect(el?.getBoundingClientRect() ?? null);
      setReadyFor(key);
      // This page has had time to load: later optional steps on it whose anchor isn't
      // here leave the count now, not when reached. (Cards that load without a skeleton need the wait.)
      if (Date.now() >= settleBy && !skeletonShowing()) {
        const absent = list.slice(i + 1).filter((s) => s.optional && !s.click && (!s.route || routeOf(s.route) === pathname) && !findTarget(s.targets));
        if (absent.length) setSkipped((prev) => { const next = new Set(prev); absent.forEach((s) => next.add(s)); return next; });
      }
    })();
    return () => { cancelled = true; clearTimeout(giveUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paused]);

  // Pages redraw after loading (a tab bar, say): follow the anchor if it's replaced or moves.
  useEffect(() => {
    if (!ready || paused || !current?.targets?.length) return;
    const t = setInterval(() => {
      let el = targetRef.current;
      if (!el?.isConnected || !isShown(el)) {
        el = findTarget(current.targets);
        if (!el) return;
        targetRef.current = el;
        setActive(el);
      }
      const r = el.getBoundingClientRect();
      setTargetRect((prev) => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : r));
    }, 300);
    return () => clearInterval(t);
  }, [ready, paused, current]);

  useEffect(() => { if (ready && !paused) primaryRef.current?.focus({ preventScroll: true }); }, [ready, paused]);

  // Follow the target when the page scrolls or resizes.
  useEffect(() => {
    const measure = () => {
      setVw(window.innerWidth); setVh(window.innerHeight);
      if (targetRef.current?.isConnected) setTargetRect(targetRef.current.getBoundingClientRect());
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, []);

  // → and Enter: next. ←: back. Esc: skip.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (paused) return;
      if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); return; }
      if (e.key === "Enter") {
        const t = e.target as HTMLElement | null;
        if (t?.closest("button, a, input, textarea, select")) return;   // that control handles it
        e.preventDefault(); goNext();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!current) return null;

  function tryIt() {
    if (!current.tryIt) return;
    setPaused(true);
    setActive(null);
    const el = findTarget([current.tryIt.click]);
    if (el instanceof HTMLElement) el.click();
  }

  if (paused) {
    return (
      <div data-tour-ui style={{ position: "fixed", left: 16, bottom: 16, zIndex: 1202, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0 8px 28px rgba(0,0,0,0.2)", fontFamily: "var(--font-roboto)" }}>
        <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>Tour paused</span>
        <button type="button" autoFocus onClick={() => { setReadyFor(null); setPaused(false); }}
          style={{ fontSize: 13, fontWeight: 600, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
          Back to the tour
        </button>
      </div>
    );
  }

  const spot = ready ? targetRect : null;
  const isChaptersCard = current.kind === "chapters";
  const sheetAtTop = Boolean(spot && narrow && spot.bottom > vh - cardH - 16);
  const place = spot && !narrow ? placeCard(spot, current.side ?? "right", W, cardH, vw, vh) : null;
  const cardStyle: React.CSSProperties = narrow
    ? { position: "fixed", left: 0, right: 0, ...(sheetAtTop ? { top: 0, borderRadius: "0 0 14px 14px" } : { bottom: 0, borderRadius: "14px 14px 0 0" }), width: "100%", zIndex: 1202 }
    : place
      ? { position: "fixed", left: place.left, top: place.top, width: W, zIndex: 1202, borderRadius: 14 }
      : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: Math.min(isChaptersCard ? 460 : W + 60, vw - 32), zIndex: 1202, borderRadius: 14 };
  const isChapters = current.kind === "chapters";
  const btn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, background: "none", border: "none", padding: "4px 0", fontFamily: "var(--font-roboto)" };

  return (
    // A long tour: clicking outside doesn't end it (Skip tour and Escape do).
    <div data-tour-ui style={{ position: "fixed", inset: 0, zIndex: 1200 }}>
      <style>{"@keyframes tour-spin { to { transform: rotate(360deg) } }"}</style>
      {!spot && <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.55)" }} />}
      {spot && (
        <div data-tour-spotlight style={{
          position: "fixed", left: spot.left - PAD, top: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2,
          borderRadius: 10, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)", pointerEvents: "none", zIndex: 1201,
        }} />
      )}

      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={!ready}
        ref={(el) => { if (el && el.offsetHeight !== cardH) setCardH(el.offsetHeight); }}
        style={{ ...cardStyle, backgroundColor: "var(--color-surface)", boxShadow: "0 16px 48px rgba(0,0,0,0.28)", fontFamily: "var(--font-roboto)", maxHeight: narrow ? "60dvh" : undefined, overflowY: narrow ? "auto" : undefined }}
      >
        {place?.side && <Caret side={place.side} at={place.caret} />}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <span data-tour-counter style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {i + 1} of {list.length}
          </span>
          <button onClick={dismiss} style={{ ...btn, fontWeight: 400, fontSize: 11, color: "var(--color-secondary)", cursor: "pointer" }}>
            <X size={13} aria-hidden="true" /> Skip tour
          </button>
        </div>

        <div style={{ padding: "12px 20px 18px" }} aria-live="polite">
          <h2 id={titleId} style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 17, color: "var(--color-navy)", margin: "0 0 8px", lineHeight: 1.3 }}>
            {current.title}
          </h2>
          {!ready ? <Spinner /> : (
            <>
              <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.6, margin: 0 }}>{current.body}</p>
              {current.tryIt && (
                <button type="button" onClick={tryIt}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--color-navy)", backgroundColor: "var(--color-navy-dim)", border: "none", borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}>
                  <Play size={12} aria-hidden="true" /> Try it: {current.tryIt.label}
                </button>
              )}
              {isChapters && chapters && (
                <ul aria-label="Chapters" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 6 }}>
                  {chapters.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => onPickChapter?.(c.id)} title={c.summary}
                        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", height: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", fontFamily: "var(--font-roboto)", fontSize: 13, fontWeight: 600, color: "var(--color-navy)" }}>
                        {c.title}
                        {c.done && <><Check size={14} color="var(--color-success)" aria-hidden="true" style={{ flexShrink: 0 }} /><span className="sr-only"> (done)</span></>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button onClick={goBack} disabled={isFirst} style={{ ...btn, color: isFirst ? "transparent" : "var(--color-secondary)", cursor: isFirst ? "default" : "pointer" }}>
            <ArrowLeft size={13} aria-hidden="true" /> Back
          </button>
          <div role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={list.length} aria-valuenow={i + 1}
            style={{ flex: 1, maxWidth: 120, height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
            <div style={{ width: `${((i + 1) / list.length) * 100}%`, height: "100%", backgroundColor: "var(--color-navy)", transition: "width 180ms ease" }} />
          </div>
          <button ref={primaryRef} onClick={goNext}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
            {isLast ? "Done" : "Next"} {!isLast && <ArrowRight size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Which tour runs: first run, Replay, a chapter, or one page ───────────────

type Running = { id: string; steps: TourStep[]; remember: boolean; started: number };

/**
 * The LC shell's tours. Listens for "app:show-onboarding" (detail.chapter
 * picks a chapter; none replays the core tour) and "app:show-page-tour".
 */
export function TourHost({ ctx, userId, onRunning }: { ctx: TourContext | null; userId: string | null; onRunning?: (on: boolean) => void }) {
  const [running, setRunning] = useState<Running | null>(null);
  useEffect(() => { onRunning?.(Boolean(running)); }, [running, onRunning]);
  const [done, setDone] = useState<string[]>([]);
  const role = ctx?.role ?? null;
  const onMc = Boolean(ctx?.onMc);

  useEffect(() => {
    const sync = () => setDone(readProgress(userId));
    sync();
    window.addEventListener("app:tour-progress", sync);
    return () => window.removeEventListener("app:tour-progress", sync);
  }, [userId]);

  useEffect(() => {
    if (!role) return;
    const c: TourContext = { role, onMc };
    let seen = true;
    try { seen = Boolean(localStorage.getItem(lsKey(role))); } catch { /* storage blocked */ }
    // Showing the core tour once per role is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setRunning({ id: "core", steps: stepsFor(CORE, c), remember: true, started: Date.now() });

    function onShow(e: Event) {
      const chapter = (e as CustomEvent<{ chapter?: string } | undefined>).detail?.chapter;
      setRunning(chapter
        ? { id: chapter, steps: chapterSteps(chapter, c), remember: false, started: Date.now() }
        : { id: "core", steps: stepsFor(CORE, c), remember: true, started: Date.now() });
    }
    function onPage(e: Event) {
      const path = (e as CustomEvent<{ path?: string } | undefined>).detail?.path ?? window.location.pathname;
      const steps = pageSteps(path, c);
      if (steps.length) setRunning({ id: `page:${path}`, steps, remember: false, started: Date.now() });
    }
    window.addEventListener("app:show-onboarding", onShow);
    window.addEventListener("app:show-page-tour", onPage);
    return () => { window.removeEventListener("app:show-onboarding", onShow); window.removeEventListener("app:show-page-tour", onPage); };
  }, [role, onMc]);

  if (!running || !ctx) return null;
  // Not the chapter you just finished; after the core tour, Getting around (mostly what you just saw) goes last.
  const chapters = chaptersFor(ctx)
    .filter((c) => c.id !== running.id)
    .sort((a, b) => Number(running.id === "core" && a.id === "getting-around") - Number(running.id === "core" && b.id === "getting-around"))
    .map((c) => ({ id: c.id, title: c.title, summary: c.summary, done: done.includes(c.id) }));
  return (
    <OnboardingModal
      key={`${running.id}:${running.started}`}
      role={ctx.role} steps={running.steps} remember={running.remember}
      chapters={chapters}
      onPickChapter={(id) => setRunning({ id, steps: chapterSteps(id, ctx), remember: false, started: Date.now() })}
      onReachEnd={() => { if (!running.id.startsWith("page:")) markDone(userId, running.id); }}
      onClose={() => setRunning(null)}
    />
  );
}

/** The MC shell's first-run tour (the national view has one tour). */
export function useOnboarding(role: TourRole | null) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !role) return;
    let seen = true;
    try { seen = Boolean(localStorage.getItem(lsKey(role))); } catch { /* storage blocked */ }
    // Showing the tour once per role is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setShow(true);

    const open = () => setShow(true);
    window.addEventListener("app:show-onboarding", open);
    window.addEventListener("app:show-page-tour", open);
    return () => { window.removeEventListener("app:show-onboarding", open); window.removeEventListener("app:show-page-tour", open); };
  }, [role]);

  return { show, open: () => setShow(true), close: () => setShow(false) };
}
