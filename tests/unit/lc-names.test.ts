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
  it("covers accents and letters beyond Western Europe", () => {
    expect(lcNameKey("AIESEC in Eskişehir")).toBe(lcNameKey("AIESEC in Eskisehir"));
    expect(lcNameKey("AIESEC in Iğdır")).toBe("igdir");                       // Turkish ğ and dotless ı
    expect(lcNameKey("AIESEC in İstanbul")).toBe("istanbul");                  // Turkish dotted İ
    expect(lcNameKey("AIESEC in Brașov")).toBe("brasov");                      // Romanian ș
    expect(lcNameKey("AIESEC in Timișoara")).toBe(lcNameKey("AIESEC in Timisoara"));
    expect(lcNameKey("AIESEC in Łódź")).toBe("lodz");                          // Polish ł
    expect(lcNameKey("AIESEC in Tromsø")).toBe("tromso");                      // Nordic ø
    expect(lcNameKey("AIESEC in Århus")).toBe("arhus");
  });
  it("keeps names in other scripts instead of dropping them", () => {
    expect(lcNameKey("AIESEC в Москве")).toBe("вмоскве");
    expect(lcNameKey("AIESEC in МОСКВА")).toBe(lcNameKey("AIESEC in Москва"));
    expect(lcNameKey("AIESEC in 北京")).toBe("北京");
    expect(lcNameKey("AIESEC in 北京")).not.toBe(lcNameKey("AIESEC in 上海"));
  });
  it("keeps different LCs apart", () => {
    expect(lcNameKey("AIESEC in Lisbon")).not.toBe(lcNameKey("AIESEC in Lisboa"));
    expect(lcNameKey("AIESEC in Porto")).not.toBe(lcNameKey("AIESEC in Lisbon"));
    expect(lcNameKey("AIESEC")).toBe("");
  });
});
