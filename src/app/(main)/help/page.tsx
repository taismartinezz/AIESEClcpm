"use client";

import { useEffect, useState } from "react";
import { Check, PlayCircle, RotateCcw } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useProject } from "@/context/ProjectContext";
import { HELP_TOPICS, RELEASES } from "@/lib/help";
import { chaptersFor, readProgress } from "@/lib/tours";
import { Button, Panel } from "@/components/lc/ui";
import FeatureRequests from "@/components/helper/FeatureRequests";

/** Short guides per feature, with a slot for a 30–60 s video each, and release notes. */
export default function HelpPage() {
  const { role, userId } = useProject();
  const chapters = chaptersFor({ role: role ?? "member" });
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setDone(readProgress(userId));
    sync();
    window.addEventListener("app:tour-progress", sync);
    return () => window.removeEventListener("app:tour-progress", sync);
  }, [userId]);
  const topics = [...HELP_TOPICS].sort((a, b) => Number(Boolean(role && b.forRoles.includes(role))) - Number(Boolean(role && a.forRoles.includes(role))));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Help & guides" subtitle="Short how-tos for each part of the app." action={
        <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("app:show-onboarding"))}>
          <RotateCcw size={14} aria-hidden="true" /> Replay the tour
        </Button>
      } />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1000, width: "100%" }}>
        <section data-tour="help-chapters" aria-labelledby="help-chapters-heading" style={{ marginBottom: 24 }}>
          <h2 id="help-chapters-heading" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 4px" }}>The tour, by chapter</h2>
          <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "0 0 10px" }}>A minute or two each. A ✓ marks the ones you&apos;ve finished.</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {chapters.map((c) => {
              const finished = done.includes(c.id);
              return (
                <li key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}>
                  <span aria-hidden="true" style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>{finished && <Check size={15} color="var(--color-success)" />}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{c.title}{finished && <span className="sr-only"> (done)</span>}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", lineHeight: 1.45 }}>{c.summary}</span>
                  </span>
                  <Button variant="secondary" aria-label={`${finished ? "Replay" : "Start"} ${c.title}`}
                    onClick={() => window.dispatchEvent(new CustomEvent("app:show-onboarding", { detail: { chapter: c.id } }))}>
                    {finished ? "Replay" : "Start"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <h2 data-tour="help-guides" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 10px", width: "fit-content" }}>Guides</h2>
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

        <div data-tour="help-requests" style={{ marginTop: 24 }}><FeatureRequests showEmpty /></div>

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
