// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, asUserCommit } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["ana", "bo", "cy"]) u[n] = await createUser(db, n);
  const lisbon = await createLc(db, u.ana, "AIESEC in Lisbon");
  const porto = await createLc(db, u.bo, "AIESEC in Porto");
  await db.query("update projects set country_code = 'PT' where id in ($1, $2)", [lisbon.id, porto.id]);
  // A demo LC in Portugal must not be suggested.
  const demo = await asUserCommit(db, u.ana, async () => (await db.query<{ create_demo_lc: string }>("select create_demo_lc()")).rows[0].create_demo_lc);
  await db.query("update projects set country_code = 'PT' where id = $1", [demo]);
}, 60_000);

describe("country", () => {
  it("is saved on the profile as a two-letter code, by the person themselves", async () => {
    await asUserCommit(db, u.cy, () => db.query("update user_profiles set country_code = 'ES' where id = $1", [u.cy]));
    expect((await db.query<{ country_code: string }>("select country_code from user_profiles where id = $1", [u.cy])).rows[0].country_code).toBe("ES");
    await expect(db.query("update user_profiles set country_code = 'Spain' where id = $1", [u.cy])).rejects.toThrow(/country_code/);
  });

  it("lists the LCs already in a country (names only, no demo LCs) for anyone signed in", async () => {
    const lcs = await asUser(db, u.cy, async (tx) => (await tx.query<{ name: string }>("select name from lcs_in_country('pt')")).rows);
    expect(lcs.map((l) => l.name)).toEqual(["AIESEC in Lisbon", "AIESEC in Porto"]);
    await expect(asUser(db, null, (tx) => tx.query("select * from lcs_in_country('PT')"))).rejects.toThrow(/permission denied/);
  });
});
