// Builds the JPEG fixtures: real coded image data from a base JPEG (ffmpeg) plus synthetic,
// phone-like metadata (EXIF with GPS/serials/MakerNote, XMP, IPTC, MPF, trailers).
// Independent of src/: its own TIFF writer, so the tests cross-check two implementations.
// Usage: node scripts/synth-jpeg.mjs <base.jpg> <outDir>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [basePath, outDir] = process.argv.slice(2);
if (!basePath || !outDir) {
  console.error("usage: synth-jpeg.mjs <base.jpg> <outDir>");
  process.exit(2);
}
const base = readFileSync(basePath);

/** The base JPEG without its APPn/COM segments: DQT, SOF, DHT, SOS ... EOI. */
function codedPart(b) {
  let p = 2;
  for (;;) {
    const m = b[p + 1];
    const len = b.readUInt16BE(p + 2);
    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) p += 2 + len;
    else return b.subarray(p);
  }
}
const coded = codedPart(base);
const dims = (() => {
  let p = 0;
  while (p < coded.length) {
    const m = coded[p + 1];
    if (m === 0xc0 || m === 0xc2)
      return { h: coded.readUInt16BE(p + 5), w: coded.readUInt16BE(p + 7) };
    p += 2 + coded.readUInt16BE(p + 2);
  }
  throw new Error("no SOF");
})();

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
function encode(le, type, v) {
  if (type === 2) return Buffer.from(`${v}\0`, "latin1");
  if (type === 7 || type === 1) return Buffer.from(v);
  const n = type === 5 ? v.length * 8 : v.length * SIZE[type];
  const b = Buffer.alloc(n);
  v.forEach((x, i) => {
    if (type === 3) le ? b.writeUInt16LE(x, i * 2) : b.writeUInt16BE(x, i * 2);
    if (type === 4) le ? b.writeUInt32LE(x, i * 4) : b.writeUInt32BE(x, i * 4);
    if (type === 5) {
      le ? b.writeUInt32LE(x[0], i * 8) : b.writeUInt32BE(x[0], i * 8);
      le ? b.writeUInt32LE(x[1], i * 8 + 4) : b.writeUInt32BE(x[1], i * 8 + 4);
    }
  });
  return b;
}
const pad2 = (n) => n + (n & 1);

/** ifds: array of entry lists; entries {tag,type,value} or {tag,ptr:index} (LONG pointer to ifds[index]). */
function buildTiff(le, ifds, { ifd1 = null, thumb = null } = {}) {
  const all = ifd1 ? [...ifds, ifd1] : ifds;
  const enc = all.map((es) =>
    es
      .map((e) => ({ ...e, data: e.ptr !== undefined ? null : encode(le, e.type, e.value) }))
      .sort((a, b) => a.tag - b.tag),
  );
  const sizes = enc.map(
    (es) =>
      2 +
      es.length * 12 +
      4 +
      es.reduce((s, e) => s + (e.data && e.data.length > 4 ? pad2(e.data.length) : 0), 0),
  );
  const offs = [];
  let at = 8;
  for (const s of sizes) {
    offs.push(at);
    at += s;
  }
  const thumbAt = at;
  const out = Buffer.alloc(at + (thumb ? thumb.length : 0));
  out.write(le ? "II" : "MM", 0, "latin1");
  const w16 = (v, o) => (le ? out.writeUInt16LE(v, o) : out.writeUInt16BE(v, o));
  const w32 = (v, o) => (le ? out.writeUInt32LE(v, o) : out.writeUInt32BE(v, o));
  w16(42, 2);
  w32(8, 4);
  enc.forEach((es, k) => {
    const o = offs[k];
    w16(es.length, o);
    let val = o + 2 + es.length * 12 + 4;
    es.forEach((e, i) => {
      const p = o + 2 + i * 12;
      w16(e.tag, p);
      if (e.ptr !== undefined) {
        w16(4, p + 2);
        w32(1, p + 4);
        w32(e.ptr === "thumb" ? thumbAt : offs[e.ptr], p + 8);
        return;
      }
      const count = e.type === 5 ? e.value.length : e.data.length / SIZE[e.type];
      w16(e.type, p + 2);
      w32(count, p + 4);
      if (e.data.length <= 4) e.data.copy(out, p + 8);
      else {
        w32(val, p + 8);
        e.data.copy(out, val);
        val += pad2(e.data.length);
      }
    });
    // IFD0 links to IFD1 (the last block) when a thumbnail IFD exists.
    w32(k === 0 && ifd1 ? offs[offs.length - 1] : 0, o + 2 + es.length * 12);
  });
  if (thumb) thumb.copy(out, thumbAt);
  return out;
}

const seg = (marker, payload) => {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
};
const A = 2,
  S = 3,
  L = 4,
  R = 5,
  U = 7,
  B = 1;

function exifSegment(le, v) {
  const ifd0 = [
    { tag: 0x010f, type: A, value: v.make },
    { tag: 0x0110, type: A, value: v.model },
    { tag: 0x0112, type: S, value: [v.orientation] },
    { tag: 0x011a, type: R, value: [[72, 1]] },
    { tag: 0x011b, type: R, value: [[72, 1]] },
    { tag: 0x0128, type: S, value: [2] },
    { tag: 0x0131, type: A, value: v.software },
    { tag: 0x0132, type: A, value: "2026:09:30 14:05:11" },
    { tag: 0x013b, type: A, value: "Fixture Owner" },
    { tag: 0x013c, type: A, value: v.model },
    { tag: 0x8298, type: A, value: "(c) Fixture Owner" },
    { tag: 0x8769, ptr: 1 },
    { tag: 0x8825, ptr: 2 },
  ];
  const exif = [
    { tag: 0x829a, type: R, value: [[1, 120]] },
    { tag: 0x829d, type: R, value: [[178, 100]] },
    { tag: 0x8827, type: S, value: [64] },
    { tag: 0x9000, type: U, value: Buffer.from("0232") },
    { tag: 0x9003, type: A, value: "2026:09:30 14:05:11" },
    { tag: 0x9004, type: A, value: "2026:09:30 14:05:11" },
    { tag: 0x9011, type: A, value: "-03:00" },
    { tag: 0x920a, type: R, value: [[678, 100]] },
    {
      tag: 0x927c,
      type: U,
      value: Buffer.concat([Buffer.from(v.makerNoteId, "latin1"), Buffer.alloc(48, 0x5a)]),
    },
    {
      tag: 0x9286,
      type: U,
      value: Buffer.from("ASCII\0\0\0private note by Fixture Owner", "latin1"),
    },
    { tag: 0xa001, type: S, value: [1] },
    { tag: 0xa002, type: L, value: [dims.w] },
    { tag: 0xa003, type: L, value: [dims.h] },
    { tag: 0xa420, type: A, value: "F1D2C3B4A5968778695A4B3C2D1E0F00" },
    { tag: 0xa430, type: A, value: "Fixture Owner" },
    { tag: 0xa431, type: A, value: "SN-BODY-123456" },
    { tag: 0xa433, type: A, value: v.make },
    { tag: 0xa434, type: A, value: `${v.model} back camera` },
    { tag: 0xa435, type: A, value: "SN-LENS-654321" },
  ];
  const gps = [
    { tag: 0x0000, type: B, value: [2, 3, 0, 0] },
    { tag: 0x0001, type: A, value: "S" },
    {
      tag: 0x0002,
      type: R,
      value: [
        [23, 1],
        [33, 1],
        [180, 100],
      ],
    },
    { tag: 0x0003, type: A, value: "W" },
    {
      tag: 0x0004,
      type: R,
      value: [
        [46, 1],
        [37, 1],
        [5988, 100],
      ],
    },
    { tag: 0x0006, type: R, value: [[760, 1]] },
  ];
  const ifd1 = [
    { tag: 0x0103, type: S, value: [6] },
    { tag: 0x0201, ptr: "thumb" },
    { tag: 0x0202, type: L, value: [base.length] },
  ];
  const tiff = buildTiff(le, [ifd0, exif, gps], { ifd1, thumb: base });
  return seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]));
}

const xmpPacket = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" exif:GPSLatitude="23,33.03S" exif:GPSLongitude="46,37.998W"><dc:creator><rdf:Seq><rdf:li>Fixture Owner</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const xmp = seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xmpPacket}`, "utf8"));
const xmpExt = seg(
  0xe1,
  Buffer.concat([
    Buffer.from("http://ns.adobe.com/xmp/extension/\0", "latin1"),
    Buffer.from("0123456789ABCDEF0123456789ABCDEF"),
    Buffer.from([0, 0, 0, 16, 0, 0, 0, 0]),
    Buffer.from("extended xmp...."),
  ]),
);
const jfif = seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
const mpf = seg(
  0xe2,
  Buffer.concat([
    Buffer.from("MPF\0", "latin1"),
    Buffer.from("MM\0\x2a\0\0\0\x08\0\0\0\0\0\0", "latin1"),
  ]),
);
function iptc() {
  const rec = (n, s) =>
    Buffer.concat([Buffer.from([0x1c, 2, n, 0, s.length]), Buffer.from(s, "latin1")]);
  const data = Buffer.concat([
    Buffer.from([0x1c, 2, 0, 0, 2, 0, 4]),
    rec(80, "Fixture Owner"),
    rec(90, "Sao Paulo"),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([
    Buffer.from("8BIM\x04\x04\0\0", "latin1"),
    len,
    data,
    data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
  return seg(0xed, Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), body]));
}
const com = seg(0xfe, Buffer.from("shot by Fixture Owner", "latin1"));
const SOI = Buffer.from([0xff, 0xd8]);

const fixtures = {
  "iphone.jpg": [
    exifSegment(false, {
      make: "Apple",
      model: "iPhone 15 Pro",
      software: "17.4",
      orientation: 6,
      makerNoteId: "Apple iOS\0\0\x01MM",
    }),
    xmp,
    mpf,
    coded,
    base,
  ],
  "pixel.jpg": [
    jfif,
    exifSegment(true, {
      make: "Google",
      model: "Pixel 8",
      software: "HDR+ 1.0",
      orientation: 1,
      makerNoteId: "Google\0",
    }),
    xmp,
    xmpExt,
    coded,
    Buffer.from("\0\0\0\x18ftypmp42\0\0\0\0isommp42"),
  ],
  "orient-3.jpg": [
    exifSegment(true, {
      make: "Google",
      model: "Pixel 8",
      software: "HDR+ 1.0",
      orientation: 3,
      makerNoteId: "Google\0",
    }),
    iptc(),
    com,
    coded,
  ],
  "orient-8.jpg": [
    exifSegment(false, {
      make: "Apple",
      model: "iPhone 15 Pro",
      software: "17.4",
      orientation: 8,
      makerNoteId: "Apple iOS\0\0\x01MM",
    }),
    xmp,
    iptc(),
    coded,
  ],
};
for (const [name, parts] of Object.entries(fixtures)) {
  writeFileSync(join(outDir, name), Buffer.concat([SOI, ...parts]));
  console.log(`wrote ${name}`);
}
