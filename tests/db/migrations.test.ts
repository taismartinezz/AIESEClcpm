// @vitest-environment node
import { describe, it, expect } from "vitest";
import { freshDatabase, migrationFiles } from "./harness";

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
