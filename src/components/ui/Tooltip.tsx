"use client";

import { useState, useRef, useCallback, useId, useEffect } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/lib/use-hydrated";

interface TooltipProps {
  label: string;
  children: React.ReactElement;
  delay?: number;
  placement?: "top" | "bottom" | "left" | "right";
}

export default function Tooltip({ label, children, delay = 450, placement = "bottom" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const mounted = useHydrated();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const GAP = 7;
    switch (placement) {
      case "top":    return { top: r.top - GAP,          left: r.left + r.width / 2 };
      case "left":   return { top: r.top + r.height / 2, left: r.left - GAP };
      case "right":  return { top: r.top + r.height / 2, left: r.right + GAP };
      default:       return { top: r.bottom + GAP,       left: r.left + r.width / 2 };
    }
  }, [placement]);

  const show = useCallback(() => {
    timer.current = setTimeout(() => {
      const c = compute();
      if (c) { setCoords(c); setVisible(true); }
    }, delay);
  }, [delay, compute]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  const transformForPlacement: React.CSSProperties = (() => {
    switch (placement) {
      case "top":   return { transform: "translate(-50%, -100%)" };
      case "left":  return { transform: "translate(-100%, -50%)" };
      case "right": return { transform: "translateY(-50%)" };
      default:      return { transform: "translateX(-50%)" };
    }
  })();

  return (
    <>
      <span
        ref={triggerRef}
        aria-describedby={label ? id : undefined}
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
        onMouseEnter={show}
        onMouseLeave={hide}
        // Keyboard focus only: focus that returns to the button after a panel
        // closes (or a mouse click) shouldn't leave the tooltip hanging.
        onFocus={(e) => { if ((e.target as HTMLElement).matches?.(":focus-visible")) show(); }}
        onBlur={hide}
        onClick={hide}
        onKeyDown={(e) => { if (e.key === "Escape") hide(); }}
      >
        {children}
      </span>
      {mounted && label && createPortal(
        <span
          role="tooltip"
          id={id}
          aria-hidden={!visible}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            ...transformForPlacement,
            whiteSpace: "nowrap",
            backgroundColor: "rgba(15,23,42,0.92)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "var(--font-roboto, sans-serif)",
            borderRadius: 5,
            padding: "4px 8px",
            pointerEvents: "none",
            zIndex: 99999,
            letterSpacing: "0.01em",
            lineHeight: 1.4,
            visibility: visible ? "visible" : "hidden",
          }}
        >
          {label}
        </span>,
        document.body
      )}
    </>
  );
}
