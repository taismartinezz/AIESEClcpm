// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};

async function addGoal(metric: "manual" | "pipeline"): Promise<string> {
  return asUserCommit(db, u.pres, async () => (await db.query<{ id: string }>(
    `insert into goals (project_id, title, metric, stage, product, target, starts_on, ends_on, created_by)
     values ($1, 'Goal', $2, $3, $4, 10, current_date, current_date + 30, $5) returning id`,
    [lc.id, metric, metric === "pipeline" ? "approved" : null, metric === "pipeline" ? "ogv" : null, u.pres],
  )).rows[0].id);
}

const valueOf = async (id: string) =>
  Number((await db.query<{ current_value: string }>("select current_value from goals where id = $1", [id])).rows[0].current_value);

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "member"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.member, { department: "Marketing" });
}, 60_000);

describe("adjust_goal_value", () => {
  it("counts every quick + click", async () => {
    const id = await addGoal("manual");
    for (let i = 0; i < 3; i++) {
      await asUserCommit(db, u.pres, () => db.query("select adjust_goal_value($1, 1)", [id]));
    }
    expect(await valueOf(id)).toBe(3);
  });

  it("never goes below zero", async () => {
    const id = await addGoal("manual");
    await asUserCommit(db, u.pres, () => db.query("select adjust_goal_value($1, -5)", [id]));
    expect(await valueOf(id)).toBe(0);
  });

  it("leaves pipeline goals alone", async () => {
    const id = await addGoal("pipeline");
    await asUserCommit(db, u.pres, () => db.query("select adjust_goal_value($1, 4)", [id]));
    expect(await valueOf(id)).toBe(0);
  });

  it("changes nothing for a member who can't manage goals", async () => {
    const id = await addGoal("manual");
    await asUser(db, u.member, (tx) => tx.query("select adjust_goal_value($1, 2)", [id]));
    expect(await valueOf(id)).toBe(0);
  });
});

describe("chat_messages", () => {
  it("rejects an empty message", async () => {
    await expect(db.query("insert into chat_messages (channel, sender_id, content) values ('general', $1, '   ')", [u.pres]))
      .rejects.toThrow(/chat_messages_not_empty/);
  });

  it("accepts an attachment without text, and deleted messages", async () => {
    await db.query(`insert into chat_messages (channel, sender_id, content, attachments) values ('general', $1, '', '[{"name":"a.pdf"}]')`, [u.pres]);
    await db.query("insert into chat_messages (channel, sender_id, content, deleted_at) values ('general', $1, '', now())", [u.pres]);
  });
});

describe("exchanges", () => {
  it("rejects an email that isn't one", async () => {
    await expect(db.query(
      "insert into exchanges (project_id, product, person_name, email) values ($1, 'ogv', 'Ana', 'notanemail')", [lc.id],
    )).rejects.toThrow(/exchanges_email_format/);
    await db.query("insert into exchanges (project_id, product, person_name, email) values ($1, 'ogv', 'Ben', 'ben@example.com')", [lc.id]);
  });
});
