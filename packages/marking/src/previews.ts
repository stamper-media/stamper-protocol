import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "./badge-image.js";
import { checkBytes } from "./validate.js";

/** WebP preview no larger than `maxEdge` on its long side (never upscaled), EXIF-oriented. */
export async function renderPreview(input: Uint8Array, maxEdge: number): Promise<Uint8Array> {
  checkBytes("input", input);
  if (!Number.isInteger(maxEdge) || maxEdge < 16 || maxEdge > 8192)
    throw new RangeError("maxEdge must be an integer in 16..8192");
  const b = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .autoOrient()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

export function renderThumb(input: Uint8Array, size = 320): Promise<Uint8Array> {
  return renderPreview(input, size);
}
