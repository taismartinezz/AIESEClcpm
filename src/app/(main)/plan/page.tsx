"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { useLcMembers } from "@/hooks/useLcMembers";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { askConfirm } from "@/components/ui/confirm";
import { Button, ErrorText, Field, Panel, inputStyle } from "@/components/lc/ui";

interface Identity {
  team_name: string | null; vision: string | null; values: string[]; rules: string[]; ambition: string | null;
  headline_goals: string | null; main_channel: string | null; tool_links: { label: string; url: string }[]; swot_takeaways: string | null;
}
interface SwotItem { id: string; kind: SwotKind; body: string; areas: string[] }
interface Battle { id: string; month: string; title: string; owner_id: string | null; done: boolean }
type SwotKind = "strength" | "weakness" | "opportunity" | "threat";

const EMPTY: Identity = { team_name: null, vision: null, values: [], rules: [], ambition: null, headline_goals: null, main_channel: null, tool_links: [], swot_takeaways: null };
const SWOT: { kind: SwotKind; label: string }[] = [
  { kind: "strength", label: "Strengths" }, { kind: "weakness", label: "Weaknesses" },
  { kind: "opportunity", label: "Opportunities" }, { kind: "threat", label: "Threats" },
];
const AREAS = ["LCP", "MXP", "oGX", "iGX", "MKT", "FIN", "BD"];
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** The LC's plan: who the EB is as a team, its SWOT, and each month's battles. */
export default function PlanPage() {
  const { projectId, userId, role, departments, isLoading } = useProject();
  const { members } = useLcMembers(projectId);
  const exec = role === "president" || role === "vp";
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [swot, setSwot] = useState<SwotItem[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [termStart, setTermStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || isLoading) return;
    let cancelled = false;
    (async () => {
      const [id, sw, bt, term] = await Promise.all([
        supabase.from("lc_identity").select("*").eq("project_id", projectId).maybeSingle(),
        supabase.from("lc_swot").select("id, kind, body, areas").eq("project_id", projectId).order("created_at"),
        supabase.from("lc_battles").select("id, month, title, owner_id, done").eq("project_id", projectId).order("created_at"),
        supabase.rpc("lc_term_start", { p_project_id: projectId }),
      ]);
      if (cancelled) return;
      const err = id.error ?? sw.error ?? bt.error;
      if (err) { setError(`Couldn't load the plan: ${err.message}`); return; }
      setIdentity({ ...EMPTY, ...(id.data ?? {}) } as Identity);
      setSwot((sw.data ?? []) as SwotItem[]);
      setBattles((bt.data ?? []) as Battle[]);
      setTermStart(typeof term.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(term.data) ? term.data : null);
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, version]);

  const reload = () => setVersion((v) => v + 1);
  async function run(p: PromiseLike<{ error: { message: string } | null }>, what: string) {
    const { error: err } = await p;
    if (err) { setError(`Couldn't ${what}: ${err.message}`); return false; }
    setError(null);
    reload();
    return true;
  }

  // The term's twelve months, from its start (or this month).
  const months = (() => {
    const start = termStart ?? `${new Date().toISOString().slice(0, 7)}-01`;
    const [y, m] = start.split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10));
  })();

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Our LC" subtitle="Who your EB is as a team, where the LC stands, and each month's priorities."
        action={exec && isSupabaseConfigured ? <Button variant="secondary" onClick={() => setEditing((v) => !v)}><Pencil size={14} aria-hidden="true" /> {editing ? "Done" : "Edit identity"}</Button> : undefined} />
      <div className="flex-1 overflow-auto" style={{ padding: "16px clamp(16px, 3vw, 28px)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
        {!isSupabaseConfigured ? (
          <NeedsDatabase what="Our LC">Your EB&apos;s identity, a SWOT tagged by area, and the battles for each month of the term.</NeedsDatabase>
        ) : (
          <>
            <ErrorText>{error}</ErrorText>
            {editing && exec
              ? <IdentityForm value={identity} onSave={async (v) => { if (await run(supabase.from("lc_identity").upsert({ project_id: projectId, ...v, updated_at: new Date().toISOString() }, { onConflict: "project_id" }), "save")) setEditing(false); }} />
              : <IdentityView value={identity} exec={exec} />}

            <Panel title="SWOT">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 1, backgroundColor: "var(--color-border)" }}>
                {SWOT.map(({ kind, label }) => (
                  <SwotQuadrant key={kind} label={label} items={swot.filter((s) => s.kind === kind)} exec={exec}
                    onAdd={(body, areas) => run(supabase.from("lc_swot").insert({ project_id: projectId, kind, body, areas }), "add")}
                    onRemove={(id) => run(supabase.from("lc_swot").delete().eq("id", id), "remove")} />
                ))}
              </div>
              <TakeawaysEditor value={identity.swot_takeaways} exec={exec}
                onSave={(t) => run(supabase.from("lc_identity").upsert({ project_id: projectId, swot_takeaways: t || null, updated_at: new Date().toISOString() }, { onConflict: "project_id" }), "save")} />
            </Panel>

            <EbPanel projectId={projectId!} userId={userId} exec={exec} members={members} departments={departments} />

            <Panel title="Battles, month by month">
              <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>Each month&apos;s key priorities and who owns them. The owner can tick a battle off.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, padding: 14 }}>
                {months.map((m) => (
                  <MonthCard key={m} month={m} battles={battles.filter((b) => b.month === m)} members={members} exec={exec}
                    onAdd={(title, owner) => run(supabase.from("lc_battles").insert({ project_id: projectId, month: m, title, owner_id: owner || null }), "add")}
                    onToggle={(b) => run(supabase.from("lc_battles").update({ done: !b.done }).eq("id", b.id), "update")}
                    onRemove={async (b) => { if (await askConfirm(`Remove "${b.title}"?`, { confirmLabel: "Remove" })) await run(supabase.from("lc_battles").delete().eq("id", b.id), "remove"); }} />
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function IdentityView({ value: v, exec }: { value: Identity; exec: boolean }) {
  const empty = !v.team_name && !v.vision && !v.values.length && !v.rules.length && !v.ambition && !v.headline_goals && !v.main_channel && !v.tool_links.length;
  const row = (label: string, body: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
      <span style={{ color: "var(--color-secondary)", fontSize: 12, fontWeight: 600 }}>{label}</span><div>{body}</div>
    </div>
  );
  return (
    <Panel title={v.team_name || "Team identity"}>
      <div style={{ padding: "4px 14px 10px" }}>
        {empty ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "8px 0" }}>
            {exec ? "Not written yet. Press Edit identity to set your team's name, vision, values, rules and ambition." : "Your EB hasn't written its identity yet."}
          </p>
        ) : (
          <>
            {v.vision && row("Vision", v.vision)}
            {v.values.length > 0 && row("Values", v.values.join(" · "))}
            {v.rules.length > 0 && row("Non-negotiables", <ul style={{ margin: 0, paddingLeft: 18 }}>{v.rules.map((r) => <li key={r}>{r}</li>)}</ul>)}
            {v.ambition && row("Ambition", v.ambition)}
            {v.headline_goals && row("Headline goals", <span style={{ whiteSpace: "pre-wrap" }}>{v.headline_goals}</span>)}
            {v.main_channel && row("EB's main channel", v.main_channel)}
            {v.tool_links.length > 0 && row("Other tools", v.tool_links.map((t) => <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 12, color: "var(--color-navy)" }}>{t.label}</a>))}
          </>
        )}
      </div>
    </Panel>
  );
}

function IdentityForm({ value, onSave }: { value: Identity; onSave: (v: Partial<Identity>) => void }) {
  const [v, setV] = useState({
    team_name: value.team_name ?? "", vision: value.vision ?? "", values: value.values.join("\n"), rules: value.rules.join("\n"),
    ambition: value.ambition ?? "", headline_goals: value.headline_goals ?? "", main_channel: value.main_channel ?? "",
    tool_links: value.tool_links.map((t) => `${t.label} | ${t.url}`).join("\n"),
  });
  const [error, setError] = useState<string | null>(null);
  const area = (k: keyof typeof v, label: string, hint?: string, rows = 3) => (
    <Field label={label} htmlFor={`id-${k}`} hint={hint}>
      <textarea id={`id-${k}`} value={v[k]} rows={rows} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={{ ...inputStyle, height: "auto", padding: "6px 10px" }} />
    </Field>
  );
  function submit() {
    const links = lines(v.tool_links).map((l) => { const [label, url] = l.split("|").map((x) => x.trim()); return { label: url ? label : label, url: url ?? label }; });
    if (links.some((l) => !/^https:\/\//i.test(l.url))) { setError("Each tool link needs an https:// address (\"Label | https://…\")."); return; }
    onSave({
      team_name: v.team_name.trim() || null, vision: v.vision.trim() || null, values: lines(v.values).slice(0, 20), rules: lines(v.rules).slice(0, 30),
      ambition: v.ambition.trim() || null, headline_goals: v.headline_goals.trim() || null, main_channel: v.main_channel.trim() || null, tool_links: links,
    });
  }
  return (
    <Panel title="Team identity">
      <div style={{ padding: 14 }}>
        <Field label="Team name" htmlFor="id-team_name"><input id="id-team_name" value={v.team_name} maxLength={120} onChange={(e) => setV({ ...v, team_name: e.target.value })} style={inputStyle} /></Field>
        {area("vision", "Vision")}
        {area("values", "Values", "One per line")}
        {area("rules", "Non-negotiable rules", "One per line")}
        {area("ambition", "Ambition")}
        {area("headline_goals", "Headline goals", "e.g. 60 oGX approvals, 20 iCX, 120 members impacted")}
        <Field label="EB's main channel" htmlFor="id-main_channel"><input id="id-main_channel" value={v.main_channel} maxLength={200} placeholder="e.g. Telegram group" onChange={(e) => setV({ ...v, main_channel: e.target.value })} style={inputStyle} /></Field>
        {area("tool_links", "Links to other tools", "One per line: Label | https://…", 2)}
        <ErrorText>{error}</ErrorText>
        <Button onClick={submit}><Check size={14} aria-hidden="true" /> Save identity</Button>
      </div>
    </Panel>
  );
}

function SwotQuadrant({ label, items, exec, onAdd, onRemove }: {
  label: string; items: SwotItem[]; exec: boolean; onAdd: (body: string, areas: string[]) => Promise<boolean>; onRemove: (id: string) => void;
}) {
  const [body, setBody] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  return (
    <section aria-label={label} style={{ backgroundColor: "var(--color-surface)", padding: 12 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", margin: "0 0 8px" }}>{label}</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {items.map((s) => (
          <li key={s.id} style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ flex: 1 }}>{s.body}{s.areas.length > 0 && <span style={{ fontSize: 11, color: "var(--color-secondary)" }}> · {s.areas.join(", ")}</span>}</span>
            {exec && <button type="button" aria-label={`Remove ${s.body}`} onClick={() => onRemove(s.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={12} color="var(--color-secondary)" /></button>}
          </li>
        ))}
        {items.length === 0 && !exec && <li style={{ fontSize: 12, color: "var(--color-secondary)" }}>Nothing yet.</li>}
      </ul>
      {exec && (
        <form onSubmit={async (e) => { e.preventDefault(); if (body.trim() && await onAdd(body.trim(), areas)) { setBody(""); setAreas([]); } }} style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <input aria-label={`Add to ${label}`} value={body} maxLength={500} placeholder={`Add to ${label.toLowerCase()}`} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, height: 32 }} />
          {body.trim() && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>Affects:</span>
              {AREAS.map((a) => (
                <button key={a} type="button" aria-pressed={areas.includes(a)} onClick={() => setAreas((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))}
                  style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--color-border)",
                    backgroundColor: areas.includes(a) ? "var(--color-navy-dim)" : "transparent", color: "var(--color-body)" }}>{a}</button>
              ))}
              <Button type="submit" variant="secondary" style={{ height: 26, padding: "0 10px", marginLeft: "auto" }}>Add</Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

function TakeawaysEditor({ value, exec, onSave }: { value: string | null; exec: boolean; onSave: (t: string) => void }) {
  const [text, setText] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ padding: 14, borderTop: "1px solid var(--color-border)" }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-secondary)", margin: "0 0 6px" }}>Takeaways</p>
      {editing ? (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea aria-label="SWOT takeaways" value={text} rows={3} maxLength={4000} onChange={(e) => setText(e.target.value)} style={{ ...inputStyle, height: "auto", padding: "6px 10px" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <Button onClick={() => { onSave(text.trim()); setEditing(false); }}>Save</Button>
            <Button variant="ghost" onClick={() => { setText(value ?? ""); setEditing(false); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <p style={{ flex: 1, margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: value ? "var(--color-body)" : "var(--color-secondary)" }}>{value || "What the EB takes from the SWOT."}</p>
          {exec && <Button variant="secondary" onClick={() => { setText(value ?? ""); setEditing(true); }}>Edit</Button>}
        </div>
      )}
    </div>
  );
}

function MonthCard({ month, battles, members, exec, onAdd, onToggle, onRemove }: {
  month: string; battles: Battle[]; members: { id: string; name: string }[]; exec: boolean;
  onAdd: (title: string, owner: string) => Promise<boolean>; onToggle: (b: Battle) => void; onRemove: (b: Battle) => void;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const label = new Date(`${month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const current = month.slice(0, 7) === new Date().toISOString().slice(0, 7);
  return (
    <section aria-label={label} style={{ border: `1px solid ${current ? "var(--color-navy)" : "var(--color-border)"}`, borderRadius: 8, padding: 10, backgroundColor: "var(--color-surface)" }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px", color: current ? "var(--color-navy)" : "var(--color-body)" }}>{label}{current ? " · now" : ""}</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {battles.map((b) => (
          <li key={b.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={b.done} onChange={() => onToggle(b)} aria-label={`${b.title} done`} style={{ marginTop: 3 }} />
            <span style={{ flex: 1, textDecoration: b.done ? "line-through" : "none", color: b.done ? "var(--color-secondary)" : "var(--color-body)" }}>
              {b.title}{b.owner_id && <span style={{ fontSize: 11, color: "var(--color-secondary)" }}> · {members.find((m) => m.id === b.owner_id)?.name ?? "LC member"}</span>}
            </span>
            {exec && <button type="button" aria-label={`Remove ${b.title}`} onClick={() => onRemove(b)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={12} color="var(--color-secondary)" /></button>}
          </li>
        ))}
        {battles.length === 0 && <li style={{ fontSize: 12, color: "var(--color-secondary)" }}>No battles set.</li>}
      </ul>
      {exec && (
        <form onSubmit={async (e) => { e.preventDefault(); if (title.trim() && await onAdd(title.trim(), owner)) { setTitle(""); setOwner(""); } }} style={{ display: "grid", gap: 4, marginTop: 8 }}>
          <input aria-label={`Battle for ${label}`} value={title} maxLength={200} placeholder="Add a battle" onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, height: 30 }} />
          {title.trim() && (
            <div style={{ display: "flex", gap: 4 }}>
              <select aria-label={`Owner for ${label}`} value={owner} onChange={(e) => setOwner(e.target.value)} style={{ ...inputStyle, height: 30, flex: 1 }}>
                <option value="">No owner</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <Button type="submit" variant="secondary" style={{ height: 30, padding: "0 10px" }}><Plus size={12} aria-hidden="true" /> Add</Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

// ── Getting to know the EB ───────────────────────────────────────────────────

const EB_QUESTIONS = [
  { key: "skills", label: "Skills I bring" },
  { key: "why_elected", label: "Why I was elected" },
  { key: "impact", label: "The impact I want to leave" },
  { key: "working_style", label: "How I like to work" },
  { key: "frustrations", label: "What frustrates me" },
  { key: "needs_help_signs", label: "How to tell I need help" },
  { key: "appreciation", label: "What appreciation means to me" },
] as const;
type EbKey = (typeof EB_QUESTIONS)[number]["key"];
type EbProfile = { user_id: string } & Partial<Record<EbKey, string | null>>;

/** The planning template's EB member profiles: each EB member's answers, read by the LC. */
function EbPanel({ projectId, userId, exec, members, departments }: {
  projectId: string; userId: string | null; exec: boolean;
  members: { id: string; name: string; role: string; departmentId: string | null }[];
  departments: { id: string; name: string; vpUserId: string | null }[];
}) {
  const [profiles, setProfiles] = useState<EbProfile[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<EbKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase.from("eb_profiles").select("*").eq("project_id", projectId).then(({ data, error: err }) => {
      if (!cancelled) { if (err) setError(err.message); else setProfiles((data ?? []) as EbProfile[]); }
    });
    return () => { cancelled = true; };
  }, [projectId, version]);

  const eb = members.filter((m) => m.role === "president" || m.role === "vp")
    .sort((a, b) => (a.role === "president" ? -1 : b.role === "president" ? 1 : a.name.localeCompare(b.name)));
  const roleOf = (m: { id: string; role: string }) => m.role === "president" ? "LCP"
    : `VP ${departments.filter((d) => d.vpUserId === m.id).map((d) => d.name).join(", ") || ""}`.trim();
  const mine = profiles.find((p) => p.user_id === userId);

  async function save() {
    const row: Record<string, unknown> = { project_id: projectId, user_id: userId, updated_at: new Date().toISOString() };
    for (const q of EB_QUESTIONS) row[q.key] = (draft[q.key] ?? "").trim() || null;
    const { error: err } = await supabase.from("eb_profiles").upsert(row, { onConflict: "project_id,user_id" });
    if (err) { setError(`Couldn't save: ${err.message}`); return; }
    setError(null);
    setEditing(false);
    setVersion((v) => v + 1);
  }

  return (
    <Panel title="Getting to know the EB" action={exec && userId && !editing ? (
      <Button variant="secondary" onClick={() => { setDraft(Object.fromEntries(EB_QUESTIONS.map((q) => [q.key, mine?.[q.key] ?? ""]))); setEditing(true); }}>
        <Pencil size={14} aria-hidden="true" /> {mine ? "Edit mine" : "Fill in mine"}
      </Button>
    ) : undefined}>
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <ErrorText>{error}</ErrorText>
        {editing && (
          <div style={{ display: "grid", gap: 2, padding: 12, border: "1px solid var(--color-border)", borderRadius: 8 }}>
            {EB_QUESTIONS.map((q) => (
              <Field key={q.key} label={q.label} htmlFor={`eb-${q.key}`}>
                <textarea id={`eb-${q.key}`} rows={2} maxLength={1000} value={draft[q.key] ?? ""} onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value })}
                  style={{ ...inputStyle, height: "auto", padding: "6px 10px" }} />
              </Field>
            ))}
            <div style={{ display: "flex", gap: 6 }}>
              <Button onClick={save}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {eb.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>No EB members yet.</p> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {eb.map((m) => {
              const p = profiles.find((x) => x.user_id === m.id);
              const answered = EB_QUESTIONS.filter((q) => p?.[q.key]);
              return (
                <section key={m.id} aria-label={m.name} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
                  <h3 style={{ fontSize: 14, margin: 0 }}>{m.name}</h3>
                  <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 8px" }}>{roleOf(m)}</p>
                  {answered.length === 0 ? <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>Not filled in yet.</p> : (
                    <dl style={{ margin: 0, display: "grid", gap: 6 }}>
                      {answered.map((q) => (
                        <div key={q.key}>
                          <dt style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)" }}>{q.label}</dt>
                          <dd style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{p![q.key]}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
