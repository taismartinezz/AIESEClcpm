// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc1: Lc;
let lc2: Lc;
const u: Record<string, string> = {};
let mcId: string;
let codes: { member_code: string; lc_code: string };

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["mcp", "mcvp", "pres1", "pres2", "olga", "nobody"]) u[n] = await createUser(db, n);
  lc1 = await createLc(db, u.pres1, "LC Lisbon");
  lc2 = await createLc(db, u.pres2, "LC Porto");
  await addMember(db, lc1, u.olga, { role: "vp", leads: ["Outgoing Global Volunteer"] });
  await asUserCommit(db, u.olga, () => db.query(
    "insert into exchanges (project_id, product, person_name, stage, approved_at, created_by) values ($1, 'ogv', 'Secret Name', 'approved', current_date, $2)", [lc1.id, u.olga]));
}, 60_000);

describe("MC", () => {
  it("is created by its MCP, who sees both codes", async () => {
    mcId = await asUserCommit(db, u.mcp, async () => (await db.query<{ create_mc: string }>("select create_mc('AIESEC in Portugal')")).rows[0].create_mc);
    codes = await asUser(db, u.mcp, async (tx) => (await tx.query<{ member_code: string; lc_code: string }>("select member_code, lc_code from mcs")).rows[0]);
    expect(codes.member_code).toMatch(/^[0-9A-F]{8}$/);
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query("select * from mcs")).rows)).toEqual([]);
  });

  it("only an LC's president links it, with the LC code", async () => {
    await expect(asUser(db, u.olga, (tx) => tx.query("select link_lc_to_mc($1, $2)", [lc1.id, codes.lc_code]))).rejects.toThrow(/Only the LC president/);
    await expect(asUser(db, u.pres1, (tx) => tx.query("select link_lc_to_mc($1, $2)", [lc1.id, codes.member_code]))).rejects.toThrow(/Invalid MC code/);
    await asUserCommit(db, u.pres1, () => db.query("select link_lc_to_mc($1, $2)", [lc1.id, codes.lc_code]));
    await asUserCommit(db, u.pres2, () => db.query("select link_lc_to_mc($1, $2)", [lc2.id, codes.lc_code]));
  });

  it("MC members get counts per LC and product, and nothing from inside the LCs", async () => {
    await asUserCommit(db, u.mcvp, () => db.query("select join_mc($1)", [codes.member_code]));
    const rows = await asUser(db, u.mcvp, async (tx) => (await tx.query<{ lc_name: string; product: string; approved: number; members: number }>(
      "select lc_name, product, approved, members from mc_dashboard($1) where product = 'ogv'", [mcId])).rows);
    expect(rows).toEqual([{ lc_name: "LC Lisbon", product: "ogv", approved: 1, members: 2 }, { lc_name: "LC Porto", product: "ogv", approved: 0, members: 1 }]);
    const leaked = await asUser(db, u.mcvp, async (tx) => ({
      exchanges: (await tx.query("select * from exchanges")).rows.length,
      tasks: (await tx.query("select * from tasks")).rows.length,
    }));
    expect(leaked).toEqual({ exchanges: 0, tasks: 0 });
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query("select * from mc_dashboard($1)", [mcId])).rows)).toEqual([]);
  });

  it("only the MCP removes an LC", async () => {
    await expect(asUser(db, u.mcvp, (tx) => tx.query("select unlink_lc_from_mc($1)", [lc2.id]))).rejects.toThrow(/Only the MCP/);
    await asUser(db, u.mcp, (tx) => tx.query("select unlink_lc_from_mc($1)", [lc2.id]));
  });
});
