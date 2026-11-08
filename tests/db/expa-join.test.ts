// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { asUserCommit, createLc, createUser, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
let n = 0;

/** A new EXPA sign-in: an account with no profile yet, and where EXPA places them. */
async function expaUser(name: string, placement: Record<string, unknown> | null, extra: Record<string, unknown> = {}): Promise<string> {
  n += 1;
  const id = `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name}@expa.org`]);
  await db.query("insert into expa_connections (user_id, expa_person_id, access_token, profile) values ($1, $2, 'x', $3)",
    [id, `p${n}`, JSON.stringify({ fullName: `${name[0].toUpperCase()}${name.slice(1)} Hassan`, positions: [], ...extra, placement })]);
  return id;
}
const join = (uid: string) => asUserCommit(db, uid, async () =>
  (await db.query<{ j: Record<string, unknown> }>("select join_from_expa('Africa/Cairo') as j")).rows[0].j);
const membership = async (uid: string) => (await db.query<{ role: string; department: string | null }>(
  "select tm.role, d.name as department from team_members tm left join departments d on d.id = tm.department_id where tm.project_id = $1 and tm.user_id = $2",
  [lc.id, uid])).rows[0];

const cairo = { kind: "lc", expaId: "1500", name: "Cairo University", country: "EG" };

beforeAll(async () => {
  db = await freshDatabase();
  const lcp = await createUser(db, "lcp");
  lc = await createLc(db, lcp, "AIESEC in Cairo University");
  await db.query("update projects set country_code = 'EG' where id = $1", [lc.id]);
}, 60_000);

describe("joining from EXPA", () => {
  it("an LCVP joins their LC as a VP, leading their function's department, with a profile from EXPA", async () => {
    const vp = await expaUser("omar", { ...cairo, role: "vp", department: "ogv" }, { photoUrl: "https://cdn.expa/omar.jpg" });
    expect(await join(vp)).toMatchObject({ status: "joined", kind: "lc", id: lc.id, role: "vp" });
    expect(await membership(vp)).toEqual({ role: "vp", department: "Outgoing Global Volunteer" });
    const { rows } = await db.query("select name, avatar_initials, avatar_url, country_code from user_profiles where id = $1", [vp]);
    expect(rows[0]).toEqual({ name: "Omar Hassan", avatar_initials: "OH", avatar_url: "https://cdn.expa/omar.jpg", country_code: "EG" });
    expect((await db.query("select vp_user_id from departments where id = $1", [lc.departments["Outgoing Global Volunteer"]])).rows[0])
      .toEqual({ vp_user_id: vp });
    expect((await db.query("select timezone from user_settings where user_id = $1", [vp])).rows[0]).toEqual({ timezone: "Africa/Cairo" });
  });

  it("the first match by name remembers the LC's EXPA id; then the id is enough, even if the LC is renamed", async () => {
    expect((await db.query("select expa_lc_id from projects where id = $1", [lc.id])).rows[0]).toEqual({ expa_lc_id: "1500" });
    await db.query("update projects set name = 'AIESEC Cairo Uni' where id = $1", [lc.id]);
    const m = await expaUser("mona", { ...cairo, role: "member", department: "mkt" });
    expect(await join(m)).toMatchObject({ status: "joined", id: lc.id });
    expect(await membership(m)).toEqual({ role: "member", department: "Marketing" });
  });

  it("a second VP of the same function joins the department without taking over its lead", async () => {
    const vp2 = await expaUser("karim", { ...cairo, role: "vp", department: "ogv" });
    await join(vp2);
    expect(await membership(vp2)).toEqual({ role: "vp", department: "Outgoing Global Volunteer" });
    expect((await db.query<{ vp_user_id: string }>("select vp_user_id from departments where id = $1", [lc.departments["Outgoing Global Volunteer"]])).rows[0].vp_user_id)
      .not.toBe(vp2);
  });

  it("joining again changes nothing: roles the president set later stay", async () => {
    const m = await expaUser("sara", { ...cairo, role: "member" });
    await join(m);
    await db.query("update team_members set role = 'vp' where project_id = $1 and user_id = $2", [lc.id, m]);
    expect(await join(m)).toMatchObject({ status: "already", kind: "lc", id: lc.id });
    expect((await membership(m)).role).toBe("vp");
  });

  it("an LC not on the app yet: the LCP is sent to create it, anyone else is told to wait", async () => {
    const other = { kind: "lc", expaId: "2000", name: "Alexandria", country: "EG" };
    const p = await expaUser("lcpalex", { ...other, role: "president" });
    const m = await expaUser("memalex", { ...other, role: "member" });
    expect(await join(p)).toEqual({ status: "create_lc", kind: "lc", name: "Alexandria" });
    expect(await join(m)).toEqual({ status: "lc_missing", kind: "lc", name: "Alexandria" });
    expect((await db.query("select 1 from user_profiles where id = any($1)", [[p, m]])).rows).toHaveLength(0);

    // The LCP creates it in onboarding: it takes their EXPA LC id, so members join it by id.
    await db.query("insert into user_profiles (id, name) values ($1, 'Lcp Alex')", [p]);
    const alexId = await asUserCommit(db, p, async () => (await db.query<{ id: string }>(
      "insert into projects (name, owner_id, country_code) values ('AIESEC Alex', $1, 'EG') returning id", [p])).rows[0].id);
    expect((await db.query("select expa_lc_id from projects where id = $1", [alexId])).rows[0]).toEqual({ expa_lc_id: "2000" });
    expect(await join(m)).toMatchObject({ status: "joined", id: alexId, role: "member" });
  });

  it("no one sets an LC's or MC's EXPA id by hand", async () => {
    await asUserCommit(db, lc.president, () => db.query("update projects set expa_lc_id = '9999' where id = $1", [lc.id]));
    expect((await db.query("select expa_lc_id from projects where id = $1", [lc.id])).rows[0]).toEqual({ expa_lc_id: "1500" });
    const sneaky = await createUser(db, "sneaky");
    const id = await asUserCommit(db, sneaky, async () => (await db.query<{ id: string }>(
      "insert into projects (name, owner_id, expa_lc_id) values ('Fake LC', $1, '3000') returning id", [sneaky])).rows[0].id);
    expect((await db.query("select expa_lc_id from projects where id = $1", [id])).rows[0]).toEqual({ expa_lc_id: null });
  });

  it("MC: members join the country's MC; the MCP creates it when there's none", async () => {
    const egypt = { kind: "mc", expaId: "1609", name: "Egypt", country: "EG", department: null };
    const mcp = await expaUser("mcp", { ...egypt, role: "mcp" });
    const mcvp = await expaUser("mcvp", { ...egypt, role: "member" });
    expect(await join(mcvp)).toEqual({ status: "mc_missing", kind: "mc", name: "Egypt" });
    expect(await join(mcp)).toEqual({ status: "create_mc", kind: "mc", name: "Egypt" });

    // Created by an MCP without EXPA first; the first EXPA sign-in finds it by country.
    const someone = await createUser(db, "founder");
    const mcId = await asUserCommit(db, someone, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Egypt', 'EG') as id")).rows[0].id);
    expect(await join(mcvp)).toMatchObject({ status: "joined", kind: "mc", id: mcId, role: "member" });
    expect(await join(mcp)).toMatchObject({ status: "joined", kind: "mc", id: mcId, role: "mcp" });
    expect((await db.query("select user_id, role from mc_members where mc_id = $1 order by role", [mcId])).rows).toEqual(
      expect.arrayContaining([{ user_id: mcp, role: "mcp" }, { user_id: mcvp, role: "member" }]));
    expect((await db.query("select expa_mc_id from mcs where id = $1", [mcId])).rows[0]).toEqual({ expa_mc_id: "1609" });
    // MC members are not added to any LC.
    expect((await db.query("select 1 from team_members where user_id = any($1)", [[mcp, mcvp]])).rows).toHaveLength(0);
  });

  it("without a placement (an EP, or no EXPA) nothing happens; the role can't be made up", async () => {
    const ep = await expaUser("ep", null);
    expect(await join(ep)).toEqual({ status: "none" });
    const odd = await expaUser("odd", { ...cairo, role: "owner" });
    expect(await join(odd)).toMatchObject({ status: "joined", role: "member" });
    const stranger = await createUser(db, "stranger");
    expect(await join(stranger)).toEqual({ status: "none" });
  });

  it("members can't write their own placement, and anonymous callers can't join", async () => {
    const m = await createUser(db, "writer");
    await expect(asUser(db, m, (tx) => tx.query("update expa_connections set profile = '{}' where user_id = $1", [m]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query("select join_from_expa()"))).rejects.toThrow(/permission denied/);
  });
});
