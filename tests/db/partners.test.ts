// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const BD = "Business Development";
const MKT = "Marketing";

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "bea", "mia", "bob", "max", "owner"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.bea, { role: "vp", leads: [BD] });
  await addMember(db, lc, u.mia, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.bob, { department: BD });
  await addMember(db, lc, u.max, { department: MKT });
  await addMember(db, lc, u.owner, { department: MKT });

  await asUserCommit(db, u.bea, async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into partners (project_id, name, department_id, created_by) values ($1, 'Acme Bank', $2, $3) returning id",
      [lc.id, lc.departments[BD], u.bea]);
    await db.query("insert into partner_contacts (partner_id, name, email) values ($1, 'Rita (HR)', 'rita@acme.example')", [rows[0].id]);
    await db.query("insert into partner_activities (partner_id, kind, body, author_id) values ($1, 'call', 'Intro call', $2)", [rows[0].id, u.bea]);
  });
  // A BD partner owned by a Marketing member (e.g. they brought in the contact).
  await db.query("insert into partners (project_id, name, department_id, owner_id) values ($1, 'Café Uno', $2, $3)",
    [lc.id, lc.departments[BD], u.owner]);
}, 60_000);

const names = (who: string) => asUser(db, u[who], async (tx) =>
  (await tx.query<{ name: string }>("select name from partners order by name")).rows.map((r) => r.name));

describe("partner CRM", () => {
  it("the LCP sees all partners and VPs see only their department", async () => {
    expect(await names("pres")).toEqual(["Acme Bank", "Café Uno"]);
    expect(await names("mia")).toEqual([]);
    expect(await names("bea")).toEqual(["Acme Bank", "Café Uno"]);
  });

  it("members cannot read private partner data even when named as owner", async () => {
    expect(await names("bob")).toEqual([]);
    expect(await names("max")).toEqual([]);
    expect(await names("owner")).toEqual([]);
  });

  it("contacts and activities follow their partner", async () => {
    const seen = (who: string) => asUser(db, u[who], async (tx) => ({
      contacts: (await tx.query("select name from partner_contacts")).rows.length,
      activities: (await tx.query("select body from partner_activities")).rows.length,
    }));
    expect(await seen("bea")).toEqual({ contacts: 1, activities: 1 });
    expect(await seen("bob")).toEqual({ contacts: 0, activities: 0 });
    expect(await seen("max")).toEqual({ contacts: 0, activities: 0 });
  });

  it("members cannot add private partners", async () => {
    await expect(asUser(db, u.max, (tx) => tx.query(
      "insert into partners (project_id, name, department_id, created_by) values ($1, 'x', $2, $3)", [lc.id, lc.departments[BD], u.max],
    ))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, u.max, (tx) => tx.query(
      "insert into partners (project_id, name, department_id, created_by) values ($1, 'Print shop', $2, $3) returning id", [lc.id, lc.departments[MKT], u.max],
    ))).rejects.toThrow(/row-level security/);
  });

  it("members can't add contacts to partners they can't see", async () => {
    const acme = (await db.query<{ id: string }>("select id from partners where name = 'Acme Bank'")).rows[0].id;
    await expect(asUser(db, u.max, (tx) => tx.query(
      "insert into partner_contacts (partner_id, name) values ($1, 'Spy')", [acme],
    ))).rejects.toThrow(/row-level security/);
  });
});
