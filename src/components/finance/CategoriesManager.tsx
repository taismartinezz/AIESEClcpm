"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { mapCategory } from "@/lib/finance";
import type { FinanceCategory } from "@/types";
import { Button, ErrorText, inputStyle } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";

/** President-only: the LC's finance categories (RLS: "president manages finance categories"). */
export default function CategoriesManager({ projectId }: { projectId: string }) {
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase.from("finance_categories").select("*").eq("project_id", projectId).order("sort_order");
      if (cancelled) return;
      if (err) setError(`Couldn't load categories: ${err.message}`);
      else setCategories((data ?? []).map(mapCategory));
    })();
    return () => { cancelled = true; };
  }, [projectId, version]);

  async function run(key: string, action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setError(null);
    try {
      const { error: err } = await action();
      if (err) throw new Error(err.message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't save the category: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {categories.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 8, opacity: busy === c.id ? 0.6 : 1 }}>
            <input
              aria-label={`Category name: ${c.name}`}
              value={drafts[c.id] ?? c.name}
              onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              onBlur={() => {
                const next = (drafts[c.id] ?? c.name).trim();
                if (next && next !== c.name) void run(c.id, () => supabase.from("finance_categories").update({ name: next }).eq("id", c.id));
              }}
              style={{ ...inputStyle, height: 34 }}
            />
            <button
              type="button" aria-label={`Delete ${c.name}`}
              onClick={() => { void askConfirm(`Delete "${c.name}"? Entries keep their amounts but become uncategorised.`).then((ok) => { if (ok) void run(c.id, () => supabase.from("finance_categories").delete().eq("id", c.id)); }); }}
              style={{ width: 34, height: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--color-border)", background: "transparent", borderRadius: 6, cursor: "pointer" }}
            >
              <Trash2 size={13} color="var(--color-secondary)" />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          aria-label="New category" placeholder="New category" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ ...inputStyle, height: 34 }}
        />
        <Button
          disabled={!newName.trim() || busy === "new"}
          onClick={() => run("new", () => supabase.from("finance_categories").insert({ project_id: projectId, name: newName.trim(), sort_order: categories.length + 1 }))
            .then(() => setNewName(""))}
        >
          <Plus size={13} aria-hidden="true" /> Add
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
