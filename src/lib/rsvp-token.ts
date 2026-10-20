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

/** Signed one-tap tabling sign-up links in the weekly email: one slot, one person. */
export function tablingToken(slotId: string, userId: string): string {
  return createHmac("sha256", secret()).update(`tabling:${slotId}:${userId}`).digest("base64url");
}

export function verifyTablingToken(slotId: string, userId: string, token: string): boolean {
  try {
    const expected = Buffer.from(tablingToken(slotId, userId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
