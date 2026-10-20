// Server-side only. Emails to members: event invites and reminders, task and
// check-in reminders, the weekly digest and announcements.

import { APP_NAME } from "@/lib/brand";
import { APP_URL, baseHtml, btn, escapeHtml, p, type EmailPayload } from "@/lib/email";

export interface EventForEmail {
  id: string; name: string; starts_on: string; ends_on: string; starts_at: string | null; ends_at: string | null;
  location: string | null; meeting_url: string | null; description: string | null;
}

/** "Tue 20 Oct, 17:00 UTC" / "Sat 1 – Sun 2 Nov" — UTC because recipients' time zones vary. */
export function whenText(ev: EventForEmail): string {
  const fmt = (d: Date, withTime: boolean) => d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
  if (ev.starts_at) return `${fmt(new Date(ev.starts_at), true)} UTC`;
  const a = fmt(new Date(ev.starts_on + "T12:00:00Z"), false);
  return ev.ends_on !== ev.starts_on ? `${a} – ${fmt(new Date(ev.ends_on + "T12:00:00Z"), false)}` : a;
}

const muted = (t: string) => `<p style="margin:0 0 14px;font-size:12px;color:#64748b;line-height:1.5;">${t}</p>`;

export function buildEventEmail(opts: {
  to: string; recipientName: string; lcName: string; ev: EventForEmail; kind: "invite" | "24h" | "1h";
  rsvp: { going: string; notGoing: string } | null; ics?: string; fromName?: string; replyTo?: string;
}): EmailPayload {
  const { ev, kind } = opts;
  const when = whenText(ev);
  const intro = kind === "invite" ? `You're invited to <strong>${escapeHtml(ev.name)}</strong>.`
    : kind === "24h" ? `Reminder: <strong>${escapeHtml(ev.name)}</strong> is tomorrow.`
    : `<strong>${escapeHtml(ev.name)}</strong> starts in about an hour.`;
  const details = [
    `<strong>When:</strong> ${escapeHtml(when)}`,
    ...(ev.location ? [`<strong>Where:</strong> ${escapeHtml(ev.location)}`] : []),
    ...(ev.meeting_url ? [`<strong>Online:</strong> <a href="${escapeHtml(ev.meeting_url)}" style="color:#0263C4;">${escapeHtml(ev.meeting_url)}</a>`] : []),
  ].join("<br />");
  const rsvp = opts.rsvp ? `
    <p style="margin:20px 0 6px;font-size:13px;font-weight:600;color:#1e293b;">Are you coming?</p>
    <a href="${escapeHtml(opts.rsvp.going)}" style="display:inline-block;background:#0263C4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;margin-right:8px;">Going</a>
    <a href="${escapeHtml(opts.rsvp.notGoing)}" style="display:inline-block;color:#0263C4;border:2px solid #0263C4;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;">Not going</a>` : "";
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(opts.recipientName)},`)}
    ${p(intro)}
    ${p(details)}
    ${ev.description ? p(escapeHtml(ev.description).replace(/\n/g, "<br />")) : ""}
    ${rsvp}
    ${kind === "invite" && opts.ics ? muted("The calendar invite is attached; open it to add the event to your calendar.") : ""}
    ${btn("See it in the app", `${APP_URL}/attendance`)}
  `);
  const text = [
    `Hi ${opts.recipientName},`, "",
    kind === "invite" ? `You're invited to ${ev.name}.` : kind === "24h" ? `Reminder: ${ev.name} is tomorrow.` : `${ev.name} starts in about an hour.`,
    `When: ${when}`, ...(ev.location ? [`Where: ${ev.location}`] : []), ...(ev.meeting_url ? [`Online: ${ev.meeting_url}`] : []),
    ...(ev.description ? ["", ev.description] : []),
    ...(opts.rsvp ? ["", `Going: ${opts.rsvp.going}`, `Not going: ${opts.rsvp.notGoing}`] : []),
    "", `Manage email preferences: ${APP_URL}/settings#notifications`,
  ].join("\n");
  const subject = kind === "invite" ? `${ev.name} · ${when}` : kind === "24h" ? `Tomorrow: ${ev.name}` : `In 1 hour: ${ev.name}`;
  return {
    to: opts.to, subject, html, text, fromName: opts.fromName, replyTo: opts.replyTo,
    ...(opts.ics ? { attachments: [{ filename: "invite.ics", content: Buffer.from(opts.ics).toString("base64"), contentType: "text/calendar; charset=utf-8; method=PUBLISH" }] } : {}),
  };
}

export function buildTasksEmail(opts: {
  to: string; recipientName: string; kind: "due" | "overdue" | "escalate"; tasks: { title: string; due: string; who?: string }[]; fromName?: string;
}): EmailPayload {
  const { kind, tasks } = opts;
  const lead = kind === "due" ? `Due tomorrow:` : kind === "overdue" ? `These tasks are past their due date:` : `These tasks in your department are 3 or more days late:`;
  const list = `<ul style="margin:0 0 16px;padding-left:20px;">${tasks.map((t) => `<li style="font-size:14px;color:#1e293b;line-height:1.6;">${escapeHtml(t.title)} <span style="color:#64748b;">· due ${escapeHtml(t.due)}${t.who ? ` · ${escapeHtml(t.who)}` : ""}</span></li>`).join("")}</ul>`;
  const html = baseHtml(`${p(`Hi ${escapeHtml(opts.recipientName)},`)}${p(lead)}${list}${btn("Open tasks", `${APP_URL}/tasks`)}`);
  const text = `Hi ${opts.recipientName},\n\n${lead}\n${tasks.map((t) => `- ${t.title} (due ${t.due}${t.who ? `, ${t.who}` : ""})`).join("\n")}\n\n${APP_URL}/tasks\n\nManage email preferences: ${APP_URL}/settings#notifications`;
  const subject = kind === "due" ? `Due tomorrow: ${tasks[0].title}${tasks.length > 1 ? ` and ${tasks.length - 1} more` : ""}`
    : kind === "overdue" ? `Overdue: ${tasks[0].title}${tasks.length > 1 ? ` and ${tasks.length - 1} more` : ""}`
    : `${tasks.length} task${tasks.length === 1 ? " is" : "s are"} 3+ days late in your department`;
  return { to: opts.to, subject, html, text, fromName: opts.fromName };
}

export function buildCheckinEmail(opts: { to: string; recipientName: string; kind: "open" | "nudge"; fromName?: string }): EmailPayload {
  const url = `${APP_URL}/checkin`;
  const line = opts.kind === "open"
    ? "A new check-in is open. It takes about a minute, and only anonymous averages are ever shared."
    : "The check-in closes in two days. If you haven't done it yet, it takes about a minute.";
  const html = baseHtml(`${p(`Hi ${escapeHtml(opts.recipientName)},`)}${p(line)}${btn("Do the check-in", url)}`);
  return {
    to: opts.to, fromName: opts.fromName, html,
    subject: opts.kind === "open" ? "Your check-in is open" : "Check-in closes in two days",
    text: `Hi ${opts.recipientName},\n\n${line}\n\n${url}\n\nManage email preferences: ${APP_URL}/settings#notifications`,
  };
}

export function buildWeeklyDigest(opts: {
  to: string; recipientName: string; lcName: string; tasks: { title: string; due: string }[];
  events: EventForEmail[]; wins: string[]; fromName?: string;
  /** Open tabling slots this week, each with a one-tap sign-up link. */
  slots?: { label: string; signUpUrl: string }[];
}): EmailPayload {
  const slots = opts.slots ?? [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // The subject says what needs you, so it's useful without opening the email.
  const asks = [
    opts.tasks.length ? `You have ${plural(opts.tasks.length, "task", "tasks")} this week` : "",
    slots.length ? `${plural(slots.length, "tabling slot needs", "tabling slots need")} you` : "",
  ].filter(Boolean);
  const section = (title: string, body: string) =>
    `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;color:#0263C4;text-transform:uppercase;letter-spacing:0.05em;">${title}</p>${body}`;
  const list = (items: string[], empty: string) => items.length
    ? `<ul style="margin:0;padding-left:20px;">${items.map((i) => `<li style="font-size:14px;color:#1e293b;line-height:1.6;">${i}</li>`).join("")}</ul>`
    : `<p style="margin:0;font-size:14px;color:#94a3b8;">${empty}</p>`;
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(opts.recipientName)}, here's your week in <strong>${escapeHtml(opts.lcName)}</strong>.`)}
    ${section("Your tasks this week", list(opts.tasks.map((t) => `${escapeHtml(t.title)} <span style="color:#64748b;">· ${escapeHtml(t.due)}</span>`), "Nothing due this week."))}
    ${slots.length ? section("Tabling needs you", list(slots.map((sl) => `${escapeHtml(sl.label)} · <a href="${escapeHtml(sl.signUpUrl)}" style="color:#0263C4;font-weight:600;">Sign me up</a>`), "")) : ""}
    ${section("Coming up", list(opts.events.map((e) => `${escapeHtml(e.name)} <span style="color:#64748b;">· ${escapeHtml(whenText(e))}</span>`), "No events in the next 7 days."))}
    ${section("LC wins", list(opts.wins.map(escapeHtml), "No wins posted last week. Post one!"))}
    ${btn(`Open ${APP_NAME}`, `${APP_URL}/`)}
  `);
  const text = [
    `Hi ${opts.recipientName}, here's your week in ${opts.lcName}.`, "",
    "Your tasks this week:", ...(opts.tasks.length ? opts.tasks.map((t) => `- ${t.title} (${t.due})`) : ["- nothing due"]), "",
    ...(slots.length ? ["Tabling needs you:", ...slots.map((sl) => `- ${sl.label}: sign up at ${sl.signUpUrl}`), ""] : []),
    "Coming up:", ...(opts.events.length ? opts.events.map((e) => `- ${e.name} (${whenText(e)})`) : ["- no events"]), "",
    "LC wins:", ...(opts.wins.length ? opts.wins.map((w) => `- ${w}`) : ["- none yet"]), "",
    `${APP_URL}/`, `Manage email preferences: ${APP_URL}/settings#notifications`,
  ].join("\n");
  const subject = asks.length ? `${asks.join(", ")} (${opts.lcName})` : `Your week in ${opts.lcName}`;
  return { to: opts.to, subject, html, text, fromName: opts.fromName };
}

export function buildAnnouncementEmail(opts: {
  to: string; recipientName: string; subject: string; body: string; authorName: string; fromName?: string; replyTo?: string;
}): EmailPayload {
  const html = baseHtml(`
    ${p(`Hi ${escapeHtml(opts.recipientName)},`)}
    ${p(escapeHtml(opts.body).replace(/\n/g, "<br />"))}
    ${muted(`Sent by ${escapeHtml(opts.authorName)}. Reply to this email to answer them.`)}
  `);
  return {
    to: opts.to, subject: opts.subject, html, fromName: opts.fromName, replyTo: opts.replyTo,
    text: `Hi ${opts.recipientName},\n\n${opts.body}\n\nSent by ${opts.authorName}.\n\nManage email preferences: ${APP_URL}/settings#notifications`,
  };
}
