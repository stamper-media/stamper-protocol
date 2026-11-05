import { assertBytes, concat, fail, guarded, pushUnique, startsWith, u16be } from "./bytes.js";
import { rewriteTiff, tiffFacts } from "./tiff.js";
import type { JpegInspection, MinimiseResult } from "./types.js";

/** One marker segment before the first SOS. `start` points at the 0xFF of the marker. */
export type JpegSegment = { marker: number; start: number; end: number; label: string };

export type ParsedJpeg = {
  segments: JpegSegment[];
  /** Offset of the first SOS marker: everything from here to `eoiEnd` is copied verbatim. */
  scanStart: number;
  /** Offset just after the EOI marker. */
  eoiEnd: number;
  /** Labels of the markers seen in the entropy-coded region (SOS, DHT, ... EOI). */
  scanMarkers: string[];
  /** Marker segments found between scans (DHT/DQT/DRI of progressive JPEGs, or stray APPn/COM). */
  scanSegments: JpegSegment[];
  width?: number;
  height?: number;
};

const EXIF_ID = "Exif\0\0";
const XMP_ID = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_ID = "http://ns.adobe.com/xmp/extension/\0";

function markerName(m: number): string {
  if (m >= 0xe0 && m <= 0xef) return `APP${m - 0xe0}`;
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  switch (m) {
    case 0xd8:
      return "SOI";
    case 0xd9:
      return "EOI";
    case 0xda:
      return "SOS";
    case 0xdb:
      return "DQT";
    case 0xc4:
      return "DHT";
    case 0xcc:
      return "DAC";
    case 0xdd:
      return "DRI";
    case 0xdc:
      return "DNL";
    case 0xfe:
      return "COM";
  }
  if (m >= 0xc0 && m <= 0xcf && m !== 0xc8) return `SOF${m - 0xc0}`;
  return `M0x${m.toString(16)}`;
}

function segmentLabel(b: Uint8Array, marker: number, payload: number): string {
  const base = markerName(marker);
  switch (marker) {
    case 0xe0:
      if (startsWith(b, payload, "JFIF\0")) return "APP0:JFIF";
      if (startsWith(b, payload, "JFXX\0")) return "APP0:JFXX";
      break;
    case 0xe1:
      if (startsWith(b, payload, EXIF_ID)) return "APP1:Exif";
      if (startsWith(b, payload, XMP_ID)) return "APP1:XMP";
      if (startsWith(b, payload, XMP_EXT_ID)) return "APP1:XMPExtended";
      break;
    case 0xe2:
      if (startsWith(b, payload, "ICC_PROFILE\0")) return "APP2:ICC_PROFILE";
      if (startsWith(b, payload, "MPF\0")) return "APP2:MPF";
      break;
    case 0xed:
      if (startsWith(b, payload, "Photoshop 3.0\0")) return "APP13:IPTC";
      break;
    case 0xee:
      if (startsWith(b, payload, "Adobe")) return "APP14:Adobe";
      break;
  }
  return base;
}

function isSof(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

/** Walks a baseline or progressive JPEG. Throws MinimiseError when truncated or malformed. */
export function parseJpeg(b: Uint8Array): ParsedJpeg {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) fail("JPEG: missing SOI");
  const segments: JpegSegment[] = [];
  let pos = 2;
  let width: number | undefined;
  let height: number | undefined;
  for (;;) {
    if (pos >= b.length) fail("JPEG: truncated before SOS");
    if (b[pos] !== 0xff) fail(`JPEG: expected marker at ${pos}`);
    while (pos < b.length && b[pos] === 0xff) pos++; // fill bytes
    if (pos >= b.length) fail("JPEG: truncated before SOS");
    const marker = b[pos] as number;
    const start = pos - 1;
    pos++;
    if (marker === 0xd9) fail("JPEG: EOI before image data");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
      fail("JPEG: stray marker before SOS");
    const len = u16be(b, pos);
    if (len < 2) fail("JPEG: bad segment length");
    const end = pos + len;
    if (end > b.length) fail("JPEG: segment exceeds file");
    if (marker === 0xda) {
      const scanMarkers = ["SOS"];
      const scanSegments: JpegSegment[] = [];
      const eoiEnd = scanToEoi(b, end, scanMarkers, scanSegments);
      const parsed: ParsedJpeg = { segments, scanStart: start, eoiEnd, scanMarkers, scanSegments };
      if (width !== undefined && height !== undefined) {
        parsed.width = width;
        parsed.height = height;
      }
      return parsed;
    }
    if (isSof(marker) && width === undefined) {
      if (len < 8) fail("JPEG: SOF too short");
      height = u16be(b, pos + 3);
      width = u16be(b, pos + 5);
    }
    segments.push({ marker, start, end, label: segmentLabel(b, marker, pos + 2) });
    pos = end;
  }
}

/** Skips entropy-coded data (and inter-scan segments of progressive JPEGs) up to and including EOI. */
function scanToEoi(b: Uint8Array, from: number, seen: string[], segs: JpegSegment[]): number {
  let i = from;
  for (;;) {
    const ff = b.indexOf(0xff, i);
    if (ff < 0 || ff + 1 >= b.length) fail("JPEG: truncated (no EOI)");
    const m = b[ff + 1] as number;
    if (m === 0x00 || m === 0xff || (m >= 0xd0 && m <= 0xd7)) {
      i = m === 0xff ? ff + 1 : ff + 2;
      continue;
    }
    if (m === 0xd9) {
      seen.push("EOI");
      return ff + 2;
    }
    const len = u16be(b, ff + 2);
    if (len < 2 || ff + 2 + len > b.length) fail("JPEG: bad segment inside scan data");
    seen.push(markerName(m));
    segs.push({ marker: m, start: ff, end: ff + 2 + len, label: segmentLabel(b, m, ff + 4) });
    i = ff + 2 + len;
  }
}

/** Segments kept verbatim (besides the coding tables and frame headers). */
const KEEP_LABELS = new Set(["APP0:JFIF", "APP2:ICC_PROFILE", "APP14:Adobe"]);

function isMetadataMarker(m: number): boolean {
  return (m >= 0xe0 && m <= 0xef) || m === 0xfe;
}

const REMOVED_LABEL: Record<string, string> = {
  "APP1:XMP": "XMP",
  "APP1:XMPExtended": "XMP",
  "APP13:IPTC": "IPTC",
  "APP2:MPF": "MPF",
  "APP0:JFXX": "JFXXThumbnail",
  COM: "Comment",
};

/**
 * Strips identifying metadata from a JPEG without touching coded image data: rewrites APP1 Exif to a
 * whitelist (Orientation, Make, Model, resolution, exposure facts, pixel dimensions), drops XMP,
 * IPTC, MPF, comments, vendor APPn segments and any trailer after EOI. DQT/DHT/SOF/SOS..EOI are
 * copied byte for byte.
 */
export function minimiseJpeg(bytes: Uint8Array): MinimiseResult {
  assertBytes(bytes);
  return guarded("JPEG", () => {
    const p = parseJpeg(bytes);
    const out: Uint8Array[] = [bytes.subarray(0, 2)];
    const removed: string[] = [];
    const kept: string[] = [];
    let publicExif = {};
    let orientation: number | undefined;
    let exifDone = false;
    for (const s of p.segments) {
      if (s.label === "APP1:Exif" && !exifDone) {
        exifDone = true;
        const r = rewriteTiff(bytes.subarray(s.start + 4 + EXIF_ID.length, s.end));
        for (const x of r.removed) pushUnique(removed, x);
        for (const x of r.kept) pushUnique(kept, x);
        publicExif = r.publicExif;
        orientation = r.orientation;
        if (r.tiff) {
          const len = 2 + EXIF_ID.length + r.tiff.length;
          if (len > 0xffff) fail("JPEG: rewritten Exif too large");
          const head = new Uint8Array(4 + EXIF_ID.length);
          head.set([0xff, 0xe1, len >> 8, len & 0xff]);
          for (let i = 0; i < EXIF_ID.length; i++) head[4 + i] = EXIF_ID.charCodeAt(i);
          out.push(head, r.tiff);
        }
        continue;
      }
      if (KEEP_LABELS.has(s.label) || !isMetadataMarker(s.marker)) {
        if (KEEP_LABELS.has(s.label)) pushUnique(kept, s.label.slice(s.label.indexOf(":") + 1));
        out.push(bytes.subarray(s.start, s.end));
        continue;
      }
      pushUnique(
        removed,
        REMOVED_LABEL[s.label] ?? (s.label === "APP1:Exif" ? "ExtraExif" : s.label),
      );
    }
    // Metadata segments hidden between scans are cut out; everything else is copied verbatim.
    let from = p.scanStart;
    for (const s of p.scanSegments) {
      if (!isMetadataMarker(s.marker)) continue;
      out.push(bytes.subarray(from, s.start));
      from = s.end;
      pushUnique(
        removed,
        REMOVED_LABEL[s.label] ?? (s.label === "APP1:Exif" ? "ExtraExif" : s.label),
      );
    }
    out.push(bytes.subarray(from, p.eoiEnd));
    if (p.eoiEnd < bytes.length) pushUnique(removed, "TrailerAfterEOI");
    const report: MinimiseResult["report"] = { removed, kept, publicExif };
    if (orientation !== undefined) report.orientation = orientation;
    if (p.width !== undefined) report.width = p.width;
    if (p.height !== undefined) report.height = p.height;
    return { bytes: concat(out), report };
  });
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  assertBytes(bytes);
  return guarded("JPEG", () => {
    const p = parseJpeg(bytes);
    const res: JpegInspection = {
      hasGps: false,
      hasSerial: false,
      hasMakerNote: false,
      hasXmp: false,
      segments: ["SOI", ...p.segments.map((s) => s.label), ...p.scanMarkers],
    };
    if (p.eoiEnd < bytes.length) res.segments.push("Trailer");
    let exifSeen = false;
    for (const s of [...p.segments, ...p.scanSegments]) {
      if (s.label === "APP1:XMP" || s.label === "APP1:XMPExtended") res.hasXmp = true;
      if (s.label === "APP1:Exif") {
        const f = tiffFacts(bytes.subarray(s.start + 4 + EXIF_ID.length, s.end));
        res.hasGps ||= f.hasGps;
        res.hasSerial ||= f.hasSerial;
        res.hasMakerNote ||= f.hasMakerNote;
        if (!exifSeen && f.orientation !== undefined) res.orientation = f.orientation;
        exifSeen = true;
      }
    }
    if (p.width !== undefined && p.height !== undefined) res.dims = { w: p.width, h: p.height };
    return res;
  });
}
