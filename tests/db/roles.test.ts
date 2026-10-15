// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
let vp: string;
let member: string;
let outsider: string;

beforeAll(async () => {
  db = await freshDatabase();
  const president = await createUser(db, "Pres");
  vp = await createUser(db, "Vera");
  member = await createUser(db, "Mo");
  outsider = await createUser(db, "Out");
  lc = await createLc(db, president);
  await addMember(db, lc, vp, { role: "vp", leads: ["Marketing"] });
  await addMember(db, lc, member, { department: "Marketing" });
}, 60_000);

describe("LC creation", () => {
  it("seeds the President / VP / Member system roles", () => {
    expect(Object.keys(lc.roleIds).sort()).toEqual(["Member", "President", "VP"]);
  });

  it("seeds the eight default AIESEC departments with F&L flagged as finance", async () => {
    expect(Object.keys(lc.departments)).toHaveLength(8);
    const { rows } = await db.query<{ name: string }>(
      "select name from departments where project_id = $1 and is_finance", [lc.id],
    );
    expect(rows.map((r) => r.name)).toEqual(["Finance & Legality"]);
  });
});

describe("joining an LC", () => {
  it("cannot insert yourself into an LC directly", async () => {
    await expect(asUser(db, outsider, (tx) =>
      tx.query("insert into team_members (project_id, user_id, role) values ($1, $2, 'president')", [lc.id, outsider]),
    )).rejects.toThrow(/row-level security/);
  });

  it("joins with an invite code, getting the code's role (never president by request)", async () => {
    await db.query(
      "insert into invite_codes (code, project_id, created_by, lab_role_id) values ('JOIN01', $1, $2, $3)",
      [lc.id, lc.president, lc.roleIds.VP],
    );
    const role = await asUser(db, outsider, async (tx) => {
      await tx.query("select join_lc_with_code('join01')");
      const { rows } = await tx.query<{ role: string }>(
        "select role from team_members where project_id = $1 and user_id = $2", [lc.id, outsider],
      );
      return rows[0]?.role;
    });
    expect(role).toBe("vp");
  });

  it("rejects personal invites claimed by a different email", async () => {
    await db.query(
      "insert into invite_codes (code, project_id, created_by, invited_email) values ('MAIL01', $1, $2, 'someone@else.org')",
      [lc.id, lc.president],
    );
    await expect(asUser(db, outsider, (tx) => tx.query("select join_lc_with_code('MAIL01')")))
      .rejects.toThrow(/different email/);
  });
});

describe("role changes", () => {
  it("a member cannot promote themselves", async () => {
    await expect(asUser(db, member, (tx) =>
      tx.query("update team_members set role = 'president' where user_id = $1", [member]),
    )).rejects.toThrow(/Only the LC president/);
  });

  it("a member can change their own department", async () => {
    const dep = await asUser(db, member, async (tx) => {
      await tx.query("update team_members set department_id = $1 where user_id = $2",
        [lc.departments["Talent Management"], member]);
      const { rows } = await tx.query<{ department_id: string }>(
        "select department_id from team_members where user_id = $1", [member]);
      return rows[0].department_id;
    });
    expect(dep).toBe(lc.departments["Talent Management"]);
  });

  it("the president can promote a member to VP, and lab_role_id follows", async () => {
    const row = await asUser(db, lc.president, async (tx) => {
      await tx.query("update team_members set role = 'vp' where user_id = $1", [member]);
      const { rows } = await tx.query<{ role: string; lab_role_id: string }>(
        "select role, lab_role_id from team_members where user_id = $1", [member]);
      return rows[0];
    });
    expect(row).toEqual({ role: "vp", lab_role_id: lc.roleIds.VP });
  });

  it("the last president cannot step down", async () => {
    await expect(asUser(db, lc.president, (tx) =>
      tx.query("update team_members set role = 'member' where user_id = $1", [lc.president]),
    )).rejects.toThrow(/at least one president/);
  });

  it("only the president manages departments", async () => {
    await expect(asUser(db, vp, async (tx) => {
      const { rows } = await tx.query(
        "update departments set name = 'Hacked' where project_id = $1 returning id", [lc.id]);
      if (rows.length === 0) throw new Error("blocked by RLS");
    })).rejects.toThrow(/blocked by RLS/);
  });
});
