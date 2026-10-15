// Server-side only. Signed RSVP links so members can answer from the email
// without logging in. The token binds one event to one person.

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.RSVP_SECRET || process.env.INTERNAL_API_SECRET || "";
  if (!s) throw new Error("RSVP_SECRET (or INTERNAL_API_SECRET) is not set");
  return s;
}

export function rsvpToken(eventId: string, userId: string): string {
  return createHmac("sha256", secret()).update(`rsvp:${eventId}:${userId}`).digest("base64url");
}

export function verifyRsvpToken(eventId: string, userId: string, token: string): boolean {
  try {
    const expected = Buffer.from(rsvpToken(eventId, userId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
