"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authedPost } from "@/lib/api-client";
import { askConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/lc/ui";
import { formatDay } from "@/lib/dates";

interface Status { expa_name: string | null; home_lc_name: string | null; last_synced_at: string | null }
interface SyncResult { lc: string | null; inserted: number; updated: number; failed: number; skipped: number; errors: string[] }

/**
 * Connect EXPA / Sync from EXPA, for the pipeline header. Coming back from
 * auth.aiesec.org lands on /pipeline?expa=connected (or =error&reason=…).
 */
export default function ExpaSync({ projectId, onSynced }: { projectId: string; onSynced: () => void }) {
  const [status, setStatus] = useState<Status | null | undefined>(undefined);   // undefined = loading, null = not connected
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const back = q.get("expa");
    if (back) {
      window.history.replaceState(null, "", window.location.pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessage(back === "connected"
        ? { text: "EXPA is connected. Press Sync from EXPA to bring in your LC's applications." }
        : { text: `Couldn't connect EXPA: ${q.get("reason") ?? "unknown error"}`, error: true });
    }
    supabase.rpc("expa_status").then(({ data, error }) => {
      // Before the EXPA migration runs, the function is missing: show Connect, which explains itself.
      setStatus(error ? null : ((data as Status[] | null)?.[0] ?? null));
    });
  }, []);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await authedPost<{ url: string }>("/api/expa/connect", {});
      window.location.assign(url);
    } catch (e) {
      setMessage({ text: `Couldn't start connecting EXPA: ${e instanceof Error ? e.message : String(e)}`, error: true });
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await authedPost<SyncResult>("/api/expa/sync", { projectId });
      const parts = [`${r.inserted} new`, `${r.updated} updated`];
      if (r.skipped) parts.push(`${r.skipped} rejected or withdrawn left out`);
      if (r.failed) parts.push(`${r.failed} couldn't be saved`);
      setMessage({ text: `Synced ${r.lc ?? "your LC"} from EXPA: ${parts.join(", ")}.${r.errors.length ? ` ${r.errors.slice(0, 3).join("; ")}` : ""}`, error: r.failed > 0 });
      setStatus((s) => (s ? { ...s, last_synced_at: new Date().toISOString() } : s));
      onSynced();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/connect/i.test(text)) setStatus(null);
      setMessage({ text: `Couldn't sync from EXPA: ${text}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!(await askConfirm("Disconnect EXPA? Torch forgets your EXPA sign-in. Exchanges already synced stay in the pipeline.", { confirmLabel: "Disconnect" }))) return;
    const { error } = await supabase.rpc("disconnect_expa");
    if (error) { setMessage({ text: `Couldn't disconnect: ${error.message}`, error: true }); return; }
    setStatus(null);
    setMessage({ text: "EXPA is disconnected." });
  }

  if (status === undefined) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {status ? (
        <Button variant="secondary" onClick={sync} disabled={busy}>
          <RefreshCw size={14} aria-hidden="true" className={busy ? "animate-spin" : undefined} /> {busy ? "Syncing…" : "Sync from EXPA"}
        </Button>
      ) : (
        <Button variant="secondary" onClick={connect} disabled={busy}><Link2 size={14} aria-hidden="true" /> Connect EXPA</Button>
      )}
      {status && (
        <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
          {status.home_lc_name ?? "EXPA"}{status.last_synced_at ? `, synced ${formatDay(status.last_synced_at)}` : ", not synced yet"}
          {" · "}
          <button type="button" onClick={disconnect} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: "var(--color-secondary)", textDecoration: "underline", cursor: "pointer" }}>Disconnect</button>
        </span>
      )}
      {message && (
        <p role={message.error ? "alert" : "status"} style={{ margin: 0, maxWidth: 360, fontSize: 12, textAlign: "right", color: message.error ? "var(--color-error)" : "var(--color-body)" }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
