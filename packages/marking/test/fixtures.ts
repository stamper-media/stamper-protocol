import { execa } from "execa";
import sharp from "sharp";

/** Valid 9-symbol code (core frozen vector: stampId 0x11…11 → 5VEB-TVRA-F). */
export const CODE9 = "5VEBTVRAF";
export const DIGEST = `0x${"ab".repeat(32)}`;

const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** Deterministic RGB test pattern (gradients plus a checkerboard) encoded as JPEG q90. */
export async function patternJpeg(width: number, height: number): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0, i = 0; y < height; y++)
    for (let x = 0; x < width; x++, i += 3) {
      data[i] = Math.floor((x * 255) / width);
      data[i + 1] = Math.floor((y * 255) / height);
      data[i + 2] = ((x >> 5) ^ (y >> 5)) & 1 ? 210 : 40;
    }
  return u8(
    await sharp(data, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
}

/** 600×400 stored pixels (top half red, bottom half blue) tagged EXIF orientation 6 (displays 400×600). */
export async function rotatedExif6(): Promise<Uint8Array> {
  const w = 600;
  const h = 400;
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i += 3) {
      if (y < h / 2) data[i] = 255;
      else data[i + 2] = 255;
    }
  return u8(
    await sharp(data, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer(),
  );
}

export async function pixel(
  img: Uint8Array,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i] as number, data[i + 1] as number, data[i + 2] as number];
}

export async function hasBinary(bin: string): Promise<boolean> {
  try {
    await execa(bin, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** clip-2s.mp4: 640×360 testsrc, 30 fps, 440 Hz AAC, 2 s. */
export async function makeClip(ffmpeg: string, out: string): Promise<void> {
  await execa(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    out,
  ]);
}

/** Top-level MP4 box types in file order. */
export function topLevelBoxes(buf: Uint8Array): string[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: string[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = dv.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    if (size === 1) size = Number(dv.getBigUint64(off + 8));
    else if (size === 0) size = buf.length - off;
    out.push(type);
    if (size < 8) break;
    off += size;
  }
  return out;
}
