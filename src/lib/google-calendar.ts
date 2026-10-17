"use client";

import { supabase } from "@/lib/supabase";

// Read-only access to the person's own Google Calendar, shown in their own
// Scheduling view. Tokens never reach other people: the callback hands them to
// /api/google/connect, which stores them where only the server can read them.

export const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
const FLAG = "aiesec_gcal_connecting";

/**
 * Start the Google consent flow. People who signed up with email get Google
 * *linked* to their account (it never creates a second account); people who
 * already sign in with Google just grant the calendar permission.
 */
export async function connectGoogleCalendar(returnTo = "/scheduling"): Promise<string | null> {
  try { localStorage.setItem(FLAG, "1"); } catch { /* storage blocked: tokens won't be saved */ }
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;
  const options = { redirectTo, scopes: GCAL_SCOPES, queryParams: { access_type: "offline", prompt: "consent" } };
  const { data: { user } } = await supabase.auth.getUser();
  const hasGoogle = (user?.identities ?? []).some((i) => i.provider === "google");
  const { error } = hasGoogle
    ? await supabase.auth.signInWithOAuth({ provider: "google", options })
    : await supabase.auth.linkIdentity({ provider: "google", options });
  if (!error) return null;
  try { localStorage.removeItem(FLAG); } catch { /* ignore */ }
  if (/manual linking/i.test(error.message)) return "Connecting Google needs “Manual linking” switched on in Supabase (Authentication → Sign In / Providers). Ask whoever set up the app.";
  if (/provider is not enabled|unsupported provider/i.test(error.message)) return "Google isn't switched on for this app yet. Ask whoever set up the app to enable the Google provider in Supabase.";
  return error.message;
}

/** Called by /auth/callback: if this sign-in was a calendar connection, store the tokens server-side. */
export async function finishGoogleCalendarConnect(session: { access_token: string; provider_token?: string | null; provider_refresh_token?: string | null; expires_in?: number }): Promise<void> {
  let connecting = false;
  try { connecting = localStorage.getItem(FLAG) === "1"; localStorage.removeItem(FLAG); } catch { /* ignore */ }
  if (!connecting || !session.provider_token) return;
  const res = await fetch("/api/google/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ accessToken: session.provider_token, refreshToken: session.provider_refresh_token ?? null }),
  });
  if (!res.ok) console.error("[Google Calendar] couldn't save the connection:", await res.text().catch(() => res.status));
}

export interface GoogleEvent { id: string; title: string; start: string; end: string | null; allDay: boolean; link: string | null }
