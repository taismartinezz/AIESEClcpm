import { serviceClient } from "@/lib/server-db";
import { verifyTablingToken } from "@/lib/rsvp-token";
import { escapeHtml } from "@/lib/email";
import { APP_NAME } from "@/lib/brand";

// One-tap tabling sign-up from the weekly email, without logging in. GET shows a
// confirmation button (link scanners open every URL and mustn't sign people up);
// POST signs up.

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#f4f6f9;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<main style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:100%">
<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0263C4">${APP_NAME}</p>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

const invalid = () => page("Link not valid", "<h1 style='font-size:18px'>This link isn't valid</h1><p>Sign up on the Tabling page instead.</p>", 400);

function params(url: URL) {
  return { s: url.searchParams.get("s") ?? "", u: url.searchParams.get("u") ?? "", t: url.searchParams.get("t") ?? "" };
}

async function describe(slotId: string): Promise<string | null> {
  const db = serviceClient();
  if (!db) return null;
  const { data } = await db.from("tabling_slots").select("purpose, location, starts_at").eq("id", slotId).maybeSingle();
  if (!data) return null;
  const when = new Date(data.starts_at as string).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${data.purpose} · ${data.location} · ${when}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { s, u, t } = params(url);
  if (!verifyTablingToken(s, u, t)) return invalid();
  const what = (await describe(s)) ?? "this tabling slot";
  return page("Sign up", `<h1 style="font-size:18px;margin:0 0 14px">${escapeHtml(what)}</h1>
<form method="post" action="${escapeHtml(url.pathname + url.search)}"><button type="submit" style="background:#0263C4;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">Yes, sign me up</button></form>`);
}

export async function POST(request: Request) {
  const { s, u, t } = params(new URL(request.url));
  if (!verifyTablingToken(s, u, t)) return invalid();
  const db = serviceClient();
  if (!db) return page("Not available", "<p>Email sign-up isn't set up on this server.</p>", 503);
  const { data, error } = await db.rpc("tabling_sign_up_as", { p_slot_id: s, p_user_id: u });
  if (error) return page("Couldn't sign you up", `<h1 style="font-size:18px">Couldn't sign you up</h1><p>${escapeHtml(error.message)}.</p>`, 409);
  const what = (await describe(s)) ?? "the slot";
  return page("You're signed up", `<h1 style="font-size:18px;margin:0 0 8px">${data === "already" ? "You were already signed up." : "You're signed up. Thank you!"}</h1><p style="margin:0">${escapeHtml(what)}. You'll get a reminder the day before; to withdraw, use the Tabling page.</p>`);
}
