// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const TM = "Talent Management";
const MKT = "Marketing";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "tia", "mia", "tom", "max"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.tia, { role: "vp", leads: [TM] });
  await addMember(db, lc, u.mia, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.tom, { department: TM });
  await addMember(db, lc, u.max, { department: MKT });
}, 60_000);

describe("recruitment", () => {
  it("is exec-only and dedupes by email", async () => {
    await asUserCommit(db, u.tia, () => db.query("insert into recruits (project_id, name, email, created_by) values ($1, 'Ana', 'Ana@Example.com', $2)", [lc.id, u.tia]));
    const seen = (who: string) => asUser(db, u[who], async (tx) => (await tx.query("select email from recruits")).rows);
    expect(await seen("mia")).toEqual([{ email: "ana@example.com" }]);
    expect(await seen("tom")).toEqual([]);
    await expect(asUser(db, u.tom, (tx) => tx.query("insert into recruits (project_id, name) values ($1, 'X')", [lc.id]))).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into recruits (project_id, name, email) values ($1, 'Ana 2', 'ana@example.com')", [lc.id])).rejects.toThrow(/duplicate/);
  });
});

describe("onboarding", () => {
  it("seeds five steps; members tick their own, their VP can tick theirs, other VPs cannot", async () => {
    const { rows: steps } = await db.query<{ id: string }>("select id from onboarding_steps where project_id = $1 order by sort_order", [lc.id]);
    expect(steps).toHaveLength(5);
    const tick = (who: string, member: string) => asUser(db, u[who], (tx) =>
      tx.query("insert into member_onboarding (project_id, user_id, step_id) values ($1, $2, $3)", [lc.id, u[member], steps[0].id]));
    await expect(tick("tom", "tom")).resolves.toBeTruthy();
    await expect(tick("tia", "tom")).resolves.toBeTruthy();
    await expect(tick("mia", "tom")).rejects.toThrow(/row-level security/);
    await expect(tick("max", "tom")).rejects.toThrow(/row-level security/);
  });
});

describe("term dates and activity", () => {
  it("only the president or the member's VP sets term dates", async () => {
    await asUser(db, u.tia, (tx) => tx.query("select set_member_term($1, $2, '2026-02-01', '2027-01-31')", [lc.id, u.tom]));
    await expect(asUser(db, u.mia, (tx) => tx.query("select set_member_term($1, $2, '2026-02-01', null)", [lc.id, u.tom])))
      .rejects.toThrow(/president or the member's VP/);
    await expect(asUser(db, u.tom, (tx) => tx.query("select set_member_term($1, $2, '2026-02-01', null)", [lc.id, u.tom])))
      .rejects.toThrow(/president or the member's VP/);
  });

  it("activity: president sees everyone, a VP their departments, a member nothing", async () => {
    const who = (name: string) => asUser(db, u[name], async (tx) =>
      (await tx.query<{ user_id: string }>("select user_id from member_activity($1)", [lc.id])).rows.map((r) => r.user_id).sort());
    expect((await who("pres")).length).toBe(5);
    expect(await who("tia")).toEqual([u.tom].sort());
    expect(await who("tom")).toEqual([]);
  });

  it("touch_last_seen records when someone opened the app", async () => {
    await asUserCommit(db, u.max, () => db.query("select touch_last_seen()"));
    const { rows } = await db.query("select last_seen_at from user_profiles where id = $1", [u.max]);
    expect(rows[0]).toMatchObject({ last_seen_at: expect.anything() });
  });
});
