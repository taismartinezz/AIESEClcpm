import { describe, it, expect } from "vitest";
import { fitInViewport } from "@/components/ui/useViewportFit";

const vp = { width: 400, height: 600 };
const size = { width: 280, height: 320 };

describe("fitInViewport", () => {
  it("leaves a popover that fits where it is", () => {
    expect(fitInViewport({ top: 100, left: 50 }, size, vp)).toEqual({ top: 100, left: 50 });
  });

  it("flips above the anchor when there's no room below", () => {
    expect(fitInViewport({ top: 500, left: 50, anchorTop: 470 }, size, vp)).toEqual({ top: 470 - 6 - 320, left: 50 });
  });

  it("shifts up when it can't flip", () => {
    expect(fitInViewport({ top: 400, left: 50, anchorTop: 200 }, size, vp)).toEqual({ top: 600 - 8 - 320, left: 50 });
  });

  it("pulls back from the right and left edges", () => {
    expect(fitInViewport({ top: 0, left: 300 }, size, vp).left).toBe(400 - 8 - 280);
    expect(fitInViewport({ top: 0, left: -40 }, size, vp)).toEqual({ top: 0, left: 8 });
  });
});
