"use client";

import { supabase } from "@/lib/supabase";

// EXPA keeps you signed in at auth.aiesec.org, so "Continue with EXPA" after
// signing in with the wrong account goes straight back to that account. This
// signs out of the app and of EXPA (in a small window: its sign-out page
// can't send people back here), then starts EXPA sign-in again asking it to
// show its sign-in form.
export const EXPA_SIGN_OUT_URL = "https://auth.aiesec.org/users/sign_out";

/** Call from a click handler (opening the window needs the click). */
export function switchExpaAccount() {
  const popup = window.open(EXPA_SIGN_OUT_URL, "expa-sign-out", "width=480,height=600");
  void (async () => {
    try { await supabase.auth.signOut(); } catch { /* already signed out */ }
    try { ["aiesec_user", "aiesec_project", "aiesec_authed"].forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { popup?.close(); } catch { /* closed already */ }
    window.location.assign(new URL("/api/expa/login?switch=1", window.location.origin).href);
  })();
}
