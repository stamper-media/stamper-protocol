import sharp from "sharp";
import { ssim as ssimJs } from "ssim.js";
import { MAX_INPUT_PIXELS } from "./badge-image.js";
import { checkBytes } from "./validate.js";

export const SSIM_EDGE = 256;

async function grey(img: Uint8Array, size?: { width: number; height: number }) {
  let s = sharp(img, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient().removeAlpha().greyscale();
  s = size
    ? s.resize(size.width, size.height, { fit: "fill" })
    : s.resize(SSIM_EDGE, SSIM_EDGE, { fit: "inside" });
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0, p = 0; p < info.width * info.height; p++, i += info.channels) {
    const v = data[i] as number;
    rgba[p * 4] = v;
    rgba[p * 4 + 1] = v;
    rgba[p * 4 + 2] = v;
    rgba[p * 4 + 3] = 255;
  }
  return { data: rgba, width: info.width, height: info.height };
}

/** Mean SSIM of 256-px grey downscales (b is resized to a's downscaled size). */
export async function ssim(a: Uint8Array, b: Uint8Array): Promise<number> {
  checkBytes("a", a);
  checkBytes("b", b);
  const ga = await grey(a);
  const gb = await grey(b, { width: ga.width, height: ga.height });
  return ssimJs(ga, gb).mssim;
}
