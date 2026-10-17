import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PREVIEW_SIGNED_OUT_KEY, PREVIEW_STORAGE_KEY, PREVIEW_URL, previewFetch, previewSession } from "@/lib/preview/backend";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

/** A real Supabase project is configured (both public variables were set at build time). */
export const hasRealDatabase = !!(url.startsWith("https://") && key);

/**
 * Preview mode: no database configured, so the app runs on sample data in the
 * browser (src/lib/preview). Every page then shows the same demo LC. Unit
 * tests keep the old "not configured" behaviour.
 */
export const isPreview = !hasRealDatabase && process.env.NODE_ENV !== "test";

/** Pages treat preview mode like a connected database; only the data differs. */
export const isSupabaseConfigured = hasRealDatabase || isPreview;

// Use a global singleton to prevent duplicate GoTrueClient instances (and the
// unconditional console.warn they emit, which leaks the storage key prefix).
const g = globalThis as typeof globalThis & { __app_supabase?: SupabaseClient };
if (!g.__app_supabase) {
  if (isPreview && typeof window !== "undefined") {
    // Start signed in as the demo LC's president, unless they signed out.
    try {
      if (!localStorage.getItem(PREVIEW_STORAGE_KEY) && !localStorage.getItem(PREVIEW_SIGNED_OUT_KEY)) {
        localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(previewSession()));
      }
    } catch { /* storage blocked: the login page still works */ }
  }
  const client = createClient(
    hasRealDatabase ? url : isPreview ? PREVIEW_URL : "https://placeholder.supabase.co",
    hasRealDatabase ? key : "preview-or-placeholder",
    // PKCE: OAuth comes back to /auth/callback as ?code=… (the default "implicit"
    // flow returns tokens after a # instead, which the callback can't use).
    { auth: { debug: false, flowType: "pkce" }, ...(isPreview ? { global: { fetch: previewFetch } } : {}) },
  );
  if (isPreview) {
    // No realtime server in the preview: channels are silent no-ops.
    const noop = {
      on() { return noop; },
      subscribe(cb?: (status: string) => void) { if (cb) setTimeout(() => cb("SUBSCRIBED"), 0); return noop; },
      unsubscribe: async () => "ok" as const,
      send: async () => "ok" as const,
      track: async () => "ok" as const,
      untrack: async () => "ok" as const,
      presenceState: () => ({}),
    };
    (client as unknown as { channel: () => typeof noop }).channel = () => noop;
    (client as unknown as { removeChannel: () => Promise<"ok"> }).removeChannel = async () => "ok";
  }
  g.__app_supabase = client;
}

export const supabase: SupabaseClient = g.__app_supabase;
