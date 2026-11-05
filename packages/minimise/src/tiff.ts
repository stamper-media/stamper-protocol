import { fail } from "./bytes.js";
import type { PublicExif } from "./types.js";

/** TIFF/EXIF IFD walker and whitelist rewriter for the APP1 Exif payload (after "Exif\0\0"). */

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_ORIENTATION = 0x0112;

export const TAG_NAMES: Record<number, string> = {
  270: "ImageDescription",
  271: "Make",
  272: "Model",
  274: "Orientation",
  282: "XResolution",
  283: "YResolution",
  296: "ResolutionUnit",
  305: "Software",
  306: "DateTime",
  315: "Artist",
  316: "HostComputer",
  531: "YCbCrPositioning",
  33432: "Copyright",
  34665: "ExifIFD",
  34853: "GPSInfo",
  33434: "ExposureTime",
  33437: "FNumber",
  34850: "ExposureProgram",
  34855: "ISO",
  36864: "ExifVersion",
  36867: "DateTimeOriginal",
  36868: "DateTimeDigitized",
  36880: "OffsetTime",
  36881: "OffsetTimeOriginal",
  36882: "OffsetTimeDigitized",
  37386: "FocalLength",
  37500: "MakerNote",
  37510: "UserComment",
  37520: "SubSecTime",
  37521: "SubSecTimeOriginal",
  37522: "SubSecTimeDigitized",
  40961: "ColorSpace",
  40962: "PixelXDimension",
  40963: "PixelYDimension",
  40965: "InteropIFD",
  42016: "ImageUniqueID",
  42032: "CameraOwnerName",
  42033: "BodySerialNumber",
  42034: "LensSpecification",
  42035: "LensMake",
  42036: "LensModel",
  42037: "LensSerialNumber",
  50735: "CameraSerialNumber",
  50341: "PrintIM",
  59932: "Padding",
  18246: "Rating",
};

/** Tags that survive minimisation (whitelist; everything else is dropped). */
const KEEP_IFD0 = new Set([0x010f, 0x0110, 0x0112, 0x011a, 0x011b, 0x0128]);
const KEEP_EXIF = new Set([0x829a, 0x829d, 0x8827, 0x9000, 0x9003, 0x920a, 0xa001, 0xa002, 0xa003]);
export const SERIAL_TAGS = new Set([0xa430, 0xa431, 0xa435, 0xc62f]);
const TAG_MAKERNOTE = 0x927c;

export type IfdEntry = { tag: number; type: number; count: number; raw: Uint8Array | null };

export type ParsedTiff = {
  le: boolean;
  ifd0: IfdEntry[];
  exif: IfdEntry[];
  hasGps: boolean;
  hasThumbnail: boolean;
};

export function tagName(tag: number): string {
  return TAG_NAMES[tag] ?? `Tag0x${tag.toString(16).padStart(4, "0")}`;
}

function rd16(t: Uint8Array, at: number, le: boolean): number {
  if (at < 0 || at + 2 > t.length) fail("EXIF: offset out of range");
  const a = t[at] as number;
  const b = t[at + 1] as number;
  return le ? a | (b << 8) : (a << 8) | b;
}

function rd32(t: Uint8Array, at: number, le: boolean): number {
  if (at < 0 || at + 4 > t.length) fail("EXIF: offset out of range");
  const a = t[at] as number;
  const b = t[at + 1] as number;
  const c = t[at + 2] as number;
  const d = t[at + 3] as number;
  return le
    ? (a | (b << 8) | (c << 16)) + d * 0x1000000
    : a * 0x1000000 + ((b << 16) | (c << 8) | d);
}

function readIfd(
  t: Uint8Array,
  offset: number,
  le: boolean,
  keep: Set<number>,
): { entries: IfdEntry[]; next: number } {
  const n = rd16(t, offset, le);
  if (offset + 2 + n * 12 + 4 > t.length) fail("EXIF: IFD exceeds segment");
  const entries: IfdEntry[] = [];
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12;
    const tag = rd16(t, e, le);
    const type = rd16(t, e + 2, le);
    const count = rd32(t, e + 4, le);
    let raw: Uint8Array | null = null;
    const size = TYPE_SIZE[type];
    // Only whitelisted (or pointer) tags need their value; dropped tags are never dereferenced.
    if (size !== undefined && (keep.has(tag) || tag === TAG_EXIF_IFD)) {
      const len = size * count;
      if (len <= 4) raw = t.slice(e + 8, e + 8 + len);
      else {
        const at = rd32(t, e + 8, le);
        if (at + len > t.length) fail(`EXIF: value of ${tagName(tag)} out of range`);
        raw = t.slice(at, at + len);
      }
    }
    entries.push({ tag, type, count, raw });
  }
  return { entries, next: rd32(t, offset + 2 + n * 12, le) };
}

/** Parses a TIFF structure (the bytes after "Exif\0\0"). Throws MinimiseError when malformed. */
export function parseTiff(t: Uint8Array): ParsedTiff {
  if (t.length < 8) fail("EXIF: TIFF header truncated");
  let le: boolean;
  if (t[0] === 0x49 && t[1] === 0x49) le = true;
  else if (t[0] === 0x4d && t[1] === 0x4d) le = false;
  else fail("EXIF: bad byte order mark");
  if (rd16(t, 2, le) !== 42) fail("EXIF: bad TIFF magic");
  const ifd0Off = rd32(t, 4, le);
  const ifd0 = readIfd(t, ifd0Off, le, KEEP_IFD0);
  const ptr = ifd0.entries.find((e) => e.tag === TAG_EXIF_IFD);
  let exif: IfdEntry[] = [];
  if (ptr) {
    const at = ptr.raw && ptr.raw.length === 4 ? readPtr(ptr.raw, le) : -1;
    if (at < 8 || at === ifd0Off) fail("EXIF: bad Exif IFD pointer");
    exif = readIfd(t, at, le, KEEP_EXIF).entries;
  }
  return {
    le,
    ifd0: ifd0.entries,
    exif,
    hasGps: ifd0.entries.some((e) => e.tag === TAG_GPS_IFD),
    hasThumbnail: ifd0.next !== 0,
  };
}

function readPtr(raw: Uint8Array, le: boolean): number {
  return rd32(raw, 0, le);
}

export type TiffRewrite = {
  /** Rebuilt TIFF bytes, or null when nothing worth keeping remains. */
  tiff: Uint8Array | null;
  removed: string[];
  kept: string[];
  orientation?: number;
  publicExif: PublicExif;
};

function pad2(n: number): number {
  return n + (n & 1);
}

function wr16(b: Uint8Array, at: number, v: number, le: boolean): void {
  if (le) {
    b[at] = v & 0xff;
    b[at + 1] = (v >>> 8) & 0xff;
  } else {
    b[at] = (v >>> 8) & 0xff;
    b[at + 1] = v & 0xff;
  }
}

function wr32(b: Uint8Array, at: number, v: number, le: boolean): void {
  if (le) {
    wr16(b, at, v & 0xffff, true);
    wr16(b, at + 2, (v >>> 16) & 0xffff, true);
  } else {
    wr16(b, at, (v >>> 16) & 0xffff, false);
    wr16(b, at + 2, v & 0xffff, false);
  }
}

function ifdSize(entries: readonly IfdEntry[]): number {
  let v = 0;
  for (const e of entries)
    if ((e.raw as Uint8Array).length > 4) v += pad2((e.raw as Uint8Array).length);
  return 2 + entries.length * 12 + 4 + v;
}

function writeIfd(b: Uint8Array, at: number, entries: readonly IfdEntry[], le: boolean): void {
  wr16(b, at, entries.length, le);
  let values = at + 2 + entries.length * 12 + 4;
  entries.forEach((e, i) => {
    const p = at + 2 + i * 12;
    const raw = e.raw as Uint8Array;
    wr16(b, p, e.tag, le);
    wr16(b, p + 2, e.type, le);
    wr32(b, p + 4, e.count, le);
    if (raw.length <= 4) b.set(raw, p + 8);
    else {
      wr32(b, p + 8, values, le);
      b.set(raw, values);
      values += pad2(raw.length);
    }
  });
  wr32(b, at + 2 + entries.length * 12, 0, le);
}

function ascii(raw: Uint8Array): string {
  let s = "";
  for (const c of raw) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function rational(raw: Uint8Array, le: boolean): number | undefined {
  if (raw.length < 8) return undefined;
  const num = rd32(raw, 0, le);
  const den = rd32(raw, 4, le);
  return den === 0 ? undefined : num / den;
}

function intValue(e: IfdEntry, le: boolean): number | undefined {
  const raw = e.raw;
  if (!raw || e.count < 1) return undefined;
  if (e.type === 3 && raw.length >= 2) return rd16(raw, 0, le);
  if (e.type === 4 && raw.length >= 4) return rd32(raw, 0, le);
  return undefined;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Keeps the whitelist (Orientation, Make, Model, resolution, exposure facts, pixel dims) and drops the rest. */
export function rewriteTiff(t: Uint8Array): TiffRewrite {
  const p = parseTiff(t);
  const le = p.le;
  const removed: string[] = [];
  const kept: string[] = [];
  const keepFrom = (entries: IfdEntry[], keep: Set<number>): IfdEntry[] => {
    const out: IfdEntry[] = [];
    for (const e of entries) {
      if (e.tag === TAG_EXIF_IFD) continue;
      if (keep.has(e.tag) && e.raw && !out.some((o) => o.tag === e.tag)) out.push(e);
      else if (!removed.includes(tagName(e.tag))) removed.push(tagName(e.tag));
    }
    return out.sort((a, b) => a.tag - b.tag);
  };
  const ifd0 = keepFrom(p.ifd0, KEEP_IFD0);
  const exif = keepFrom(p.exif, KEEP_EXIF);
  if (p.hasThumbnail) removed.push("IFD1Thumbnail");
  for (const e of [...ifd0, ...exif]) kept.push(tagName(e.tag));

  const publicExif: PublicExif = {};
  let orientation: number | undefined;
  for (const e of [...ifd0, ...exif]) {
    const raw = e.raw as Uint8Array;
    switch (e.tag) {
      case 0x010f:
        if (e.type === 2 && ascii(raw)) publicExif.make = ascii(raw);
        break;
      case 0x0110:
        if (e.type === 2 && ascii(raw)) publicExif.model = ascii(raw);
        break;
      case TAG_ORIENTATION: {
        const v = intValue(e, le);
        if (v !== undefined && v >= 1 && v <= 8) orientation = v;
        break;
      }
      case 0x8827: {
        const v = intValue(e, le);
        if (v !== undefined) publicExif.iso = v;
        break;
      }
      case 0x829a: {
        const v = e.type === 5 ? rational(raw, le) : undefined;
        if (v !== undefined && v > 0)
          publicExif.exposure = v < 1 ? `1/${Math.round(1 / v)}` : `${round(v)}`;
        break;
      }
      case 0x920a: {
        const v = e.type === 5 ? rational(raw, le) : undefined;
        if (v !== undefined) publicExif.focalLength = `${round(v)} mm`;
        break;
      }
    }
  }

  if (ifd0.length === 0 && exif.length === 0) return { tiff: null, removed, kept, publicExif };
  const ifd0All = exif.length
    ? [...ifd0, { tag: TAG_EXIF_IFD, type: 4, count: 1, raw: new Uint8Array(4) }].sort(
        (a, b) => a.tag - b.tag,
      )
    : ifd0;
  const exifAt = 8 + ifdSize(ifd0All);
  const total = exifAt + (exif.length ? ifdSize(exif) : 0);
  const out = new Uint8Array(total);
  out[0] = out[1] = le ? 0x49 : 0x4d;
  wr16(out, 2, 42, le);
  wr32(out, 4, 8, le);
  const ptr = ifd0All.find((e) => e.tag === TAG_EXIF_IFD);
  if (ptr) {
    const raw = new Uint8Array(4);
    wr32(raw, 0, exifAt, le);
    ptr.raw = raw;
  }
  writeIfd(out, 8, ifd0All, le);
  if (exif.length) writeIfd(out, exifAt, exif, le);
  const result: TiffRewrite = { tiff: out, removed, kept, publicExif };
  if (orientation !== undefined) result.orientation = orientation;
  return result;
}

export type TiffFacts = {
  hasGps: boolean;
  hasSerial: boolean;
  hasMakerNote: boolean;
  orientation?: number;
};

export function tiffFacts(t: Uint8Array): TiffFacts {
  const p = parseTiff(t);
  const all = [...p.ifd0, ...p.exif];
  const facts: TiffFacts = {
    hasGps: p.hasGps,
    hasSerial: all.some((e) => SERIAL_TAGS.has(e.tag)),
    hasMakerNote: all.some((e) => e.tag === TAG_MAKERNOTE),
  };
  const o = p.ifd0.find((e) => e.tag === TAG_ORIENTATION);
  const v = o ? intValue(o, p.le) : undefined;
  if (v !== undefined && v >= 1 && v <= 8) facts.orientation = v;
  return facts;
}
