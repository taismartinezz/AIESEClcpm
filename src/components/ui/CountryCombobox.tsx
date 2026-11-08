"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { countryByCode, foldText, searchCountries, type AiesecCountry } from "@/lib/aiesecCountries";

/**
 * Pick a country with an AIESEC entity: type to filter, arrows + Enter to
 * choose. Only listed countries can be picked (no free text). `value` is the
 * ISO code or "".
 */
export default function CountryCombobox({ value, onChange, id, autoFocus, large }: {
  value: string; onChange: (code: string) => void; id?: string; autoFocus?: boolean; large?: boolean;
}) {
  const selected = countryByCode(value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchCountries(query), [query]);
  // The list is drawn fixed to the window, so a card with overflow: hidden
  // (Panel, modals) can't cut it off. Opens upward when there's no room below.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  function place() {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    setPos(below < 200 && r.top > below
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, width: r.width, top: r.bottom + 4 });
  }

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  // Keep the highlighted option in view while moving with the arrow keys.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(c: AiesecCountry) {
    onChange(c.code);
    setQuery("");
    setOpen(false);
  }

  const height = large ? 48 : 40;
  return (
    <div style={{ position: "relative" }}>
      <div ref={boxRef} style={{ position: "relative" }}>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].code}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={selected ? "" : "Search for your country"}
          value={open ? query : selected ? `${selected.flag}  ${selected.name}` : query}
          onFocus={() => { place(); setOpen(true); setActive(0); }}
          onBlur={() => setTimeout(() => {
            // Typed a country's full name and left without picking: take it.
            const exact = query.trim() && results.find((c) => foldText(c.name) === foldText(query));
            if (exact) onChange(exact.code);
            setOpen(false); setQuery("");
          }, 120)}
          onChange={(e) => { place(); setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); place(); setOpen(true); setActive((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && open && results[active]) { e.preventDefault(); pick(results[active]); }
            else if (e.key === "Escape") { setOpen(false); setQuery(""); }
          }}
          style={{
            width: "100%", height, padding: "0 36px 0 12px", border: "1px solid var(--color-border)", borderRadius: 8,
            fontSize: large ? 15 : 14, color: "var(--color-body)", backgroundColor: "var(--color-surface)", outline: "none", boxSizing: "border-box",
          }}
        />
        <ChevronDown size={16} color="var(--color-secondary)" aria-hidden="true" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
      </div>
      {open && pos && (
        <ul id={listId} ref={listRef} role="listbox" aria-label="Countries"
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 1000, maxHeight: 260, boxSizing: "border-box", overflowY: "auto", margin: 0, padding: 4, listStyle: "none",
            backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
          {results.length === 0 && <li style={{ padding: "10px 12px", fontSize: 13, color: "var(--color-secondary)" }}>No AIESEC country matches &ldquo;{query}&rdquo;.</li>}
          {results.map((c, i) => (
            <li key={c.code} id={`${listId}-${c.code}`} data-index={i} role="option" aria-selected={c.code === value}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 14,
                backgroundColor: i === active ? "var(--color-navy-dim)" : "transparent", color: "var(--color-body)", fontWeight: c.code === value ? 600 : 400 }}>
              <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>{c.flag}</span>
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
