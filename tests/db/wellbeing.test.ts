// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, type Lc } from "./fixtures";

// Scenario: one LC.
//   Marketing (VP Vera):  3 members  → above threshold (3)
//   oGV       (VP Omar):  2 members  → below threshold → suppressed
//   Exec board: Vera, Omar, Kai (3 VPs) → above exec threshold
// Everyone, including the president, submits a check-in this week.

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};

const MKT = "Marketing";
const OGV = "Outgoing Global Volunteer";

async function checkIn(userId: string, scores: Record<string, number>, weeksAgo = 0) {
  await db.query(
    `insert into journal_entries (user_id, project_id, content, checkin_scores, created_at)
     values ($1, $2, '{}'::jsonb, $3::jsonb, date_trunc('week', now()) - make_interval(weeks => $4) + interval '1 day')`,
    [userId, lc.id, JSON.stringify(Object.entries(scores).map(([questionId, score]) => ({ questionId, score }))), weeksAgo],
  );
}

type MemberRow = { department_id: string | null; week_start: Date; question_id: string | null; avg_score: string | null; respondent_count: number | null; suppressed: boolean };
type ExecRow = Omit<MemberRow, "department_id">;

const memberPulse = (who: string, dept: string | null = null) =>
  asUser(db, who, async (tx) =>
    (await tx.query<MemberRow>("select * from get_member_pulse($1, $2)", [lc.id, dept])).rows);
const execPulse = (who: string) =>
  asUser(db, who, async (tx) => (await tx.query<ExecRow>("select * from get_exec_pulse($1)", [lc.id])).rows);

const weekKey = (d: Date) => new Date(d).toISOString();
const thisWeek = <T extends { week_start: Date }>(rows: T[]): T[] => {
  const latest = rows.map((r) => weekKey(r.week_start)).sort().at(-1);
  return rows.filter((r) => weekKey(r.week_start) === latest);
};

beforeAll(async () => {
  db = await freshDatabase();
  for (const name of ["pres", "vera", "omar", "kai", "m1", "m2", "m3", "g1", "g2", "outsider"]) {
    u[name] = await createUser(db, name);
  }
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.vera, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.omar, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.kai, { role: "vp" });
  for (const m of ["m1", "m2", "m3"]) await addMember(db, lc, u[m], { department: MKT });
  for (const m of ["g1", "g2"]) await addMember(db, lc, u[m], { department: OGV });

  await checkIn(u.pres, { energy: 1, workload: 1 });          // must never count
  await checkIn(u.vera, { energy: 4, workload: 2 });
  await checkIn(u.omar, { energy: 4, workload: 3 });
  await checkIn(u.kai, { energy: 5, workload: 4 });
  await checkIn(u.m1, { energy: 5, workload: 4 });
  await checkIn(u.m2, { energy: 3, workload: 4 });
  await checkIn(u.m3, { energy: 4, workload: 1 });
  await checkIn(u.g1, { energy: 2, workload: 2 });
  await checkIn(u.g2, { energy: 2, workload: 5 });
}, 60_000);

describe("Member Pulse", () => {
  it("the president sees every department plus the whole-LC total", async () => {
    const rows = thisWeek(await memberPulse(u.pres));
    const groups = new Set(rows.map((r) => r.department_id));
    expect(groups.has(null)).toBe(true);
    expect(groups.has(lc.departments[MKT])).toBe(true);
    expect(groups.has(lc.departments[OGV])).toBe(true);

    const mktEnergy = rows.find((r) => r.department_id === lc.departments[MKT] && r.question_id === "energy");
    expect(Number(mktEnergy?.avg_score)).toBe(4);           // (5+3+4)/3
    expect(mktEnergy?.respondent_count).toBe(3);

    const totalEnergy = rows.find((r) => r.department_id === null && r.question_id === "energy");
    expect(Number(totalEnergy?.avg_score)).toBe(3.2);       // members only: (5+3+4+2+2)/5 — no president, no VPs
  });

  it("a VP sees only the departments they lead", async () => {
    const rows = await memberPulse(u.vera);
    expect(new Set(rows.map((r) => r.department_id))).toEqual(new Set([lc.departments[MKT]]));
  });

  it("a VP asking for another department gets nothing", async () => {
    expect(await memberPulse(u.vera, lc.departments[OGV])).toEqual([]);
  });

  it("a VP who leads no department gets nothing", async () => {
    expect(await memberPulse(u.kai)).toEqual([]);
  });

  it("a member gets no pulse data at all", async () => {
    expect(await memberPulse(u.m1)).toEqual([]);
    expect(await memberPulse(u.m1, lc.departments[MKT])).toEqual([]);
  });

  it("someone outside the LC gets nothing", async () => {
    expect(await memberPulse(u.outsider)).toEqual([]);
  });

  it("suppresses a department below the threshold without leaking numbers", async () => {
    const rows = thisWeek(await memberPulse(u.pres, lc.departments[OGV]));
    expect(rows).toEqual([
      expect.objectContaining({ suppressed: true, question_id: null, avg_score: null, respondent_count: null }),
    ]);
  });

  it("returns 8 weeks, with weeks nobody answered suppressed", async () => {
    const rows = await memberPulse(u.vera);
    expect(new Set(rows.map((r) => weekKey(r.week_start))).size).toBe(8);
    expect(rows.filter((r) => r.suppressed)).toHaveLength(7);
  });

  it("the president can lower the department threshold and the department appears", async () => {
    const rows = await asUser(db, u.pres, async (tx) => {
      await tx.query("update projects set min_wellbeing_respondents = 2 where id = $1", [lc.id]);
      return (await tx.query<MemberRow>("select * from get_member_pulse($1, $2)", [lc.id, lc.departments[OGV]])).rows;
    });
    const energy = thisWeek(rows).find((r) => r.question_id === "energy");
    expect(Number(energy?.avg_score)).toBe(2);
  });

  it("thresholds cannot be set below 2", async () => {
    await expect(asUser(db, u.pres, (tx) =>
      tx.query("update projects set min_wellbeing_respondents = 1 where id = $1", [lc.id]),
    )).rejects.toThrow(/check constraint/);
  });

  it("opted-out members are not counted (and can push a group under the threshold)", async () => {
    const rows = await asUser(db, u.m1, async (tx) => {
      await tx.query("insert into user_settings (user_id, wellbeing_opted_in) values ($1, false)", [u.m1]);
      // Same transaction, now asking as Marketing's VP.
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [u.vera]);
      return (await tx.query<MemberRow>("select * from get_member_pulse($1)", [lc.id])).rows;
    });
    expect(thisWeek(rows)).toEqual([expect.objectContaining({ suppressed: true, avg_score: null })]);
  });

  it("questions the president turned off are left out", async () => {
    const rows = await asUser(db, u.pres, async (tx) => {
      await tx.query("update projects set checkin_disabled_questions = '{workload}' where id = $1", [lc.id]);
      return (await tx.query<MemberRow>("select * from get_member_pulse($1, $2)", [lc.id, lc.departments[MKT]])).rows;
    });
    expect(new Set(thisWeek(rows).map((r) => r.question_id))).toEqual(new Set(["energy"]));
  });
});

describe("Exec Pulse", () => {
  it("the president sees the VPs' averages, never their own", async () => {
    const energy = thisWeek(await execPulse(u.pres)).find((r) => r.question_id === "energy");
    expect(Number(energy?.avg_score)).toBeCloseTo(4.33, 2);   // (4+4+5)/3, president's 1 excluded
    expect(energy?.respondent_count).toBe(3);
  });

  it("VPs and members cannot see it", async () => {
    expect(await execPulse(u.vera)).toEqual([]);
    expect(await execPulse(u.m1)).toEqual([]);
  });

  it("is suppressed below the exec threshold", async () => {
    const rows = await asUser(db, u.pres, async (tx) => {
      await tx.query("update projects set min_exec_respondents = 4 where id = $1", [lc.id]);
      return (await tx.query<ExecRow>("select * from get_exec_pulse($1)", [lc.id])).rows;
    });
    expect(thisWeek(rows)).toEqual([expect.objectContaining({ suppressed: true, avg_score: null })]);
  });
});

describe("raw scores stay private", () => {
  it("nobody can read another person's journal entries or scores", async () => {
    const rows = await asUser(db, u.pres, async (tx) =>
      (await tx.query("select id from journal_entries where user_id <> $1", [u.pres])).rows);
    expect(rows).toEqual([]);
  });

  it("the internal scoring function and the old rollups are not callable", async () => {
    await expect(asUser(db, u.pres, (tx) => tx.query("select * from _pulse_scores($1, 'member', 8)", [lc.id])))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.pres, (tx) => tx.query("select * from get_wellbeing_rollup($1)", [lc.id])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("weekly check-in reminder", () => {
  it("exists for VPs and members but not the president", async () => {
    const { rows } = await db.query<{ user_id: string }>(
      "select user_id from reminders where project_id = $1 and kind = 'weekly_checkin'", [lc.id]);
    const owners = new Set(rows.map((r) => r.user_id));
    expect(owners.has(u.vera)).toBe(true);
    expect(owners.has(u.m1)).toBe(true);
    expect(owners.has(u.pres)).toBe(false);
  });

  it("rolls forward a week instead of staying completed", async () => {
    const after = await asUser(db, u.m2, async (tx) => {
      const before = (await tx.query<{ due_at: Date }>(
        "select due_at from reminders where user_id = $1 and kind = 'weekly_checkin'", [u.m2])).rows[0].due_at;
      await tx.query("update reminders set completed = true where user_id = $1 and kind = 'weekly_checkin'", [u.m2]);
      const row = (await tx.query<{ due_at: Date; completed: boolean }>(
        "select due_at, completed from reminders where user_id = $1 and kind = 'weekly_checkin'", [u.m2])).rows[0];
      return { before, ...row };
    });
    expect(after.completed).toBe(false);
    expect(new Date(after.due_at).getTime()).toBeGreaterThan(new Date(after.before).getTime());
  });
});
