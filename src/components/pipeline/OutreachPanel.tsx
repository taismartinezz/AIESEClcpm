"use client";

import { useEffect, useState } from "react";
import { Mail, MessageCircleReply } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button, ErrorText } from "@/components/lc/ui";

interface Message { id: string; subject: string; sent_at: string; status: string; step_no: number | null }
interface State { consent: boolean; source: string | null; unsubscribed: string | null; replied: string | null; active: number; messages: Message[] }

/** On a lead's card: consent, "they replied" (stops sequences) and every outreach email sent. */
export default function OutreachPanel({ exchangeId }: { exchangeId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ex, msgs, en] = await Promise.all([
        supabase.from("exchanges").select("email_consent, consent_source, unsubscribed_at, replied_at").eq("id", exchangeId).maybeSingle(),
        supabase.from("outreach_messages").select("id, subject, sent_at, status, step_no").eq("exchange_id", exchangeId).order("sent_at", { ascending: false }),
        supabase.from("outreach_enrollments").select("id", { count: "exact", head: true }).eq("exchange_id", exchangeId).eq("status", "active"),
      ]);
      if (cancelled) return;
      if (ex.error) { setError(ex.error.message); return; }
      setState({
        consent: Boolean(ex.data?.email_consent), source: (ex.data?.consent_source as string | null) ?? null,
        unsubscribed: (ex.data?.unsubscribed_at as string | null) ?? null, replied: (ex.data?.replied_at as string | null) ?? null,
        active: en.count ?? 0, messages: (msgs.data ?? []) as Message[],
      });
    })();
    return () => { cancelled = true; };
  }, [exchangeId, version]);

  async function update(patch: Record<string, unknown>, what: string) {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("exchanges").update(patch).eq("id", exchangeId);
      if (err) throw new Error(err.message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return error ? <ErrorText>{error}</ErrorText> : null;
  return (
    <section aria-label="Outreach" style={{ borderTop: "1px solid var(--color-border)", marginTop: 6, paddingTop: 12 }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--color-body)", margin: "0 0 8px" }}>
        <Mail size={13} aria-hidden="true" /> Outreach emails
        {state.active > 0 && <span style={{ fontWeight: 400, color: "var(--color-secondary)" }}>· in {state.active} active sequence{state.active === 1 ? "" : "s"}</span>}
      </h3>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--color-body)", marginBottom: 8 }}>
        <input type="checkbox" checked={state.consent} disabled={busy || Boolean(state.unsubscribed)} style={{ accentColor: "var(--color-navy)", marginTop: 2 }}
          onChange={(e) => update({ email_consent: e.target.checked, consent_source: e.target.checked ? state.source ?? "confirmed in the app" : state.source }, "update consent")} />
        <span>Signed up with AIESEC and agreed to be contacted{state.source ? ` (${state.source})` : ""}</span>
      </label>
      {state.unsubscribed && <p style={{ fontSize: 12, color: "var(--color-warning)", margin: "0 0 8px" }}>Unsubscribed on {new Date(state.unsubscribed).toLocaleDateString()}. No more outreach emails.</p>}
      {state.replied
        ? <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 8px" }}>Replied on {new Date(state.replied).toLocaleDateString()}; sequences stopped.</p>
        : <Button variant="secondary" disabled={busy} onClick={() => update({ replied_at: new Date().toISOString() }, "save the reply")}><MessageCircleReply size={13} aria-hidden="true" /> They replied: stop the emails</Button>}
      {state.messages.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, fontSize: 12, color: "var(--color-body)" }}>
          {state.messages.map((m) => (
            <li key={m.id} style={{ padding: "3px 0" }}>
              {new Date(m.sent_at).toLocaleDateString()} · {m.subject}
              {m.status !== "sent" && <span style={{ color: "var(--color-error)" }}> (failed)</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
