// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, asUserCommit } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["ana", "bo"]) u[n] = await createUser(db, n);
  await createLc(db, u.bo, "Real LC");
}, 60_000);

describe("demo LC", () => {
  let demo: string;

  it("is created full of sample data with the caller as its only member", async () => {
    demo = await asUserCommit(db, u.ana, async () => (await db.query<{ create_demo_lc: string }>("select create_demo_lc()")).rows[0].create_demo_lc);
    const counts = await asUser(db, u.ana, async (tx) => (await tx.query<Record<string, number>>(`select
      (select count(*)::int from exchanges where project_id = $1) as exchanges,
      (select count(*)::int from goals where project_id = $1) as goals,
      (select count(*)::int from partners where project_id = $1) as partners,
      (select count(*)::int from team_members where project_id = $1) as members`, [demo])).rows[0]);
    expect(counts).toEqual({ exchanges: 10, goals: 3, partners: 3, members: 1 });
    const { rows } = await db.query<{ approved: number }>("select current from goal_progress($1) limit 0", [demo]);
    expect(rows).toEqual([]);
  });

  it("is invisible to everyone else", async () => {
    expect(await asUser(db, u.bo, async (tx) => (await tx.query("select 1 from exchanges where project_id = $1", [demo])).rows)).toEqual([]);
  });

  it("can only be deleted by its owner, and real LCs can't be deleted this way", async () => {
    const real = (await db.query<{ id: string }>("select id from projects where name = 'Real LC'")).rows[0].id;
    await expect(asUser(db, u.bo, (tx) => tx.query("select delete_demo_lc($1)", [demo]))).rejects.toThrow(/Only your own demo LCs/);
    await expect(asUser(db, u.bo, (tx) => tx.query("select delete_demo_lc($1)", [real]))).rejects.toThrow(/Only your own demo LCs/);
    await asUserCommit(db, u.ana, () => db.query("select delete_demo_lc($1)", [demo]));
    expect((await db.query("select 1 from projects where id = $1", [demo])).rows).toEqual([]);
  });
});
