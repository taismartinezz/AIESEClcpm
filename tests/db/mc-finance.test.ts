// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser, type Tx } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

// LC with its president and Fiona (VP Finance & Legality, the LC's finance lead)
// and Vera (VP Marketing). Linked to an MC: Max is MCP, Val its VP Finance,
// Mona a plain MC member.

let db: PGlite;
let lc: Lc;
let mc: string;
const u: Record<string, string> = {};

const add = (tx: Tx, who: string, account: string, amount = 100, type = "income") => tx.query(
  `insert into finance_entries (project_id, type, amount, currency, recorded_by, description, account)
   values ($1, $2, $3, 'USD', $4, 'Entry', $5) returning id`, [lc.id, type, amount, u[who], account]);
const tries = async (fn: () => Promise<unknown>) => { try { await fn(); return "ok"; } catch { return "refused"; } };

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "fiona", "vera", "max", "val", "mona"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres, "AIESEC in Northwestern");
  await addMember(db, lc, u.fiona, { role: "vp", leads: ["Finance & Legality"] });
  await addMember(db, lc, u.vera, { role: "vp", leads: ["Marketing"] });
  mc = await asUserCommit(db, u.max, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in the United States', 'US') as id")).rows[0].id);
  const codes = (await db.query<{ member_code: string; lc_code: string }>("select member_code, lc_code from mcs where id = $1", [mc])).rows[0];
  for (const who of ["val", "mona"]) await asUserCommit(db, u[who], () => db.query("select join_mc($1)", [codes.member_code]));
  await asUserCommit(db, u.max, () => db.query("select set_mc_member_role($1, $2, 'vp_finance')", [mc, u.val]));
  await asUserCommit(db, u.pres, () => db.query("select link_lc_to_mc($1, $2)", [lc.id, codes.lc_code]));
  await asUserCommit(db, u.val, () => add(db as unknown as Tx, "val", "lc", 1401.16));
}, 60_000);

describe("LC account", () => {
  it("existing and new entries are LC account entries unless said otherwise", async () => {
    expect((await db.query<{ account: string }>("select account from finance_entries where project_id = $1", [lc.id])).rows.map((r) => r.account)).toEqual(["lc"]);
  });

  it("only the MC VP Finance writes it; the LC and the MCP don't", async () => {
    for (const who of ["pres", "fiona", "max"]) {
      expect(await tries(() => asUser(db, u[who], (tx) => add(tx, who, "lc")))).toBe("refused");
    }
    expect(await tries(() => asUser(db, u.val, (tx) => add(tx, "val", "lc")))).toBe("ok");
  });
});

describe("university account", () => {
  it("is off until the LC's finance lead (or the MC VP Finance) turns it on", async () => {
    expect(await tries(() => asUser(db, u.fiona, (tx) => add(tx, "fiona", "university")))).toBe("refused");
    await expect(asUser(db, u.vera, (tx) => tx.query("select set_university_account($1, true)", [lc.id]))).rejects.toThrow(/finance lead or the MC VP Finance/);
    await expect(asUser(db, u.max, (tx) => tx.query("select set_university_account($1, true)", [lc.id]))).rejects.toThrow(/finance lead or the MC VP Finance/);
    await asUserCommit(db, u.fiona, () => db.query("select set_university_account($1, true)", [lc.id]));
    expect((await db.query<{ on: boolean }>("select has_university_account as on from projects where id = $1", [lc.id])).rows[0].on).toBe(true);
  });

  it("the LC's finance lead and the MC VP Finance record it; other VPs and the MCP don't", async () => {
    expect(await tries(() => asUser(db, u.fiona, (tx) => add(tx, "fiona", "university")))).toBe("ok");
    expect(await tries(() => asUser(db, u.pres, (tx) => add(tx, "pres", "university")))).toBe("ok");
    expect(await tries(() => asUser(db, u.val, (tx) => add(tx, "val", "university")))).toBe("ok");
    expect(await tries(() => asUser(db, u.vera, (tx) => add(tx, "vera", "university")))).toBe("refused");
    expect(await tries(() => asUser(db, u.max, (tx) => add(tx, "max", "university")))).toBe("refused");
  });

  it("the LC can't move a university entry into the LC account", async () => {
    const id = await asUserCommit(db, u.fiona, async () => (await add(db as unknown as Tx, "fiona", "university", 1117.43)).rows[0] as { id: string });
    const moved = await asUser(db, u.fiona, async (tx) => {
      try { return (await tx.query("update finance_entries set account = 'lc' where id = $1 returning id", [id.id])).rows.length; } catch { return "refused"; }
    });
    expect(moved === 0 || moved === "refused").toBe(true);
    expect((await db.query<{ account: string }>("select account from finance_entries where id = $1", [id.id])).rows[0].account).toBe("university");
  });

  it("turning it off keeps the entries but stops the LC writing", async () => {
    await asUserCommit(db, u.fiona, () => db.query("select set_university_account($1, false)", [lc.id]));
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from finance_entries where project_id = $1 and account = 'university'", [lc.id])).rows[0].n)).toBe(1);
    expect(await tries(() => asUser(db, u.fiona, (tx) => add(tx, "fiona", "university")))).toBe("refused");
    await asUserCommit(db, u.fiona, () => db.query("select set_university_account($1, true)", [lc.id]));
  });
});

describe("the MC's finance view", () => {
  it("the MCP and the VP Finance read every account; other MC members read nothing", async () => {
    const read = (who: string) => asUser(db, u[who], async (tx) => (await tx.query<{ account: string }>("select account from finance_entries where project_id = $1", [lc.id])).rows.length);
    expect(await read("max")).toBe(2);
    expect(await read("val")).toBe(2);
    expect(await read("mona")).toBe(0);
  });

  it("mc_finance_lcs lists the linked LCs for the MCP and VP Finance only", async () => {
    const list = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query<{ name: string; has_university_account: boolean; term_start_date: string | null }>("select name, has_university_account, term_start_date from mc_finance_lcs($1)", [mc])).rows);
    const forMax = await list("max");
    expect(forMax.map((r) => [r.name, r.has_university_account])).toEqual([["AIESEC in Northwestern", true]]);
    expect(forMax[0].term_start_date).not.toBeNull();       // falls back to the MC's term
    expect(await list("val")).toHaveLength(1);
    expect(await list("mona")).toEqual([]);
    expect(await list("fiona")).toEqual([]);
  });

  it("the change log records which account an entry was in", async () => {
    const logged = (await db.query<{ account: string }>(
      "select new_values ->> 'account' as account from finance_entry_changes where project_id = $1 and op = 'insert' order by changed_at", [lc.id])).rows.map((r) => r.account);
    expect(logged).toContain("university");
  });
});
