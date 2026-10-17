// iCalendar (.ics) invites so events land in Google Calendar / Outlook.

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Timed event (UTC instants)… */
  startsAt?: string | null;
  endsAt?: string | null;
  /** …or all-day, inclusive dates (YYYY-MM-DD). */
  startsOn: string;
  endsOn: string;
  organizerName?: string;
}

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (d: string) => d.replace(/-/g, "");

function nextDay(d: string): string {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(ev: IcsEvent, now = new Date()): string {
  const timed = Boolean(ev.startsAt);
  const end = ev.endsAt ?? (ev.startsAt ? new Date(new Date(ev.startsAt).getTime() + 3_600_000).toISOString() : null);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AIESEClcpm//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${utc(now.toISOString())}`,
    timed ? `DTSTART:${utc(ev.startsAt!)}` : `DTSTART;VALUE=DATE:${day(ev.startsOn)}`,
    timed ? `DTEND:${utc(end!)}` : `DTEND;VALUE=DATE:${day(nextDay(ev.endsOn))}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ...(ev.location ? [`LOCATION:${escapeText(ev.location)}`] : []),
    ...(ev.description || ev.url ? [`DESCRIPTION:${escapeText([ev.description, ev.url].filter(Boolean).join("\n\n"))}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    ...(ev.organizerName ? [`ORGANIZER;CN=${escapeText(ev.organizerName)}:mailto:noreply@invalid`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
