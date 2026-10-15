import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const KEY_SECRET  = process.env.JOURNAL_KEY_SECRET ?? "";

// GET /api/journal/key
// Returns { key: "<base64 raw AES-256 key>" } for the authenticated user.
// The key is derived deterministically via HKDF(JOURNAL_KEY_SECRET, userId, "canopy-journal-v1").
// It is never stored — re-derived on every request. A DB dump of journal_entries is unreadable
// without this server secret.
export async function GET(request: Request) {
  if (!KEY_SECRET) {
    // Encryption not configured — return sentinel so client skips encryption gracefully
    return Response.json({ disabled: true });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !anonKey || !supabaseUrl) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user } } = await anonClient.auth.getUser(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const encoder = new TextEncoder();

  // Import the master secret as HKDF key material
  const masterKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(KEY_SECRET),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );

  // Derive a 256-bit AES-GCM key unique to this user
  const derivedKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(user.id),
      info: encoder.encode("canopy-journal-v1"),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const rawKey = await globalThis.crypto.subtle.exportKey("raw", derivedKey);
  const base64Key = Buffer.from(rawKey).toString("base64");

  return Response.json(
    { key: base64Key },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
