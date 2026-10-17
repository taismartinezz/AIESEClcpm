"use client";

import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { supabase, isPreview } from "@/lib/supabase";
import { connectGoogleCalendar } from "@/lib/google-calendar";

/** Connect / disconnect the person's own Google Calendar (read-only). */
export default function GoogleCalendarCard({ connected, email, onChanged, returnTo = "/scheduling" }: { connected: boolean; email: string | null; onChanged: () => void; returnTo?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      if (isPreview) throw new Error("Google Calendar can't be connected in the preview, which uses sample data.");
      const problem = await connectGoogleCalendar(returnTo);
      if (problem) throw new Error(problem);
      // On success the browser goes to Google and comes back to Scheduling.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("disconnect_google_calendar");
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't disconnect: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Google Calendar" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", alignSelf: "start" }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>Google Calendar</h2>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 8, backgroundColor: "var(--color-navy-dim)" }}>
          {connected
            ? <Check size={13} color="var(--color-success, #00A86B)" aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
            : <AlertCircle size={13} color="var(--color-secondary)" aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />}
          <p style={{ fontSize: 12, color: "var(--color-body)", margin: 0, lineHeight: 1.5 }}>
            {connected
              ? <>Connected{email ? <> as <strong>{email}</strong></> : null}. Your Google events show in your Scheduling calendar.</>
              : "Not connected. Connect to see your Google Calendar events next to your LC's schedule."}
          </p>
        </div>
        <button type="button" onClick={connected ? disconnect : connect} disabled={busy}
          style={{
            height: 38, borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer",
            border: "1px solid var(--color-border)",
            backgroundColor: connected ? "transparent" : "var(--color-btn-primary, var(--color-navy))",
            color: connected ? "var(--color-error)" : "#fff",
          }}>
          {busy ? "One moment…" : connected ? "Disconnect Google Calendar" : "Connect Google Calendar"}
        </button>
        <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: 0, lineHeight: 1.5 }}>
          Read-only. Only you see your Google events; nobody else in your LC does, and nothing is changed in your Google Calendar.
        </p>
        {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>{error}</p>}
      </div>
    </section>
  );
}
