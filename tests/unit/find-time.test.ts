import { describe, it, expect } from "vitest";
import { findTimes } from "@/lib/find-time";
import { gridToIntervals, normaliseSlots, parseSlotKey, slotKey, zonedToUtc } from "@/lib/availability";

const TZ = "Europe/Lisbon";
const at = (d: number, h: number, min = 0) => zonedToUtc(2026, 10, d, h * 60 + min, TZ);   // Oct 2026
const iv = (start: number, end: number) => ({ start, end });

describe("availability grid keys", () => {
  it("reads the old Mon–Fri 9:00 grid and the new 7-day format", () => {
    expect(parseSlotKey("0-0")).toEqual({ day: 0, startMin: 540 });       // Mon 9:00 (old)
    expect(parseSlotKey("4-15")).toEqual({ day: 4, startMin: 990 });      // Fri 16:30 (old)
    expect(parseSlotKey("6-19:30")).toEqual({ day: 6, startMin: 1170 });  // Sun 19:30
    expect(parseSlotKey("nope")).toBeNull();
    expect(normaliseSlots(["0-0", "0-09:00", "2-3"])).toEqual(["0-09:00", "2-10:30"]);
    expect(slotKey(5, 20 * 60)).toBe("5-20:00");
  });

  it("turns the grid into real times in the person's time zone, across a clock change", () => {
    // Lisbon leaves summer time on Sun Oct 25 2026: 18:00 local is 17:00 UTC before, 18:00 UTC after.
    const ivs = gridToIntervals(["5-18:00", "6-18:00"], TZ, Date.UTC(2026, 9, 24), Date.UTC(2026, 9, 26));
    expect(ivs.map((i) => new Date(i.start).toISOString())).toEqual(["2026-10-24T17:00:00.000Z", "2026-10-25T18:00:00.000Z"]);
  });
});

describe("findTimes", () => {
  const opts = { durationMin: 60, from: at(19, 0), to: at(22, 0), timeZone: TZ };

  it("picks times when everyone is free, on different days", () => {
    const ana = { id: "ana", source: "google" as const, busy: [iv(at(19, 8), at(19, 18))] };
    const bo = { id: "bo", source: "grid" as const, busy: [], free: [iv(at(19, 18), at(19, 21)), iv(at(20, 19), at(20, 21))] };
    const s = findTimes([ana, bo], opts);
    expect(s.length).toBe(3);
    expect(s[0]).toMatchObject({ start: at(19, 18), free: ["ana", "bo"], busy: [] });
    expect(s[1]).toMatchObject({ start: at(20, 19), free: ["ana", "bo"] });
    expect(new Set(s.slice(0, 2).map((x) => new Date(x.start).getUTCDate())).size).toBe(2);
  });

  it("offers the best partial time when nobody overlaps, naming who's busy", () => {
    const ana = { id: "ana", source: "grid" as const, busy: [], free: [iv(at(19, 9), at(19, 10))] };
    const bo = { id: "bo", source: "grid" as const, busy: [], free: [iv(at(19, 18), at(19, 19))] };
    const s = findTimes([ana, bo], opts);
    expect(s[0]).toMatchObject({ start: at(19, 9), free: ["ana"], busy: ["bo"] });
  });

  it("counts people with no calendar or grid as unknown, not busy", () => {
    const cy = { id: "cy", source: "none" as const, busy: [] };
    expect(findTimes([cy, { id: "ana", source: "google" as const, busy: [] }], opts)[0].unknown).toEqual(["cy"]);
  });

  it("app events make people busy whatever their source", () => {
    const meeting = iv(at(19, 18), at(19, 20));
    const s = findTimes([{ id: "ana", source: "google" as const, busy: [meeting] }], { ...opts, to: at(20, 0), dayStartMin: 18 * 60, dayEndMin: 21 * 60 });
    expect(s[0].start).toBe(at(19, 20));
  });
});
