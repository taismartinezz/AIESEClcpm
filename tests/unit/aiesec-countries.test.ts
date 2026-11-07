import { describe, it, expect } from "vitest";
import { AIESEC_COUNTRIES, countryByCode, searchCountries } from "@/lib/aiesecCountries";

// The list as given in the product brief: the constant must match it exactly.
const BRIEF = "Albania, Algeria, Argentina, Armenia, Australia, Austria, Azerbaijan, Bahrain, Bangladesh, Belgium, Benin, Bolivia, Bosnia and Herzegovina, Brazil, Bulgaria, Burkina Faso, Cambodia, Cameroon, Canada, Chile, China (Mainland), Colombia, Costa Rica, Côte d'Ivoire, Croatia, Czech Republic, Denmark, Dominican Republic, Ecuador, Egypt, El Salvador, Estonia, Ethiopia, Finland, France, Georgia, Germany, Ghana, Greece, Guatemala, Hong Kong, Hungary, Iceland, India, Indonesia, Italy, Japan, Jordan, Kazakhstan, Kenya, Kuwait, Kyrgyzstan, Latvia, Lebanon, Liberia, Lithuania, Malaysia, Mexico, Moldova, Mongolia, Montenegro, Morocco, Mozambique, Myanmar, Nepal, Netherlands, New Zealand, Nicaragua, Nigeria, North Macedonia, Norway, Pakistan, Panama, Paraguay, Peru, Philippines, Poland, Portugal, Romania, Russia, Rwanda, Senegal, Serbia, Singapore, Slovakia, South Africa, South Korea, Spain, Sri Lanka, Sweden, Switzerland, Taiwan, Tanzania, Thailand, Togo, Tunisia, Turkey, Uganda, Ukraine, United Arab Emirates, United Kingdom, United States, Venezuela, Vietnam"
  .split(", ");

describe("AIESEC countries", () => {
  it("are exactly the brief's list, with unique two-letter codes and a flag each", () => {
    expect([...AIESEC_COUNTRIES.map((c) => c.name)].sort()).toEqual([...BRIEF].sort());
    const codes = AIESEC_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(countryByCode("ci")?.flag).toBe("🇨🇮");
    expect(countryByCode("US")?.name).toBe("United States");
    expect(countryByCode("ZZ")).toBeNull();
  });

  it("search ignores accents and case, and puts word starts first", () => {
    expect(searchCountries("cote").map((c) => c.name)).toEqual(["Côte d'Ivoire"]);
    expect(searchCountries("KOREA")[0].name).toBe("South Korea");
    expect(searchCountries("united").map((c) => c.name)).toEqual(["United Arab Emirates", "United Kingdom", "United States"]);
    expect(searchCountries("xyz")).toEqual([]);
    expect(searchCountries("")).toHaveLength(BRIEF.length);
  });
});
