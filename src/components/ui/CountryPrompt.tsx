"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import CountryCombobox from "@/components/ui/CountryCombobox";

/**
 * Asked once of people who joined before onboarding had a Country step. It
 * saves the country on their profile, and for an LC president whose LC has
 * none yet, on the LC too. It stays until answered: the country is required.
 */
export default function CountryPrompt({ userId, projectId, isPresident, onSaved }: {
  userId: string; projectId: string | null; isPresident: boolean; onSaved: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!code) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("user_profiles").update({ country_code: code }).eq("id", userId);
    if (err) { setError(`Couldn't save: ${err.message}`); setBusy(false); return; }
    if (isPresident && projectId) {
      // Best effort: the LC takes its president's country if it has none.
      await supabase.from("projects").update({ country_code: code }).eq("id", projectId).is("country_code", null);
    }
    onSaved(code);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="country-prompt-title"
      style={{ position: "fixed", inset: 0, zIndex: 70, backgroundColor: "var(--color-navy-scrim)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "max(16px, 12vh) 16px 16px" }}>
      <div style={{ backgroundColor: "var(--color-surface)", borderRadius: 12, width: "100%", maxWidth: 420, padding: 22, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
        <h2 id="country-prompt-title" style={{ fontSize: 17, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 6px" }}>Which country is your LC in?</h2>
        <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "0 0 14px" }}>
          We now ask everyone for their AIESEC country. You can change it later in Settings &gt; Profile.
        </p>
        <CountryCombobox value={code} onChange={setCode} autoFocus />
        {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "8px 0 0" }}>{error}</p>}
        <button type="button" onClick={save} disabled={!code || busy}
          style={{ marginTop: 16, width: "100%", height: 42, borderRadius: 8, border: "none", fontSize: 14, fontWeight: 700, color: "#fff",
            backgroundColor: code && !busy ? "var(--color-btn-primary)" : "var(--color-border)", cursor: code && !busy ? "pointer" : "default" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
