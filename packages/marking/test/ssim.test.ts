import { describe, expect, it } from "vitest";
import { applyBadgeImage, ssim } from "../src/index.js";
import { CODE9, DIGEST, patternJpeg, rotatedExif6 } from "./fixtures.js";

describe("ssim", () => {
  it("is 1 for the same input, high for a badged copy, low for another image", async () => {
    const a = await patternJpeg(1200, 900);
    expect(await ssim(a, a)).toBeCloseTo(1, 9);
    const marked = (await applyBadgeImage(a, { family: "F1", code9: CODE9, imageDigest: DIGEST }))
      .bytes;
    const s = await ssim(a, marked);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.85);
    expect(await ssim(a, await rotatedExif6())).toBeLessThan(0.5);
  });
});
