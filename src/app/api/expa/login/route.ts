import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/server-db";
import { authorizeUrl, expaCredentials, EXPA_CALLBACK_PATH, EXPA_STATE_COOKIE } from "@/lib/expa-server";

// GET /api/expa/login: "Continue with EXPA" on the login page links here. It
// sends the browser to auth.aiesec.org; /auth/expa/callback signs them in.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const fail = (description: string) =>
    NextResponse.redirect(`${origin}/login?${new URLSearchParams({ error: "expa", error_description: description })}`, 303);

  const creds = expaCredentials();
  if (!creds) return fail("Signing in with EXPA isn't set up on this server yet.");
  const db = serviceClient();
  if (!db) return fail("Signing in with EXPA isn't set up on this server yet.");

  const state = randomBytes(32).toString("hex");
  await db.from("expa_oauth_states").delete().lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { error } = await db.from("expa_oauth_states").insert({ state, purpose: "login" });
  if (error) return fail(error.message);

  const res = NextResponse.redirect(authorizeUrl(creds.clientId, origin, state), 303);
  res.cookies.set(EXPA_STATE_COOKIE, state, {
    httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: EXPA_CALLBACK_PATH, maxAge: 600,
  });
  return res;
}
