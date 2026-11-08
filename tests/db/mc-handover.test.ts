// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, asUserCommit } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};
let mcId: string;
let memberCode: string;

const roles = async () =>
  Object.fromEntries((await db.query<{ user_id: string; role: string }>("select user_id, role from mc_members where mc_id = $1", [mcId])).rows
    .map((r) => [Object.keys(u).find((k) => u[k] === r.user_id), r.role]));
const handoverTo = async () =>
  (await db.query<{ handover_to: string | null }>("select handover_to from mcs where id = $1", [mcId])).rows[0].handover_to;

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["oldMcp", "nextMcp", "mcvp", "outsider"]) u[n] = await createUser(db, n);
  mcId = await asUserCommit(db, u.oldMcp, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Portugal', 'PT') as id")).rows[0].id);
  memberCode = (await db.query<{ member_code: string }>("select member_code from mcs where id = $1", [mcId])).rows[0].member_code;
  await asUserCommit(db, u.nextMcp, () => db.query("select join_mc($1)", [memberCode]));
  await asUserCommit(db, u.mcvp, () => db.query("select join_mc($1)", [memberCode]));
}, 60_000);

describe("MC handover", () => {
  it("MC members see the team with names and roles; others see nobody", async () => {
    const team = await asUser(db, u.mcvp, async (tx) => (await tx.query<{ name: string; role: string; is_me: boolean }>(
      "select name, role, is_me from mc_team($1)", [mcId])).rows);
    expect(team[0]).toEqual({ name: "oldMcp", role: "mcp", is_me: false });         // the MCP first
    expect(team.map((t) => t.name).sort()).toEqual(["mcvp", "nextMcp", "oldMcp"]);
    expect(team.find((t) => t.name === "mcvp")?.is_me).toBe(true);
    expect(await asUser(db, u.outsider, async (tx) => (await tx.query("select * from mc_team($1)", [mcId])).rows)).toEqual([]);
  });

  it("only the MCP offers it, and only to someone already on the MC", async () => {
    await expect(asUser(db, u.mcvp, (tx) => tx.query("select offer_mcp_handover($1, $2)", [mcId, u.nextMcp]))).rejects.toThrow(/Only the MCP/);
    await expect(asUser(db, u.oldMcp, (tx) => tx.query("select offer_mcp_handover($1, $2)", [mcId, u.outsider]))).rejects.toThrow(/join the MC with the member code first/);
    await expect(asUser(db, u.oldMcp, (tx) => tx.query("select offer_mcp_handover($1, $2)", [mcId, u.oldMcp]))).rejects.toThrow(/already the MCP/);
  });

  it("nothing changes until the next MCP accepts; nobody else can accept it", async () => {
    await asUserCommit(db, u.oldMcp, () => db.query("select offer_mcp_handover($1, $2)", [mcId, u.nextMcp]));
    expect(await handoverTo()).toBe(u.nextMcp);
    expect((await roles()).oldMcp).toBe("mcp");
    const pending = await asUser(db, u.nextMcp, async (tx) => (await tx.query<{ handover_pending: boolean }>(
      "select handover_pending from mc_team($1) where is_me", [mcId])).rows[0].handover_pending);
    expect(pending).toBe(true);
    await expect(asUser(db, u.mcvp, (tx) => tx.query("select accept_mcp_handover($1)", [mcId]))).rejects.toThrow(/no handover waiting for you/);
  });

  it("the person it was offered to can decline it", async () => {
    await expect(asUser(db, u.mcvp, (tx) => tx.query("select cancel_mcp_handover($1)", [mcId]))).rejects.toThrow(/Only the MCP, or the person/);
    await asUserCommit(db, u.nextMcp, () => db.query("select cancel_mcp_handover($1)", [mcId]));
    expect(await handoverTo()).toBeNull();
    await expect(asUser(db, u.nextMcp, (tx) => tx.query("select accept_mcp_handover($1)", [mcId]))).rejects.toThrow(/no handover waiting/);
  });

  it("the MCP can't leave or be removed without handing over first", async () => {
    await expect(asUserCommit(db, u.oldMcp, () => db.query("delete from mc_members where mc_id = $1 and user_id = $2", [mcId, u.oldMcp])))
      .rejects.toThrow(/The MC needs an MCP/);
    expect((await roles()).oldMcp).toBe("mcp");
  });

  it("accepting makes them the MCP; the old MCP stays on as a member", async () => {
    await asUserCommit(db, u.oldMcp, () => db.query("select offer_mcp_handover($1, $2)", [mcId, u.nextMcp]));
    await asUserCommit(db, u.nextMcp, () => db.query("select accept_mcp_handover($1)", [mcId]));
    expect(await roles()).toEqual({ oldMcp: "member", nextMcp: "mcp", mcvp: "member" });
    expect(await handoverTo()).toBeNull();
    // The old MCP lost MCP powers, the new one has them.
    await expect(asUser(db, u.oldMcp, (tx) => tx.query("select new_mc_member_code($1)", [mcId]))).rejects.toThrow(/Only the MCP/);
    // …and can now leave.
    await asUserCommit(db, u.oldMcp, () => db.query("delete from mc_members where mc_id = $1 and user_id = $2", [mcId, u.oldMcp]));
    expect(Object.keys(await roles()).sort()).toEqual(["mcvp", "nextMcp"]);
  });

  it("a new member code stops the old one from working; people already on the MC stay", async () => {
    const fresh = await asUserCommit(db, u.nextMcp, async () => (await db.query<{ code: string }>("select new_mc_member_code($1) as code", [mcId])).rows[0].code);
    expect(fresh).toMatch(/^[0-9A-F]{8}$/);
    expect(fresh).not.toBe(memberCode);
    await expect(asUser(db, u.outsider, (tx) => tx.query("select join_mc($1)", [memberCode]))).rejects.toThrow(/No MC has that member code/);
    await asUserCommit(db, u.outsider, () => db.query("select join_mc($1)", [fresh]));
    expect((await roles()).mcvp).toBe("member");
  });

  it("an offer to someone who then leaves is dropped", async () => {
    await asUserCommit(db, u.nextMcp, () => db.query("select offer_mcp_handover($1, $2)", [mcId, u.mcvp]));
    await asUserCommit(db, u.mcvp, () => db.query("delete from mc_members where mc_id = $1 and user_id = $2", [mcId, u.mcvp]));
    expect(await handoverTo()).toBeNull();
  });

  it("deleting the whole MC still works", async () => {
    await db.query("delete from mcs where id = $1", [mcId]);
    expect((await db.query("select * from mc_members where mc_id = $1", [mcId])).rows).toEqual([]);
  });
});
