// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, type Lc } from "./fixtures";

// oGV has 2 members and oGTa 1: each is below the threshold of 3 on its own,
// but together they make the Outgoing area (3 people), which can be shown.

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "vp", "a", "b", "c", "m"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.vp, { role: "vp", leads: ["Outgoing Global Volunteer"] });
  await addMember(db, lc, u.a, { department: "Outgoing Global Volunteer" });
  await addMember(db, lc, u.b, { department: "Outgoing Global Volunteer" });
  await addMember(db, lc, u.c, { department: "Outgoing Global Talent/Teacher" });
  await addMember(db, lc, u.m, { department: "Marketing" });
  for (const [who, score] of [["a", 4], ["b", 3], ["c", 5], ["m", 2]] as const) {
    await db.query(`insert into checkins (user_id, project_id, period_start, scores) values ($1, $2, checkin_period_start($2, now()), $3::jsonb)`,
      [u[who], lc.id, JSON.stringify([{ questionId: "energy", score }])]);
  }
}, 60_000);

type Row = { area: string; period_start: string; avg_score: string | null; respondent_count: number | null; suppressed: boolean };
const latest = (rows: Row[], area: string) => rows.filter((r) => r.area === area).sort((x, y) => new Date(x.period_start).getTime() - new Date(y.period_start).getTime()).at(-1)!;

describe("pulse by area", () => {
  it("pools small departments into Outgoing and keeps Support suppressed", async () => {
    const rows = await asUser(db, u.pres, async (tx) => (await tx.query<Row>("select * from get_area_pulse($1)", [lc.id])).rows);
    expect(latest(rows, "outgoing")).toMatchObject({ suppressed: false, respondent_count: 3, avg_score: "4.00" });
    expect(latest(rows, "support")).toMatchObject({ suppressed: true, avg_score: null, respondent_count: null });
  });

  it("is for the president only", async () => {
    expect(await asUser(db, u.vp, async (tx) => (await tx.query("select * from get_area_pulse($1)", [lc.id])).rows)).toEqual([]);
  });
});
