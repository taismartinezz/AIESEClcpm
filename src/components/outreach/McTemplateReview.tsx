"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, ErrorText, Panel, inputStyle } from "@/components/lc/ui";

interface Pending { id: string; project_id: string; name: string; subject: string; body: string }

/** MC members approve LC outreach templates before they can be sent under AIESEC's name. */
export default function McTemplateReview({ lcNames }: { lcNames: Record<string, string> }) {
  const [items, setItems] = useState<Pending[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const lcKey = Object.keys(lcNames).sort().join(",");

  useEffect(() => {
    if (!lcKey) return;
    let cancelled = false;
    supabase.from("outreach_templates").select("id, project_id, name, subject, body").eq("status", "pending").in("project_id", lcKey.split(","))
      .then(({ data, error: err }) => { if (!cancelled) { if (err) setError(err.message); else setItems((data ?? []) as Pending[]); } });
    return () => { cancelled = true; };
  }, [lcKey, version]);

  async function decide(t: Pending, status: "approved" | "rejected") {
    setError(null);
    try {
      const { error: err } = await supabase.from("outreach_templates").update({ status, review_note: status === "rejected" ? notes[t.id] ?? null : null }).eq("id", t.id);
      if (err) throw new Error(err.message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (items.length === 0 && !error) return null;
  return (
    <Panel title={`Outreach templates waiting for approval (${items.length})`}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((t) => (
          <li key={t.id} style={{ padding: "12px 14px", borderTop: "1px solid var(--color-border)" }}>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>{lcNames[t.project_id]} · {t.name}</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "4px 0" }}>{t.subject}</p>
            <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "0 0 8px", color: "var(--color-body)" }}>{t.body}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => decide(t, "approved")}>Approve</Button>
              <input aria-label={`Note for ${t.name}`} placeholder="What should change?" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 180, height: 34 }} />
              <Button variant="secondary" disabled={!notes[t.id]?.trim()} onClick={() => decide(t, "rejected")}>Ask for changes</Button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
