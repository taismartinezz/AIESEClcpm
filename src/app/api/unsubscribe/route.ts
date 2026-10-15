import { serviceClient } from "@/lib/server-db";
import { verifyUnsubscribeToken } from "@/lib/outreach-token";

// Unsubscribe from outreach emails. GET shows a confirm button (mail scanners
// open links); POST — from the button or a one-click List-Unsubscribe — records it.

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#f4f6f9;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<main style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:100%">${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function read(url: URL) {
  return { x: url.searchParams.get("x") ?? "", t: url.searchParams.get("t") ?? "" };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { x, t } = read(url);
  if (!verifyUnsubscribeToken(x, t)) return page("<h1 style='font-size:18px'>This link isn't valid</h1>", 400);
  return page(`<h1 style="font-size:18px;margin:0 0 10px">Stop these emails?</h1>
<form method="post" action="${url.pathname}${url.search}"><button type="submit" style="background:#0263C4;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
}

export async function POST(request: Request) {
  const { x, t } = read(new URL(request.url));
  if (!verifyUnsubscribeToken(x, t)) return page("<h1 style='font-size:18px'>This link isn't valid</h1>", 400);
  const db = serviceClient();
  if (!db) return page("<p>Not available right now. Reply to the email and ask to be removed.</p>", 503);
  const { error } = await db.from("exchanges").update({ unsubscribed_at: new Date().toISOString() }).eq("id", x).is("unsubscribed_at", null);
  if (error) return page("<p>Couldn't save that. Reply to the email and ask to be removed.</p>", 500);
  return page("<h1 style='font-size:18px;margin:0 0 8px'>You're unsubscribed</h1><p style='margin:0'>You won't get these emails again.</p>");
}
