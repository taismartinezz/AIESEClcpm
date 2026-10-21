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

  it("is created full of sample data, with the caller as president and a made-up team", async () => {
    demo = await asUserCommit(db, u.ana, async () => (await db.query<{ create_demo_lc: string }>("select create_demo_lc()")).rows[0].create_demo_lc);
    const counts = await asUser(db, u.ana, async (tx) => (await tx.query<Record<string, number>>(`select
      (select count(*)::int from exchanges where project_id = $1) as exchanges,
      (select count(*)::int from goals where project_id = $1) as goals,
      (select count(*)::int from partners where project_id = $1) as partners,
      (select count(*)::int from team_members where project_id = $1) as members,
      (select count(*)::int from exchanges where project_id = $1 and owner_id is null) as unowned,
      (select count(*)::int from chat_messages where channel = 'lab:' || $1) as messages,
      (select count(*)::int from lab_wins where project_id = $1) as wins`, [demo])).rows[0]);
    expect(counts).toEqual({ exchanges: 10, goals: 3, partners: 3, members: 8, unowned: 0, messages: 5, wins: 1 });
    // Their check-ins are in, so the president's pulse shows numbers rather than "not enough responses".
    const pulse = await asUser(db, u.ana, async (tx) => (await tx.query<{ suppressed: boolean }>(
      "select suppressed from get_exec_pulse($1)", [demo])).rows);
    expect(pulse.some((r) => !r.suppressed)).toBe(true);
    // Placeholder accounts can't be reached or signed into.
    const emails = (await db.query<{ email: string }>("select u.email from auth.users u join demo_people d on d.user_id = u.id where d.project_id = $1", [demo])).rows;
    expect(emails).toHaveLength(7);
    expect(emails.every((e) => e.email.endsWith("@demo.invalid"))).toBe(true);
    // Its sample finance entries are filed under their categories.
    const finance = (await db.query<{ description: string; category: string | null }>(
      "select e.description, c.name as category from finance_entries e left join finance_categories c on c.id = e.category_id where e.project_id = $1 order by 1", [demo])).rows;
    expect(finance).toEqual([
      { description: "Posters for the info session", category: "Marketing" },
      { description: "Sponsorship: Demo Bank", category: "Sponsorship" },
    ]);
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
    expect((await db.query("select 1 from auth.users where email like '%@demo.invalid'")).rows).toEqual([]);
  });
});
