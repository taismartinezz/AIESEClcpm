"use client";

import { useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { RECEIPT_BUCKET } from "@/lib/finance";

/** Opens a receipt through a short-lived signed URL (the bucket is private). */
export default function ReceiptButton({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the URL.
    // ("noopener" would make window.open return null, so detach the opener by hand.)
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { data, error: err } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60);
      if (err || !data?.signedUrl) throw new Error(err?.message ?? "no URL returned");
      if (tab) tab.location.href = data.signedUrl;
      else window.location.assign(data.signedUrl);
    } catch (e) {
      tab?.close();
      setError(`Couldn't open receipt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column" }}>
      <button
        type="button" onClick={open} disabled={busy}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-navy)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Paperclip size={12} aria-hidden="true" />}
        Receipt
      </button>
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--color-error)" }}>{error}</span>}
    </span>
  );
}
