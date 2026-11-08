"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured, isPreview } from "@/lib/supabase";
import GoogleCalendarCard from "@/components/scheduling/GoogleCalendarCard";

/** Settings → Google Calendar: the same card as in Scheduling, loading its own status. */
export default function GoogleCalendarSettings() {
  const [state, setState] = useState<{ connected: boolean; email: string | null; canAddEvents: boolean; addEvents: boolean } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured || isPreview) return;
    let cancelled = false;
    supabase.rpc("google_calendar_status").then(({ data, error }) => {
      if (cancelled) return;
      const row = (Array.isArray(data) ? data[0] : data) as { google_email: string | null; can_add_events?: boolean; add_events?: boolean } | undefined;
      setState(error ? { connected: false, email: null, canAddEvents: false, addEvents: false }
        : { connected: Boolean(row), email: row?.google_email ?? null, canAddEvents: Boolean(row?.can_add_events), addEvents: Boolean(row?.add_events) });
    });
    return () => { cancelled = true; };
  }, [version]);

  return (
    <GoogleCalendarCard connected={state?.connected ?? false} email={state?.email ?? null}
      canAddEvents={state?.canAddEvents ?? false} addEvents={state?.addEvents ?? false}
      onChanged={() => setVersion((v) => v + 1)} returnTo="/settings#google-calendar" />
  );
}
