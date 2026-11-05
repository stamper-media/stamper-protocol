import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hamming, PDQ_VARIANTS, pdqToBitString, pdqVariants } from "../src/index.js";
import { patternJpeg, pixel, rotatedExif6 } from "./fixtures.js";

describe("pdqVariants", () => {
  it("returns ids 0–9 with the expected dimensions", async () => {
    const v = await pdqVariants(await patternJpeg(300, 200));
    expect(v.map((x) => x.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(PDQ_VARIANTS).toHaveLength(10);
    const dims = await Promise.all(
      v.map(async (x) => {
        const m = await sharp(x.bytes).metadata();
        return `${m.width}x${m.height}`;
      }),
    );
    expect(dims).toEqual([
      "300x200",
      "200x300",
      "300x200",
      "200x300",
      "300x200",
      "200x300",
      "300x200",
      "200x300",
      "160x200",
      "200x200",
    ]);
  });

  it("orients first and mirrors horizontally for 4–7", async () => {
    const v = await pdqVariants(await rotatedExif6());
    const v0 = v[0]?.bytes as Uint8Array;
    const v4 = v[4]?.bytes as Uint8Array;
    expect((await sharp(v0).metadata()).width).toBe(400);
    expect((await pixel(v0, 390, 10))[0]).toBeGreaterThan(200); // red on the right
    expect((await pixel(v4, 9, 10))[0]).toBeGreaterThan(200); // mirrored: red on the left
  });
});

describe("hamming / pdqToBitString", () => {
  it("counts differing bits", () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    expect(hamming(a, b)).toBe(0);
    b[0] = 0xff;
    b[31] = 0x01;
    expect(hamming(a, b)).toBe(9);
    expect(() => hamming(a, new Uint8Array(31))).toThrow();
  });

  it("renders MSB-first 256-bit strings", () => {
    const b = new Uint8Array(32);
    b[0] = 0x80;
    b[31] = 0x01;
    const s = pdqToBitString(b);
    expect(s).toHaveLength(256);
    expect(s.startsWith("10000000")).toBe(true);
    expect(s.endsWith("00000001")).toBe(true);
    expect(() => pdqToBitString(new Uint8Array(16))).toThrow();
  });
});
