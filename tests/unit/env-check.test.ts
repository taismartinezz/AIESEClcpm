// @vitest-environment node
import { describe, it, expect } from "vitest";
import { envReport, missingEnv } from "@/lib/env-check";

describe("environment check", () => {
  it("names each missing variable and what it breaks", () => {
    const lines = envReport({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });
    expect(lines.some((l) => l.includes("MISSING: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && l.includes("PREVIEW MODE"))).toBe(true);
    expect(lines.some((l) => l.includes("MISSING: CRON_SECRET"))).toBe(true);
    expect(lines.some((l) => l.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(false);
  });
  it("accepts the legacy anon key name", () => {
    expect(missingEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }).map((v) => v.name)).not.toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });
});
