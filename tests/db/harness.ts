import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/** Migration files in the order Supabase applies them (lexical by filename). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Build a fresh database the way the README tells people to: Supabase stub,
 * then every migration in order. Throws with the failing file name on error.
 */
export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

/** Run `fn` as an authenticated user, with RLS applied, inside a rolled-back transaction. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  await db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    result = await fn(tx);
    await tx.rollback();
  }).catch((err: Error) => {
    // PGlite raises when a transaction is rolled back on purpose; ignore that one.
    if (!/rollback/i.test(err.message)) throw err;
  });
  return result;
}

export type Tx = Parameters<Parameters<PGlite["transaction"]>[0]>[0];
