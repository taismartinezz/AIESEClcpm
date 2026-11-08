import { describe, it, expect } from "vitest";
import { lcNameKey } from "@/lib/lcNames";

describe("LC name matching (same as the database's lc_name_key)", () => {
  it("ignores case, accents, punctuation and filler words", () => {
    expect(lcNameKey("AIESEC in Lisbón!")).toBe("lisbon");
    expect(lcNameKey("aiesec Lisbon")).toBe("lisbon");
    expect(lcNameKey("LC  Lisbon")).toBe("lisbon");
    expect(lcNameKey("AIESEC at Northwestern")).toBe("northwestern");
    expect(lcNameKey("AIESEC en Santo Domingo")).toBe("santodomingo");
  });
  it("keeps different LCs apart", () => {
    expect(lcNameKey("AIESEC in Lisbon")).not.toBe(lcNameKey("AIESEC in Lisboa"));
    expect(lcNameKey("AIESEC in Porto")).not.toBe(lcNameKey("AIESEC in Lisbon"));
    expect(lcNameKey("AIESEC")).toBe("");
  });
});
