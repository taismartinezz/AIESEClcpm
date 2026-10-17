"use client";

import { useMemo, useState } from "react";
import { FileUp, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS, type ProductCode } from "@/lib/products";
import { guessColumns, parseCsv } from "@/lib/sheet-import";
import { IMPORT_TARGETS, type ImportContext, type ImportTargetId } from "@/lib/importers";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

interface Result { inserted: number; updated: number; failed: number; errors: string[] }

/**
 * Import a tracker from a Google Sheets link or a CSV file: pick the source,
 * check the guessed columns, see what will happen, import. Every target's
 * database function applies the person's own permissions and reports rows it
 * couldn't write.
 */
export default function ImportWizard({ target: initialTarget, targets, projectId, context, products, onClose, onImported }: {
  target: ImportTargetId; targets?: ImportTargetId[]; projectId: string;
  context: Omit<ImportContext, "product">; products: ProductCode[];
  onClose: () => void; onImported: () => void;
}) {
  const [targetId, setTargetId] = useState<ImportTargetId>(initialTarget);
  const target = IMPORT_TARGETS[targetId];
  const [product, setProduct] = useState<ProductCode>(products[0] ?? "ogv");
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState<"sheet" | "file">("sheet");
  const [link, setLink] = useState("");
  const [loadedFrom, setLoadedFrom] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState<"load" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const ctx = useMemo(() => ({ ...context, product }), [context, product]);
  const plan = useMemo(() => (mapping ? target.build(data, mapping, ctx) : null), [target, data, mapping, ctx]);
  const missing = mapping && !target.requiresOneOf.some((f) => mapping[f] >= 0);

  function load(text: string, from: string) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("it has no rows below the header");
    setLoadedFrom(from);
    setHeader(rows[0]);
    setData(rows.slice(1));
    setMapping(guessColumns(rows[0], target.fields));
    setResult(null);
  }

  function changeTarget(id: ImportTargetId) {
    setTargetId(id);
    if (header.length) setMapping(guessColumns(header, IMPORT_TARGETS[id].fields));
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("load");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("the file is larger than 5 MB");
      if (/\.xlsx?$/i.test(file.name)) throw new Error("that's an Excel file. In Excel or Sheets choose File → Download → CSV, then upload the CSV");
      load(await file.text(), file.name);
    } catch (e) {
      setError(`Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function loadSheet() {
    setError(null);
    setBusy("load");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/sheets/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ url: link }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      load(body.csv as string, "your Google Sheet");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!plan || plan.rows.length === 0) return;
    setBusy("import");
    setError(null);
    try {
      const args = target.id === "exchanges"
        ? { p_project_id: projectId, p_product: product, p_rows: consent ? plan.rows.map((r) => ({ ...r, email_consent: true, consent_source: `import: ${loadedFrom}` })) : plan.rows }
        : { p_project_id: projectId, p_rows: plan.rows };
      const { data: rows, error: err } = await supabase.rpc(target.rpc, args);
      if (err) throw new Error(err.message);
      const r = (Array.isArray(rows) ? rows[0] : rows) as Result;
      setResult(r);
      if (r.inserted + r.updated > 0) onImported();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const sourceTab = (id: "sheet" | "file", label: string, Icon: typeof Link2) => (
    <Button variant={source === id ? "primary" : "secondary"} aria-pressed={source === id} onClick={() => setSource(id)} style={{ flex: 1 }}>
      <Icon size={14} aria-hidden="true" /> {label}
    </Button>
  );

  return (
    <Modal
      title="Import a tracker" onClose={onClose} width={660}
      footer={result ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={runImport} disabled={busy !== null || !plan || plan.rows.length === 0 || Boolean(missing)}>
          {busy === "import" ? "Importing…" : plan ? `Import ${plan.rows.length} row${plan.rows.length === 1 ? "" : "s"}` : "Import"}
        </Button>
      </>}
    >
      {result ? (
        <div role="status">
          <p style={{ fontSize: 14, color: "var(--color-body)", margin: "0 0 8px" }}>
            {result.inserted} added, {result.updated} {target.id === "tasks" ? "already there" : "updated"}
            {result.failed ? `, ${result.failed} not imported` : ""}.
          </p>
          {result.errors.length > 0 && (
            <ul style={{ fontSize: 12, color: "var(--color-error)", margin: 0, paddingLeft: 18 }}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: target.id === "exchanges" ? "1fr 1fr" : "1fr", gap: 12 }}>
            <Field label="What are you importing?" htmlFor="import-target" hint={target.description}>
              <select id="import-target" value={targetId} onChange={(e) => changeTarget(e.target.value as ImportTargetId)} style={selectStyle} disabled={(targets ?? []).length <= 1}>
                {(targets ?? [initialTarget]).map((id) => <option key={id} value={id}>{IMPORT_TARGETS[id].title}</option>)}
              </select>
            </Field>
            {target.id === "exchanges" && (
              <Field label="Product" htmlFor="import-product" hint="Import one product at a time.">
                <select id="import-product" value={product} onChange={(e) => setProduct(e.target.value as ProductCode)} style={selectStyle}>
                  {PRODUCTS.filter((p) => products.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.label} · {p.name}</option>)}
                </select>
              </Field>
            )}
          </div>

          {target.id === "exchanges" && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--color-body)", margin: "0 0 12px" }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ accentColor: "var(--color-navy)", marginTop: 2 }} />
              <span>Everyone in this file signed up with AIESEC (on EXPA or our own form) and agreed to be contacted. Needed for outreach emails; never tick it for bought or scraped lists.</span>
            </label>
          )}
          <div role="group" aria-label="Source" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {sourceTab("sheet", "Google Sheets link", Link2)}
            {sourceTab("file", "CSV file", FileUp)}
          </div>
          {source === "sheet" ? (
            <Field label="Link to the sheet" htmlFor="import-link" hint="Open the tab you want, copy the address bar. Share the sheet as “Anyone with the link can view”.">
              <div style={{ display: "flex", gap: 8 }}>
                <input id="import-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" style={{ ...inputStyle, flex: 1 }} />
                <Button variant="secondary" onClick={loadSheet} disabled={!link.trim() || busy !== null}>{busy === "load" ? "Loading…" : "Load"}</Button>
              </div>
            </Field>
          ) : (
            <Field label="CSV file" htmlFor="import-file" hint="In Google Sheets or Excel: File → Download → Comma-separated values (.csv).">
              <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => loadFile(e.target.files?.[0])} style={{ fontSize: 13 }} />
            </Field>
          )}

          {mapping && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "var(--color-body)", margin: "4px 0 6px" }}>
                Columns in {loadedFrom} <span style={{ fontWeight: 400, color: "var(--color-secondary)" }}>· check the guesses</span>
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: "6px 12px", maxHeight: 240, overflowY: "auto" }}>
                {target.fields.map(({ field, label }) => (
                  <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-body)" }}>
                    <span style={{ width: 130, flexShrink: 0 }}>{label}</span>
                    <select aria-label={`Column for ${label}`} value={mapping[field] ?? -1}
                      onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
                      style={{ ...selectStyle, height: 30, fontSize: 12 }}>
                      <option value={-1}>—</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {plan && (
                <div style={{ fontSize: 12, color: "var(--color-body)", marginTop: 12 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{plan.rows.length}</strong> row{plan.rows.length === 1 ? "" : "s"} to import
                    {plan.leftOut.map((l) => <span key={l.reason}>; {l.count} {l.reason}, left out</span>)}.
                  </p>
                  {plan.unmatched.length > 0 && (
                    <p style={{ margin: "4px 0 0", color: "var(--color-warning)" }}>
                      Not recognised (imported without it): {plan.unmatched.slice(0, 6).join(", ")}{plan.unmatched.length > 6 ? ` and ${plan.unmatched.length - 6} more` : ""}.
                    </p>
                  )}
                </div>
              )}
              {missing && <ErrorText>Choose the column for {target.fields.find((f) => f.field === target.requiresOneOf[0])?.label.toLowerCase()}.</ErrorText>}
            </>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
