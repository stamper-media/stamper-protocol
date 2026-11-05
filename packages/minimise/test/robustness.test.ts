import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectJpeg, inspectMp4, MinimiseError, minimiseJpeg, minimiseMp4 } from "../src/index.js";
import { parseJpeg } from "../src/jpeg.js";
import { buildMov, cat, fixture, JPEGS, VIDEOS } from "./helpers.js";

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns true if fn returned, false if it threw MinimiseError; any other error fails the test. */
function settles(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof MinimiseError) return false;
    throw e;
  }
}

const all = { jpeg: [minimiseJpeg, inspectJpeg], mp4: [minimiseMp4, inspectMp4] } as const;

describe("fuzz", () => {
  it.each(JPEGS)("%s: every truncation before EOI throws MinimiseError", (name) => {
    const b = fixture(name);
    const eoi = parseJpeg(b).eoiEnd;
    for (let cut = 0; cut < b.length; cut += 3) {
      const t = b.subarray(0, cut);
      for (const fn of all.jpeg) {
        const ok = settles(() => fn(t));
        if (cut < eoi) expect(ok, `cut=${cut}`).toBe(false);
      }
    }
  });

  it.each(VIDEOS)("%s: truncations never escape as foreign errors; mid-file cut throws", (name) => {
    const b = fixture(name);
    for (let cut = 0; cut < b.length; cut += 5)
      for (const fn of all.mp4) settles(() => fn(b.subarray(0, cut)));
    expect(settles(() => minimiseMp4(b.subarray(0, (b.length >> 1) + 3)))).toBe(false);
  });

  it("byte mutations and garbage settle (return or MinimiseError), never hang", () => {
    const r = rng(1234);
    const inputs = [
      ...JPEGS.map(fixture),
      ...VIDEOS.map(fixture),
      buildMov({ faststart: true, co64: true }),
    ];
    for (const src of inputs) {
      const fns = src[0] === 0xff ? all.jpeg : all.mp4;
      for (let i = 0; i < 300; i++) {
        const m = src.slice();
        const flips = 1 + Math.floor(r() * 4);
        for (let k = 0; k < flips; k++) m[Math.floor(r() * m.length)] = Math.floor(r() * 256);
        for (const fn of fns) settles(() => fn(m));
      }
    }
    for (let i = 0; i < 300; i++) {
      const g = Uint8Array.from({ length: Math.floor(r() * 200) }, () => Math.floor(r() * 256));
      if (i % 3 === 0) g.set([0xff, 0xd8, 0xff].slice(0, g.length));
      if (i % 3 === 1 && g.length >= 12)
        g.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
      for (const fn of [...all.jpeg, ...all.mp4]) settles(() => fn(g));
    }
  });
});

describe("purity", () => {
  it("src uses no Node built-ins, Buffer, process or require", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    for (const f of readdirSync(dir)) {
      const code = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(
        /from\s+["']node:|\bBuffer\b|\bprocess\.|\brequire\(|globalThis\.|TextDecoder/,
      );
    }
  });
});

describe("metadata hidden between scans", () => {
  it("detects and cuts APPn/COM segments placed after the first SOS", () => {
    const src = minimiseJpeg(fixture("pixel.jpg")).bytes;
    const xmpId = "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>gps</x:xmpmeta>";
    const xmp = new Uint8Array(4 + xmpId.length);
    xmp.set([0xff, 0xe1, (xmpId.length + 2) >> 8, (xmpId.length + 2) & 0xff]);
    for (let i = 0; i < xmpId.length; i++) xmp[4 + i] = xmpId.charCodeAt(i);
    const com = Uint8Array.of(0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63);
    const eoi = src.length - 2;
    expect([src[eoi], src[eoi + 1]]).toEqual([0xff, 0xd9]);
    const dirty = cat(src.subarray(0, eoi), xmp, com, src.subarray(eoi));
    expect(inspectJpeg(dirty).hasXmp).toBe(true);
    const out = minimiseJpeg(dirty);
    expect(out.report.removed).toEqual(expect.arrayContaining(["XMP", "Comment"]));
    expect(Buffer.from(out.bytes).equals(Buffer.from(src))).toBe(true);
    expect(inspectJpeg(out.bytes).hasXmp).toBe(false);
  });
});
