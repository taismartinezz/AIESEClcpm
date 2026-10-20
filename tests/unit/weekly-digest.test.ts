import { describe, it, expect, beforeAll } from "vitest";
import { buildWeeklyDigest } from "@/lib/member-emails";
import { tablingToken, verifyTablingToken, rsvpToken } from "@/lib/rsvp-token";

beforeAll(() => { process.env.RSVP_SECRET = "test-secret"; });

const base = { to: "a@example.com", recipientName: "Ana", lcName: "AIESEC in Test", events: [], wins: [] };

describe("weekly digest", () => {
  it("says in the subject what needs you", () => {
    const email = buildWeeklyDigest({ ...base, tasks: [{ title: "A", due: "2026-10-21" }, { title: "B", due: "2026-10-22" }],
      slots: [{ label: "oGV recruitment, Library, Wed 12:00", signUpUrl: "https://x/api/tabling/signup?s=1" }] });
    expect(email.subject).toBe("You have 2 tasks this week, 1 tabling slot needs you (AIESEC in Test)");
    expect(email.html).toContain("Tabling needs you");
    expect(email.html).toContain("Sign me up");
    expect(email.text).toContain("sign up at https://x/api/tabling/signup?s=1");
  });

  it("keeps the plain subject when nothing needs you", () => {
    expect(buildWeeklyDigest({ ...base, tasks: [] }).subject).toBe("Your week in AIESEC in Test");
  });

  it("escapes slot text", () => {
    const email = buildWeeklyDigest({ ...base, tasks: [], slots: [{ label: "<b>x</b>", signUpUrl: "https://x/?a=1&b=2" }] });
    expect(email.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(email.html).toContain("https://x/?a=1&amp;b=2");
  });
});

describe("tabling sign-up links", () => {
  it("are bound to one slot and one person", () => {
    const t = tablingToken("slot-1", "user-1");
    expect(verifyTablingToken("slot-1", "user-1", t)).toBe(true);
    expect(verifyTablingToken("slot-2", "user-1", t)).toBe(false);
    expect(verifyTablingToken("slot-1", "user-2", t)).toBe(false);
  });

  it("can't be swapped with an event RSVP link", () => {
    expect(verifyTablingToken("x", "user-1", rsvpToken("x", "user-1"))).toBe(false);
  });
});
