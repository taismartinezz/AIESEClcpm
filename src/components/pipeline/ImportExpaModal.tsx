"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS, STAGES, type ProductCode } from "@/lib/products";
import { IMPORT_FIELDS, buildImport, guessMapping, parseCsv, type ImportField } from "@/lib/expa-import";
import { Button, ErrorText, Field, Modal, selectStyle } from "@/components/lc/ui";

interface Result { inserted: number; updated: number; failed: number; errors: string[] }

/**
 * Import an EXPA CSV export into one product's pipeline. Columns are guessed
 * by name and can be corrected; rows already imported (same EXPA ID) are
 * updated, not duplicated.
 */
export default function ImportExpaModal({ projectId, products, defaultProduct, onClose, onImported }: {
  projectId: string; products: ProductCode[]; defaultProduct: ProductCode;
  onClose: () => void; onImported: () => void;
}) {
  const [product, setProduct] = useState<ProductCode>(defaultProduct);
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<ImportField, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const plan = useMemo(() => (mapping ? buildImport(data, mapping) : null), [data, mapping]);
  const byStage = useMemo(() => STAGES.map((s) => ({ ...s, n: plan?.rows.filter((r) => r.stage === s.code).length ?? 0 })).filter((s) => s.n > 0), [plan]);

  async function readFile(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("the file is larger than 5 MB");
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("the file has no data rows");
      setFileName(file.name);
      setHeader(rows[0]);
      setData(rows.slice(1));
      setMapping(guessMapping(rows[0]));
    } catch (e) {
      setError(`Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function runImport() {
    if (!plan || plan.rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { data: rows, error: err } = await supabase.rpc("import_exchanges", { p_project_id: projectId, p_product: product, p_rows: plan.rows });
      if (err) throw new Error(err.message);
      const r = (Array.isArray(rows) ? rows[0] : rows) as Result;
      setResult(r);
      if (r.inserted + r.updated > 0) onImported();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const missingName = mapping && mapping.person_name < 0 && mapping.expa_id < 0;

  return (
    <Modal
      title="Import from EXPA" onClose={onClose} width={620}
      footer={result ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={runImport} disabled={busy || !plan || plan.rows.length === 0 || Boolean(missingName)}>
          {busy ? "Importing…" : plan ? `Import ${plan.rows.length} exchange${plan.rows.length === 1 ? "" : "s"}` : "Import"}
        </Button>
      </>}
    >
      {result ? (
        <div role="status">
          <p style={{ fontSize: 14, color: "var(--color-body)", margin: "0 0 8px" }}>
            {result.inserted} added, {result.updated} updated{result.failed ? `, ${result.failed} not imported` : ""}.
          </p>
          {result.errors.length > 0 && (
            <ul style={{ fontSize: 12, color: "var(--color-error)", margin: 0, paddingLeft: 18 }}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 12px" }}>
            In EXPA, export your applications as CSV and choose the file here. Import one product at a time. People already
            in the pipeline (same EXPA application ID) are updated, so you can import the same export again each week.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Product" htmlFor="import-product">
              <select id="import-product" value={product} onChange={(e) => setProduct(e.target.value as ProductCode)} style={selectStyle}>
                {PRODUCTS.filter((p) => products.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.label} · {p.name}</option>)}
              </select>
            </Field>
            <Field label="EXPA export (.csv)" htmlFor="import-file">
              <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} style={{ fontSize: 13 }} />
            </Field>
          </div>

          {mapping && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "var(--color-body)", margin: "4px 0 6px" }}>
                Columns in {fileName} <span style={{ fontWeight: 400, color: "var(--color-secondary)" }}>· check the guesses</span>
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "6px 12px", maxHeight: 260, overflowY: "auto" }}>
                {IMPORT_FIELDS.map(({ field, label }) => (
                  <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-body)" }}>
                    <span style={{ width: 120, flexShrink: 0 }}>{label}</span>
                    <select
                      aria-label={`Column for ${label}`} value={mapping[field]}
                      onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
                      style={{ ...selectStyle, height: 30, fontSize: 12 }}
                    >
                      <option value={-1}>—</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {plan && (
                <p style={{ fontSize: 12, color: "var(--color-body)", margin: "12px 0 0" }}>
                  <strong>{plan.rows.length}</strong> to import
                  {byStage.length > 0 && <> ({byStage.map((s) => `${s.n} ${s.label.toLowerCase()}`).join(", ")})</>}
                  {plan.skipped > 0 && <>; {plan.skipped} rejected or withdrawn, left out</>}
                  {plan.empty > 0 && <>; {plan.empty} without a name or ID, left out</>}.
                  {mapping.expa_id < 0 && <span style={{ color: "var(--color-warning)" }}> Without an EXPA ID column, importing the same file again will add duplicates.</span>}
                </p>
              )}
              {missingName && <ErrorText>Choose the column with the person&apos;s name or EXPA ID.</ErrorText>}
            </>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
