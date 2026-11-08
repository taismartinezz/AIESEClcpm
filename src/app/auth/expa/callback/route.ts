import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/server-db";
import { currentPerson, exchangeCode, expiresAt, EXPA_STATE_COOKIE } from "@/lib/expa-server";

type Person = Awaited<ReturnType<typeof currentPerson>>;
type Tokens = Awaited<ReturnType<typeof exchangeCode>>;

// GET /auth/expa/callback?code&state: where auth.aiesec.org sends the browser
// back, for both flows:
//   connect  (Pipeline > Connect EXPA, already signed in): store the tokens,
//            back to /pipeline?expa=connected or ?expa=error&reason=….
//   login    (Continue with EXPA on the login page): find or create the Torch
//            account, store the tokens, and finish the sign-in on
//            /auth/expa/finish with a one-time link. Errors go to /login.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const toPipeline = (params: Record<string, string>) =>
    Response.redirect(`${url.origin}/pipeline?${new URLSearchParams(params)}`, 303);
  const toLogin = (description: string) =>
    Response.redirect(`${url.origin}/login?${new URLSearchParams({ error: "expa", error_description: description })}`, 303);

  const jar = await cookies();
  const cookieState = jar.get(EXPA_STATE_COOKIE)?.value ?? "";
  jar.delete(EXPA_STATE_COOKIE);

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const db = serviceClient();
  const { data: pending } = db && state
    ? await db.from("expa_oauth_states").delete().eq("state", state).select("purpose, user_id, created_at").maybeSingle()
    : { data: null };
  const login = pending?.purpose === "login";
  const fail = (reason: string) => (login ? toLogin(reason) : toPipeline({ expa: "error", reason }));

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "EXPA didn't allow it.");
  if (!db) return fail("The server isn't set up for EXPA (SUPABASE_SERVICE_ROLE_KEY missing).");
  if (!code || !pending || state !== cookieState || Date.now() - new Date(pending.created_at as string).getTime() > 10 * 60_000) {
    return fail("The request expired or came from another browser. Try again.");
  }

  try {
    const tokens = await exchangeCode(code, url.origin);
    const me = await currentPerson(tokens.access_token);
    if (!login) {
      const err = await saveConnection(db, pending.user_id as string, me, tokens);
      return err ? fail(err) : toPipeline({ expa: "connected" });
    }

    const account = await accountFor(db, me);
    if ("error" in account) return fail(account.error);
    const err = await saveConnection(db, account.userId, me, tokens);
    if (err) return fail(err);
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email: account.email });
    if (linkErr || !link.properties?.hashed_token) return fail(linkErr?.message ?? "Couldn't start your session.");
    // In the fragment, so the one-time token isn't sent to any server or logged.
    const finish = new URLSearchParams({ token_hash: link.properties.hashed_token });
    if (account.created && me.full_name) finish.set("name", me.full_name);
    return Response.redirect(`${url.origin}/auth/expa/finish#${finish}`, 303);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function saveConnection(db: SupabaseClient, userId: string, me: Person, tokens: Tokens): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await db.from("expa_connections").upsert({
    user_id: userId, expa_person_id: String(me.id), expa_name: me.full_name,
    home_lc_id: me.home_lc ? String(me.home_lc.id) : null, home_lc_name: me.home_lc?.name ?? null,
    access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null, expires_at: expiresAt(tokens),
    connected_at: now, updated_at: now,
  }, { onConflict: "user_id" });
  if (error?.code === "23505") return "This EXPA account is already connected to another Torch account.";
  return error?.message ?? null;
}

/**
 * The Torch account for this EXPA person: the one already linked to them, or a
 * new one with their EXPA email. An existing account with that email that was
 * never linked is not taken over: its owner signs in as usual and connects
 * EXPA from the Pipeline page.
 */
async function accountFor(db: SupabaseClient, me: Person): Promise<{ userId: string; email: string; created: boolean } | { error: string }> {
  const { data: linked } = await db.from("expa_connections").select("user_id").eq("expa_person_id", String(me.id)).maybeSingle();
  if (linked) {
    const { data, error } = await db.auth.admin.getUserById(linked.user_id as string);
    if (error || !data.user?.email) return { error: error?.message ?? "Your Torch account has no email." };
    return { userId: data.user.id, email: data.user.email, created: false };
  }

  const email = me.email?.trim().toLowerCase();
  if (!email) return { error: "Your EXPA profile has no email, so Torch can't create an account for you." };
  const { data: existing } = await db.rpc("auth_user_id_by_email", { p_email: email });
  if (existing) {
    return { error: `There's already a Torch account for ${email}. Sign in with your password or Google, then press Connect EXPA on the Pipeline page. After that, Continue with EXPA works too.` };
  }
  const { data, error } = await db.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { full_name: me.full_name ?? undefined, expa_person_id: String(me.id) },
  });
  if (error || !data.user) return { error: error?.message ?? "Couldn't create your account." };
  return { userId: data.user.id, email, created: true };
}
