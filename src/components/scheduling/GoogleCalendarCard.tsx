"use client";

import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { supabase, isPreview } from "@/lib/supabase";
import { authedPost } from "@/lib/api-client";
import { connectGoogleCalendar } from "@/lib/google-calendar";
import { APP_NAME } from "@/lib/brand";

/**
 * Connect / disconnect the person's own Google Calendar, and their switch for
 * having their LC's events added to it. Connections made before that could
 * only read, so they're asked to reconnect.
 */
export default function GoogleCalendarCard({ connected, email, canAddEvents = false, addEvents = false, onChanged, returnTo = "/scheduling" }: {
  connected: boolean; email: string | null; canAddEvents?: boolean; addEvents?: boolean; onChanged: () => void; returnTo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The switch moves at once; it goes back if the server says no.
  const [eventsOn, setEventsOn] = useState<boolean | null>(null);
  const checked = eventsOn ?? addEvents;

  async function toggleEvents(on: boolean) {
    setEventsOn(on);
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await authedPost<{ added: number; removed: number; failed: number; errors: string[] }>("/api/google/add-events", { on });
      setNote(on
        ? `LC events will be added to your Google Calendar.${r.added ? ` ${r.added} upcoming ${r.added === 1 ? "event" : "events"} added.` : ""}`
        : `LC events won't be added any more.${r.removed ? ` ${r.removed} removed from your Google Calendar.` : ""}`);
      if (r.failed) setError(`Some events couldn't be updated: ${r.errors[0] ?? "Google refused"}`);
      onChanged();
    } catch (e) {
      setEventsOn(!on);
      setError(`Couldn't change it: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

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
      // Take the LC events the app added out of their calendar first, while the app still can.
      if (canAddEvents && checked) await authedPost("/api/google/add-events", { on: false }).catch(() => null);
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
              ? <>Connected{email ? <> as <strong>{email}</strong></> : null}. Your Google events show in your Calendar.</>
              : "Not connected. Connect to see your Google Calendar events next to your LC's schedule, and to get your LC's events in your Google Calendar."}
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
        {connected && canAddEvents && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--color-body)", cursor: busy ? "default" : "pointer" }}>
            <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => toggleEvents(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Add my LC&apos;s events to my Google Calendar<span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>Events you&apos;re invited to, kept up to date. &ldquo;Not going&rdquo; takes one out.</span></span>
          </label>
        )}
        {connected && !canAddEvents && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ fontSize: 12, color: "var(--color-body)", margin: 0 }}>Want your LC&apos;s events in your Google Calendar? Connect again and allow adding events.</p>
            <button type="button" onClick={connect} disabled={busy}
              style={{ height: 34, borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", color: "var(--color-navy)" }}>
              Reconnect to add LC events
            </button>
          </div>
        )}
        <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: 0, lineHeight: 1.5 }}>
          Only you see your Google events; nobody else in your LC does. The only thing {APP_NAME} adds to your Google Calendar is your LC&apos;s events, if you leave that on.
        </p>
        {note && <p role="status" style={{ fontSize: 12, color: "var(--color-body)", margin: 0 }}>{note}</p>}
        {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>{error}</p>}
      </div>
    </section>
  );
}
