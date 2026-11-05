import { normaliseCode } from "@stamper/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyBadgeImage, createMlClients, hamming } from "../src/index.js";
import { CODE9, DIGEST, patternJpeg } from "./fixtures.js";

const ML_URL = process.env.ML_URL;

describe.skipIf(!ML_URL)(
  `ml sidecar integration${ML_URL ? "" : " (skipped: ML_URL not set)"}`,
  () => {
    it("badge → watermark round trip, PDQ drift and survival after q80 + 0.75×", async () => {
      const ml = createMlClients(ML_URL as string, { timeoutMs: 120_000 });
      expect((await ml.health()).ok).toBe(true);
      const original = await patternJpeg(1600, 1200);
      const code = normaliseCode(CODE9);
      if (!code.ok) throw new Error("fixture code");
      const marked = await applyBadgeImage(original, {
        family: "F1",
        code9: CODE9,
        imageDigest: DIGEST,
      });
      const wm = await ml.watermark.encode(marked.bytes, code.value);
      const dec = await ml.watermark.decode(wm.bytes);
      expect(dec.ok).toBe(true);
      expect(dec.payload40).toBe(code.value);

      const drift = hamming((await ml.pdq.hash(original)).bits, (await ml.pdq.hash(wm.bytes)).bits);
      console.info(`badge-vs-PDQ drift (hamming) = ${drift}`);
      expect(drift).toBeLessThanOrEqual(15);

      const degraded = await sharp(wm.bytes).resize(1200).jpeg({ quality: 80 }).toBuffer();
      const again = await ml.watermark.decode(new Uint8Array(degraded));
      expect(again.payload40).toBe(code.value);
    });
  },
);
