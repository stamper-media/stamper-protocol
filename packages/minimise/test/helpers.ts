import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const JPEGS = ["iphone.jpg", "pixel.jpg", "orient-3.jpg", "orient-8.jpg"] as const;
export const VIDEOS = ["pixel.mp4", "iphone.mov"] as const;

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export function hasTool(cmd: string, arg = "-version"): boolean {
  try {
    execFileSync(cmd, [arg], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function u32(n: number): Uint8Array {
  return Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = cat(...parts);
  return cat(u32(body.length + 8), enc(type), body);
}

/** Top-level boxes of an MP4, walked independently of src/. */
export function topBoxes(
  b: Uint8Array,
): { type: string; start: number; end: number; header: number }[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  let p = 0;
  while (p + 8 <= b.length) {
    let size = dv.getUint32(p);
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) size = b.length - p;
    out.push({
      type: String.fromCharCode(...b.subarray(p + 4, p + 8)),
      start: p,
      end: p + size,
      header,
    });
    p += size;
  }
  return out;
}

export function mdatPayload(b: Uint8Array): Uint8Array {
  const m = topBoxes(b).find((x) => x.type === "mdat");
  if (!m) throw new Error("no mdat");
  return b.subarray(m.start + m.header, m.end);
}

export const MDAT = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff);
export const KEYS = [
  "com.apple.quicktime.location.ISO6709",
  "com.apple.quicktime.make",
  "com.apple.quicktime.content.identifier",
];

/**
 * Synthetic iOS-style MOV: moov/meta (QuickTime, no version) with mdta keys + ilst, moov/udta/©xyz,
 * one video track whose stco/co64 points at two chunks in mdat.
 */
export function buildMov(opts: { faststart: boolean; co64?: boolean }): Uint8Array {
  const ftyp = box("ftyp", enc("qt  "), u32(0), enc("qt  "));
  const mdat = box("mdat", MDAT);
  const build = (chunk0: number): Uint8Array => {
    const offsets = opts.co64
      ? box("co64", u32(0), u32(2), u32(0), u32(chunk0), u32(0), u32(chunk0 + 32))
      : box("stco", u32(0), u32(2), u32(chunk0), u32(chunk0 + 32));
    const tkhd = new Uint8Array(84);
    tkhd.set(u32(640 << 16), 76);
    tkhd.set(u32(480 << 16), 80);
    const trak = box("trak", box("tkhd", tkhd), box("mdia", box("minf", box("stbl", offsets))));
    const hdlr = box("hdlr", u32(0), u32(0), enc("mdta"), new Uint8Array(13));
    const keys = box("keys", u32(0), u32(KEYS.length), ...KEYS.map((k) => box("mdta", enc(k))));
    const item = (i: number, v: string): Uint8Array => {
      const data = box("data", u32(1), u32(0), enc(v));
      return cat(u32(8 + data.length), u32(i), data);
    };
    const ilst = box(
      "ilst",
      item(1, "-23.5505-046.6333+760.000/"),
      item(2, "Apple"),
      item(3, "UUID-1234"),
    );
    const meta = box("meta", hdlr, keys, ilst);
    const udta = box(
      "udta",
      box("\xa9xyz", Uint8Array.of(0, 17, 0x15, 0xc7), enc("-23.5505-046.6333/")),
    );
    return box("moov", box("mvhd", new Uint8Array(100)), trak, meta, udta);
  };
  if (opts.faststart) {
    const len = build(0).length;
    return cat(ftyp, build(ftyp.length + len + 8), mdat);
  }
  return cat(ftyp, mdat, build(ftyp.length + 8));
}

/** Chunk offsets from the first stco/co64 found by a naive scan (independent of src/). */
export function chunkOffsets(b: Uint8Array): number[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 4; i + 4 <= b.length; i++) {
    const t = String.fromCharCode(...b.subarray(i, i + 4));
    if (t !== "stco" && t !== "co64") continue;
    const n = dv.getUint32(i + 8);
    return Array.from({ length: n }, (_, k) =>
      t === "stco" ? dv.getUint32(i + 12 + k * 4) : Number(dv.getBigUint64(i + 12 + k * 8)),
    );
  }
  return [];
}
