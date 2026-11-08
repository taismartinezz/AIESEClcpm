// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["ana", "bo"]) u[n] = await createUser(db, n);
  // The server (service role) stores tokens.
  await db.query(
    "insert into expa_connections (user_id, expa_name, home_lc_name, access_token, refresh_token) values ($1, 'Ana EXPA', 'AIESEC in Santo Domingo', 'secret-a', 'refresh-a')",
    [u.ana],
  );
  await db.query("insert into expa_oauth_states (state, user_id) values ($1, $2)", ["s".repeat(64), u.ana]);
}, 60_000);

describe("EXPA connection", () => {
  it("tokens and pending states can't be read or written by members, even their own", async () => {
    await expect(asUser(db, u.ana, (tx) => tx.query("select access_token from expa_connections"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.ana, (tx) => tx.query("select state from expa_oauth_states"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.bo, (tx) => tx.query(
      "insert into expa_connections (user_id, access_token) values ($1, 'x')", [u.bo]))).rejects.toThrow(/permission denied/);
  });

  it("looking up an account by email is for the server only", async () => {
    await expect(asUser(db, u.bo, (tx) => tx.query("select auth_user_id_by_email('ana@example.com')"))).rejects.toThrow(/permission denied/);
    const { rows } = await db.query<{ id: string | null }>("select auth_user_id_by_email((select email from auth.users where id = $1)) as id", [u.ana]);
    expect(rows[0].id).toBe(u.ana);
  });

  it("one EXPA person can be linked to only one Torch account", async () => {
    await db.query("update expa_connections set expa_person_id = '55' where user_id = $1", [u.ana]);
    await expect(db.query("insert into expa_connections (user_id, expa_person_id, access_token) values ($1, '55', 'x')", [u.bo])).rejects.toThrow(/duplicate key/);
  });

  it("expa_status() tells you about your own connection only, without tokens", async () => {
    const mine = await asUser(db, u.ana, async (tx) => (await tx.query<Record<string, unknown>>("select * from expa_status()")).rows);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ expa_name: "Ana EXPA", home_lc_name: "AIESEC in Santo Domingo" });
    expect(Object.keys(mine[0])).not.toContain("access_token");
    expect(await asUser(db, u.bo, async (tx) => (await tx.query("select * from expa_status()")).rows)).toEqual([]);
  });

  it("disconnect_expa() removes only your own tokens", async () => {
    await asUser(db, u.bo, (tx) => tx.query("select disconnect_expa()"));
    expect((await db.query("select 1 from expa_connections")).rows).toHaveLength(1);
    await db.exec("begin");
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [u.ana]);
    await db.query("select disconnect_expa()");
    await db.exec("commit");
    expect((await db.query("select 1 from expa_connections")).rows).toHaveLength(0);
  });
});
