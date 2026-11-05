import { assertBytes, latin1, startsWith } from "./bytes.js";
import type { SniffedType } from "./types.js";

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);
const QT_LEAD = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

/** Identifies the container from magic bytes only (never trusts file names or MIME headers). */
export function sniff(bytes: Uint8Array): SniffedType {
  assertBytes(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length < 12) return "unknown";
  if (startsWith(bytes, 4, "ftyp")) {
    const major = latin1(bytes, 8, 12);
    if (major === "qt  ") return "video/quicktime";
    if (HEIF_BRANDS.has(major)) return "image/heic";
    if (major === "avif" || major === "avis" || major === "crx ") return "unknown";
    return "video/mp4";
  }
  if (QT_LEAD.has(latin1(bytes, 4, 8))) return "video/quicktime";
  return "unknown";
}
