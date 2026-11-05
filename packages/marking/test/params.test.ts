import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { badgeGeometry, FONT_PATH, paramsHash, type RenderParams } from "../src/index.js";
import { baseParams } from "../src/params.js";
import { DIGEST } from "./fixtures.js";

const p = (): RenderParams => baseParams("F1", badgeGeometry(1080, 1350, "F1"), DIGEST);

describe("paramsHash", () => {
  it("is a stable sha256 hex", () => {
    const h = paramsHash(p());
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(paramsHash(p())).toBe(h);
  });

  it("hashes the bundled font file", () => {
    const sha = `0x${createHash("sha256").update(readFileSync(FONT_PATH)).digest("hex")}`;
    expect(p().fontSha256).toBe(sha);
  });

  it("changes when the font, renderer versions or image digest change", () => {
    const base = paramsHash(p());
    expect(paramsHash({ ...p(), fontSha256: `0x${"00".repeat(32)}` })).not.toBe(base);
    expect(paramsHash({ ...p(), sharp: "0.0.0" })).not.toBe(base);
    expect(paramsHash({ ...p(), libvips: "0.0.0" })).not.toBe(base);
    expect(paramsHash({ ...p(), imageDigest: "other" })).not.toBe(base);
    expect(paramsHash({ ...p(), family: "F0" })).not.toBe(base);
  });

  it("accepts a fractional watermark strength and rejects malformed params", () => {
    const wm = {
      lib: "trustmark",
      version: "0.9.2",
      variant: "Q",
      schema: "BCH_SUPER",
      payload: "123",
    } as const;
    const a = paramsHash({ ...p(), watermark: { ...wm, strength: 1 } });
    expect(paramsHash({ ...p(), watermark: { ...wm, strength: 0.8 } })).not.toBe(a);
    expect(() => paramsHash({ ...p(), imageDigest: "" })).toThrow();
    expect(() => paramsHash({ ...p(), extra: 1 } as unknown as RenderParams)).toThrow();
  });
});
