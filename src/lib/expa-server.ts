// Server-side only. EXPA (AIESEC GIS) OAuth and GraphQL calls.
//
// AIESEC_CLIENT_ID / AIESEC_CLIENT_SECRET come from the app registered at
// auth.aiesec.org. Its redirect URI must be <app origin>/auth/expa/callback.

import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATIONS_QUERY, CURRENT_PERSON_QUERY, POSITIONS_QUERY, POSITIONS_QUERY_BASIC, PROFILE_QUERY, profileFromExpa, type ExpaApplication, type ExpaProfile } from "@/lib/expa-sync";
import { placementFromExpa } from "@/lib/expa-profile";

const AUTHORIZE_URL = "https://auth.aiesec.org/oauth/authorize";
const TOKEN_URL = "https://auth.aiesec.org/oauth/token";
const GRAPHQL_URL = "https://gis-api.aiesec.org/graphql";

export const EXPA_STATE_COOKIE = "expa_state";
export const EXPA_CALLBACK_PATH = "/auth/expa/callback";

export function expaCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AIESEC_CLIENT_ID ?? "";
  const clientSecret = process.env.AIESEC_CLIENT_SECRET ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(origin: string): string {
  return `${origin}${EXPA_CALLBACK_PATH}`;
}

export function authorizeUrl(clientId: string, origin: string, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri(origin), state });
  return `${AUTHORIZE_URL}?${q}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => ({})) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `AIESEC answered ${res.status}`);
  return j as TokenResponse;
}

/** Trade the code from the callback for tokens. */
export function exchangeCode(code: string, origin: string): Promise<TokenResponse> {
  const creds = expaCredentials();
  if (!creds) throw new Error("AIESEC_CLIENT_ID / AIESEC_CLIENT_SECRET aren't set on the server");
  return tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: redirectUri(origin),
    client_id: creds.clientId, client_secret: creds.clientSecret,
  });
}

export const expiresAt = (t: TokenResponse) => new Date(Date.now() + (t.expires_in ?? 7200) * 1000).toISOString();

/** Run a GIS GraphQL query. Errors carry GIS's own message. */
export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("EXPA refused the connection. Connect EXPA again.");
  const j = await res.json().catch(() => null) as { data?: T; errors?: { message: string }[] } | null;
  if (!j) throw new Error(`EXPA answered ${res.status}`);
  if (j.errors?.length) throw new Error(`EXPA: ${j.errors.map((e) => e.message).join("; ")}`);
  if (!j.data) throw new Error("EXPA sent no data");
  return j.data;
}

export async function currentPerson(token: string) {
  const d = await gql<{ currentPerson: { id: string | number; full_name: string | null; email: string | null; home_lc: { id: string | number; name: string } | null } | null }>(token, CURRENT_PERSON_QUERY);
  if (!d.currentPerson) throw new Error("EXPA didn't say who you are");
  return d.currentPerson;
}

/**
 * The profile details onboarding fills in, and where sign-in places them (their
 * LC or MC and role). The extra queries may fail (a renamed field, a hidden
 * photo); what they'd add is then simply left out.
 */
export async function fetchProfile(token: string, me: Awaited<ReturnType<typeof currentPerson>>): Promise<ExpaProfile> {
  type Extra = { currentPerson: Record<string, unknown> | null };
  const [extra, positions] = await Promise.all([
    gql<Extra>(token, PROFILE_QUERY).catch(() => null),
    gql<Extra>(token, POSITIONS_QUERY).catch(() => gql<Extra>(token, POSITIONS_QUERY_BASIC)).catch(() => null),
  ]);
  const profile = profileFromExpa({ ...me, ...(extra?.currentPerson ?? {}), ...(positions?.currentPerson ?? {}) });
  return { ...profile, placement: placementFromExpa(profile) };
}

/** A usable access token for the member, renewing it when it has expired. */
export async function accessTokenFor(db: SupabaseClient, userId: string): Promise<{ token: string } | { reconnect: string }> {
  const { data } = await db.from("expa_connections").select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!data) return { reconnect: "EXPA isn't connected." };
  const expires = data.expires_at ? new Date(data.expires_at as string).getTime() : 0;
  if (!expires || Date.now() < expires - 60_000) return { token: data.access_token as string };

  const creds = expaCredentials();
  if (!data.refresh_token || !creds) return { reconnect: "The EXPA connection expired. Connect again." };
  try {
    const t = await tokenRequest({
      grant_type: "refresh_token", refresh_token: data.refresh_token as string,
      client_id: creds.clientId, client_secret: creds.clientSecret,
    });
    await db.from("expa_connections").update({
      access_token: t.access_token, refresh_token: t.refresh_token ?? data.refresh_token,
      expires_at: expiresAt(t), updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    return { token: t.access_token };
  } catch {
    return { reconnect: "EXPA didn't renew the connection. Connect again." };
  }
}

const PER_PAGE = 100;
const MAX_PAGES = 30;

/**
 * Applications of an LC created since `since` (YYYY-MM-DD): its outgoing EPs'
 * and the ones to its opportunities.
 */
export async function fetchApplications(token: string, lcId: string, since: string): Promise<ExpaApplication[]> {
  const all = new Map<string, ExpaApplication>();
  for (const side of ["person_home_lc", "opportunity_home_lc"] as const) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const d = await gql<{ allOpportunityApplication: { paging: { total_pages: number } | null; data: ExpaApplication[] } }>(token, APPLICATIONS_QUERY, {
        page, perPage: PER_PAGE, filters: { [side]: Number(lcId), created_at: { from: since } },
      });
      for (const a of d.allOpportunityApplication.data ?? []) all.set(String(a.id), a);
      if (page >= (d.allOpportunityApplication.paging?.total_pages ?? 1)) break;
    }
  }
  return [...all.values()];
}
