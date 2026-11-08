// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";
import { dueOn, ROUTINE_TEMPLATES, type Schedule } from "../../src/lib/routines";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const FIN = "Finance & Legality";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "fiona", "mia", "outsider"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres, "AIESEC in Lisbon");
  await addMember(db, lc, u.fiona, { role: "vp", leads: [FIN] });
  await addMember(db, lc, u.mia, { department: "Marketing" });
}, 60_000);

const addRoutine = (who: string, fields: Record<string, unknown>) => asUserCommit(db, u[who], async () => {
  const cols = ["project_id", "created_by", ...Object.keys(fields)];
  const vals = [lc.id, u[who], ...Object.values(fields)];
  const { rows } = await db.query<{ id: string }>(`insert into routines (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
  return rows[0].id;
});

describe("routines", () => {
  it("are set up by the LC's execs only", async () => {
    await addRoutine("pres", { title: "Weekly EB meeting", assignee: "president", freq: "weekly", weekday: 1 });
    await expect(addRoutine("mia", { title: "Mine", assignee: "president", freq: "weekly", weekday: 2 })).rejects.toThrow();
    await expect(addRoutine("outsider", { title: "Theirs", assignee: "president", freq: "weekly", weekday: 2 })).rejects.toThrow();
    const seen = await asUser(db, u.mia, async (tx) => (await tx.query("select title from routines")).rows);
    expect(seen).toHaveLength(1);                                     // members can see them
  });

  it("refuse schedules that don't make sense", async () => {
    await expect(addRoutine("pres", { title: "x", assignee: "president", freq: "weekly" })).rejects.toThrow(/routines_schedule/);
    await expect(addRoutine("pres", { title: "x", assignee: "president", freq: "biweekly", weekday: 1, anchor: "2026-01-01" })).rejects.toThrow(/routines_schedule/);   // a Thursday
    await expect(addRoutine("pres", { title: "x", assignee: "person", freq: "weekly", weekday: 1 })).rejects.toThrow(/routines_person/);
  });

  it("become tasks a few days ahead, once, assigned to the VP (or the LCP without one)", async () => {
    await addRoutine("fiona", { title: "Semester audit", department_id: lc.departments[FIN], assignee: "department_vp", freq: "monthly", month_day: 15, months: [2, 9], lead_days: 14 });
    await addRoutine("pres", { title: "Info session", department_id: lc.departments["Marketing"], assignee: "department_vp", freq: "weekly", weekday: 3, lead_days: 2 });
    // 2027-02-08 (Monday): the audit on the 15th is within 14 days; Wednesday the 10th has the info session.
    const made = await asUserCommit(db, u.pres, async () => (await db.query<{ n: number }>("select run_routines($1, '2027-02-08') as n", [lc.id])).rows[0].n);
    const tasks = (await db.query<{ title: string; due_date: string; who: string[] }>(
      "select t.title, t.due_date::text, array(select user_id::text from task_assignees a where a.task_id = t.id) as who from tasks t where t.project_id = $1 order by due_date, title", [lc.id])).rows;
    expect(tasks).toEqual([
      { title: "Weekly EB meeting", due_date: "2027-02-08", who: [u.pres] },
      { title: "Info session", due_date: "2027-02-10", who: [u.pres] },          // Marketing has no VP: the LCP
      { title: "Semester audit", due_date: "2027-02-15", who: [u.fiona] },        // 14 days ahead
    ]);                                                                         // next Monday's EB meeting: not yet (3 days ahead)
    expect(made).toBe(3);
    // Running again creates nothing new.
    expect(await asUserCommit(db, u.pres, async () => (await db.query<{ n: number }>("select run_routines($1, '2027-02-08') as n", [lc.id])).rows[0].n)).toBe(0);
  });

  it("can be run for an LC by its execs only; the daily job runs every LC", async () => {
    await expect(asUser(db, u.mia, (tx) => tx.query("select run_routines($1, '2027-02-08')", [lc.id]))).rejects.toThrow(/Only the LC's president or a VP/);
    await expect(asUser(db, u.pres, (tx) => tx.query("select run_routines(null, '2027-02-08')"))).rejects.toThrow(/Only the LC's president or a VP/);
    const { rows } = await db.query<{ n: number }>("select run_routines(null, '2027-03-01') as n");   // no signed-in user: the job
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("fall on the same dates in the app as in the database", async () => {
    const schedules: Schedule[] = [
      ...ROUTINE_TEMPLATES,
      { freq: "monthly", nth: 2, weekday: 5 },
      { freq: "biweekly", weekday: 2, anchor: "2026-03-03" },
      { freq: "monthly", month_day: -1, months: [2] },
    ];
    for (const s of schedules) {
      const { rows } = await db.query<{ d: string }>(
        `select g::date::text as d from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') g
         where routine_due_on(row(gen_random_uuid(), gen_random_uuid(), 'x', null, null, 'president', null, $1, $2, $3, $4, $5, $6::smallint[], 3, true, null, gen_random_uuid(), now())::routines, g::date)`,
        [s.freq, s.weekday ?? null, s.anchor ?? null, s.month_day ?? null, s.nth ?? null, s.months ?? null]);
      const app: string[] = [];
      for (let d = new Date("2026-01-01T00:00:00Z"); d <= new Date("2027-12-31T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
        const x = d.toISOString().slice(0, 10);
        if (dueOn(s, x)) app.push(x);
      }
      expect(rows.map((r) => r.d), JSON.stringify(s)).toEqual(app);
    }
  });
});
