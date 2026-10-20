"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { STAGES, STAGE_DATE_FIELD, STAGE_LABEL, type ExchangeStage } from "@/lib/products";
import type { LcMember } from "@/hooks/useLcMembers";
import type { Exchange } from "@/types";

interface Change { kind: "created" | "stage" | "owner"; from: string | null; to: string | null; by: string | null; at: string }

const day = (iso: string) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The exchange's path through the stages ("Applied Oct 2 → Accepted Oct 10 (Tais)")
 * and who changed its stage or owner, for handovers and MC reporting.
 */
export default function ExchangeHistory({ exchange, roster }: { exchange: Exchange; roster: LcMember[] }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string | null) => (id && roster.find((m) => m.id === id)?.name.split(" ")[0]) || null;

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    supabase.from("exchange_history").select("kind, from_value, to_value, changed_by, changed_at")
      .eq("exchange_id", exchange.id).order("changed_at")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); return; }
        setChanges((data ?? []).map((r) => ({ kind: r.kind as Change["kind"], from: r.from_value as string | null, to: r.to_value as string | null, by: r.changed_by as string | null, at: r.changed_at as string })));
      });
    return () => { cancelled = true; };
  }, [exchange.id, exchange.updatedAt]);

  // Stage dates come from the exchange itself (imports included); who moved it, from the log.
  const reached = STAGES.filter((s) => exchange[STAGE_DATE_FIELD[s.code]]);
  const movedBy = (stage: ExchangeStage) => name(changes?.filter((c) => c.kind === "stage" && c.to === stage).at(-1)?.by ?? null);
  const owners = (changes ?? []).filter((c) => c.kind === "owner");

  return (
    <section aria-label="History" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
      <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 8px" }}>History</h3>
      <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 6px", lineHeight: 1.7 }}>
        {reached.map((s, i) => {
          const by = movedBy(s.code);
          return (
            <span key={s.code} style={{ whiteSpace: "nowrap" }}>
              {i > 0 && <span aria-hidden="true" style={{ color: "var(--color-secondary)" }}> → </span>}
              {STAGE_LABEL[s.code]} {day(exchange[STAGE_DATE_FIELD[s.code]] as string)}{by ? ` (${by})` : ""}
            </span>
          );
        })}
      </p>
      {owners.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12, color: "var(--color-secondary)" }}>
          {owners.map((c, i) => (
            <li key={i}>
              {day(c.at)}: {c.to ? `owner set to ${name(c.to) ?? "a former member"}` : "owner removed"}{name(c.by) ? ` by ${name(c.by)}` : ""}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "4px 0 0" }}>Couldn&apos;t load the history: {error}</p>}
    </section>
  );
}
