// Server-side only. Signed unsubscribe links for outreach emails.

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.RSVP_SECRET || process.env.INTERNAL_API_SECRET || "";
  if (!s) throw new Error("RSVP_SECRET (or INTERNAL_API_SECRET) is not set");
  return s;
}

export function unsubscribeToken(exchangeId: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${exchangeId}`).digest("base64url");
}

export function verifyUnsubscribeToken(exchangeId: string, token: string): boolean {
  try {
    const a = Buffer.from(unsubscribeToken(exchangeId));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
