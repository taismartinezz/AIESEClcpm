"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Handshake, Plane, CheckSquare, UserPlus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useProject } from "@/context/ProjectContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { PRODUCTS, type ProductCode } from "@/lib/products";
import { IMPORT_TARGETS, type ImportTargetId } from "@/lib/importers";
import { useLcMembers } from "@/hooks/useLcMembers";
import ImportWizard from "@/components/import/ImportWizard";

const ICONS: Record<ImportTargetId, typeof Plane> = { exchanges: Plane, partners: Handshake, recruits: UserPlus, tasks: CheckSquare };

/** Bring the LC's Google Sheets trackers into the app. */
export default function ImportPage() {
  const { projectId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const { members } = useLcMembers(projectId);
  const [open, setOpen] = useState<ImportTargetId | null>(null);
  const [done, setDone] = useState<ImportTargetId[]>([]);

  const products = useMemo<ProductCode[]>(() => {
    if (role === "president") return PRODUCTS.map((p) => p.code);
    const mine = departments.filter((d) => d.id === departmentId || ledDepartmentIds.includes(d.id));
    return PRODUCTS.map((p) => p.code).filter((c) => mine.some((d) => d.products.includes(c)));
  }, [role, departments, departmentId, ledDepartmentIds]);

  const available: ImportTargetId[] = [
    ...(products.length ? ["exchanges" as const] : []),
    "partners", "tasks",
    ...(isExec(role) ? ["recruits" as const] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Import trackers" subtitle="Bring your Google Sheets into the app once, then keep working here." />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 900, width: "100%" }}>
        {isLoading ? null : !isSupabaseConfigured || !projectId ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Importing needs a connected database.</p>
        ) : (
          <>
            <ol style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.7, margin: "0 0 18px", paddingLeft: 20 }}>
              <li>Open the tracker in Google Sheets and pick the tab with the data. The first row must be the column names.</li>
              <li>Share it as <strong>Anyone with the link can view</strong>, or download it as CSV.</li>
              <li>Choose what it contains below, paste the link (or upload the CSV) and check the columns.</li>
            </ol>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {available.map((id) => {
                const t = IMPORT_TARGETS[id];
                const Icon = ICONS[id];
                return (
                  <button key={id} type="button" onClick={() => setOpen(id)}
                    style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: 14, borderRadius: 10, cursor: "pointer",
                      border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}>
                    <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-navy-dim)", flexShrink: 0 }}>
                      <Icon size={16} color="var(--color-navy)" />
                    </span>
                    <span>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--color-body)" }}>{t.title}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", marginTop: 3 }}>{t.description}</span>
                      {done.includes(id) && <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-success, #00A86B)", marginTop: 6 }}>Imported</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)", marginTop: 18 }}>
              <FileSpreadsheet size={13} aria-hidden="true" /> Importing again later is safe: people, partners and recruits already in the app are updated, not duplicated.
            </p>
          </>
        )}
      </div>
      {open && projectId && (
        <ImportWizard target={open} targets={available} projectId={projectId} products={products}
          context={{ departments, roster: members, defaultDepartmentId: departmentId }}
          onClose={() => setOpen(null)} onImported={() => setDone((d) => [...new Set([...d, open])])} />
      )}
    </div>
  );
}
