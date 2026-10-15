"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Receipt, Store, Wallet } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { formatMoney, mapClaim, mapEntry, totals } from "@/lib/finance";
import { formatEventDates, mapEvent, EVENT_TYPE_LABELS } from "@/lib/attendance";
import { formatTimeRange, mapSlot } from "@/lib/tabling";
import type { ExpenseClaim, FinanceEntry, LcEvent, TablingSlot } from "@/types";
import { ClaimStatusBadge } from "@/components/finance/ClaimsView";

function Card({ title, href, icon, children }: { title: string; href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} style={{ flex: "1 1 300px", minWidth: 0, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
        {icon}
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>{title}</h2>
        <Link href={href} aria-label={`Open ${title}`} style={{ display: "flex", color: "var(--color-secondary)" }}><ArrowRight size={14} /></Link>
      </header>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </section>
  );
}

const muted: React.CSSProperties = { fontSize: 12, color: "var(--color-secondary)", margin: 0 };

/** Load once per LC; errors are shown in the card rather than swallowed. */
function useLoad<T>(projectId: string | null, loader: (projectId: string) => Promise<T>, initial: T) {
  const [state, setState] = useState<{ data: T; error: string | null; loaded: boolean }>({ data: initial, error: null, loaded: false });
  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    loader(projectId)
      .then((data) => { if (!cancelled) setState({ data, error: null, loaded: true }); })
      .catch((e: unknown) => { if (!cancelled) setState({ data: initial, error: e instanceof Error ? e.message : String(e), loaded: true }); });
    return () => { cancelled = true; };
  // loader/initial are stable module-level functions/values at every call site
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return state;
}

function Status({ error, loaded }: { error: string | null; loaded: boolean }) {
  if (error) return <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>Couldn&apos;t load: {error}</p>;
  if (!loaded) return <div className="animate-pulse" style={{ height: 48, borderRadius: 6, backgroundColor: "var(--color-dimmed-bg)" }} />;
  return null;
}

// ── President + finance VP ────────────────────────────────────────────────────

async function loadFinance(projectId: string) {
  const [proj, entries, pending] = await Promise.all([
    supabase.from("projects").select("currency").eq("id", projectId).maybeSingle(),
    supabase.from("finance_entries").select("*").eq("project_id", projectId),
    supabase.from("expense_claims").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pending"),
  ]);
  const failed = [proj, entries, pending].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    currency: (proj.data?.currency as string) ?? "EUR",
    entries: (entries.data ?? []).map(mapEntry) as FinanceEntry[],
    pending: pending.count ?? 0,
  };
}
const EMPTY_FINANCE = { currency: "EUR", entries: [] as FinanceEntry[], pending: 0 };

export function FinanceSnapshotCard({ projectId }: { projectId: string | null }) {
  const { data, error, loaded } = useLoad(projectId, loadFinance, EMPTY_FINANCE);
  const t = totals(data.entries);
  const money = (n: number) => formatMoney(n, data.currency);
  return (
    <Card title="Finance" href="/finance" icon={<Wallet size={15} color="var(--color-navy)" aria-hidden="true" />}>
      <Status error={error} loaded={loaded} />
      {loaded && !error && (
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, margin: 0 }}>
          <div><dt style={muted}>Balance</dt><dd style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(t.balance)}</dd></div>
          <div><dt style={muted}>This month</dt><dd style={{ margin: "2px 0 0", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>In {money(t.monthIn)}<br />Out {money(t.monthOut)}</dd></div>
          <div>
            <dt style={muted}>Pending claims</dt>
            <dd style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 600, color: data.pending ? "var(--color-warning)" : "var(--color-body)" }}>{data.pending}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

// ── VPs + president: what still needs people ─────────────────────────────────

async function loadUpcoming(projectId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [events, slots] = await Promise.all([
    supabase.from("lc_events").select("*").eq("project_id", projectId).gte("ends_on", today).order("starts_on").limit(4),
    supabase.from("tabling_slots").select("*").eq("project_id", projectId).gt("starts_at", new Date().toISOString()).order("starts_at").limit(30),
  ]);
  const failed = [events, slots].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    events: (events.data ?? []).map(mapEvent) as LcEvent[],
    openSlots: ((slots.data ?? []).map(mapSlot) as TablingSlot[]).filter((s) => s.taken < s.capacity).slice(0, 4),
  };
}
const EMPTY_UPCOMING = { events: [] as LcEvent[], openSlots: [] as TablingSlot[] };

export function UpcomingNeedsCard({ projectId }: { projectId: string | null }) {
  const { data, error, loaded } = useLoad(projectId, loadUpcoming, EMPTY_UPCOMING);
  return (
    <Card title="Coming up" href="/tabling" icon={<CalendarDays size={15} color="var(--color-navy)" aria-hidden="true" />}>
      <Status error={error} loaded={loaded} />
      {loaded && !error && (
        <>
          <h3 style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10 }}>Events</h3>
          {data.events.length === 0 ? <p style={{ ...muted, margin: "4px 0 10px" }}>No upcoming events.</p> : (
            <ul style={{ listStyle: "none", margin: "4px 0 12px", padding: 0 }}>
              {data.events.map((e) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0" }}>
                  <Link href="/attendance" style={{ color: "var(--color-body)", textDecoration: "none" }}>{e.name}</Link>
                  <span style={{ color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{EVENT_TYPE_LABELS[e.type]} · {formatEventDates(e)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10 }}>Tabling slots that need people</h3>
          {data.openSlots.length === 0 ? <p style={{ ...muted, marginTop: 4 }}>Every upcoming slot is full.</p> : (
            <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
              {data.openSlots.map((s) => (
                <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0" }}>
                  <span style={{ color: "var(--color-body)" }}>{s.purpose}</span>
                  <span style={{ color: "var(--color-secondary)", whiteSpace: "nowrap" }}>
                    {new Date(s.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} · {formatTimeRange(s)} · <strong style={{ color: "var(--color-warning)" }}>{s.capacity - s.taken} needed</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

// ── Members: my next shift + my pending claims ────────────────────────────────

async function loadMine(projectId: string, userId: string) {
  const [signups, claims] = await Promise.all([
    supabase.from("tabling_signups").select("slot_id, tabling_slots(*)").eq("project_id", projectId).eq("user_id", userId).eq("status", "signed_up"),
    supabase.from("expense_claims").select("*").eq("project_id", projectId).eq("submitted_by", userId).order("created_at", { ascending: false }).limit(5),
  ]);
  const failed = [signups, claims].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const now = Date.now();
  const nextShift = (signups.data ?? [])
    .map((r) => (Array.isArray(r.tabling_slots) ? r.tabling_slots[0] : r.tabling_slots))
    .filter(Boolean)
    .map((s) => mapSlot(s as Record<string, unknown>))
    .filter((s) => new Date(s.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
  // Pending claims, plus anything reviewed in the last two weeks so the outcome is visible.
  const recent = ((claims.data ?? []).map(mapClaim) as ExpenseClaim[])
    .filter((c) => c.status === "pending" || now - new Date(c.reviewedAt ?? c.createdAt).getTime() < 14 * 86_400_000);
  return { nextShift, claims: recent };
}

export function MyNextCard({ projectId, userId }: { projectId: string | null; userId: string | null }) {
  const { data, error, loaded } = useLoad(
    projectId && userId ? projectId : null,
    (pid) => loadMine(pid, userId!),
    { nextShift: null as TablingSlot | null, claims: [] as ExpenseClaim[] },
  );
  const open = data.claims;
  return (
    <Card title="My next" href="/tabling" icon={<Store size={15} color="var(--color-navy)" aria-hidden="true" />}>
      <Status error={error} loaded={loaded} />
      {loaded && !error && (
        <>
          {data.nextShift ? (
            <p style={{ fontSize: 13, margin: "0 0 10px", color: "var(--color-body)" }}>
              <strong>{data.nextShift.purpose}</strong>{" "}
              <span style={{ color: "var(--color-secondary)" }}>
                {new Date(data.nextShift.startsAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · {formatTimeRange(data.nextShift)} · {data.nextShift.location}
              </span>
            </p>
          ) : (
            <p style={{ ...muted, marginBottom: 10 }}>No tabling shift booked. <Link href="/tabling" style={{ color: "var(--color-navy)" }}>Pick one</Link></p>
          )}
          <h3 style={{ ...muted, display: "flex", alignItems: "center", gap: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10 }}>
            <Receipt size={11} aria-hidden="true" /> My expense claims
          </h3>
          {open.length === 0 ? <p style={{ ...muted, marginTop: 4 }}>Nothing pending.</p> : (
            <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
              {open.map((c) => (
                <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.description}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(c.amount, c.currency)}</span>
                  <ClaimStatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
