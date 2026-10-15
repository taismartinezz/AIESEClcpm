import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "./harness";

let counter = 0;

/** Create an auth user + profile (as the service role, bypassing RLS). */
export async function createUser(db: PGlite, name: string): Promise<string> {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name.toLowerCase()}@example.com`]);
  await db.query("insert into user_profiles (id, name, role) values ($1, $2, 'member')", [id, name]);
  return id;
}

export interface Lc {
  id: string;
  president: string;
  departments: Record<string, string>; // name → id
  roleIds: Record<"President" | "VP" | "Member", string>;
}

/** Create an LC the way onboarding does: owner inserts project, then joins as president. */
export async function createLc(db: PGlite, presidentId: string, name = "LC Test"): Promise<Lc> {
  const id = await asUserCommit(db, presidentId, async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into projects (name, owner_id) values ($1, $2) returning id", [name, presidentId],
    );
    const lcId = rows[0].id;
    const { rows: roles } = await db.query<{ id: string }>(
      "select id from lab_roles where project_id = $1 and name = 'President'", [lcId],
    );
    await db.query(
      "insert into team_members (project_id, user_id, role, lab_role_id) values ($1, $2, 'president', $3)",
      [lcId, presidentId, roles[0].id],
    );
    return lcId;
  });

  const { rows: deps } = await db.query<{ id: string; name: string }>(
    "select id, name from departments where project_id = $1", [id],
  );
  const { rows: roles } = await db.query<{ id: string; name: "President" | "VP" | "Member" }>(
    "select id, name from lab_roles where project_id = $1 and is_system", [id],
  );
  return {
    id,
    president: presidentId,
    departments: Object.fromEntries(deps.map((d) => [d.name, d.id])),
    roleIds: Object.fromEntries(roles.map((r) => [r.name, r.id])) as Lc["roleIds"],
  };
}

/** Add a member directly (service role), optionally as a VP leading departments. */
export async function addMember(
  db: PGlite, lc: Lc, userId: string,
  opts: { role?: "vp" | "member"; department?: string; leads?: string[] } = {},
): Promise<void> {
  const role = opts.role ?? "member";
  await db.query(
    "insert into team_members (project_id, user_id, role, department_id) values ($1, $2, $3, $4)",
    [lc.id, userId, role, opts.department ? lc.departments[opts.department] : null],
  );
  for (const dep of opts.leads ?? []) {
    await db.query("update departments set vp_user_id = $1 where id = $2", [userId, lc.departments[dep]]);
  }
}

/** Like asUser but commits — for fixture setup that must go through RLS. */
export async function asUserCommit<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
