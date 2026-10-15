import { describe, it, expect, beforeAll } from "vitest";
import {
  importJournalKey, encryptJournalContent, decryptJournalContent, isEncryptedContent,
} from "@/lib/journal-crypto";

// Minimal WebCrypto shim for the jsdom test environment (Node 18 has globalThis.crypto)
// Vitest runs in jsdom which inherits Node's crypto — no shim needed.

let key: CryptoKey;

beforeAll(async () => {
  // Generate a fresh 256-bit AES-GCM key for all tests
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...raw));
  key = await importJournalKey(b64);
});

describe("isEncryptedContent", () => {
  it("returns true for a valid encrypted shape", () => {
    expect(isEncryptedContent({ enc: "aes-gcm-v1", ct: "abc", iv: "def" })).toBe(true);
  });
  it("returns false for plaintext objects", () => {
    expect(isEncryptedContent({ prompts: [], checkin: [] })).toBe(false);
    expect(isEncryptedContent(null)).toBe(false);
    expect(isEncryptedContent("string")).toBe(false);
  });
});

describe("encrypt / decrypt round-trip", () => {
  it("small payload", async () => {
    const data = { prompts: [{ id: "p1", text: "Hello", response: "World" }], checkin: [] };
    const enc = await encryptJournalContent(key, data);
    expect(isEncryptedContent(enc)).toBe(true);
    const dec = await decryptJournalContent(key, enc);
    expect(dec).toEqual(data);
  });

  it("1 MB payload — bytesToB64 must not stack-overflow", async () => {
    // ~1 MB of Unicode text
    const largeText = "A".repeat(1024 * 1024);
    const data = { prompts: [{ id: "p1", text: "Big", response: largeText }], checkin: [] };
    const enc = await encryptJournalContent(key, data);
    const dec = await decryptJournalContent(key, enc) as typeof data;
    expect(dec.prompts[0].response.length).toBe(largeText.length);
  });

  it("unique IVs per encryption", async () => {
    const data = { text: "same" };
    const enc1 = await encryptJournalContent(key, data);
    const enc2 = await encryptJournalContent(key, data);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ct).not.toBe(enc2.ct);
  });

  it("tampered ciphertext throws on decrypt", async () => {
    const enc = await encryptJournalContent(key, { x: 1 });
    const tampered = { ...enc, ct: enc.ct.slice(0, -4) + "XXXX" };
    await expect(decryptJournalContent(key, tampered)).rejects.toThrow();
  });
});
