"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { mapExchange } from "@/lib/pipeline";
import { PRODUCT_BY_CODE, type ProductCode } from "@/lib/products";
import { achieved, DEFAULT_RATES, lcRates, plan, type Rates } from "@/lib/funnelPlan";
import { Panel, inputStyle } from "@/components/lc/ui";
import type { Exchange } from "@/types";

const OUTGOING: ProductCode[] = ["ogv", "ogta", "ogte"];
const today = () => new Date().toISOString().slice(0, 10);
const pct = (n: number) => Math.round(n * 1000) / 10;

/**
 * The planning template's "work backwards": from each product's approvals
 * goal and the conversion rates, the sign-ups, applicants and acceptances it
 * takes, what's left this term, and per week (what Marketing plans for).
 */
export default function FunnelPlanner({ projectId, termStart, termEnd, approvalGoals }: {
  projectId: string; termStart: string; termEnd: string; approvalGoals: Partial<Record<ProductCode, number>>;
}) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [source, setSource] = useState<"template" | "lc" | "custom">("template");
  const [custom, setCustom] = useState<Rates>(DEFAULT_RATES);
  const [goals, setGoals] = useState<Partial<Record<ProductCode, string>>>({});

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    // RLS shows each person the products they can see.
    supabase.from("exchanges").select("*").eq("project_id", projectId).then(({ data }) => {
      if (!cancelled) setExchanges((data ?? []).map(mapExchange));
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const [yearAgo] = useState(() => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10));
  const [now] = useState(today);
  const own = useMemo(() => lcRates(exchanges.filter((e) => OUTGOING.includes(e.product as ProductCode)), yearAgo), [exchanges, yearAgo]);
  const rates = source === "lc" && own ? own : source === "custom" ? custom : DEFAULT_RATES;

  const rows = OUTGOING.map((code) => {
    const typed = goals[code];
    const goal = typed !== undefined ? Number(typed) || 0 : approvalGoals[code] ?? 0;
    const done = achieved(exchanges.filter((e) => e.product === code), termStart);
    return { code, goal, fromGoals: typed === undefined && approvalGoals[code] !== undefined, p: goal > 0 ? plan(goal, rates, done, termEnd, now) : null };
  });
  const totalPerWeek = rows.reduce((s, r) => s + (r.p?.perWeek.signups ?? 0), 0);

  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const rateInput = (key: keyof Rates, label: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--color-secondary)" }}>
      {label}
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" min={1} max={100} step={0.5} aria-label={`${label} (%)`} value={pct(rates[key])}
          onChange={(e) => { const v = Math.min(100, Math.max(0.5, Number(e.target.value) || 0)) / 100; setCustom({ ...rates, [key]: v }); setSource("custom"); }}
          style={{ ...inputStyle, width: 72, height: 32 }} />%
      </span>
    </label>
  );

  return (
    <Panel title="Plan backwards from approvals">
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, lineHeight: 1.5 }}>
          How many sign-ups, applicants and acceptances your approval goals take, what&apos;s left this term and how many a week until it ends.
          Goals come from your pipeline goals; you can try other numbers here (nothing is saved).
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--color-secondary)" }}>
            Conversion rates
            <select aria-label="Conversion rates" value={source} onChange={(e) => setSource(e.target.value as typeof source)} style={{ ...inputStyle, width: "auto", height: 32 }}>
              <option value="template">AIESEC rule of thumb</option>
              <option value="lc" disabled={!own}>Our LC&apos;s last year{own ? "" : " (not enough data yet)"}</option>
              <option value="custom">My own</option>
            </select>
          </label>
          {rateInput("signupToApplied", "Sign-up → applicant")}
          {rateInput("appliedToAccepted", "Applicant → accepted")}
          {rateInput("acceptedToApproved", "Accepted → approved")}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th scope="col" style={{ ...th, textAlign: "left" }}>Product</th>
              <th scope="col" style={th}>Approvals goal</th>
              <th scope="col" style={th}>Sign-ups</th>
              <th scope="col" style={th}>Applicants</th>
              <th scope="col" style={th}>Accepted</th>
              <th scope="col" style={th} title="From now until the term ends">Per week from now</th>
            </tr></thead>
            <tbody>
              {rows.map(({ code, goal, fromGoals, p }) => (
                <tr key={code}>
                  <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{PRODUCT_BY_CODE[code].label}</th>
                  <td style={td}>
                    <input aria-label={`${PRODUCT_BY_CODE[code].label} approvals goal`} inputMode="numeric" value={goals[code] ?? (goal ? String(goal) : "")}
                      placeholder="0" onChange={(e) => setGoals((g) => ({ ...g, [code]: e.target.value.replace(/[^0-9]/g, "") }))}
                      style={{ ...inputStyle, width: 72, height: 30, textAlign: "right" }} />
                    {fromGoals && <span style={{ display: "block", fontSize: 10, color: "var(--color-secondary)" }}>from your goals</span>}
                  </td>
                  {p ? (
                    <>
                      <td style={td}>{p.needed.signups}<span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{p.done.signups} so far</span></td>
                      <td style={td}>{p.needed.applied}<span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{p.done.applied} so far</span></td>
                      <td style={td}>{p.needed.accepted}<span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{p.done.accepted} so far</span></td>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {p.perWeek.signups} sign-ups
                        <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--color-secondary)" }}>{p.perWeek.applied} applicants · {p.perWeek.accepted} accepted · {p.weeksLeft} weeks</span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} style={{ ...td, textAlign: "left", color: "var(--color-secondary)" }}>Enter an approvals goal</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPerWeek > 0 && (
          <p role="status" style={{ margin: 0, fontSize: 13, padding: "8px 12px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)" }}>
            Marketing needs about <strong>{totalPerWeek} sign-ups a week</strong> across outgoing products until the term ends.
          </p>
        )}
      </div>
    </Panel>
  );
}
