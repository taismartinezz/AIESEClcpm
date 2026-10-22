// Server-side only. Never import this in client components.

import { APP_NAME } from "@/lib/brand";

const RESEND_KEY  = process.env.RESEND_API_KEY  ?? "";
const FROM        = process.env.EMAIL_FROM       ?? `${APP_NAME} <notifications@example.com>`;
export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Shown as "<fromName> via AIESEClcpm"; the address stays EMAIL_FROM's. */
  fromName?: string;
  /** Replies go here (e.g. the organiser), not to the no-reply sender. */
  replyTo?: string;
  cc?: string[];
  /** Base64 content, e.g. an .ics calendar invite. */
  attachments?: { filename: string; content: string; contentType?: string }[];
  headers?: Record<string, string>;
}

/** "Name <addr>" → addr; a bare address is returned as is. */
export function fromAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}

/** Display name safe for a From header: no quotes, angle brackets, @ or line breaks. */
export function safeDisplayName(name: string): string {
  return name.replace(/[<>"@\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// Escape characters that could break out of an HTML attribute or text node.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_KEY) {
    console.info("[email] RESEND_API_KEY not set: logging instead of sending");
    console.info(`[email] TO: ${payload.to} | SUBJECT: ${payload.subject}`);
    console.info(`[email] TEXT: ${payload.text}`);
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: payload.fromName ? `${safeDisplayName(payload.fromName)} via ${APP_NAME} <${fromAddress(FROM)}>` : FROM,
        to: [payload.to],
        subject: payload.subject, html: payload.html, text: payload.text,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
        ...(payload.cc?.length ? { cc: payload.cc } : {}),
        ...(payload.attachments?.length ? { attachments: payload.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) } : {}),
        ...(payload.headers ? { headers: payload.headers } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `Resend ${res.status}: ${body}`;
      console.error("[email] send failed:", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] fetch error:", msg);
    return { ok: false, error: msg };
  }
}

// ── Template helpers ───────────────────────────────────────────────────────────

export function baseHtml(body: string): string {
  const prefsUrl = `${APP_URL}/settings#notifications`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:#0263C4;padding:20px 28px;">
          <span style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">${APP_NAME}</span>
        </td></tr>
        <tr><td style="padding:28px;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            You received this email from ${APP_NAME}, your Local Committee workspace.<br />
            <a href="${escapeHtml(prefsUrl)}" style="color:#0263C4;">Manage email preferences</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function btn(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#0263C4;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin:20px 0;">${escapeHtml(text)}</a>`;
}

export function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">${text}</p>`;
}

// ── Invite email ───────────────────────────────────────────────────────────────

export function buildInviteEmail(opts: {
  to: string; labName: string; inviterName: string; role: string; inviteCode: string;
}): EmailPayload {
  const { to, labName, inviterName, role, inviteCode } = opts;
  // Build URL from APP_URL + encoded code only: never interpolate caller-supplied URLs
  const inviteUrl = `${APP_URL}/login?invite=${encodeURIComponent(inviteCode)}`;
  const html = baseHtml(`
    ${p(`Hi there,`)}
    ${p(`<strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(labName)}</strong> on ${APP_NAME} as a <strong>${escapeHtml(role)}</strong>.`)}
    ${p(`${APP_NAME} is where your AIESEC Local Committee plans tasks, keeps in touch and checks in on how everyone is doing.`)}
    ${btn("Accept invitation", inviteUrl)}
    ${p(`Or copy this link: <a href="${escapeHtml(inviteUrl)}" style="color:#0263C4;word-break:break-all;">${escapeHtml(inviteUrl)}</a>`)}
    ${p(`This invite is personal to you and can only be used once.`)}
  `);
  const text = `${inviterName} invited you to join ${labName} on ${APP_NAME} as a ${role}.\n\nAccept here: ${inviteUrl}\n\nThis invite is personal to you and can only be used once.\n\nManage preferences: ${APP_URL}/settings#notifications`;
  return { to, subject: `You're invited to join ${escapeHtml(labName)} on ${APP_NAME}`, html, text };
}

// ── Task assignment email ──────────────────────────────────────────────────────

export function buildTaskAssignedEmail(opts: {
  to: string; recipientName: string; taskTitle: string; assignerName: string; projectName: string;
}): EmailPayload {
  const { to, recipientName, taskTitle, assignerName, projectName } = opts;
  const url = `${APP_URL}/tasks`;
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(recipientName)},`)}
    ${p(`<strong>${escapeHtml(assignerName)}</strong> assigned you a task in <strong>${escapeHtml(projectName)}</strong>:`)}
    <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#0263C4;">&ldquo;${escapeHtml(taskTitle)}&rdquo;</p>
    ${btn("View task", url)}
  `);
  const text = `Hi ${recipientName},\n\n${assignerName} assigned you "${taskTitle}" in ${projectName}.\n\nView: ${url}\n\nManage preferences: ${APP_URL}/settings#notifications`;
  return { to, subject: `${assignerName} assigned you a task`, html, text };
}

// ── LC win email ──────────────────────────────────────────────────────────────

export function buildLabWinEmail(opts: {
  to: string; recipientName: string; posterName: string; content: string; projectName: string;
}): EmailPayload {
  const { to, recipientName, posterName, content, projectName } = opts;
  const url = `${APP_URL}/`;
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(recipientName)},`)}
    ${p(`<strong>${escapeHtml(posterName)}</strong> posted a win in <strong>${escapeHtml(projectName)}</strong>:`)}
    <blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #0263C4;background:#f8fafc;border-radius:0 6px 6px 0;font-size:14px;color:#1e293b;">${escapeHtml(content)}</blockquote>
    ${btn(`See it in ${APP_NAME}`, url)}
  `);
  const text = `Hi ${recipientName},\n\n${posterName} posted a win in ${projectName}:\n\n"${content}"\n\nView: ${url}\n\nManage preferences: ${APP_URL}/settings#notifications`;
  return { to, subject: `New win from ${posterName}`, html, text };
}

// ── Weekly digest email ────────────────────────────────────────────────────────

export function buildDigestEmail(opts: {
  to: string; recipientName: string; projectName: string;
  tasksCompleted: number; labWins: string[]; newTasks: number;
}): EmailPayload {
  const { to, recipientName, projectName, tasksCompleted, labWins, newTasks } = opts;
  const url = `${APP_URL}/`;
  const winLines = labWins.length
    ? `<ul style="margin:0 0 20px;padding:0 0 0 20px;">${labWins.map(w => `<li style="font-size:14px;color:#1e293b;line-height:1.6;">${escapeHtml(w)}</li>`).join("")}</ul>`
    : `<p style="margin:0 0 20px;font-size:14px;color:#94a3b8;">No wins posted this week.</p>`;
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(recipientName)},`)}
    ${p(`Here&rsquo;s your weekly digest for <strong>${escapeHtml(projectName)}</strong>:`)}
    <table role="presentation" style="width:100%;margin:0 0 20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr style="background:#f8fafc;">
        <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#0263C4;">Tasks completed</td>
        <td style="padding:12px 16px;font-size:20px;font-weight:700;color:#0263C4;text-align:right;">${tasksCompleted}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#0263C4;border-top:1px solid #e2e8f0;">New tasks added</td>
        <td style="padding:12px 16px;font-size:20px;font-weight:700;color:#0263C4;text-align:right;border-top:1px solid #e2e8f0;">${newTasks}</td>
      </tr>
    </table>
    <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#0263C4;text-transform:uppercase;letter-spacing:0.05em;">Wins this week</p>
    ${winLines}
    ${btn(`Open ${APP_NAME}`, url)}
  `);
  const text = `Hi ${recipientName},\n\nWeekly digest for ${projectName}:\n\nTasks completed: ${tasksCompleted}\nNew tasks: ${newTasks}\nWins: ${labWins.join(", ") || "none"}\n\nOpen ${APP_NAME}: ${url}\n\nManage preferences: ${APP_URL}/settings#notifications`;
  return { to, subject: `Your weekly ${APP_NAME} digest: ${projectName}`, html, text };
}
