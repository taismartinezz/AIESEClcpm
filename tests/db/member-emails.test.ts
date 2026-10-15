// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const MKT = "Marketing";

const newEvent = (fields: string, values: unknown[]) => asUserCommit(db, u.pres, async () =>
  (await db.query<{ id: string }>(`insert into lc_events (project_id, name, type, starts_on, ends_on, created_by${fields ? ", " + fields : ""})
     values ($1, 'E', 'local_event', current_date + 3, current_date + 3, $2${values.map((_, i) => `, $${i + 3}`).join("")}) returning id`,
    [lc.id, u.pres, ...values])).rows[0].id);

const audience = async (id: string) => (await db.query<{ u: string }>("select event_audience as u from event_audience($1)", [id])).rows.map((r) => r.u).sort();

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "mia", "max", "tom"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.mia, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.max, { department: MKT });
  await addMember(db, lc, u.tom, { department: "Talent Management" });
}, 60_000);

describe("event audiences", () => {
  it("whole LC, a department (with its VP), a role, or chosen people", async () => {
    expect(await audience(await newEvent("", []))).toEqual([u.pres, u.mia, u.max, u.tom].sort());
    expect(await audience(await newEvent("audience, department_id", ["department", lc.departments[MKT]]))).toEqual([u.mia, u.max].sort());
    expect(await audience(await newEvent("audience, audience_role", ["role", "exec"]))).toEqual([u.pres, u.mia].sort());
    const people = await newEvent("audience", ["people"]);
    await asUserCommit(db, u.pres, () => db.query("insert into event_invitees (event_id, user_id) values ($1, $2)", [people, u.tom]));
    expect(await audience(people)).toEqual([u.tom]);
  });

  it("rejects an online link that isn't https", async () => {
    await expect(newEvent("meeting_url", ["http://zoom.example/123"])).rejects.toThrow(/meeting_url/);
  });
});

describe("RSVPs", () => {
  it("members answer for themselves; the exec board sees all answers", async () => {
    const ev = await newEvent("", []);
    await asUserCommit(db, u.max, () => db.query("insert into event_rsvps (event_id, user_id, response) values ($1, $2, 'going')", [ev, u.max]));
    await expect(asUser(db, u.tom, (tx) => tx.query("insert into event_rsvps (event_id, user_id, response) values ($1, $2, 'going')", [ev, u.max])))
      .rejects.toThrow(/row-level security/);
    const seen = (who: string) => asUser(db, u[who], async (tx) => (await tx.query("select user_id from event_rsvps where event_id = $1", [ev])).rows.length);
    expect(await seen("mia")).toBe(1);
    expect(await seen("tom")).toBe(0);
  });
});

describe("announcements and the send log", () => {
  it("only the exec board writes announcements; nobody reads the send log", async () => {
    await expect(asUser(db, u.max, (tx) => tx.query("insert into announcements (project_id, author_id, subject, body) values ($1, $2, 'Hi', 'GA moved')", [lc.id, u.max])))
      .rejects.toThrow(/row-level security/);
    await asUser(db, u.mia, (tx) => tx.query("insert into announcements (project_id, author_id, subject, body) values ($1, $2, 'GA moved', 'Thursday 6pm')", [lc.id, u.mia]));
    await db.query("insert into email_log (kind, ref_id, user_id) values ('digest', '2026-10-12', $1)", [u.max]);
    expect(await asUser(db, u.max, async (tx) => (await tx.query("select * from email_log")).rows)).toEqual([]);
  });

  it("validates the LC's sender name", async () => {
    await expect(db.query("update projects set email_sender_name = 'Evil <x@y.z>' where id = $1", [lc.id])).rejects.toThrow(/sender_name/);
    await db.query("update projects set email_sender_name = 'AIESEC at Northwestern' where id = $1", [lc.id]);
  });
});
