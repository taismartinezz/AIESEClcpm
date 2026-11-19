// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "vp", "mem"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres, "AIESEC in Lisbon");
  await addMember(db, lc, u.vp, { role: "vp", leads: ["Outgoing Global Volunteer"] });
  await addMember(db, lc, u.mem, { department: "Marketing" });
  // The books (as the service role): an opening balance, income, an expense.
  await db.query(`insert into finance_entries (project_id, type, amount, currency, description) values
    ($1, 'opening', 100, 'USD', 'Opening'), ($1, 'income', 50, 'USD', 'Fees'), ($1, 'expense', 30, 'USD', 'Venue')`, [lc.id]);
  await db.query(`insert into exchanges (project_id, product, person_name, stage, approved_at) values
    ($1, 'ogv', 'A', 'approved', current_date - 10), ($1, 'ogta', 'B', 'approved', current_date - 400), ($1, 'igv', 'C', 'approved', current_date - 5)`, [lc.id]);
  const { rows } = await db.query<{ id: string }>("insert into partners (project_id, name, stage) values ($1, 'Demo Bank', 'meeting') returning id", [lc.id]);
  await db.query(`insert into partner_activities (partner_id, kind, body, happened_on) values ($1, 'meeting', 'Intro', current_date - 20), ($1, 'call', 'Follow-up', current_date - 10)`, [rows[0].id]);
}, 60_000);

describe("membership criteria", () => {
  it("come in one call for the LCP: balance, approvals, meetings and what they set", async () => {
    await asUserCommit(db, u.pres, () => db.query("insert into lc_compliance_info (project_id, boa_members, university_affiliated) values ($1, 2, true)", [lc.id]));
    await asUserCommit(db, u.vp, () => db.query("insert into lc_compliance_checks (project_id, kind, month, done_on) values ($1, 'sona', '2026-11-01', '2026-10-31')", [lc.id]));
    const r = await asUser(db, u.pres, async (tx) => (await tx.query<Record<string, unknown>>("select * from lc_compliance($1)", [lc.id])).rows[0]);
    expect(await asUser(db, u.vp, async tx => (await tx.query("select * from lc_compliance($1)", [lc.id])).rows)).toEqual([]);
    expect(Number(r.balance)).toBe(120);                  // the opening balance adds, the expense subtracts
    expect(r.approvals_12m).toBe(1);                      // outgoing, last 12 months only
    expect(r.meetings_12m).toBe(1);
    expect(r).toMatchObject({ boa_members: 2, university_affiliated: true });
    expect(r.checks).toEqual([{ kind: "sona", month: "2026-11-01", done_on: "2026-10-31" }]);
  });

  it("are not for members, who can't set them either", async () => {
    expect(await asUser(db, u.mem, async (tx) => (await tx.query("select * from lc_compliance($1)", [lc.id])).rows)).toEqual([]);
    await expect(asUser(db, u.mem, (tx) => tx.query("insert into lc_compliance_checks (project_id, kind, month) values ($1, 'hr_report', '2026-11-01')", [lc.id]))).rejects.toThrow();
  });
});
