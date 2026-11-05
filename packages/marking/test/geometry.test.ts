import { describe, expect, it } from "vitest";
import { type BadgeFamily, badgeGeometry } from "../src/index.js";

function inCentral45(w: number, h: number, g: ReturnType<typeof badgeGeometry>) {
  const crop =
    w * 5 > h * 4
      ? { l: Math.floor((w - Math.floor((h * 4) / 5)) / 2), t: 0 }
      : { l: 0, t: Math.floor((h - Math.floor((w * 5) / 4)) / 2) };
  const r = w - crop.l;
  const b = h - crop.t;
  return (
    g.x >= crop.l + g.margin &&
    g.x + g.width <= r - g.margin &&
    g.y >= crop.t &&
    g.y + g.pillH <= b - g.margin
  );
}

describe("badgeGeometry", () => {
  it("1080×1350 follows DESIGN §6.1", () => {
    const g = badgeGeometry(1080, 1350, "F1");
    expect(g).toMatchObject({
      shortSide: 1080,
      pillH: 54,
      radius: 27,
      margin: 32,
      capHeight: 18,
      fontPx: 25,
    });
    expect(g.capHeight).toBeGreaterThanOrEqual(17);
    expect(g.x + g.width).toBe(1080 - 32);
    expect(g.y).toBe(1350 - 32 - 54);
  });

  it.each([
    [1080, 1350],
    [4000, 3000],
    [720, 1280],
    [480, 480],
    [1920, 1080],
    [3000, 4000],
  ])("%i×%i stays inside the central 4:5 crop for every family", (w, h) => {
    for (const f of ["F0", "F1", "F2"] as BadgeFamily[]) {
      const g = badgeGeometry(w, h, f);
      expect(inCentral45(w, h, g)).toBe(true);
      expect(g.capHeight).toBeGreaterThanOrEqual(0.016 * g.shortSide);
      expect(g.fontPx * 0.73).toBeGreaterThanOrEqual(g.capHeight);
      expect(g.pillH % 2).toBe(0);
      expect(Math.abs(g.pillH - 0.05 * g.shortSide)).toBeLessThanOrEqual(1);
    }
  });

  it("4000×3000 is inset by the side crop; 720×1280 by the vertical crop", () => {
    const a = badgeGeometry(4000, 3000, "F1");
    expect(a.x + a.width).toBe(4000 - 800 - a.margin);
    const b = badgeGeometry(720, 1280, "F1");
    expect(b.y + b.pillH).toBe(1280 - 190 - b.margin);
  });

  it("F2 is wider than F1; families never share geometry", () => {
    const f1 = badgeGeometry(1080, 1350, "F1");
    const f2 = badgeGeometry(1080, 1350, "F2");
    const f0 = badgeGeometry(1080, 1350, "F0");
    expect(f2.width).toBeGreaterThan(f1.width);
    expect(f0.width).not.toBe(f1.width);
  });

  it("rejects bad input", () => {
    expect(() => badgeGeometry(100, 100, "F1")).toThrow(/too small/);
    expect(() => badgeGeometry(10.5, 1000, "F1")).toThrow(RangeError);
    expect(() => badgeGeometry(1000, 1000, "F9" as BadgeFamily)).toThrow(/family/);
  });
});
