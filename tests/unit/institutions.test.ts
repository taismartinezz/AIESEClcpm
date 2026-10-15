import { describe, it, expect } from "vitest";
import {
  resolveResources,
  hasNoCounselingResources,
  getRegistryResources,
  INSTITUTION_REGISTRY,
} from "@/lib/support/institutions";
import type { LabResource } from "@/lib/support/institutions";

// ── Factory ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<LabResource> = {}): LabResource {
  return {
    id: crypto.randomUUID(),
    label: "Test resource",
    description: null,
    confidentiality: null,
    category: "counseling",
    contact_type: "phone",
    contact_value: "555-0100",
    availability: null,
    is_pinned: false,
    sort_order: 0,
    active: true,
    ...overrides,
  };
}

// ── Guard: contact values must match what was written in this prompt ───────────

describe("Northwestern registry — contact value guard", () => {
  it("contains 847-491-2151 in the CAPS on-call entry", () => {
    const oncall = INSTITUTION_REGISTRY.northwestern.resources.find(
      (r) => r.id === "__reg__northwestern_caps_oncall",
    );
    expect(oncall?.contact_value).toBe("847-491-2151");
  });

  it("contains 847-491-2151 in the CAPS counseling entry", () => {
    const caps = INSTITUTION_REGISTRY.northwestern.resources.find(
      (r) => r.id === "__reg__northwestern_caps",
    );
    expect(caps?.contact_value).toBe("847-491-2151");
  });

  it("contains the correct CAPS website URL", () => {
    const website = INSTITUTION_REGISTRY.northwestern.resources.find(
      (r) => r.id === "__reg__northwestern_caps_website",
    );
    expect(website?.contact_value).toBe("https://www.northwestern.edu/counseling/");
  });
});

// ── Scenario 1: Northwestern lab with zero PI rows ────────────────────────────

describe("resolveResources — Northwestern, no PI rows", () => {
  const result = resolveResources([], "northwestern", "US");

  it("includes the CAPS on-call urgent entry", () => {
    expect(result.some((r) => r.id === "__reg__northwestern_caps_oncall")).toBe(true);
  });

  it("includes the 988 crisis default", () => {
    expect(result.some((r) => r.id === "__crisis_default_us__")).toBe(true);
  });

  it("includes CAPS counseling entry", () => {
    expect(result.some((r) => r.id === "__reg__northwestern_caps")).toBe(true);
  });

  it("orders CAPS on-call before 988", () => {
    const oncallIdx = result.findIndex((r) => r.id === "__reg__northwestern_caps_oncall");
    const crisisIdx = result.findIndex((r) => r.id === "__crisis_default_us__");
    expect(oncallIdx).toBeLessThan(crisisIdx);
  });

  it("has at least one urgent entry", () => {
    const urgent = result.filter((r) => r.category === "urgent" || r.is_pinned);
    expect(urgent.length).toBeGreaterThan(0);
  });
});

// ── Scenario 2: PI counseling row suppresses registry counseling ───────────────

describe("resolveResources — PI counseling row suppresses registry", () => {
  const piCounseling = makeRow({ category: "counseling", label: "Lab counselor" });
  const result = resolveResources([piCounseling], "northwestern", "US");

  it("includes the PI counseling row", () => {
    expect(result.some((r) => r.id === piCounseling.id)).toBe(true);
  });

  it("suppresses the CAPS counseling registry entry", () => {
    expect(result.some((r) => r.id === "__reg__northwestern_caps")).toBe(false);
  });

  it("suppresses the CAPS website registry entry (same category)", () => {
    expect(result.some((r) => r.id === "__reg__northwestern_caps_website")).toBe(false);
  });

  it("still includes CAPS on-call urgent entry (different category)", () => {
    expect(result.some((r) => r.id === "__reg__northwestern_caps_oncall")).toBe(true);
  });

  it("still includes 988", () => {
    expect(result.some((r) => r.id === "__crisis_default_us__")).toBe(true);
  });

  it("PI row appears before registry rows in the same category section", () => {
    const piIdx = result.findIndex((r) => r.id === piCounseling.id);
    // No registry counseling rows present; just verify PI row is in result
    expect(piIdx).toBeGreaterThanOrEqual(0);
  });
});

// ── Scenario 3: Unrecognized institution_key ──────────────────────────────────

describe("resolveResources — unrecognized institution_key", () => {
  const result = resolveResources([], "unknown_university", "US");

  it("includes 988 as the sole urgent entry", () => {
    const urgent = result.filter((r) => r.category === "urgent" || r.is_pinned);
    expect(urgent.length).toBe(1);
    expect(urgent[0].id).toBe("__crisis_default_us__");
  });

  it("has no counseling entries", () => {
    expect(result.filter((r) => r.category === "counseling").length).toBe(0);
  });
});

// ── Scenario 4: Zero contact actions invariant ────────────────────────────────

describe("resolveResources — zero urgent entries impossible", () => {
  it("always has at least one urgent entry even with no PI rows and null institution", () => {
    const result = resolveResources([], null, "US");
    const urgent = result.filter((r) => r.category === "urgent" || r.is_pinned);
    expect(urgent.length).toBeGreaterThan(0);
  });

  it("always has at least one urgent entry for an unrecognized institution", () => {
    const result = resolveResources([], "nowhere", "US");
    const urgent = result.filter((r) => r.category === "urgent" || r.is_pinned);
    expect(urgent.length).toBeGreaterThan(0);
  });

  it("always has at least one urgent entry for Northwestern with PI rows", () => {
    const piRow = makeRow({ category: "urgent", label: "Emergency line" });
    const result = resolveResources([piRow], "northwestern", "US");
    const urgent = result.filter((r) => r.category === "urgent" || r.is_pinned);
    expect(urgent.length).toBeGreaterThan(0);
  });
});

// ── hasNoCounselingResources ──────────────────────────────────────────────────

describe("hasNoCounselingResources", () => {
  it("returns false for Northwestern with no PI rows (registry has counseling)", () => {
    expect(hasNoCounselingResources([], "northwestern")).toBe(false);
  });

  it("returns true for unrecognized institution with no PI rows", () => {
    expect(hasNoCounselingResources([], "unknown_university")).toBe(true);
  });

  it("returns true for null institution with no PI rows", () => {
    expect(hasNoCounselingResources([], null)).toBe(true);
  });

  it("returns false when PI has a counseling row and institution is unrecognized", () => {
    const piRow = makeRow({ category: "counseling" });
    expect(hasNoCounselingResources([piRow], "unknown_university")).toBe(false);
  });
});

// ── getRegistryResources ──────────────────────────────────────────────────────

describe("getRegistryResources", () => {
  it("returns empty array for null key", () => {
    expect(getRegistryResources(null)).toHaveLength(0);
  });

  it("returns empty array for unrecognized key", () => {
    expect(getRegistryResources("nowhere")).toHaveLength(0);
  });

  it("returns 3 entries for northwestern", () => {
    expect(getRegistryResources("northwestern")).toHaveLength(3);
  });
});
