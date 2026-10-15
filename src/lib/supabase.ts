import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const isSupabaseConfigured = !!(
  url.startsWith("https://") &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

// Use a global singleton to prevent duplicate GoTrueClient instances (and the
// unconditional console.warn they emit, which leaks the storage key prefix).
const g = globalThis as typeof globalThis & { __app_supabase?: SupabaseClient };
if (!g.__app_supabase) {
  g.__app_supabase = createClient(
    isSupabaseConfigured ? url : "https://placeholder.supabase.co",
    isSupabaseConfigured ? key : "placeholder",
    { auth: { debug: false } },
  );
}

export const supabase: SupabaseClient = g.__app_supabase;
