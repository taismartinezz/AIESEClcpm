// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const LC_WIDE = "00000000-0000-0000-0000-000000000000";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "ana", "ben", "out"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.ana, { department: "Marketing" });
  await addMember(db, lc, u.ben, { department: "Marketing" });
}, 60_000);

describe("availability", () => {
  it("you save your own; the LC reads everyone's; outsiders read nothing", async () => {
    await asUserCommit(db, u.ana, () => db.query(
      "insert into user_availability (project_id, user_id, sub_project_id, slots) values ($1, $2, $3, '[\"0-1\",\"0-2\"]') on conflict (project_id, user_id, sub_project_id) do update set slots = excluded.slots",
      [lc.id, u.ana, LC_WIDE]));
    await expect(asUser(db, u.ben, (tx) => tx.query("insert into user_availability (project_id, user_id, slots) values ($1, $2, '[]')", [lc.id, u.ana])))
      .rejects.toThrow(/row-level security/);
    expect(await asUser(db, u.ben, async (tx) => (await tx.query("select slots from user_availability")).rows.length)).toBe(1);
    expect(await asUser(db, u.out, async (tx) => (await tx.query("select slots from user_availability")).rows.length)).toBe(0);
  });
});

describe("meeting proposals", () => {
  it("invitees answer; only the proposer changes the meeting", async () => {
    const id = await asUserCommit(db, u.ana, async () => (await db.query<{ id: string }>(
      "insert into meeting_proposals (project_id, proposer_id, title, proposed_date, proposed_time, invitee_ids, responses) values ($1, $2, 'Plan GA', current_date + 2, '18:00', $3, '[]') returning id",
      [lc.id, u.ana, [u.ben]])).rows[0].id);
    const answered = await asUser(db, u.ben, async (tx) => (await tx.query(
      `update meeting_proposals set responses = '[{"userId":"${u.ben}","status":"accepted"}]' where id = $1 returning id`, [id])).rows.length);
    expect(answered).toBe(1);
    await expect(asUser(db, u.ben, (tx) => tx.query("update meeting_proposals set proposed_time = '09:00' where id = $1", [id])))
      .rejects.toThrow(/Only the person who proposed/);
    expect(await asUser(db, u.pres, async (tx) => (await tx.query("update meeting_proposals set title = 'x' where id = $1 returning id", [id])).rows.length)).toBe(0);
  });
});
