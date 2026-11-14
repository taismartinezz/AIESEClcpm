// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let linked: Lc;
let unlinked: Lc;
let mcId: string;
const u: Record<string, string> = {};
const OGV = "Outgoing Global Volunteer";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["mcp", "mcvp", "pres", "pres2", "olga", "nobody"]) u[n] = await createUser(db, n);
  linked = await createLc(db, u.pres, "AIESEC in Lisbon");
  unlinked = await createLc(db, u.pres2, "AIESEC in Porto");
  await addMember(db, linked, u.olga, { role: "vp", leads: [OGV] });
  mcId = await asUserCommit(db, u.mcp, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Portugal', 'PT') as id")).rows[0].id);
  const { rows } = await db.query<{ member_code: string; lc_code: string }>("select member_code, lc_code from mcs where id = $1", [mcId]);
  await asUserCommit(db, u.mcvp, () => db.query("select join_mc($1)", [rows[0].member_code]));
  await asUserCommit(db, u.pres, () => db.query("select link_lc_to_mc($1, $2)", [linked.id, rows[0].lc_code]));
  // Pipeline: one approved today, one approved 90 days ago and still not realized, one from EXPA.
  await asUserCommit(db, u.olga, async () => {
    await db.query("insert into exchanges (project_id, product, person_name, stage, approved_at, created_by) values ($1, 'ogv', 'Secret A', 'approved', current_date, $2)", [linked.id, u.olga]);
    await db.query("insert into exchanges (project_id, product, person_name, stage, approved_at, created_by) values ($1, 'ogv', 'Secret B', 'approved', current_date - 90, $2)", [linked.id, u.olga]);
    await db.query("insert into exchanges (project_id, product, person_name, expa_id, created_by) values ($1, 'ogv', 'Secret C', '123', $2)", [linked.id, u.olga]);
  });
}, 60_000);

const setTarget = (who: string, project: string, target: number) => asUserCommit(db, u[who], () => db.query(
  "insert into mc_lc_targets (mc_id, project_id, product, metric, term_start, target) values ($1, $2, 'ogv', 'approved', mc_term_start($1), $3) on conflict (mc_id, project_id, product, metric, term_start) do update set target = excluded.target",
  [mcId, project, target]));

describe("MC targets", () => {
  it("any MC member sets an LC's target, only for LCs linked to the MC", async () => {
    await setTarget("mcvp", linked.id, 30);
    await setTarget("mcp", linked.id, 40);                                     // changed
    await expect(setTarget("mcp", unlinked.id, 10)).rejects.toThrow();         // not linked
    await expect(setTarget("pres", linked.id, 1)).rejects.toThrow();           // LCs don't set their own
  });

  it("are read by the MC and by that LC's president and VPs only", async () => {
    const read = (who: string) => asUser(db, u[who], async (tx) => (await tx.query<{ target: number }>("select target from mc_lc_targets")).rows.map((r) => r.target));
    expect(await read("mcvp")).toEqual([40]);
    expect(await read("pres")).toEqual([40]);
    expect(await read("pres2")).toEqual([]);
    expect(await read("olga")).toEqual([40]);                                 // a VP of that LC

    expect(await read("nobody")).toEqual([]);
  });
});

describe("LC health for the MC", () => {
  it("does not expose the deprecated health detail RPC to app roles", async () => {
    for (const who of ["mcp", "mcvp", "pres", "nobody"]) await expect(asUser(db, u[who], tx => tx.query("select * from mc_lc_health($1)", [mcId]))).rejects.toThrow(/permission denied/);
  });

  it("mc_term_start follows the MC's term start, or the latest 1 February", async () => {
    const { rows } = await asUser(db, u.mcp, async (tx) => tx.query<{ d: string }>("select mc_term_start($1)::text as d", [mcId]));
    expect(rows[0].d).toMatch(/^\d{4}-02-01$/);
    await db.query("update mcs set term_start = '2026-07-01' where id = $1", [mcId]);
    const again = await asUser(db, u.mcp, async (tx) => tx.query<{ d: string }>("select mc_term_start($1)::text as d", [mcId]));
    expect(again.rows[0].d).toBe("2026-07-01");
    await db.query("update mcs set term_start = null where id = $1", [mcId]);
  });
});

describe("LC insights for the MC", () => {
  it("does not expose the deprecated team insight RPC to app roles", async () => {
    for (const who of ["mcp", "mcvp", "pres", "nobody"]) await expect(asUser(db, u[who], tx => tx.query("select * from mc_lc_insights($1)", [mcId]))).rejects.toThrow(/permission denied/);
  });
});

describe("MC messages", () => {
  const send = (who: string, body: string, project: string | null = null, kind = "announcement") => asUserCommit(db, u[who], () => db.query(
    "insert into mc_messages (mc_id, project_id, kind, body, created_by) values ($1, $2, $3, $4, $5)", [mcId, project, kind, body, u[who]]));
  const inbox = (who: string) => asUser(db, u[who], async (tx) => (await tx.query<{ body: string }>("select body from mc_messages order by created_at")).rows.map((r) => r.body));

  it("go from MC members to every linked LC, or to one, and members of those LCs read them", async () => {
    await send("mcvp", "National targets are set");
    await send("mcp", "Please update your pipeline", linked.id, "nudge");
    expect(await inbox("olga")).toEqual(["National targets are set", "Please update your pipeline"]);   // in the linked LC
    expect(await inbox("pres2")).toEqual([]);                                                            // LC not linked
    expect(await inbox("nobody")).toEqual([]);
    expect(await inbox("mcvp")).toHaveLength(2);
  });

  it("can't be sent by LCs or to LCs outside the MC", async () => {
    await expect(send("pres", "From an LC")).rejects.toThrow();
    await expect(send("mcp", "To Porto", unlinked.id)).rejects.toThrow();
  });

  it("lc_national tells an LC's members their MC and its term", async () => {
    const { rows } = await asUser(db, u.olga, async (tx) => tx.query<{ mc_name: string; term_start: string }>("select mc_name, term_start::text from lc_national($1)", [linked.id]));
    expect(rows[0].mc_name).toBe("AIESEC in Portugal");
    expect(rows[0].term_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await asUser(db, u.nobody, async (tx) => (await tx.query("select * from lc_national($1)", [linked.id])).rows)).toEqual([]);
  });
});
