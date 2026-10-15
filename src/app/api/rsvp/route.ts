import { serviceClient } from "@/lib/server-db";
import { verifyRsvpToken } from "@/lib/rsvp-token";
import { escapeHtml } from "@/lib/email";
import { APP_NAME } from "@/lib/brand";

// RSVP from an email without logging in. GET shows a confirmation button
// (so link scanners that open every URL don't answer for people); POST records it.

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#f4f6f9;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<main style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:100%">
<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0263C4">${APP_NAME}</p>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function params(url: URL) {
  return { e: url.searchParams.get("e") ?? "", u: url.searchParams.get("u") ?? "", t: url.searchParams.get("t") ?? "", a: url.searchParams.get("a") ?? "" };
}

async function eventName(eventId: string): Promise<string | null> {
  const db = serviceClient();
  if (!db) return null;
  const { data } = await db.from("lc_events").select("name").eq("id", eventId).maybeSingle();
  return (data?.name as string) ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { e, u, t, a } = params(url);
  if (!["going", "not_going"].includes(a) || !verifyRsvpToken(e, u, t)) return page("Link not valid", "<h1 style='font-size:18px'>This link isn't valid</h1><p>Answer in the app instead.</p>", 400);
  const name = (await eventName(e)) ?? "this event";
  const label = a === "going" ? "Yes, I'm going" : "No, I can't go";
  return page("Confirm your answer", `<h1 style="font-size:18px;margin:0 0 14px">${escapeHtml(name)}</h1>
<form method="post" action="${escapeHtml(url.pathname + url.search)}"><button type="submit" style="background:#0263C4;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">${label}</button></form>`);
}

export async function POST(request: Request) {
  const { e, u, t, a } = params(new URL(request.url));
  if (!["going", "not_going"].includes(a) || !verifyRsvpToken(e, u, t)) return page("Link not valid", "<h1 style='font-size:18px'>This link isn't valid</h1>", 400);
  const db = serviceClient();
  if (!db) return page("Not available", "<p>RSVPs aren't set up on this server.</p>", 503);
  const { error } = await db.from("event_rsvps").upsert({ event_id: e, user_id: u, response: a, responded_at: new Date().toISOString() }, { onConflict: "event_id,user_id" });
  if (error) return page("Couldn't save", `<h1 style="font-size:18px">Couldn't save your answer</h1><p>${escapeHtml(error.message)}</p>`, 500);
  const name = (await eventName(e)) ?? "the event";
  return page("Thanks", `<h1 style="font-size:18px;margin:0 0 8px">${a === "going" ? "See you there!" : "Thanks for letting us know."}</h1><p style="margin:0">Your answer for ${escapeHtml(name)} is saved. You can change it from the email or in the app.</p>`);
}
