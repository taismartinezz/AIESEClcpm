// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";
import { lcNameKey } from "../../src/lib/lcNames";

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
    mcId = await asUserCommit(db, u.mcp, async () => (await db.query<{ create_mc: string }>("select create_mc('AIESEC in Portugal', 'PT')")).rows[0].create_mc);
    codes = await asUser(db, u.mcp, async (tx) => (await tx.query<{ member_code: string; lc_code: string }>("select member_code, lc_code from mcs")).rows[0]);
    expect(codes.member_code).toMatch(/^[0-9A-F]{8}$/);
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query("select * from mcs")).rows)).toEqual([]);
  });

  it("only an LC's president links it, with the LC code", async () => {
    await expect(asUser(db, u.olga, (tx) => tx.query("select link_lc_to_mc($1, $2)", [lc1.id, codes.lc_code]))).rejects.toThrow(/Only the LC president/);
    // The member code in the LC-code box says which code it was.
    await expect(asUser(db, u.pres1, (tx) => tx.query("select link_lc_to_mc($1, $2)", [lc1.id, codes.member_code]))).rejects.toThrow(/That is the MC's member code/);
    await expect(asUser(db, u.pres1, (tx) => tx.query("select link_lc_to_mc($1, 'NOPE1234')", [lc1.id]))).rejects.toThrow(/No MC has that LC code/);
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

  it("setup: a name is required, the country is kept, and a wrong code says which code it was", async () => {
    await expect(asUser(db, u.nobody, (tx) => tx.query("select create_mc('   ', 'ES')"))).rejects.toThrow(/Give the MC a name/);
    await expect(asUser(db, u.nobody, (tx) => tx.query("select create_mc($1, 'ES')", ["x".repeat(81)]))).rejects.toThrow(/under 80/);
    const id = await asUserCommit(db, u.nobody, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Spain', 'es') as id")).rows[0].id);
    expect((await db.query<{ country_code: string }>("select country_code from mcs where id = $1", [id])).rows[0].country_code).toBe("ES");
    await expect(asUser(db, u.pres2, (tx) => tx.query("select join_mc($1)", [codes.lc_code]))).rejects.toThrow(/That is an LC code/);
    await expect(asUser(db, u.pres2, (tx) => tx.query("select join_mc('NOPE1234')"))).rejects.toThrow(/No MC has that member code/);
  });

  it("MC members see which LCs are linked, by name; others see nothing", async () => {
    const linked = await asUser(db, u.mcp, async (tx) => (await tx.query<{ name: string }>("select name from mc_linked_lcs($1)", [mcId])).rows.map((r) => r.name));
    expect(linked).toEqual(["LC Lisbon", "LC Porto"]);
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query("select * from mc_linked_lcs($1)", [mcId])).rows)).toEqual([]);
  });

  it("one MC per country: a second one is refused with a pointer to the first, and the country is required", async () => {
    await expect(asUser(db, u.nobody, (tx) => tx.query("select create_mc('AIESEC Portugal 2', 'pt')"))).rejects.toThrow(/AIESEC in Portugal is already set up\. Ask your MCP for the member code/);
    await expect(asUser(db, u.nobody, (tx) => tx.query("select create_mc('No country')"))).rejects.toThrow(/Pick your MC's country/);
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query<{ n: string | null }>("select mc_in_country('pt') as n")).rows[0].n)).toBe("AIESEC in Portugal");
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query<{ n: string | null }>("select mc_in_country('FR') as n")).rows[0].n)).toBeNull();
    // Even directly, the database won't hold two MCs for one country.
    await expect(db.query("insert into mcs (name, country_code) values ('Dup', 'PT')")).rejects.toThrow(/mcs_one_per_country/);
  });

  it("no two LCs with the same name in a country (ignoring case, accents and filler words)", async () => {
    await db.query("update projects set country_code = 'PT' where id = $1", [lc1.id]);    // "LC Lisbon"
    const pres = await createUser(db, "dup-pres");
    // Created with a country (as onboarding does): refused, pointing to the existing LC.
    await expect(asUserCommit(db, pres, () => db.query("insert into projects (name, owner_id, country_code) values ('AIESEC in Lisbón', $1, 'PT')", [pres])))
      .rejects.toThrow(/LC Lisbon is already set up\. Ask its LCP for an invite/);
    // Given the country later: refused too. The same name in another country is fine.
    const other = await createLc(db, pres, "aiesec Lisbon!");
    await expect(db.query("update projects set country_code = 'PT' where id = $1", [other.id])).rejects.toThrow(/already set up/);
    await db.query("update projects set country_code = 'BR' where id = $1", [other.id]);
    // A different LC in the same country is fine.
    await db.query("update projects set country_code = 'PT', name = 'AIESEC in Coimbra' where id = $1", [other.id]);
    // Editing an LC's own name without changing what it is isn't blocked.
    await db.query("update projects set name = 'LC  Lisbon' where id = $1", [lc1.id]);
  });

  it("lc_name_key gives the same keys as the app's lcNameKey", async () => {
    const names = ["AIESEC in Lisbón!", "aiesec Lisbon", "LC  Lisbon", "AIESEC at Northwestern", "AIESEC en Santo Domingo", "AIESEC in Lisboa", "AIESEC"];
    for (const n of names) {
      const { rows } = await db.query<{ k: string }>("select lc_name_key($1) as k", [n]);
      expect(rows[0].k, n).toBe(lcNameKey(n));
    }
  });
});
