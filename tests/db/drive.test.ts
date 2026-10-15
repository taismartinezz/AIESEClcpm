// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const MKT = "Marketing";
const TM = "Talent Management";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "mia", "tia", "max", "tom", "out"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.mia, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.tia, { role: "vp", leads: [TM] });
  await addMember(db, lc, u.max, { department: MKT });
  await addMember(db, lc, u.tom, { department: TM });
}, 60_000);

describe("LC Drive", () => {
  it("seeds the default folders for every LC", async () => {
    const { rows } = await db.query<{ name: string }>("select name from drive_folders where project_id = $1 order by sort_order", [lc.id]);
    expect(rows.map((r) => r.name)).toEqual(["Templates", "Brand kit", "Job descriptions", "Important links", "Handover"]);
  });

  it("only the exec board manages folders", async () => {
    await expect(asUser(db, u.max, (tx) => tx.query("insert into drive_folders (project_id, name) values ($1, 'Mine')", [lc.id])))
      .rejects.toThrow(/row-level security/);
    const ok = await asUser(db, u.mia, async (tx) => (await tx.query("insert into drive_folders (project_id, name) values ($1, 'Events') returning id", [lc.id])).rows.length);
    expect(ok).toBe(1);
  });

  it("personal items stay private; shared items are visible to the LC", async () => {
    await asUserCommit(db, u.max, async () => {
      await db.query("insert into bookmarks (project_id, url, title, added_by, scope) values ($1, 'https://a.example', 'My notes', $2, 'personal')", [lc.id, u.max]);
      await db.query("insert into bookmarks (project_id, url, title, added_by, scope) values ($1, 'https://b.example', 'Brand kit', $2, 'lab')", [lc.id, u.max]);
    });
    const titles = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query<{ title: string }>("select title from bookmarks order by title")).rows.map((r) => r.title));
    expect(await titles("max")).toEqual(["Brand kit", "My notes"]);
    expect(await titles("tom")).toEqual(["Brand kit"]);
    expect(await titles("out")).toEqual([]);
  });

  it("files live under their LC's folder in the private bucket", async () => {
    const path = `${lc.id}/${crypto.randomUUID()}-handbook.pdf`;
    await asUserCommit(db, u.max, async () => {
      await db.query("insert into storage.objects (bucket_id, name, owner) values ('lc-drive', $1, $2)", [path, u.max]);
      await db.query(`insert into bookmarks (project_id, url, title, added_by, scope, kind, storage_path, file_name)
                      values ($1, '', 'LC handbook', $2, 'lab', 'file', $3, 'handbook.pdf')`, [lc.id, u.max, path]);
    });
    const seen = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query("select name from storage.objects where bucket_id = 'lc-drive'")).rows.length);
    expect(await seen("tom")).toBe(1);
    expect(await seen("out")).toBe(0);
    await expect(asUser(db, u.out, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name, owner) values ('lc-drive', $1, $2)", [`${lc.id}/x.pdf`, u.out]),
    )).rejects.toThrow(/row-level security/);
  });
});

describe("handover", () => {
  beforeAll(async () => {
    await db.query(`insert into handover_notes (project_id, department_id, term_label, title, body, updated_by)
                    values ($1, $2, '2026/27', 'Marketing handover', 'Brand kit is in the Drive.', $3),
                           ($1, $4, '2026/27', 'TM handover', 'Onboarding checklist v2.', $5),
                           ($1, null, '2026/27', 'LCP handover', 'Partner contracts renew in March.', $6)`,
      [lc.id, lc.departments[MKT], u.mia, lc.departments[TM], u.tia, u.pres]);
  });

  const titles = (who: string) => asUser(db, u[who], async (tx) =>
    (await tx.query<{ title: string }>("select title from handover_notes order by title")).rows.map((r) => r.title));

  it("the exec board reads every handover; members read their department's", async () => {
    expect(await titles("tia")).toEqual(["LCP handover", "Marketing handover", "TM handover"]);
    expect(await titles("max")).toEqual(["Marketing handover"]);
    expect(await titles("out")).toEqual([]);
  });

  it("only the department's VP (or the president) edits a handover", async () => {
    const edit = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query("update handover_notes set body = 'changed' where title = 'Marketing handover' returning id")).rows.length);
    expect(await edit("mia")).toBe(1);
    expect(await edit("pres")).toBe(1);
    expect(await edit("tia")).toBe(0);
    expect(await edit("max")).toBe(0);
  });
});
