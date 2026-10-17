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

type Tab = "ledger" | "claims";

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
        const [proj, cats, claimRows, entryRows] = await Promise.all([
          supabase.from("projects").select("currency").eq("id", projectId).maybeSingle(),
          supabase.from("finance_categories").select("*").eq("project_id", projectId).order("sort_order"),
          supabase.from("expense_claims").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
          canSeeLedger
            ? supabase.from("finance_entries").select("*").eq("project_id", projectId).order("entry_date", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);
        const failed = [proj, cats, claimRows, entryRows].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        setCurrency((proj.data?.currency as string) ?? DEFAULT_CURRENCY);
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Finance"
        subtitle={financeLead ? "Ledger, budgets and expense claims for your LC." : canSeeLedger ? "Spend and claims for your departments." : "Submit and track your expense claims."}
      >
        {canSeeLedger && (
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "ledger", label: "Overview & ledger" },
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
        ) : tab === "ledger" && canSeeLedger ? (
          <LedgerView
            projectId={projectId} userId={userId} currency={currency}
            entries={entries} categories={categories}
            departments={financeLead ? departments : ledDepartments}
            memberNames={names} canEdit={financeLead} onChanged={load}
          />
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
