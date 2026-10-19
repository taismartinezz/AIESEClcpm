"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export interface FloatPos {
  top: number;
  left: number;
  /** Top of the element the popover belongs to; lets it flip above when there's no room below. */
  anchorTop?: number;
}

const MARGIN = 8;

/**
 * Keep a `position: fixed` popover (calendar, time picker, menu) inside the
 * viewport: flip it above its anchor when it would run off the bottom, otherwise
 * shift it up, and shift it left from the right edge. Pure positioning maths so
 * it is unit-tested below; the hook measures and applies it.
 */
export function fitInViewport(pos: FloatPos, size: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number } {
  let top = pos.top;
  if (top + size.height > viewport.height - MARGIN) {
    const above = pos.anchorTop != null ? pos.anchorTop - 6 - size.height : null;
    top = above != null && above >= MARGIN ? above : Math.max(MARGIN, viewport.height - MARGIN - size.height);
  }
  const left = Math.min(Math.max(MARGIN, pos.left), Math.max(MARGIN, viewport.width - MARGIN - size.width));
  return { top, left };
}

export function useViewportFit(ref: RefObject<HTMLElement | null>, pos: FloatPos): { top: number; left: number } {
  const [fitted, setFitted] = useState<{ top: number; left: number }>({ top: pos.top, left: pos.left });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = fitInViewport({ top: pos.top, left: pos.left, anchorTop: pos.anchorTop }, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
    // Measuring the rendered popover is the point of this layout effect.

    setFitted((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, [ref, pos.top, pos.left, pos.anchorTop]);
  return fitted;
}
