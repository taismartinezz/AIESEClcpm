// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
let eventId: string;
const u: Record<string, string> = {};
const MKT = "Marketing";
const OGV = "Outgoing Global Volunteer";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "vera", "omar", "mo", "max", "gia"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.vera, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.omar, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.mo, { department: MKT });
  await addMember(db, lc, u.max, { department: MKT });
  await addMember(db, lc, u.gia, { department: OGV });

  // The president creates an event and logs Mo, Max and Gia as attendees.
  eventId = await asUserCommit(db, u.pres, async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into lc_events (project_id, name, type, starts_on, ends_on, created_by)
       values ($1, 'National conference', 'national_conference', current_date, current_date + 2, $2) returning id`,
      [lc.id, u.pres]);
    for (const who of ["mo", "max", "gia"]) {
      await db.query("insert into event_attendance (event_id, user_id, recorded_by) values ($1, $2, $3)", [rows[0].id, u[who], u.pres]);
    }
    return rows[0].id;
  });
}, 60_000);

const attendees = (who: string) => asUser(db, u[who], async (tx) =>
  (await tx.query<{ user_id: string }>("select user_id from event_attendance where event_id = $1", [eventId])).rows.map((r) => r.user_id));

describe("attendance", () => {
  it("members can't log attendance, not even their own", async () => {
    await expect(asUser(db, u.mo, (tx) => tx.query(
      "insert into event_attendance (event_id, user_id, recorded_by) values ($1, $2, $2)", [eventId, u.mo],
    ))).rejects.toThrow(/row-level security/);
  });

  it("members can't create events", async () => {
    await expect(asUser(db, u.mo, (tx) => tx.query(
      `insert into lc_events (project_id, name, type, starts_on, ends_on, created_by) values ($1, 'x', 'other', current_date, current_date, $2)`,
      [lc.id, u.mo],
    ))).rejects.toThrow(/row-level security/);
  });

  it("members see only their own attendance", async () => {
    expect(await attendees("mo")).toEqual([u.mo]);
  });

  it("VPs see only their department's members", async () => {
    expect(new Set(await attendees("vera"))).toEqual(new Set([u.mo, u.max]));
    expect(await attendees("omar")).toEqual([u.gia]);
  });

  it("the president sees everyone", async () => {
    expect(new Set(await attendees("pres"))).toEqual(new Set([u.mo, u.max, u.gia]));
  });

  it("a VP can log attendance and then sees what they logged", async () => {
    const rows = await asUser(db, u.omar, async (tx) => {
      await tx.query("insert into event_attendance (event_id, user_id, recorded_by) values ($1, $2, $3)", [eventId, u.vera, u.omar]);
      return (await tx.query<{ user_id: string }>("select user_id from event_attendance where event_id = $1", [eventId])).rows;
    });
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([u.gia, u.vera]));
  });

  it("only LC members can be logged as attendees", async () => {
    const outsider = await createUser(db, "outsider");
    await expect(asUser(db, u.pres, (tx) => tx.query(
      "insert into event_attendance (event_id, user_id, recorded_by) values ($1, $2, $3)", [eventId, outsider, u.pres],
    ))).rejects.toThrow(/must be members/);
  });

  it("everyone in the LC sees the event list", async () => {
    const names = await asUser(db, u.mo, async (tx) => (await tx.query<{ name: string }>("select name from lc_events")).rows);
    expect(names).toEqual([{ name: "National conference" }]);
  });
});
