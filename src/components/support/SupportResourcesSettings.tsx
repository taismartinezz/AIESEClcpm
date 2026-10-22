"use client";

import { useEffect, useState } from "react";
import { Plus, Phone, Globe } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  getRegistryResources, getInstitutionName, hasNoCounselingResources, INSTITUTION_OPTIONS,
} from "@/lib/support/institutions";
import type { LabResource } from "@/lib/support/institutions";

/**
 * The LC's support resources (counseling, urgent lines…) shown in "Get help".
 * Moved here from the Team page; the president manages them in Settings.
 */
export default function SupportResourcesSettings({ projectId }: { projectId: string }) {
  const [adminResources, setAdminResources] = useState<LabResource[]>([]);
  const [institutionKey, setInstitutionKey] = useState<string | null>(null);
  const [savingInstitution, setSavingInstitution] = useState(false);
  const [showAddResource, setShowAddResource] = useState(false);
  const [newResource, setNewResource] = useState<Partial<LabResource>>({ contact_type: "phone" });
  const [savingResource, setSavingResource] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [lcUniversity, setLcUniversity] = useState("");

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    (async () => {
      const [resQ, projQ] = await Promise.all([
        supabase
          .from("support_resources")
          .select("id, label, description, confidentiality, category, contact_type, contact_value, availability, is_pinned, sort_order, active")
          .eq("project_id", projectId)
          .order("sort_order"),
        supabase
          .from("projects")
          .select("institution_key, institution")
          .eq("id", projectId)
          .maybeSingle(),
      ]);
      setAdminResources((resQ.data ?? []) as LabResource[]);
      if (projQ.data?.institution_key) setInstitutionKey(projQ.data.institution_key as string);
      setLcUniversity((projQ.data?.institution as string | null) ?? "");
    })();
  }, [projectId]);

  return (
    <SupportResourcesAdmin
      projectId={projectId}
      lcUniversity={lcUniversity}
      piRows={adminResources}
      institutionKey={institutionKey}
      savingInstitution={savingInstitution}
      showAddResource={showAddResource}
      newResource={newResource}
      savingResource={savingResource}
      resourceError={resourceError}
      onSetInstitution={async (key) => {
        if (!isSupabaseConfigured) { setInstitutionKey(key); return; }
        setSavingInstitution(true);
        await supabase.from("projects").update({ institution_key: key || null }).eq("id", projectId);
        setInstitutionKey(key || null);
        setSavingInstitution(false);
      }}
      onOverride={(cat) => {
        setNewResource({ category: cat, contact_type: "phone", active: true, sort_order: 0, is_pinned: false });
        setShowAddResource(true);
      }}
      onSetNewResource={setNewResource}
      onToggleAddResource={() => { setShowAddResource(v => !v); setNewResource({ contact_type: "phone" }); setResourceError(""); }}
      onSaveResource={async () => {
        if (!newResource.label || !newResource.contact_value || !newResource.category) {
          setResourceError("Label, Contact value, and Category are required.");
          return;
        }
        setSavingResource(true);
        const row: LabResource = {
          id: crypto.randomUUID(),
          label: newResource.label,
          description: newResource.description ?? null,
          confidentiality: newResource.confidentiality ?? null,
          category: newResource.category,
          contact_type: newResource.contact_type as LabResource["contact_type"],
          contact_value: newResource.contact_value,
          availability: newResource.availability ?? null,
          is_pinned: newResource.is_pinned ?? false,
          sort_order: newResource.sort_order ?? 0,
          active: true,
        };
        if (isSupabaseConfigured) {
          const { error: insErr } = await supabase.from("support_resources").insert({ ...row, project_id: projectId });
          if (insErr) {
            setResourceError("Failed to save: " + insErr.message);
            setSavingResource(false);
            return;
          }
        }
        setAdminResources(prev => [...prev, row]);
        setResourceError("");
        setShowAddResource(false);
        setNewResource({ contact_type: "phone" });
        setSavingResource(false);
      }}
      onDeleteResource={async (id) => {
        setAdminResources(prev => prev.filter(r => r.id !== id));
        if (isSupabaseConfigured) await supabase.from("support_resources").delete().eq("id", id);
      }}
    />
  );
}

// ── Support resources admin (PI only) ────────────────────────────────────────

const CATEGORY_OPTIONS = ["urgent", "counseling", "academic", "workplace", "health", "other"] as const;
const CONTACT_TYPE_OPTIONS = ["phone", "url", "email", "in_person"] as const;

function SupportResourcesAdmin({
  lcUniversity, piRows, institutionKey, savingInstitution,
  showAddResource, newResource, savingResource, resourceError,
  onSetInstitution, onOverride, onSetNewResource, onToggleAddResource, onSaveResource, onDeleteResource,
}: {
  projectId: string;
  lcUniversity: string;
  piRows: LabResource[];
  institutionKey: string | null;
  savingInstitution: boolean;
  showAddResource: boolean;
  newResource: Partial<LabResource>;
  savingResource: boolean;
  resourceError: string;
  onSetInstitution: (key: string) => void;
  onOverride: (category: string) => void;
  onSetNewResource: (r: Partial<LabResource>) => void;
  onToggleAddResource: () => void;
  onSaveResource: () => void;
  onDeleteResource: (id: string) => void;
}) {
  const registryRows = getRegistryResources(institutionKey);
  const institutionName = getInstitutionName(institutionKey);
  const showNoCounselingBanner = hasNoCounselingResources(piRows, institutionKey);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 12, borderRadius: 6,
    border: "1px solid var(--color-border)", background: "var(--color-canvas)",
    color: "var(--color-body)", fontFamily: "var(--font-roboto)", outline: "none",
  };

  return (
    <div style={{ marginBottom: 32, padding: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12 }}>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)", fontFamily: "var(--font-lora)", margin: 0 }}>
          Support resources
        </h2>
        <button
          onClick={onToggleAddResource}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "5px 12px", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
        >
          <Plus size={12} /> Add Resource
        </button>
      </div>

      {/* Institution picker */}
      <div className="flex items-center gap-3 mb-4">
        <span style={{ fontSize: 12, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>Built-in support lines from:</span>
        <select
          value={institutionKey ?? ""}
          onChange={e => onSetInstitution(e.target.value)}
          disabled={savingInstitution}
          style={{ ...inputStyle, width: "auto", minWidth: 200 }}
        >
          <option value="">None (add your own below)</option>
          {/* Only this LC's own university (or what's already chosen), not every university we know. */}
          {INSTITUTION_OPTIONS.filter(o => o.key === institutionKey || sameUniversity(o.name, lcUniversity)).map(o => (
            <option key={o.key} value={o.key}>{o.name}</option>
          ))}
        </select>
        {institutionName && (
          <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
            {institutionName}&apos;s counseling and urgent lines are included below.
          </span>
        )}
      </div>

      {showNoCounselingBanner && (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", padding: "8px 12px", backgroundColor: "var(--color-dimmed-bg)", borderRadius: 7, marginBottom: 12 }}>
          There are no built-in support resources for your university yet. Add them so your team can find them.
        </p>
      )}

      {/* Registry rows - read-only */}
      {registryRows.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            From your institution
          </p>
          <div className="flex flex-col gap-2">
            {registryRows.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
                {r.contact_type === "phone" ? <Phone size={13} color="var(--color-secondary)" /> : <Globe size={13} color="var(--color-secondary)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{r.label}</p>
                  {r.description && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.description}</p>}
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.contact_value}{r.availability ? ` · ${r.availability}` : ""}</p>
                </div>
                <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap", padding: "2px 7px", border: "1px solid var(--color-border)", borderRadius: 4 }}>
                  {r.category}
                </span>
                <button
                  onClick={() => onOverride(r.category)}
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--color-navy)", background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Override
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PI-configured rows */}
      {piRows.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Your lab&rsquo;s resources
          </p>
          <div className="flex flex-col gap-2">
            {piRows.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
                {r.contact_type === "phone" ? <Phone size={13} color="var(--color-secondary)" /> : <Globe size={13} color="var(--color-secondary)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{r.label}</p>
                  {r.description && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.description}</p>}
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.contact_value}{r.availability ? ` · ${r.availability}` : ""}</p>
                </div>
                <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap", padding: "2px 7px", border: "1px solid var(--color-border)", borderRadius: 4 }}>
                  {r.category}
                </span>
                <button
                  onClick={() => onDeleteResource(r.id)}
                  style={{ fontSize: 11, color: "var(--color-error, #dc2626)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add resource form */}
      {showAddResource && (
        <div style={{ padding: 14, borderRadius: 10, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-body)", marginBottom: 10 }}>New resource</p>
          <div className="flex flex-col gap-2">
            <input placeholder="Label *" value={newResource.label ?? ""} onChange={e => onSetNewResource({ ...newResource, label: e.target.value })} style={inputStyle} />
            <input placeholder="Description" value={newResource.description ?? ""} onChange={e => onSetNewResource({ ...newResource, description: e.target.value })} style={inputStyle} />
            <input placeholder="Contact value (phone number or URL) *" value={newResource.contact_value ?? ""} onChange={e => onSetNewResource({ ...newResource, contact_value: e.target.value })} style={inputStyle} />
            <input placeholder="Availability (e.g. Mon–Fri 9am–5pm)" value={newResource.availability ?? ""} onChange={e => onSetNewResource({ ...newResource, availability: e.target.value })} style={inputStyle} />
            <input placeholder="Confidentiality note" value={newResource.confidentiality ?? ""} onChange={e => onSetNewResource({ ...newResource, confidentiality: e.target.value })} style={inputStyle} />
            <div className="flex gap-2">
              <select value={newResource.category ?? ""} onChange={e => onSetNewResource({ ...newResource, category: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
                <option value="">Category *</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={newResource.contact_type ?? "phone"} onChange={e => onSetNewResource({ ...newResource, contact_type: e.target.value as LabResource["contact_type"] })} style={{ ...inputStyle, flex: 1 }}>
                {CONTACT_TYPE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {resourceError && (
              <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4, marginBottom: 2 }}>{resourceError}</p>
            )}
            <div className="flex gap-2 mt-1">
              <button
                onClick={onSaveResource}
                disabled={savingResource}
                style={{ flex: 1, height: 36, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: savingResource ? "default" : "pointer" }}
              >
                {savingResource ? "Saving…" : "Save"}
              </button>
              <button onClick={onToggleAddResource} style={{ flex: 1, height: 36, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 13, background: "transparent", cursor: "pointer", color: "var(--color-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/** "Northwestern University" ~ "Northwestern", ignoring case and punctuation. */
function sameUniversity(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\buniversity\b|\bof\b|\bthe\b/g, "").trim();
  const [x, y] = [norm(a), norm(b)];
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}
