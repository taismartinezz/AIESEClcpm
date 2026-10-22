"use client";

import Link from "next/link";

/**
 * Pages that used to be separate menu items, grouped under one: the menu shows
 * the section once and these tabs switch between its pages. Each page keeps
 * its own URL, so links and bookmarks still work.
 */
export const SECTIONS: { id: string; label: string; tabs: { href: string; label: string }[] }[] = [
  { id: "calendar", label: "Calendar", tabs: [
    { href: "/scheduling", label: "Calendar" },
    { href: "/attendance", label: "Events" },
    { href: "/tabling",    label: "Tabling" },
  ] },
  { id: "pipeline", label: "Pipeline", tabs: [
    { href: "/pipeline", label: "Pipeline" },
    { href: "/outreach", label: "Outreach" },
    { href: "/goals",    label: "Goals" },
  ] },
  { id: "people", label: "People", tabs: [
    { href: "/team",    label: "Directory" },
    { href: "/members", label: "Recruitment & onboarding" },
  ] },
  { id: "drive", label: "Drive", tabs: [
    { href: "/drive",    label: "Files" },
    { href: "/handover", label: "Handover" },
  ] },
];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** The section a page belongs to, if any. */
export function sectionFor(pathname: string) {
  return SECTIONS.find((s) => s.tabs.some((t) => matches(pathname, t.href))) ?? null;
}

export default function SectionTabs({ pathname }: { pathname: string }) {
  const section = sectionFor(pathname);
  if (!section) return null;
  return (
    <nav aria-label={section.label} style={{ display: "flex", gap: 4, padding: "8px clamp(12px, 3vw, 24px) 0", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", overflowX: "auto", flexShrink: 0 }}>
      {section.tabs.map((t) => {
        const active = matches(pathname, t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: "nowrap", textDecoration: "none",
              color: active ? "var(--color-navy)" : "var(--color-secondary)",
              borderBottom: `2px solid ${active ? "var(--color-navy)" : "transparent"}`, marginBottom: -1,
            }}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
