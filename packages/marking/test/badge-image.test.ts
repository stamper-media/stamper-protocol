import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { applyBadgeImage, badgeGeometry, paramsHash } from "../src/index.js";
import { CODE9, DIGEST, patternJpeg, pixel, rotatedExif6 } from "./fixtures.js";

let landscape: Uint8Array;
beforeAll(async () => {
  landscape = await patternJpeg(1920, 1080);
});

describe("applyBadgeImage", () => {
  it("keeps dimensions, emits 4:4:4 JPEG without metadata, records params", async () => {
    const r = await applyBadgeImage(landscape, { family: "F1", code9: CODE9, imageDigest: DIGEST });
    expect([r.width, r.height]).toEqual([1920, 1080]);
    const m = await sharp(r.bytes).metadata();
    expect(m).toMatchObject({
      format: "jpeg",
      width: 1920,
      height: 1080,
      chromaSubsampling: "4:4:4",
    });
    expect(m.exif).toBeUndefined();
    expect(r.params).toMatchObject({
      v: 1,
      family: "F1",
      imageDigest: DIGEST,
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
    });
    expect(r.params.geometry).toEqual(badgeGeometry(1920, 1080, "F1"));
    // The pill darkens its area.
    const g = r.params.geometry;
    const cx = g.x + Math.round(g.pillH / 4);
    const cy = g.y + g.pillH / 2;
    const before = await pixel(landscape, cx, cy);
    const after = await pixel(r.bytes, cx, cy);
    expect(after[0] + after[1] + after[2]).toBeLessThan(before[0] + before[1] + before[2]);
  });

  it("is byte-identical across runs with a stable paramsHash", async () => {
    const o = { family: "F2" as const, code9: CODE9, imageDigest: DIGEST };
    const a = await applyBadgeImage(landscape, o);
    const b = await applyBadgeImage(landscape, o);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(paramsHash(a.params)).toBe(paramsHash(b.params));
  });

  it("applies EXIF orientation 6 and ends upright", async () => {
    const r = await applyBadgeImage(await rotatedExif6(), {
      family: "F1",
      code9: CODE9,
      imageDigest: DIGEST,
    });
    expect([r.width, r.height]).toEqual([400, 600]);
    const right = await pixel(r.bytes, 380, 40);
    const left = await pixel(r.bytes, 20, 40);
    expect(right[0]).toBeGreaterThan(200); // stored top (red) is now on the right
    expect(right[2]).toBeLessThan(60);
    expect(left[2]).toBeGreaterThan(200);
    expect((await sharp(r.bytes).metadata()).orientation).toBeUndefined();
  });

  it("handles a 4000×3000 capture", async () => {
    const r = await applyBadgeImage(await patternJpeg(4000, 3000), {
      family: "F0",
      code9: CODE9,
      imageDigest: DIGEST,
    });
    expect([r.width, r.height]).toEqual([4000, 3000]);
  });

  it("rejects bad input", async () => {
    await expect(
      applyBadgeImage(new Uint8Array(), { family: "F1", code9: CODE9, imageDigest: DIGEST }),
    ).rejects.toThrow();
    await expect(
      applyBadgeImage(landscape, { family: "F1", code9: "nope", imageDigest: DIGEST }),
    ).rejects.toThrow(/invalid code/);
    await expect(
      applyBadgeImage(landscape, { family: "F1", code9: CODE9, imageDigest: "" }),
    ).rejects.toThrow(/imageDigest/);
  });
});
