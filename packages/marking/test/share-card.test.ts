import { qrPayload } from "@stamper/core";
import jsQRModule from "jsqr";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderShareCard, SHARE_QR, shareQr } from "../src/index.js";
import { CODE9, patternJpeg } from "./fixtures.js";

type Decoder = typeof jsQRModule.default;
// jsqr is a CJS bundle; depending on interop the function is the module or its `default`.
const jsQR: Decoder = jsQRModule.default ?? (jsQRModule as unknown as Decoder);

async function decode(png: Uint8Array) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
  );
}

const SENTENCE =
  "Registered by a capture app key at level 1. Kept on Filecoin; see the record for details.";

describe("renderShareCard", () => {
  it("is a 1080×1350 PNG whose QR decodes to the payload as version 2", async () => {
    const payload = qrPayload(CODE9);
    expect(SHARE_QR.modulePx).toBeGreaterThanOrEqual(8);
    expect(shareQr(payload).size).toBe(25);
    const png = await renderShareCard({ code9: CODE9, tierSentence: SENTENCE, qrPayload: payload });
    const m = await sharp(png).metadata();
    expect(m).toMatchObject({ format: "png", width: 1080, height: 1350 });
    const qr = await decode(png);
    expect(qr?.data).toBe(payload);
    expect(qr?.version).toBe(2);
    const again = await renderShareCard({
      code9: CODE9,
      tierSentence: SENTENCE,
      qrPayload: payload,
    });
    expect(Buffer.from(again).equals(Buffer.from(png))).toBe(true);
  });

  it("renders with a thumbnail and still decodes", async () => {
    const payload = qrPayload(CODE9);
    const png = await renderShareCard({
      code9: CODE9,
      tierSentence: SENTENCE,
      qrPayload: payload,
      thumbnail: await patternJpeg(800, 600),
    });
    expect((await decode(png))?.data).toBe(payload);
  });

  it("refuses payloads that do not fit version 2", async () => {
    expect(() => shareQr("x".repeat(80))).toThrow();
    await expect(
      renderShareCard({ code9: CODE9, tierSentence: SENTENCE, qrPayload: "" }),
    ).rejects.toThrow();
  });
});
