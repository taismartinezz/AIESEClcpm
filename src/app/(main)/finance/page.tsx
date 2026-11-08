"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isFinanceLead } from "@/lib/permissions";
import { DEFAULT_CURRENCY, mapCategory, mapClaim, mapEntry } from "@/lib/finance";
import { useLcMembers } from "@/hooks/useLcMembers";
import type { ExpenseClaim, FinanceCategory, FinanceEntry } from "@/types";
import { ErrorText, Tabs } from "@/components/lc/ui";
import LedgerView from "@/components/finance/LedgerView";
import ClaimsView from "@/components/finance/ClaimsView";
import ClaimModal from "@/components/finance/ClaimModal";
import AccountStatement from "@/components/finance/AccountStatement";
import { Button } from "@/components/lc/ui";

type Tab = "ledger" | "university" | "claims";
interface LcFinance { name: string; termStart: string | null; reviewedOn: string | null; hasUniversity: boolean }

export default function FinancePage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const financeLead = isFinanceLead(role, userId, departments);
  // VPs see their departments' slice of the ledger; members only their claims.
  const canSeeLedger = financeLead || ledDepartmentIds.length > 0;

  const [tabChoice, setTab] = useState<Tab | null>(null);
  const tab: Tab = tabChoice ?? (canSeeLedger ? "ledger" : "claims");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const enabled = Boolean(projectId) && isSupabaseConfigured;
  const [error, setError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [lc, setLc] = useState<LcFinance>({ name: "", termStart: null, reviewedOn: null, hasUniversity: false });
  // Who keeps the LC account: the MC VP Finance, once the LC is linked to an MC that has one.
  const [hasKeeper, setHasKeeper] = useState<boolean | null>(null);
  const { names } = useLcMembers(projectId);

  // Bumping `version` re-runs the loader (after a claim or entry changes).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        // RLS returns exactly what this person may see; no client-side role filtering needed.
        const projQuery = (cols: string) => supabase.from("projects").select(cols).eq("id", projectId).maybeSingle();
        const [projFull, cats, claimRows, entryRows, keeper] = await Promise.all([
          projQuery("currency, name, term_start_date, finance_reviewed_on, has_university_account"),
          supabase.from("finance_categories").select("*").eq("project_id", projectId).order("sort_order"),
          supabase.from("expense_claims").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
          canSeeLedger
            ? supabase.from("finance_entries").select("*").eq("project_id", projectId).order("entry_date", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          supabase.rpc("lc_finance_keeper", { p_project_id: projectId }),
        ]);
        // Before migration 20261108009 there's no has_university_account column: ask without it.
        const proj = projFull.error?.code === "42703" ? await projQuery("currency, name, term_start_date") : projFull;
        const failed = [proj, cats, claimRows, entryRows].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        const p = (proj.data ?? {}) as Record<string, unknown>;
        setCurrency((p.currency as string) ?? DEFAULT_CURRENCY);
        setLc({ name: (p.name as string) ?? "Your LC", termStart: (p.term_start_date as string | null) ?? null, reviewedOn: (p.finance_reviewed_on as string | null) ?? null, hasUniversity: Boolean(p.has_university_account) });
        setHasKeeper(keeper.error ? null : Boolean((keeper.data as { has_keeper: boolean }[] | null)?.[0]?.has_keeper));
        setCategories((cats.data ?? []).map(mapCategory));
        setClaims((claimRows.data ?? []).map(mapClaim));
        setEntries((entryRows.data ?? []).map(mapEntry));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load finance: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, canSeeLedger, isLoading, enabled, version]);
  const loading = isLoading || (enabled && !loaded);

  const ledDepartments = departments.filter((d) => ledDepartmentIds.includes(d.id));
  const pending = claims.filter((c) => c.status === "pending").length;
  const lcEntries = entries.filter((e) => e.account === "lc");
  const uniEntries = entries.filter((e) => e.account === "university");
  // The finance lead can always find the university tab (to turn it on); VPs see it once it's on.
  const showUniversity = canSeeLedger && (lc.hasUniversity || financeLead);

  async function setUniversity(on: boolean) {
    if (!projectId) return;
    setError(null);
    const { error: err } = await supabase.rpc("set_university_account", { p_project_id: projectId, p_on: on });
    if (err) setError(`Couldn't change the university account: ${err.message}`); else load();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Finance"
        subtitle={financeLead ? "Ledger, budgets and expense claims for your LC." : canSeeLedger ? "Spend and claims for your departments." : "Submit and track your expense claims."}
      >
        {canSeeLedger && (
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "ledger", label: "Overview & ledger" },
            ...(showUniversity ? [{ id: "university" as const, label: "University money" }] : []),
            { id: "claims", label: pending && financeLead ? `Claims (${pending} pending)` : "Claims" },
          ]} />
        )}
      </PageHeader>

      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1200, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !isSupabaseConfigured || !projectId || !userId ? (
          <NeedsDatabase what="Finance">The LC&apos;s income and expenses, expense claims with receipts, and who approves them.</NeedsDatabase>
        ) : tab === "university" && showUniversity ? (
          lc.hasUniversity ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <AccountStatement
                projectId={projectId} userId={userId} lcName={lc.name} account="university" currency={currency}
                entries={uniEntries} termStart={lc.termStart} reviewedOn={null}
                canEdit={financeLead} onChanged={load}
              />
              {financeLead && (
                <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                  Your MC VP Finance sees this account too. University stopped funding the LC?{" "}
                  <button type="button" onClick={() => setUniversity(false)} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--color-navy)", textDecoration: "underline", cursor: "pointer" }}>Turn the university account off</button> (its transactions are kept).
                </p>
              )}
            </div>
          ) : (
            <section aria-label="University money" style={{ border: "1px dashed var(--color-border)", borderRadius: 10, padding: 18, maxWidth: 620, backgroundColor: "var(--color-surface)" }}>
              <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px", color: "var(--color-body)" }}>Does your university give the LC money?</p>
              <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 12px", lineHeight: 1.5 }}>
                Keep it in its own account, separate from the LC account: the same statement as the National Finance Tracker, with its own balance and trend.
                You and your MC VP Finance can record it. Not every university funds its LC, so it&apos;s off until you turn it on.
              </p>
              <Button onClick={() => setUniversity(true)}>Turn on university money</Button>
            </section>
          )
        ) : tab === "ledger" && canSeeLedger ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p role="note" style={{ fontSize: 12, margin: 0, padding: "8px 12px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)", color: "var(--color-body)" }}>
            {hasKeeper === false
              ? "Your MC's VP Finance keeps this account, as in the National Finance Tracker, and nobody does yet: link your LC to your MC (Settings → LC & departments) and ask your MCP to name a VP Finance."
              : "Your MC's VP Finance keeps this account, as in the National Finance Tracker. Expense claims they approve show up here."}
          </p>
          <LedgerView
            projectId={projectId} userId={userId} currency={currency}
            entries={lcEntries} categories={categories}
            departments={financeLead ? departments : ledDepartments}
            memberNames={names} canEdit={financeLead} canWrite={false} onChanged={load}
          />
          </div>
        ) : (
          <ClaimsView
            claims={claims} userId={userId} departments={departments} memberNames={names}
            isFinanceLead={financeLead} onNewClaim={() => setClaimOpen(true)} onChanged={load}
          />
        )}
      </div>

      {claimOpen && projectId && userId && (
        <ClaimModal
          projectId={projectId} userId={userId} currency={currency}
          departments={departments} categories={categories} defaultDepartmentId={ledDepartmentIds[0] ?? departmentId}
          onClose={() => setClaimOpen(false)}
          onSaved={() => { setClaimOpen(false); load(); }}
        />
      )}
    </div>
  );
}
