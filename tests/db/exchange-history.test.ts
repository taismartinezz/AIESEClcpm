// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const OGV = "Outgoing Global Volunteer";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "olga", "otto", "mark"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.olga, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.otto, { department: OGV });
  await addMember(db, lc, u.mark, { department: "Marketing" });
}, 60_000);

const history = (who: string, id: string) => asUser(db, u[who], async (tx) =>
  (await tx.query<{ kind: string; from_value: string | null; to_value: string | null; changed_by: string | null }>(
    "select kind, from_value, to_value, changed_by from exchange_history where exchange_id = $1 order by changed_at, kind", [id])).rows);

describe("exchange history", () => {
  it("records creation, stage changes and owner changes, with who made them", async () => {
    const id = await asUserCommit(db, u.otto, async () => (await db.query<{ id: string }>(
      "insert into exchanges (project_id, product, person_name, created_by) values ($1, 'ogv', 'Ana', $2) returning id", [lc.id, u.otto])).rows[0].id);
    await asUserCommit(db, u.olga, () => db.query("update exchanges set stage = 'applied', owner_id = $2 where id = $1", [id, u.otto]));
    await asUserCommit(db, u.olga, () => db.query("update exchanges set notes = 'called' where id = $1", [id]));

    const rows = await history("olga", id);
    expect(rows).toEqual(expect.arrayContaining([
      { kind: "created", from_value: null, to_value: "signed_up", changed_by: u.otto },
      { kind: "stage", from_value: "signed_up", to_value: "applied", changed_by: u.olga },
      { kind: "owner", from_value: null, to_value: u.otto, changed_by: u.olga },
    ]));
    expect(rows).toHaveLength(3);                    // a notes edit isn't history
  });

  it("is visible only to people who can see the exchange, and can't be written by hand", async () => {
    const id = (await db.query<{ id: string }>("select id from exchanges limit 1")).rows[0].id;
    expect(await history("mark", id)).toEqual([]);
    await expect(asUser(db, u.olga, (tx) => tx.query(
      "insert into exchange_history (exchange_id, project_id, kind) values ($1, $2, 'created')", [id, lc.id]))).rejects.toThrow();
  });
});
