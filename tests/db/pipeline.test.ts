// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const OGV = "Outgoing Global Volunteer";
const IGV = "Incoming Global Volunteer";
const MKT = "Marketing";

async function addExchange(as: string, product: string, person: string, stage = "signed_up"): Promise<string> {
  return asUserCommit(db, u[as], async () => (await db.query<{ id: string }>(
    "insert into exchanges (project_id, product, person_name, stage, created_by) values ($1, $2, $3, $4, $5) returning id",
    [lc.id, product, person, stage, u[as]],
  )).rows[0].id);
}

const visibleTo = (who: string) => asUser(db, u[who], async (tx) =>
  (await tx.query<{ person_name: string }>("select person_name from exchanges order by person_name")).rows.map((r) => r.person_name));

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "olga", "ian", "mia", "otto", "ines", "mark"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.olga, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.ian, { role: "vp", leads: [IGV] });
  await addMember(db, lc, u.mia, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.otto, { department: OGV });
  await addMember(db, lc, u.ines, { department: IGV });
  await addMember(db, lc, u.mark, { department: MKT });

  await addExchange("otto", "ogv", "Ana (oGV)", "approved");
  await addExchange("olga", "ogv", "Ben (oGV)");
  await addExchange("ines", "igv", "Chen (iGV)", "realized");
}, 60_000);

describe("exchanges", () => {
  it("are filed under the department that runs the product", async () => {
    const { rows } = await db.query<{ product: string; department_id: string }>("select product, department_id from exchanges");
    expect(rows.find((r) => r.product === "ogv")?.department_id).toBe(lc.departments[OGV]);
    expect(rows.find((r) => r.product === "igv")?.department_id).toBe(lc.departments[IGV]);
  });

  it("date every stage up to the one reached", async () => {
    const { rows } = await db.query<{ applied_at: string | null; accepted_at: string | null; approved_at: string | null; realized_at: string | null }>(
      "select applied_at, accepted_at, approved_at, realized_at from exchanges where person_name = 'Ana (oGV)'");
    expect(rows[0].applied_at && rows[0].accepted_at && rows[0].approved_at).toBeTruthy();
    expect(rows[0].realized_at).toBeNull();
  });

  it("are visible only to their department, its VP and the president", async () => {
    expect(await visibleTo("otto")).toEqual(["Ana (oGV)", "Ben (oGV)"]);
    expect(await visibleTo("olga")).toEqual(["Ana (oGV)", "Ben (oGV)"]);
    expect(await visibleTo("ines")).toEqual(["Chen (iGV)"]);
    expect(await visibleTo("mark")).toEqual([]);
    expect(await visibleTo("mia")).toEqual([]);
    expect(await visibleTo("pres")).toEqual(["Ana (oGV)", "Ben (oGV)", "Chen (iGV)"]);
  });

  it("can't be added for a product your department doesn't run", async () => {
    await expect(asUser(db, u.mark, (tx) => tx.query(
      "insert into exchanges (project_id, product, person_name, created_by) values ($1, 'ogv', 'x', $2)", [lc.id, u.mark],
    ))).rejects.toThrow(/row-level security/);
  });
});

describe("goals", () => {
  beforeAll(async () => {
    await db.query(
      `insert into goals (project_id, department_id, title, metric, product, stage, target, starts_on, ends_on, created_by)
       values ($1, $2, 'oGV approvals', 'pipeline', 'ogv', 'approved', 10, current_date - 30, current_date + 30, $3),
              ($1, null, 'Members recruited', 'manual', null, null, 20, current_date - 30, current_date + 30, $3)`,
      [lc.id, lc.departments[OGV], u.pres]);
    await db.query("update goals set current_value = 7 where title = 'Members recruited'");
  });

  it("count pipeline progress, and members see it without seeing the exchanges", async () => {
    const progress = await asUser(db, u.mark, async (tx) =>
      (await tx.query<{ title: string; current: string }>(
        "select g.title, p.current from goal_progress($1) p join goals g on g.id = p.goal_id order by g.title", [lc.id])).rows);
    expect(progress.map((p) => [p.title, Number(p.current)])).toEqual([["Members recruited", 7], ["oGV approvals", 1]]);
  });

  it("can be managed by the department's VP but not by other VPs or members", async () => {
    const edit = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query("update goals set target = 12 where title = 'oGV approvals' returning id")).rows.length);
    expect(await edit("olga")).toBe(1);
    expect(await edit("mia")).toBe(0);
    expect(await edit("otto")).toBe(0);
    await expect(asUser(db, u.otto, (tx) => tx.query(
      `insert into goals (project_id, title, metric, target, starts_on, ends_on) values ($1, 'x', 'manual', 1, current_date, current_date)`, [lc.id],
    ))).rejects.toThrow(/row-level security/);
  });

  it("outsiders get no progress at all", async () => {
    const stranger = await createUser(db, "stranger");
    const rows = await asUser(db, stranger, async (tx) => (await tx.query("select * from goal_progress($1)", [lc.id])).rows);
    expect(rows).toEqual([]);
  });
});

describe("EXPA import and the Completed stage", () => {
  type Result = { inserted: number; updated: number; failed: number; errors: string[] };
  const importAs = (who: string, product: string, rows: object[]) => asUserCommit(db, u[who], async () =>
    (await db.query<Result>("select * from import_exchanges($1, $2, $3)", [lc.id, product, JSON.stringify(rows)])).rows[0]);

  it("inserts new applications and fills missing earlier dates from the later ones", async () => {
    const res = await importAs("otto", "ogv", [
      { expa_id: "A-100", person_name: "Dora", stage: "approved", approved_at: "2026-03-10" },
      { expa_id: "A-101", person_name: "Eli", stage: "applied", applied_at: "2026-03-01" },
    ]);
    expect(res).toMatchObject({ inserted: 2, updated: 0, failed: 0 });
    const { rows } = await db.query<{ signed_up_at: string; applied_at: string; accepted_at: string }>(
      "select signed_up_at::text, applied_at::text, accepted_at::text from exchanges where expa_id = 'A-100'");
    expect(rows[0]).toEqual({ signed_up_at: "2026-03-10", applied_at: "2026-03-10", accepted_at: "2026-03-10" });
  });

  it("re-importing the same EXPA ID updates instead of duplicating", async () => {
    const res = await importAs("olga", "ogv", [{ expa_id: "A-100", stage: "completed", realized_at: "2026-06-01" }]);
    expect(res).toMatchObject({ inserted: 0, updated: 1, failed: 0 });
    const { rows } = await db.query<{ n: number; stage: string; completed_at: string | null; finished_at: string | null }>(
      "select count(*) over ()::int as n, stage, completed_at::text, finished_at::text from exchanges where expa_id = 'A-100'");
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe("completed");
    expect(rows[0].completed_at && rows[0].finished_at).toBeTruthy();
  });

  it("reports rows the person may not write instead of dropping them silently", async () => {
    const res = await importAs("mark", "igv", [{ expa_id: "B-1", person_name: "Fay", stage: "applied" }]);
    expect(res.inserted).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toMatch(/^Fay: /);
  });
});
