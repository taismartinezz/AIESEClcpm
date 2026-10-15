// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { freshDatabase, migrationFiles } from "./harness";
// @ts-expect-error -- plain ESM script without type declarations
import { buildFullSchema } from "../../scripts/build-full-schema.mjs";

const ROOT = join(__dirname, "..", "..");

describe("supabase/migrations", () => {
  it("builds a fresh database when applied in filename order", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(rows[0].n).toBeGreaterThan(10);
    expect(migrationFiles()[0]).toMatch(/baseline/);
  }, 60_000);
});

describe("supabase/full_schema.sql", () => {
  const bundle = readFileSync(join(ROOT, "supabase", "full_schema.sql"), "utf8");

  it("is up to date with the migrations (run `npm run db:bundle`)", () => {
    expect(bundle).toBe(buildFullSchema());
  });

  it("runs in one go on an empty database", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
    await expect(db.exec(bundle)).resolves.toBeDefined();
  }, 60_000);
});
