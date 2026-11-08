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
  for (const n of ["pres", "vp", "mem", "other"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres, "AIESEC in Lisbon");
  await addMember(db, lc, u.vp, { role: "vp", leads: ["Marketing"] });
  await addMember(db, lc, u.mem, { department: "Marketing" });
}, 60_000);

describe("the LC's plan", () => {
  it("identity and SWOT are written by execs and read by the whole LC", async () => {
    await asUserCommit(db, u.pres, () => db.query("insert into lc_identity (project_id, team_name, values, rules) values ($1, 'Team Blaze', '{Ownership,Care}', '{\"Reply within 24h\"}')", [lc.id]));
    await asUserCommit(db, u.vp, () => db.query("insert into lc_swot (project_id, kind, body, areas) values ($1, 'weakness', 'Few iGTa partners', '{iGX,BD}')", [lc.id]));
    await expect(asUser(db, u.mem, (tx) => tx.query("insert into lc_swot (project_id, kind, body) values ($1, 'strength', 'x')", [lc.id]))).rejects.toThrow();
    const seen = await asUser(db, u.mem, async (tx) => ({
      id: (await tx.query<{ team_name: string; values: string[] }>("select team_name, values from lc_identity")).rows,
      swot: (await tx.query<{ areas: string[] }>("select areas from lc_swot")).rows,
    }));
    expect(seen.id).toEqual([{ team_name: "Team Blaze", values: ["Ownership", "Care"] }]);
    expect(seen.swot[0].areas).toEqual(["iGX", "BD"]);
    expect(await asUser(db, u.other, async (tx) => (await tx.query("select * from lc_identity")).rows)).toEqual([]);
  });

  it("monthly battles have an owner from the LC, who can tick them off", async () => {
    const id = await asUserCommit(db, u.pres, async () => (await db.query<{ id: string }>(
      "insert into lc_battles (project_id, month, title, owner_id) values ($1, '2026-11-01', 'Recruitment week', $2) returning id", [lc.id, u.mem])).rows[0].id);
    await asUserCommit(db, u.mem, () => db.query("update lc_battles set done = true where id = $1", [id]));
    expect((await db.query<{ done: boolean }>("select done from lc_battles where id = $1", [id])).rows[0].done).toBe(true);
    await expect(asUserCommit(db, u.pres, () => db.query("insert into lc_battles (project_id, month, title, owner_id) values ($1, '2026-12-01', 'x', $2)", [lc.id, u.other]))).rejects.toThrow(/owner must be a member/);
    await expect(asUserCommit(db, u.pres, () => db.query("insert into lc_battles (project_id, month, title) values ($1, '2026-12-05', 'x')", [lc.id]))).rejects.toThrow();
  });
});
