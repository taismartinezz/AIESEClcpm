"use client";

import { PlayCircle, RotateCcw } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useProject } from "@/context/ProjectContext";
import { HELP_TOPICS, RELEASES } from "@/lib/help";
import { Button, Panel } from "@/components/lc/ui";

/** Short guides per feature, with a slot for a 30–60 s video each, and release notes. */
export default function HelpPage() {
  const { role } = useProject();
  const topics = [...HELP_TOPICS].sort((a, b) => Number(Boolean(role && b.forRoles.includes(role))) - Number(Boolean(role && a.forRoles.includes(role))));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Help & guides" subtitle="Short how-tos for each part of the app." action={
        <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("app:show-onboarding"))}>
          <RotateCcw size={14} aria-hidden="true" /> Replay the tour
        </Button>
      } />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1000, width: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {topics.map((t) => (
            <Panel key={t.id} title={t.title}>
              <div id={t.id} style={{ padding: 14 }}>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: "var(--color-body)" }}>
                  {t.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, margin: "10px 0 0", color: "var(--color-secondary)" }}>
                  <PlayCircle size={14} aria-hidden="true" />
                  {t.video
                    ? <a href={t.video} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-navy)", fontWeight: 600 }}>Watch the 1-minute video</a>
                    : "Video coming soon"}
                </p>
              </div>
            </Panel>
          ))}
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-navy)", margin: "28px 0 10px" }}>What&apos;s new</h2>
        {RELEASES.map((r) => (
          <section key={r.id} aria-label={r.title} style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-body)", margin: "0 0 4px" }}>{r.title} <span style={{ fontWeight: 400, color: "var(--color-secondary)" }}>· {r.date}</span></h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: "var(--color-body)" }}>
              {r.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
