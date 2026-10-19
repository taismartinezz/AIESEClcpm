import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptJournalContent, encryptJournalContent, importJournalKey } from "@/lib/journal-crypto";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  vi.stubEnv("JOURNAL_KEY_SECRET", "test-only-master-secret-at-least-32-bytes");
  getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
});
afterEach(() => vi.unstubAllEnvs());

const request = (token?: string) => new Request("http://localhost/api/journal/key", {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

describe("journal key route", () => {
  it("fails closed when the server encryption secret is missing", async () => {
    vi.stubEnv("JOURNAL_KEY_SECRET", "");
    const { GET } = await import("@/app/api/journal/key/route");
    const response = await GET(request("test-token"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Journal encryption is not configured." });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects missing and invalid authentication", async () => {
    const { GET } = await import("@/app/api/journal/key/route");
    expect((await GET(request())).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("invalid"))).status).toBe(401);
  });

  it("derives stable, distinct user keys without caching, and encrypts readable entries", async () => {
    const { GET } = await import("@/app/api/journal/key/route");
    const response = await GET(request("test-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const first = await response.json();
    const second = await (await GET(request("test-token"))).json();
    expect(second.key).toBe(first.key);
    const key = await importJournalKey(first.key);
    const content = { reflection: "private test content" };
    const encrypted = await encryptJournalContent(key, content);
    expect(await decryptJournalContent(key, encrypted)).toEqual(content);
    getUser.mockResolvedValue({ data: { user: { id: "user-b" } } });
    const other = await (await GET(request("other-token"))).json();
    expect(other.key).not.toBe(first.key);
    await expect(decryptJournalContent(await importJournalKey(other.key), encrypted)).rejects.toThrow();
  });
});
