// Server-side only (service role). Sends due outreach steps: one email per
// enrollment step, from the member who enrolled the lead (their name, replies
// to their email), with an unsubscribe link. Throttled per sender and per run.

import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL, baseHtml, escapeHtml, sendEmail } from "@/lib/email";
import { renderTemplate, valuesFor } from "@/lib/outreach";
import { unsubscribeToken } from "@/lib/outreach-token";
import type { SendSummary } from "@/lib/notify-server";

const PER_RUN = 200;          // emails per job run, across all LCs
const PER_SENDER_DAY = 80;    // stays well under personal-account and provider limits
const PACE_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function outreachHtml(body: string, unsubscribeUrl: string, lcName: string): string {
  const paragraphs = escapeHtml(body).split(/\n{2,}/).map((para) =>
    `<p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">${para.replace(/\n/g, "<br />")}</p>`).join("");
  return baseHtml(`${paragraphs}
    <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">
      You're getting this because you signed up with ${escapeHtml(lcName)}.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;">Unsubscribe</a>
    </p>`);
}

export async function runOutreach(db: SupabaseClient, now = new Date()): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, skipped: 0, failed: 0, errors: [] };
  const fail = (m: string) => { summary.failed++; if (summary.errors.length < 20) summary.errors.push(m); };

  const { data: due, error } = await db.from("outreach_enrollments")
    .select("id, project_id, sequence_id, exchange_id, sender_id, enrolled_at, next_step")
    .eq("status", "active").lte("next_send_at", now.toISOString()).order("next_send_at").limit(PER_RUN);
  if (error) { fail(`outreach: ${error.message}`); return summary; }

  const sentToday = new Map<string, number>();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const lcNames = new Map<string, string>();
  const senders = new Map<string, { name: string; email: string | null }>();

  for (const en of due ?? []) {
    const stop = (reason: string) => db.from("outreach_enrollments").update({ status: "stopped", stop_reason: reason, stopped_at: now.toISOString() }).eq("id", en.id);
    try {
      const [{ data: step }, { data: steps }, { data: ex }] = await Promise.all([
        db.from("outreach_steps").select("step_no, delay_days, outreach_templates(id, subject, body, status)").eq("sequence_id", en.sequence_id).eq("step_no", en.next_step).maybeSingle(),
        db.from("outreach_steps").select("step_no, delay_days").eq("sequence_id", en.sequence_id).order("step_no"),
        db.from("exchanges").select("person_name, email, product, opportunity, host_entity, expa_url, email_consent, unsubscribed_at, replied_at").eq("id", en.exchange_id).maybeSingle(),
      ]);
      if (!step) { await db.from("outreach_enrollments").update({ status: "completed", next_send_at: null }).eq("id", en.id); continue; }
      const tpl = (Array.isArray(step.outreach_templates) ? step.outreach_templates[0] : step.outreach_templates) as { id: string; subject: string; body: string; status: string } | null;
      if (!ex || !ex.email || !ex.email_consent) { await stop("no_email"); summary.skipped++; continue; }
      if (ex.unsubscribed_at) { await stop("unsubscribed"); summary.skipped++; continue; }
      if (ex.replied_at) { await stop("replied"); summary.skipped++; continue; }
      if (!tpl || tpl.status !== "approved") { await stop("template_unapproved"); summary.skipped++; continue; }

      if (!sentToday.has(en.sender_id)) {
        const { count } = await db.from("outreach_messages").select("id", { count: "exact", head: true }).eq("sender_id", en.sender_id).eq("status", "sent").gte("sent_at", dayAgo);
        sentToday.set(en.sender_id, count ?? 0);
      }
      if ((sentToday.get(en.sender_id) ?? 0) >= PER_SENDER_DAY) { summary.skipped++; continue; }   // try again next run

      if (!lcNames.has(en.project_id)) {
        const { data: p } = await db.from("projects").select("name").eq("id", en.project_id).maybeSingle();
        lcNames.set(en.project_id, (p?.name as string) ?? "AIESEC");
      }
      if (!senders.has(en.sender_id)) {
        const [{ data: prof }, { data: au }] = await Promise.all([
          db.from("user_profiles").select("name").eq("id", en.sender_id).maybeSingle(),
          db.auth.admin.getUserById(en.sender_id),
        ]);
        senders.set(en.sender_id, { name: (prof?.name as string) ?? "AIESEC", email: au?.user?.email ?? null });
      }
      const lcName = lcNames.get(en.project_id)!;
      const sender = senders.get(en.sender_id)!;
      const values = valuesFor(ex, lcName, sender.name);
      const subject = renderTemplate(tpl.subject, values);
      const body = renderTemplate(tpl.body, values);
      const unsubscribeUrl = `${APP_URL}/api/unsubscribe?x=${encodeURIComponent(en.exchange_id)}&t=${encodeURIComponent(unsubscribeToken(en.exchange_id))}`;

      const result = await sendEmail({
        to: ex.email, subject, text: `${body}\n\n—\nYou're getting this because you signed up with ${lcName}. Unsubscribe: ${unsubscribeUrl}`,
        html: outreachHtml(body, unsubscribeUrl, lcName),
        fromName: `${sender.name} (${lcName})`, replyTo: sender.email ?? undefined,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await sleep(PACE_MS);
      await db.from("outreach_messages").insert({
        project_id: en.project_id, exchange_id: en.exchange_id, enrollment_id: en.id, template_id: tpl.id, step_no: step.step_no,
        sender_id: en.sender_id, to_email: ex.email, subject, status: result.ok ? "sent" : "failed", error: result.ok ? null : result.error ?? "send failed",
      });
      if (!result.ok) { fail(`enrollment ${en.id}: ${result.error ?? "send failed"}`); continue; }
      sentToday.set(en.sender_id, (sentToday.get(en.sender_id) ?? 0) + 1);
      summary.sent++;

      const next = (steps ?? []).find((s) => (s.step_no as number) > step.step_no);
      await db.from("outreach_enrollments").update(next
        ? { next_step: next.step_no, next_send_at: new Date(new Date(en.enrolled_at).getTime() + (next.delay_days as number) * 86_400_000).toISOString() }
        : { status: "completed", next_send_at: null }).eq("id", en.id);
    } catch (e) {
      fail(`enrollment ${en.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}
