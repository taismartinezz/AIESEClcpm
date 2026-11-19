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

  it("joining again brings role and department in line with EXPA", async () => {
    const m = await expaUser("sara", { ...cairo, role: "member", department: "mkt" });
    await join(m);
    expect(await membership(m)).toEqual({ role: "member", department: "Marketing" });
    // EXPA now says she's VP of Talent Management.
    await db.query("update expa_connections set profile = jsonb_set(profile, '{placement}', $2::jsonb) where user_id = $1",
      [m, JSON.stringify({ ...cairo, role: "vp", department: "tm" })]);
    expect(await join(m)).toMatchObject({ status: "already", kind: "lc", id: lc.id, role: "vp", updated: true });
    expect(await membership(m)).toEqual({ role: "vp", department: "Talent Management" });
    expect((await db.query("select vp_user_id from departments where id = $1", [lc.departments["Talent Management"]])).rows[0]).toEqual({ vp_user_id: m });
    // And back to member: she stops leading it.
    await db.query("update expa_connections set profile = jsonb_set(profile, '{placement}', $2::jsonb) where user_id = $1",
      [m, JSON.stringify({ ...cairo, role: "member", department: "tm" })]);
    expect(await join(m)).toMatchObject({ status: "already", role: "member", updated: true });
    expect((await db.query("select vp_user_id from departments where id = $1", [lc.departments["Talent Management"]])).rows[0]).toEqual({ vp_user_id: null });
    expect(await join(m)).toMatchObject({ status: "already", updated: false });
  });

  it("the LCP is never changed from EXPA", async () => {
    await db.query("insert into expa_connections (user_id, expa_person_id, access_token, profile) values ($1, 'lcp-p', 'x', $2)",
      [lc.president, JSON.stringify({ fullName: "The LCP", positions: [], placement: { ...cairo, role: "member", department: "mkt" } })]);
    expect(await join(lc.president)).toMatchObject({ status: "already", role: "president" });
    expect((await membership(lc.president)).role).toBe("president");
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

  it("MC: whoever signs in first sets it up from EXPA, in their own role; the LCs in its country join it", async () => {
    const egypt = { kind: "mc", expaId: "1609", name: "AIESEC in Egypt", country: "EG", department: null };
    const finance = await expaUser("mcfin", { ...egypt, role: "vp_finance", department: "fin" });
    const mcp = await expaUser("mcp", { ...egypt, role: "mcp" });
    const mcvp = await expaUser("mcvp", { ...egypt, role: "member" });
    // The VP Finance is first: the MC is set up, with them as VP Finance (not MCP), and the Egyptian LC joins it.
    const j = await join(finance);
    expect(j).toMatchObject({ status: "joined", kind: "mc", name: "AIESEC in Egypt", role: "vp_finance" });
    const mcId = j.id as string;
    expect((await db.query("select name, country_code, expa_mc_id from mcs where id = $1", [mcId])).rows[0])
      .toEqual({ name: "AIESEC in Egypt", country_code: "EG", expa_mc_id: "1609" });
    expect((await db.query("select mc_id from projects where id = $1", [lc.id])).rows[0]).toEqual({ mc_id: mcId });
    expect(await join(mcvp)).toMatchObject({ status: "joined", id: mcId, role: "member" });
    expect(await join(mcp)).toMatchObject({ status: "joined", id: mcId, role: "mcp" });
    expect((await db.query("select user_id, role from mc_members where mc_id = $1", [mcId])).rows).toEqual(
      expect.arrayContaining([{ user_id: finance, role: "vp_finance" }, { user_id: mcp, role: "mcp" }, { user_id: mcvp, role: "member" }]));
    // MC members are not added to any LC.
    expect((await db.query("select 1 from team_members where user_id = any($1)", [[mcp, mcvp, finance]])).rows).toHaveLength(0);
  });

  it("MC: someone who set it up as MCP but is VP Finance in EXPA becomes VP Finance at their next sign-in", async () => {
    const us = { kind: "mc", expaId: "1630", name: "AIESEC in the United States", country: "US", department: null };
    const fin = await expaUser("usfin", { ...us, role: "vp_finance", department: "fin" });
    const mcId = await asUserCommit(db, fin, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in the United States', 'US') as id")).rows[0].id);
    expect((await db.query("select role from mc_members where mc_id = $1 and user_id = $2", [mcId, fin])).rows[0]).toEqual({ role: "mcp" });
    expect(await join(fin)).toMatchObject({ status: "already", kind: "mc", id: mcId, role: "vp_finance", updated: true });
    expect((await db.query("select role from mc_members where mc_id = $1 and user_id = $2", [mcId, fin])).rows[0]).toEqual({ role: "vp_finance" });
    // An LC in the US set up later joins it by country.
    const usLcp = await createUser(db, "uslcp");
    const usLc = await createLc(db, usLcp, "AIESEC in Northwestern");
    await db.query("update projects set country_code = 'US' where id = $1", [usLc.id]);
    expect((await db.query("select mc_id from projects where id = $1", [usLc.id])).rows[0]).toEqual({ mc_id: mcId });
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

it('assigns the verified EXPA finance MCVP role on first joining, without giving LC finance access', async () => {
  const mc = (await db.query<{ id: string }>("select id from mcs where country_code='EG'")).rows[0].id;
  const uid = await expaUser('finance-vp', { kind: 'mc', name: 'Egypt', country: 'EG', role: 'vp_finance', department: 'fin' });
  expect(await join(uid)).toMatchObject({ status: 'joined', kind: 'mc', id: mc, role: 'vp_finance' });
  expect((await db.query('select role from mc_members where mc_id=$1 and user_id=$2', [mc, uid])).rows).toEqual([{ role: 'vp_finance' }]);
  expect(await asUser(db, uid, async tx => (await tx.query('select * from finance_entries')).rows)).toEqual([]);
  await expect(asUser(db, uid, tx => tx.query('select * from mc_finance_lcs($1)', [mc]))).rejects.toThrow(/permission denied/);
});
