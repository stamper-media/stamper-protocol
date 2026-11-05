import sharp, { type Sharp } from "sharp";
import { MAX_INPUT_PIXELS } from "./badge-image.js";
import { checkBytes } from "./validate.js";

/**
 * PDQ index variant ids (fixed; mirrored by `renditions.variant` in the DB):
 * 0–3 rotate 0/90/180/270° clockwise; 4–7 mirror horizontally, then rotate 0/90/180/270°;
 * 8 central 4:5 crop; 9 central 1:1 crop. All on the EXIF-oriented image, emitted as PNG.
 */
export const PDQ_VARIANTS = [
  "rot0",
  "rot90",
  "rot180",
  "rot270",
  "mirror",
  "mirror-rot90",
  "mirror-rot180",
  "mirror-rot270",
  "crop-4x5",
  "crop-1x1",
] as const;

type Raw = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

function centreCrop(w: number, h: number, aw: number, ah: number) {
  if (w * ah > h * aw) {
    const cw = Math.max(1, Math.floor((h * aw) / ah));
    return { left: Math.floor((w - cw) / 2), top: 0, width: cw, height: h };
  }
  const ch = Math.max(1, Math.floor((w * ah) / aw));
  return { left: 0, top: Math.floor((h - ch) / 2), width: w, height: ch };
}

function fromRaw(r: Raw) {
  return sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });
}

async function toRaw(s: Sharp): Promise<Raw> {
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

const png = async (s: Sharp) => {
  const b = await s.png({ compressionLevel: 1 }).toBuffer();
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};

export async function pdqVariants(
  image: Uint8Array,
): Promise<Array<{ variant: number; bytes: Uint8Array }>> {
  checkBytes("image", image);
  const base = await toRaw(sharp(image, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient());
  const mirrored = await toRaw(fromRaw(base).flop());
  const out: Array<{ variant: number; bytes: Uint8Array }> = [];
  for (const [offset, src] of [
    [0, base],
    [4, mirrored],
  ] as const) {
    for (let k = 0; k < 4; k++) {
      const s = k === 0 ? fromRaw(src) : fromRaw(src).rotate(90 * k);
      out.push({ variant: offset + k, bytes: await png(s) });
    }
  }
  out.push({
    variant: 8,
    bytes: await png(fromRaw(base).extract(centreCrop(base.width, base.height, 4, 5))),
  });
  out.push({
    variant: 9,
    bytes: await png(fromRaw(base).extract(centreCrop(base.width, base.height, 1, 1))),
  });
  return out;
}

export function hamming(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new RangeError("hamming: length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = (a[i] as number) ^ (b[i] as number);
    while (x) {
      x &= x - 1;
      d++;
    }
  }
  return d;
}

/** 32-byte PDQ hash → 256-char '0'/'1' string, most significant bit of byte 0 first (pgvector bit(256)). */
export function pdqToBitString(bits: Uint8Array): string {
  if (bits.length !== 32) throw new RangeError("PDQ hash must be 32 bytes");
  let s = "";
  for (const b of bits) s += b.toString(2).padStart(8, "0");
  return s;
}
