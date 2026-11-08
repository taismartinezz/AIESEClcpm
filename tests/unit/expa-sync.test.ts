import { describe, it, expect } from "vitest";
import { planSync, profileFromExpa, type ExpaApplication } from "@/lib/expa-sync";
import { countryFromMc, isLcPresident, lcDisplayName } from "@/lib/expa-profile";

const LC = "1001";
const app = (over: Partial<ExpaApplication> & { prog?: string; homeLc?: string; hostLc?: string }): ExpaApplication => ({
  id: over.id ?? 1, status: over.status ?? "open", created_at: "2026-09-01T10:00:00Z",
  date_matched: over.date_matched ?? null, date_approved: over.date_approved ?? null, date_realized: over.date_realized ?? null,
  experience_end_date: over.experience_end_date ?? null,
  person: { id: 55, full_name: " Ana Lima ", email: "ana@x.org", contact_detail: { phone: "+1 809 555 0100" }, home_lc: { id: over.homeLc ?? LC, name: "AIESEC in Santo Domingo" } },
  opportunity: { id: 9, title: "Teach English", programme: { id: 0, short_name_display: over.prog ?? "GV" }, host_lc: { id: over.hostLc ?? "2002", name: "AIESEC in Lima" } },
});

describe("EXPA sync plan", () => {
  it("files outgoing and incoming applications under the right product, with EP details", () => {
    const plan = planSync([
      app({ id: 1 }),
      app({ id: 2, prog: "GTa", homeLc: "3003", hostLc: LC }),
      app({ id: 3, prog: "GTe" }),
    ], LC);
    expect(Object.keys(plan.byProduct).sort()).toEqual(["igta", "ogte", "ogv"]);
    expect(plan.byProduct.ogv![0]).toMatchObject({
      stage: "applied", expa_id: "1", person_name: "Ana Lima", email: "ana@x.org", phone: "+1 809 555 0100",
      opportunity: "Teach English", host_entity: "AIESEC in Lima", applied_at: "2026-09-01", expa_url: "https://expa.aiesec.org/people/55",
    });
    // Incoming: the "host / home" column shows the EP's home LC.
    expect(plan.byProduct.igta![0].host_entity).toBe("AIESEC in Santo Domingo");
  });

  it("maps EXPA statuses to stages and leaves out rejected and withdrawn ones", () => {
    const plan = planSync([
      app({ id: 1, status: "matched", date_matched: "2026-09-05" }),
      app({ id: 2, status: "approved", date_approved: "2026-09-10" }),
      app({ id: 3, status: "realized", date_realized: "2026-10-01", experience_end_date: "2026-12-01" }),
      app({ id: 4, status: "finished", experience_end_date: "2026-10-30" }),
      app({ id: 5, status: "withdrawn" }),
      app({ id: 6, status: "rejected" }),
    ], LC);
    const rows = plan.byProduct.ogv!;
    expect(rows.map((r) => r.stage)).toEqual(["accepted", "approved", "realized", "finished"]);
    expect(rows[0].accepted_at).toBe("2026-09-05");
    expect(rows[2].finished_at).toBeUndefined();        // a planned end date isn't a finish
    expect(rows[3].finished_at).toBe("2026-10-30");
    expect(plan.skipped).toBe(2);
  });

  it("ignores programmes the pipeline doesn't track and applications not about this LC", () => {
    const plan = planSync([app({ id: 1, prog: "GE" }), app({ id: 2, homeLc: "7", hostLc: "8" })], LC);
    expect(plan.byProduct).toEqual({});
    expect(plan.ignored).toBe(2);
  });
});

describe("EXPA profile for onboarding", () => {
  it("keeps name, https photo, LC, entity and positions", () => {
    const p = profileFromExpa({
      full_name: null, first_name: "Ana", last_name: "Lima", profile_photo: "http://insecure/x.png",
      home_lc: { id: 1001, name: "Santo Domingo" }, home_mc: { name: "Dominican Republic" },
      current_positions: [{ role: { name: "LCP" }, function: { name: "Presidency" } }],
    });
    expect(p).toEqual({ fullName: "Ana Lima", firstName: "Ana", photoUrl: null, lcId: "1001", lcName: "Santo Domingo", mcName: "Dominican Republic", positions: [{ role: "LCP", fn: "Presidency" }] });
  });

  it("finds the country from the entity name", () => {
    expect(countryFromMc("Dominican Republic")).toBe("DO");
    expect(countryFromMc("AIESEC in Côte d'Ivoire")).toBe("CI");
    expect(countryFromMc("USA")).toBe("US");
    expect(countryFromMc("China (Mainland)")).toBe("CN");
    expect(countryFromMc("Atlantis")).toBeNull();
    expect(countryFromMc(null)).toBeNull();
  });

  it("names the LC and spots an LC President (not a VP)", () => {
    expect(lcDisplayName("Santo Domingo")).toBe("AIESEC in Santo Domingo");
    expect(lcDisplayName("AIESEC UNIBE")).toBe("AIESEC UNIBE");
    const with_ = (role: string) => profileFromExpa({ current_positions: [{ role: { name: role } }] });
    expect(isLcPresident(with_("LCP"))).toBe(true);
    expect(isLcPresident(with_("Local Committee President"))).toBe(true);
    expect(isLcPresident(with_("LCVP"))).toBe(false);
    expect(isLcPresident(with_("Vice President oGV"))).toBe(false);
    expect(isLcPresident(with_("MCP"))).toBe(false);
    expect(isLcPresident(with_("Team Member"))).toBe(false);
  });
});
