// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CHAPTERS, CORE, MC_TOUR, chapterSteps, chaptersFor, pageSteps, stepsFor, type TourRole, type TourStep } from "@/lib/tours";
import { NAV_ITEMS, PRIMARY, SHELL_CONTROLS } from "@/lib/nav";
import { SECTIONS } from "@/components/layout/SectionTabs";
import { placeCard } from "@/components/ui/OnboardingModal";

const ALL: TourStep[] = [...CORE, ...MC_TOUR, ...CHAPTERS.flatMap((c) => c.steps)];
const ROLES: TourRole[] = ["member", "vp", "president"];
const anchors = (s: TourStep) => (s.targets ?? []).join(" ");

describe("tour coverage", () => {
  // Built from the menu, the page tabs and the shell's controls, so a new one fails here until it has a step.
  it("every menu item has a step", () => {
    for (const { href, label } of NAV_ITEMS) {
      const covered = ALL.some((s) => s.route?.split("?")[0] === href || s.covers?.includes(href) || anchors(s).includes(`nav:${href}`));
      expect(covered, `${label} (${href}) has no tour step`).toBe(true);
    }
  });

  it("every page tab has a step", () => {
    for (const section of SECTIONS) for (const t of section.tabs) {
      expect(ALL.some((s) => s.route === t.href), `${section.label} → ${t.label} (${t.href}) has no tour step`).toBe(true);
    }
  });

  it("every top-bar and menu control has a step", () => {
    for (const id of SHELL_CONTROLS) {
      expect(ALL.some((s) => anchors(s).includes(`[data-tour="${id}"]`)), `control "${id}" has no tour step`).toBe(true);
    }
  });
});

describe("tour steps", () => {
  it("have unique ids, and only Welcome and Finish cards go without an anchor", () => {
    const ids = new Set<string>();
    for (const s of ALL) {
      expect(s.id, s.title).toBeTruthy();
      if (!ids.has(s.id!)) ids.add(s.id!);
      const card = s.kind === "chapters" || /welcome|done|^mc-welcome/.test(s.id!);
      if (!card) expect(s.targets?.length, `${s.id} needs an anchor`).toBeGreaterThan(0);
    }
  });

  it("say it in at most two short sentences", () => {
    for (const s of ALL) {
      const sentences = s.body.split(/(?<=[.!?])\s+(?=[A-Z"])/).filter(Boolean);
      expect(sentences.length, `${s.id}: ${s.body}`).toBeLessThanOrEqual(2);
      expect(s.body.length, s.id).toBeLessThanOrEqual(190);
    }
  });

  it("the core tour is short and ends on the chapter picker", () => {
    for (const role of ROLES) {
      const core = stepsFor(CORE, { role });
      expect(core.length).toBeLessThanOrEqual(10);
      expect(core[core.length - 1].kind).toBe("chapters");
    }
  });

  it("members never see setup or approval steps; only the MC sees National", () => {
    const member = chaptersFor({ role: "member" });
    expect(member.map((c) => c.id)).not.toContain("setup");
    const memberSteps = member.flatMap((c) => chapterSteps(c.id, { role: "member" }));
    for (const id of ["departments", "invites", "import", "finance-approve", "announcements", "recruitment", "settings-wellbeing"]) {
      expect(memberSteps.map((s) => s.id)).not.toContain(id);
    }
    const national = (onMc: boolean) => chapterSteps("getting-around", { role: "vp", onMc }).some((s) => s.id === "national");
    expect(national(false)).toBe(false);
    expect(national(true)).toBe(true);
  });

  it("each chapter ends on the chapter picker", () => {
    for (const c of CHAPTERS) {
      const steps = chapterSteps(c.id, { role: c.roles[0] });
      expect(steps[steps.length - 1].kind).toBe("chapters");
    }
  });

  it("a page's tour is that page's steps, once each", () => {
    const ids = pageSteps("/settings", { role: "president" }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["departments", "invites", "link-mc", "settings-notifications", "settings-wellbeing"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(pageSteps("/settings", { role: "member" }).map((s) => s.id)).toEqual(["settings-notifications"]);
    expect(pageSteps("/mc", { role: "member" })).toBe(MC_TOUR);
  });
});

describe("placing the card", () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  const overlaps = (p: { left: number; top: number }, r: DOMRect, w: number, h: number) =>
    p.left < r.right && p.left + w > r.left && p.top < r.bottom && p.top + h > r.top;

  it("goes beside the anchor, never on it", () => {
    for (const [r, side] of [
      [rect(20, 400, 180, 36), "right"],          // a menu item
      [rect(1200, 10, 40, 34), "bottom"],          // a top-bar button at the right edge
      [rect(300, 700, 600, 120), "bottom"],        // low on the page: no room below
      [rect(240, 120, 900, 60), "right"],          // wide: no room beside it
    ] as const) {
      const p = placeCard(r, side, 320, 220, 1440, 900);
      expect(p.side, JSON.stringify(r)).not.toBeNull();
      expect(overlaps(p, r, 320, 220)).toBe(false);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.left + 320).toBeLessThanOrEqual(1432);
      expect(p.top + 220).toBeLessThanOrEqual(892);
    }
  });
});

describe("chat access", () => {
  for (const role of ["member", "vp", "president"] as const) {
    it(`keeps Chat in the primary menu for ${role}`, () => {
      expect(PRIMARY[role]).toContain("/chat");
    });
  }
});
