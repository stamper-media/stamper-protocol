import sharp from "sharp";
import { renderBadgeSvg } from "./badge-svg.js";
import { type BadgeFamily, badgeGeometry } from "./geometry.js";
import { baseParams, type RenderParams } from "./params.js";
import { checkBadgeOpts, checkBytes } from "./validate.js";

/** Upper bound on decoded pixels (≈ 200 MP) to refuse decompression bombs. */
export const MAX_INPUT_PIXELS = 200_000_000;

/** Displayed dimensions after EXIF orientation. */
export async function orientedSize(input: Uint8Array): Promise<{ width: number; height: number }> {
  const m = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!m.width || !m.height) throw new Error("cannot read image dimensions");
  const swap = (m.orientation ?? 1) >= 5;
  return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

/**
 * Burns the visible badge into an image: EXIF auto-orient, SVG composite, mozjpeg q92 4:4:4. The
 * derivative carries no metadata (the original keeps its own). Deterministic for a given input.
 */
export async function applyBadgeImage(
  input: Uint8Array,
  opts: { family: BadgeFamily; code9: string; imageDigest: string },
): Promise<{ bytes: Uint8Array; params: RenderParams; width: number; height: number }> {
  checkBytes("input", input);
  const code9 = checkBadgeOpts(opts);
  const { width, height } = await orientedSize(input);
  const geometry = badgeGeometry(width, height, opts.family);
  const svg = renderBadgeSvg({ family: opts.family, code9, geometry });
  const out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
    .autoOrient()
    .composite([{ input: Buffer.from(svg), left: geometry.x, top: geometry.y }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  if (out.info.width !== width || out.info.height !== height) {
    throw new Error(`unexpected output size ${out.info.width}x${out.info.height}`);
  }
  return {
    bytes: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength),
    params: baseParams(opts.family, geometry, opts.imageDigest),
    width,
    height,
  };
}
