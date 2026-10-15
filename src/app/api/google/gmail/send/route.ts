import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/api-auth";

// POST /api/google/gmail/send
//
// Sends an email from the authenticated user's Gmail account.
// Body: { userId: string, to: string, subject: string, body: string, isHtml?: boolean }
//
// Used for meeting invites and direct messages to external contacts.

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const clientId     = process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

function buildMimeMessage(to: string, subject: string, body: string, isHtml: boolean): string {
  const contentType = isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}`,
    "",
    body,
  ].join("\r\n");

  // btoa is globally available in Node 16+ and all browsers; avoids needing Buffer/@types/node
  const bytes = new TextEncoder().encode(raw);
  const binary = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(request: Request) {
  // Verify caller identity from JWT — never trust userId from the request body
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
  };

  const { to, subject, body: emailBody, isHtml = false } = body;

  if (!to || !subject || !emailBody) {
    return Response.json({ error: "to, subject, and body are required" }, { status: 400 });
  }
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  const db = createClient(supabaseUrl, serviceKey);

  const { data: profile } = await db
    .from("user_profiles")
    .select("google_access_token, google_refresh_token, google_token_expiry")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.google_access_token) {
    return Response.json({ error: "Google account not connected", reconnect: true }, { status: 401 });
  }

  let accessToken = profile.google_access_token as string;

  const expiry = profile.google_token_expiry ? new Date(profile.google_token_expiry as string).getTime() : 0;
  if (expiry && Date.now() > expiry - 60_000 && profile.google_refresh_token) {
    const refreshed = await refreshAccessToken(profile.google_refresh_token as string);
    if (refreshed) {
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await db.from("user_profiles").update({
        google_access_token: accessToken,
        google_token_expiry: newExpiry,
      }).eq("id", userId);
    }
  }

  const raw = buildMimeMessage(to, subject, emailBody, isHtml);

  const gmailRes = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!gmailRes.ok) {
    const errBody = await gmailRes.text().catch(() => "");
    if (gmailRes.status === 401) {
      return Response.json({ error: "Token expired", reconnect: true }, { status: 401 });
    }
    return Response.json({ error: `Gmail API error ${gmailRes.status}: ${errBody}` }, { status: 502 });
  }

  const result = await gmailRes.json();
  return Response.json({ ok: true, messageId: result.id });
}
