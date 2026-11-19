// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser, type Tx } from "./harness";
import { createUser, createLc, asUserCommit } from "./fixtures";

// MC US: Max is MCP, Val its VP Finance, Mona an MC member. Pres runs an LC in
// the US. MC PT (Pia is its MCP) is another MC.

let db: PGlite;
let mc: string;
let otherMc: string;
let line: string;
const u: Record<string, string> = {};
const tries = async (fn: () => Promise<unknown>) => { try { await fn(); return "ok"; } catch { return "refused"; } };
const addLine = (tx: Tx, code: string, extra: { parent?: string; mc?: string; fy?: number } = {}) => tx.query<{ id: string }>(
  "insert into mc_budget_lines (mc_id, fy_start, code, name, parent_id, budget) values ($1, $2, $3, 'Line', $4, 1000) returning id",
  [extra.mc ?? mc, extra.fy ?? 2026, code, extra.parent ?? null]);
const pay = (tx: Tx, lineId: string, paidOn = "2026-10-03", tags: string[] = []) => tx.query<{ id: string; mc_id: string; tags: string[] }>(
  "insert into mc_budget_payments (line_id, mc_id, paid_on, amount, description, tags) values ($1, $2, $3, 250, 'Hotel deposit', $4) returning id, mc_id, tags",
  [lineId, mc, paidOn, tags]);

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["max", "val", "mona", "pres", "pia", "out"]) u[n] = await createUser(db, n);
  mc = await asUserCommit(db, u.max, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in the United States', 'US') as id")).rows[0].id);
  otherMc = await asUserCommit(db, u.pia, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Portugal', 'PT') as id")).rows[0].id);
  await db.query("insert into mc_members (mc_id, user_id, role) values ($1, $2, 'member')", [mc, u.mona]);
  const lc = await createLc(db, u.pres, "AIESEC in Chicago");
  await db.query("update projects set mc_id = $1 where id = $2", [mc, lc.id]);
}, 60_000);

describe("the MC budget", () => {
  it("before there's a VP Finance, the MCP keeps it", async () => {
    line = await asUserCommit(db, u.max, async () => (await addLine(db as unknown as Tx, "6300")).rows[0].id);
    expect(line).toBeTruthy();
  });

  it("once there's a VP Finance, only they keep it; the MCP reads", async () => {
    await db.query("insert into mc_members (mc_id, user_id, role) values ($1, $2, 'vp_finance')", [mc, u.val]);
    expect(await tries(() => asUser(db, u.max, (tx) => addLine(tx, "6304")))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6304")))).toBe("ok");
    const edited = await asUser(db, u.max, async (tx) => (await tx.query("update mc_budget_lines set budget = 1 where id = $1 returning id", [line])).rows.length);
    expect(edited).toBe(0);
    for (const who of ["max", "val"]) {
      expect(await asUser(db, u[who], async (tx) => (await tx.query("select id from mc_budget_lines where mc_id = $1", [mc])).rows.length)).toBe(1);
    }
  });

  it("other MC members, LCs, other MCs and outsiders see and change nothing", async () => {
    await asUserCommit(db, u.val, () => pay(db as unknown as Tx, line));
    for (const who of ["mona", "pres", "pia", "out"]) {
      const seen = await asUser(db, u[who], async (tx) => [
        (await tx.query("select id from mc_budget_lines")).rows.length,
        (await tx.query("select id from mc_budget_payments")).rows.length,
        (await tx.query("update mc_budget_payments set amount = 1 returning id")).rows.length,
        (await tx.query("delete from mc_budget_lines returning id")).rows.length,
      ]);
      expect(seen, who).toEqual([0, 0, 0, 0]);
      expect(await tries(() => asUser(db, u[who], (tx) => addLine(tx, "9999")))).toBe("refused");
      expect(await tries(() => asUser(db, u[who], (tx) => pay(tx, line)))).toBe("refused");
    }
    expect(await tries(() => asUser(db, null, (tx) => tx.query("select id from mc_budget_lines")))).toBe("refused");
  });

  it("the VP Finance can't write another MC's budget", async () => {
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6300", { mc: otherMc })))).toBe("refused");
  });

  it("a line has many payments; each takes its line's MC, and tags are tidied", async () => {
    const row = await asUser(db, u.val, async (tx) => {
      await pay(tx, line, "2026-11-20", ["FallCo 2026"]);
      // The client sends another MC: the line decides.
      return (await tx.query<{ mc_id: string; tags: string[] }>(
        "insert into mc_budget_payments (line_id, mc_id, paid_on, amount, description, tags) values ($1, $2, '2026-12-01', 80, 'Taxi', array[' FallCo 2026 ', 'FallCo 2026', '', 'Travel']) returning mc_id, tags",
        [line, otherMc])).rows[0];
    });
    expect(row.mc_id).toBe(mc);
    expect(row.tags).toEqual(["FallCo 2026", "Travel"]);
  });

  it("a payment's date falls inside the line's budget year", async () => {
    expect(await tries(() => asUser(db, u.val, (tx) => pay(tx, line, "2026-06-30")))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => pay(tx, line, "2027-07-01")))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => pay(tx, line, "2027-06-30")))).toBe("ok");
  });

  it("sub-lines go one level deep, under a line of the same year", async () => {
    const sub = await asUserCommit(db, u.val, async () => (await addLine(db as unknown as Tx, "6300-01", { parent: line })).rows[0].id);
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6300-01-a", { parent: sub })))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6300-02", { parent: line, fy: 2027 })))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => tx.query("update mc_budget_lines set parent_id = $1 where id = $2", [sub, line])))).toBe("refused");
  });

  it("codes are unique per MC and year", async () => {
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6300")))).toBe("refused");
    expect(await tries(() => asUser(db, u.val, (tx) => addLine(tx, "6300", { fy: 2027 })))).toBe("ok");
  });
});
