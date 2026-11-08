// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, asUserCommit } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};
const report = (who: string, question: string) => asUserCommit(db, u[who], async () =>
  (await db.query<{ id: string }>("insert into feature_requests (created_by, role, question, page, closest) values ($1, 'member', $2, '/tasks', '{tasks}') returning id", [u[who], question])).rows[0].id);

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["ana", "rui", "mod"]) u[n] = await createUser(db, n);
  await db.query("insert into app_moderators (user_id) values ($1)", [u.mod]);
}, 60_000);

describe("feature requests from the helper", () => {
  it("anyone signed in reports what they couldn't find, as themselves", async () => {
    await report("ana", "Can I export the calendar to Outlook?");
    await expect(asUser(db, u.rui, (tx) => tx.query("insert into feature_requests (created_by, question) values ($1, 'Pretending to be Ana')", [u.ana]))).rejects.toThrow();
    await expect(asUser(db, u.rui, (tx) => tx.query("insert into feature_requests (created_by, question, status) values ($1, 'Already done?', 'done')", [u.rui]))).rejects.toThrow();
  });

  it("people see their own requests; moderators see everyone's", async () => {
    await report("rui", "Dark mode for the national view");
    const seen = (who: string) => asUser(db, u[who], async (tx) => (await tx.query<{ question: string }>("select question from feature_requests order by created_at")).rows.map((r) => r.question));
    expect(await seen("ana")).toEqual(["Can I export the calendar to Outlook?"]);
    expect(await seen("rui")).toEqual(["Dark mode for the national view"]);
    expect(await seen("mod")).toHaveLength(2);
  });

  it("only moderators change the status, and nobody rewrites the question", async () => {
    const id = (await db.query<{ id: string }>("select id from feature_requests where created_by = $1", [u.ana])).rows[0].id;
    await expect(asUser(db, u.ana, (tx) => tx.query("select set_feature_request_status($1, 'done')", [id]))).rejects.toThrow(/Only app moderators/);
    const edited = await asUser(db, u.ana, async (tx) => (await tx.query("update feature_requests set question = 'changed' where id = $1 returning id", [id])).rows.length);
    expect(edited).toBe(0);
    await asUserCommit(db, u.mod, () => db.query("select set_feature_request_status($1, 'planned')", [id]));
    expect((await db.query<{ status: string; question: string }>("select status, question from feature_requests where id = $1", [id])).rows[0])
      .toEqual({ status: "planned", question: "Can I export the calendar to Outlook?" });
  });

  it("only moderators can tell who the moderators are", async () => {
    const list = (who: string) => asUser(db, u[who], async (tx) => (await tx.query("select user_id from app_moderators")).rows.length);
    expect(await list("ana")).toBe(0);
    expect(await list("mod")).toBe(1);
  });
});
