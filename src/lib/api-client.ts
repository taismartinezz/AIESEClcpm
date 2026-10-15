"use client";

import { supabase } from "@/lib/supabase";

/** POST JSON to one of this app's API routes as the signed-in user. Throws with the server's message. */
export async function authedPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

export interface SendResult { sent: number; skipped: number; failed: number; errors: string[] }

export function describeSend(r: SendResult): string {
  return `${r.sent} email${r.sent === 1 ? "" : "s"} sent${r.skipped ? `, ${r.skipped} skipped (already sent or no email)` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`;
}
