// @vitest-environment node
//
// Two (and more) accounts against the real schema and RLS: who sees and who can
// change what at each layer, personal / LC / project.
//
//   ana  president of LC 1
//   bo   member of LC 1, and of project P (inside LC 1)
//   cy   member of LC 1, not in project P
//   dee  member of LC 2 only
//   eve  external collaborator: in project P, not a member of LC 1
//   zed  signed in, in no LC
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc1: Lc;
let lc2: Lc;
let P: string;
const u: Record<string, string> = {};
const PEOPLE = ["ana", "bo", "cy", "dee", "eve", "zed"] as const;
type Who = (typeof PEOPLE)[number];

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of [...PEOPLE, "dan"]) u[n] = await createUser(db, n);
  lc1 = await createLc(db, u.ana, "LC One");
  lc2 = await createLc(db, u.dan, "LC Two");
  await addMember(db, lc1, u.bo);
  await addMember(db, lc1, u.cy);
  await addMember(db, lc2, u.dee);
  P = (await db.query<{ id: string }>("insert into sub_projects (project_id, name, created_by) values ($1, 'Project P', $2) returning id", [lc1.id, u.ana])).rows[0].id;
  for (const who of ["ana", "bo", "eve"]) await db.query("insert into sub_project_members (sub_project_id, user_id) values ($1, $2)", [P, u[who]]);
}, 60_000);

/** Which of the six people can read the row matching `where` in `table`. */
async function readers(table: string, id: string): Promise<Who[]> {
  const out: Who[] = [];
  for (const who of PEOPLE) {
    const { rows } = await asUser(db, u[who], (tx) => tx.query(`select 1 from ${table} where id = $1`, [id]));
    if (rows.length) out.push(who);
  }
  return out;
}

/** Which of `who` can change the row (an update that actually touches it). */
async function writers(table: string, id: string, set: string, people: readonly Who[] = PEOPLE): Promise<Who[]> {
  const out: Who[] = [];
  for (const who of people) {
    const n = await asUser(db, u[who], async (tx) => (await tx.query(`update ${table} set ${set} where id = $1`, [id]).catch(() => ({ affectedRows: 0 }))).affectedRows ?? 0);
    if (n > 0) out.push(who);
  }
  return out;
}

const insertAs = (who: Who, sql: string, params: unknown[]) =>
  asUserCommit(db, u[who], async () => (await db.query<{ id: string }>(sql + " returning id", params)).rows[0].id);

describe("tasks", () => {
  const add = (who: Who, scope: string, sub: string | null) => insertAs(who,
    "insert into tasks (project_id, title, scope, sub_project_id, created_by) values ($1, $2, $3, $4, $5)", [lc1.id, `${scope} task`, scope, sub, u[who]]);

  it("personal: only the owner sees or changes it", async () => {
    const id = await add("bo", "personal", null);
    expect(await readers("tasks", id)).toEqual(["bo"]);
    expect(await writers("tasks", id, "title = 'x'")).toEqual(["bo"]);
  });

  it("LC: everyone in the LC, nobody outside it", async () => {
    const id = await add("ana", "lab", null);
    expect(await readers("tasks", id)).toEqual(["ana", "bo", "cy"]);
    expect(await writers("tasks", id, "title = 'x'", ["dee", "eve", "zed"])).toEqual([]);
  });

  it("a personal task's subtasks are personal too, even when saved as LC tasks", async () => {
    const parent = await add("bo", "personal", null);
    const sub = await insertAs("bo", "insert into tasks (project_id, title, scope, parent_id, created_by) values ($1, 'sub', 'lab', $2, $3)", [lc1.id, parent, u.bo]);
    expect(await readers("tasks", sub)).toEqual(["bo"]);
    // Sharing the task with the LC shares its subtasks.
    await asUserCommit(db, u.bo, () => db.query("update tasks set scope = 'lab' where id = $1", [parent]));
    expect(await readers("tasks", sub)).toEqual(["ana", "bo", "cy"]);
  });

  it("project: the project's members, outside collaborators included, and they can work on it", async () => {
    const id = await add("bo", "project", P);
    expect(await readers("tasks", id)).toEqual(["ana", "bo", "eve"]);
    expect(await writers("tasks", id, "status = 'done'")).toEqual(["ana", "bo", "eve"]);
  });

  it("a project task can't be filed under another LC's project", async () => {
    const P2 = (await db.query<{ id: string }>("insert into sub_projects (project_id, name, created_by) values ($1, 'Other', $2) returning id", [lc2.id, u.dan])).rows[0].id;
    await db.query("insert into sub_project_members (sub_project_id, user_id) values ($1, $2)", [P2, u.bo]);
    await expect(insertAs("bo", "insert into tasks (project_id, title, scope, sub_project_id, created_by) values ($1, 'x', 'project', $2, $3)", [lc1.id, P2, u.bo])).rejects.toThrow();
  });
});

describe("reminders", () => {
  const add = (who: Who, scope: string, sub: string | null) => insertAs(who,
    "insert into reminders (user_id, project_id, scope, sub_project_id, title) values ($1, $2, $3, $4, $5)", [u[who], scope === "personal" ? null : lc1.id, scope, sub, `${scope} reminder`]);

  it("personal: only the owner", async () => {
    const id = await add("bo", "personal", null);
    expect(await readers("reminders", id)).toEqual(["bo"]);
    expect(await writers("reminders", id, "title = 'x'")).toEqual(["bo"]);
  });

  it("LC: everyone in the LC", async () => {
    expect(await readers("reminders", await add("ana", "lab", null))).toEqual(["ana", "bo", "cy"]);
  });

  it("project: the project's members", async () => {
    expect(await readers("reminders", await add("bo", "project", P))).toEqual(["ana", "bo", "eve"]);
  });
});

describe("calendar events (Scheduling)", () => {
  const add = (who: Who, scope: string, sub: string | null) => insertAs(who,
    "insert into schedule_events (project_id, title, date, scope, sub_project_id, created_by) values ($1, $2, current_date + 1, $3, $4, $5)", [lc1.id, `${scope} event`, scope, sub, u[who]]);

  it("personal: only the owner", async () => {
    const id = await add("bo", "personal", null);
    expect(await readers("schedule_events", id)).toEqual(["bo"]);
    expect(await writers("schedule_events", id, "title = 'x'")).toEqual(["bo"]);
  });

  it("LC: everyone in the LC; only the creator edits", async () => {
    const id = await add("ana", "lab", null);
    expect(await readers("schedule_events", id)).toEqual(["ana", "bo", "cy"]);
    expect(await writers("schedule_events", id, "title = 'x'")).toEqual(["ana"]);
  });

  it("project: the project's members", async () => {
    expect(await readers("schedule_events", await add("bo", "project", P))).toEqual(["ana", "bo", "eve"]);
  });
});

describe("LC Drive links (bookmarks)", () => {
  const add = (who: Who, scope: string, sub: string | null) => insertAs(who,
    "insert into bookmarks (project_id, url, title, scope, sub_project_id, added_by) values ($1, 'https://example.com', $2, $3, $4, $5)", [lc1.id, `${scope} link`, scope, sub, u[who]]);

  it("personal: only the owner", async () => {
    const id = await add("bo", "personal", null);
    expect(await readers("bookmarks", id)).toEqual(["bo"]);
    expect(await writers("bookmarks", id, "title = 'x'")).toEqual(["bo"]);
  });

  it("LC: everyone in the LC", async () => {
    expect(await readers("bookmarks", await add("ana", "lab", null))).toEqual(["ana", "bo", "cy"]);
  });

  it("project: the project's members", async () => {
    expect(await readers("bookmarks", await add("bo", "project", P))).toEqual(["ana", "bo", "eve"]);
  });
});

describe("chat", () => {
  const post = (who: Who, channel: string) => insertAs(who, "insert into chat_messages (channel, sender_id, content) values ($1, $2, 'hi')", [channel, u[who]]);

  it("the LC channel: the LC only", async () => {
    expect(await readers("chat_messages", await post("ana", `lab:${lc1.id}`))).toEqual(["ana", "bo", "cy"]);
  });

  it("a DM: just the two people", async () => {
    const channel = `dm:${[u.ana, u.bo].sort().join(":")}`;
    expect(await readers("chat_messages", await post("ana", channel))).toEqual(["ana", "bo"]);
  });

  it("a project channel: the project's members, outside collaborators included", async () => {
    expect(await readers("chat_messages", await post("eve", `project:${P}`))).toEqual(["ana", "bo", "eve"]);
    await expect(post("cy", `project:${P}`)).rejects.toThrow();
  });

  it("nobody posts into an LC they're not in", async () => {
    await expect(post("dee", `lab:${lc1.id}`)).rejects.toThrow();
  });
});

describe("project invites", () => {
  it("only the project's managers create and see them; the invitee sees and accepts theirs", async () => {
    // cy is in the LC but doesn't manage P; zed is an outsider trying to invite himself.
    await expect(insertAs("cy", "insert into sub_project_invite_codes (token, sub_project_id, invited_email, invited_by) values ('t-cy', $1, 'zed@example.com', $2)", [P, u.cy])).rejects.toThrow();
    await expect(insertAs("zed", "insert into sub_project_invite_codes (token, sub_project_id, invited_email, invited_by) values ('t-zed', $1, 'zed@example.com', $2)", [P, u.zed])).rejects.toThrow();
    const invite = await insertAs("ana", "insert into sub_project_invite_codes (token, sub_project_id, invited_email, invited_by) values ('t-ok', $1, 'ZED@example.com', $2)", [P, u.ana]);
    expect(await readers("sub_project_invite_codes", invite)).toEqual(["ana", "zed"]);
    // zed accepts: joins P, marks the invite used.
    await asUserCommit(db, u.zed, async () => {
      await db.query("insert into sub_project_members (sub_project_id, user_id) values ($1, $2)", [P, u.zed]);
      await db.query("update sub_project_invite_codes set status = 'accepted', used_by = $2 where id = $1", [invite, u.zed]);
    });
    expect((await db.query("select 1 from sub_project_members where sub_project_id = $1 and user_id = $2", [P, u.zed])).rows).toHaveLength(1);
    // ... and can leave again.
    await asUserCommit(db, u.zed, () => db.query("delete from sub_project_members where sub_project_id = $1 and user_id = $2", [P, u.zed]));
    expect((await db.query("select 1 from sub_project_members where sub_project_id = $1 and user_id = $2", [P, u.zed])).rows).toHaveLength(0);
  });

  it("nobody else can mark someone's invite as used", async () => {
    const invite = await insertAs("ana", "insert into sub_project_invite_codes (token, sub_project_id, invited_email, invited_by) values ('t-2', $1, 'eve2@example.com', $2)", [P, u.ana]);
    expect(await writers("sub_project_invite_codes", invite, `status = 'accepted', used_by = auth.uid()`, ["cy", "dee", "zed"])).toEqual([]);
  });
});

describe("project membership", () => {
  it("can't be granted to yourself: an outsider can't join project P to read it", async () => {
    await expect(asUserCommit(db, u.zed, () => db.query("insert into sub_project_members (sub_project_id, user_id) values ($1, $2)", [P, u.zed]))).rejects.toThrow();
    await expect(asUserCommit(db, u.cy, () => db.query("insert into sub_project_members (sub_project_id, user_id) values ($1, $2)", [P, u.cy]))).rejects.toThrow();
  });
});
