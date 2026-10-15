// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
type Result = { inserted: number; updated: number; failed: number; errors: string[] };

const run = (who: string, fn: string, rows: object[]) => asUserCommit(db, u[who], async () =>
  (await db.query<Result>(`select * from ${fn}($1, $2)`, [lc.id, JSON.stringify(rows)])).rows[0]);

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "bea", "bob", "mo"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.bea, { role: "vp", leads: ["Business Development"] });
  await addMember(db, lc, u.bob, { department: "Business Development" });
  await addMember(db, lc, u.mo, { department: "Marketing" });
}, 60_000);

describe("tracker import", () => {
  it("partners: inserts, adds the contact once, and updates on re-import", async () => {
    const row = { name: "Demo Bank", stage: "meeting", department_id: lc.departments["Business Development"], contact_name: "Rita", contact_email: "rita@bank.example" };
    expect(await run("bob", "import_partners", [row, { name: "" }])).toMatchObject({ inserted: 1, updated: 0, failed: 1 });
    expect(await run("bob", "import_partners", [{ ...row, name: "demo bank", stage: "proposal" }])).toMatchObject({ inserted: 0, updated: 1 });
    const { rows } = await db.query("select p.stage, count(c.*)::int as contacts from partners p left join partner_contacts c on c.partner_id = p.id group by p.stage");
    expect(rows).toEqual([{ stage: "proposal", contacts: 1 }]);
  });

  it("partners: a member can't import into another department", async () => {
    const res = await run("mo", "import_partners", [{ name: "Print Shop", department_id: lc.departments["Business Development"] }]);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toMatch(/can't add partners for that department/);
  });

  it("recruits: exec only, matched by email", async () => {
    expect(await run("bea", "import_recruits", [{ name: "Ana", email: "ANA@x.example", source: "Tabling" }])).toMatchObject({ inserted: 1 });
    expect(await run("bea", "import_recruits", [{ name: "Ana Silva", email: "ana@x.example", stage: "interview" }])).toMatchObject({ updated: 1 });
    expect((await run("bob", "import_recruits", [{ name: "Zed" }])).errors[0]).toMatch(/only the exec board/);
  });

  it("tasks: inserts with assignees and leaves an identical task alone", async () => {
    const rows = [{ title: "Print posters", due_date: "2026-11-01", status: "in_progress", assignee_ids: [u.mo] }];
    expect(await run("mo", "import_tasks", rows)).toMatchObject({ inserted: 1, updated: 0 });
    expect(await run("mo", "import_tasks", rows)).toMatchObject({ inserted: 0, updated: 1 });
    const { rows: a } = await db.query("select user_id from task_assignees ta join tasks t on t.id = ta.task_id where t.title = 'Print posters'");
    expect(a).toEqual([{ user_id: u.mo }]);
  });
});
