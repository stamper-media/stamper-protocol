import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ByteSource } from "../src/index.js";
import { inspectMp4, MinimiseError, minimiseMp4, minimiseMp4Stream } from "../src/index.js";
import {
  buildMov,
  cat,
  chunkOffsets,
  fixture,
  hasTool,
  KEYS,
  MDAT,
  mdatPayload,
  VIDEOS,
} from "./helpers.js";

function source(b: Uint8Array): ByteSource {
  return { size: b.length, read: async (o, l) => b.slice(o, o + l) };
}

async function streamed(b: Uint8Array, chunkSize: number) {
  const parts: Uint8Array[] = [];
  const report = await minimiseMp4Stream(
    source(b),
    { write: (c) => void parts.push(c.slice()) },
    { chunkSize },
  );
  return { bytes: cat(...parts), report };
}

describe.each(VIDEOS)("minimiseMp4(%s)", (name) => {
  const input = fixture(name);
  const { bytes, report } = minimiseMp4(input);

  it("input fixture really carries location", () => {
    expect(inspectMp4(input)).toMatchObject({ hasUdta: true, hasLocation: true });
  });

  it("drops udta, location and XMP; mdat untouched", () => {
    const after = inspectMp4(bytes);
    expect(after).toMatchObject({ hasUdta: false, hasLocation: false });
    expect(after.boxes.filter((b) => /udta|\xa9xyz|uuid:XMP|loci/.test(b))).toEqual([]);
    expect(Buffer.from(mdatPayload(bytes)).equals(mdatPayload(input))).toBe(true);
    expect(report.removed).toContain("udta");
    expect(report).toMatchObject({ width: 64, height: 48 });
  });

  it("is idempotent", () => {
    const again = minimiseMp4(bytes);
    expect(Buffer.from(again.bytes).equals(bytes)).toBe(true);
    expect(again.report.removed).toEqual([]);
  });

  it("streaming variant produces the same bytes and report", async () => {
    const s = await streamed(input, 1000);
    expect(Buffer.from(s.bytes).equals(bytes)).toBe(true);
    expect(s.report).toEqual(report);
  });
});

it("pixel.mp4: ©xyz and the XMP uuid are reported", () => {
  expect(minimiseMp4(fixture("pixel.mp4")).report.removed).toEqual(
    expect.arrayContaining(["udta/\xa9xyz", "uuid:XMP"]),
  );
});

describe.skipIf(!hasTool("ffprobe") || !hasTool("ffmpeg"))("ffprobe / ffmpeg cross-check", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamper-minimise-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const probe = (p: string) =>
    JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,nb_frames",
        "-of",
        "json",
        p,
      ]).toString(),
    );
  const frames = (p: string) =>
    execFileSync("ffmpeg", ["-v", "error", "-i", p, "-f", "framemd5", "-"])
      .toString()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
  it.each(VIDEOS)("%s: equal duration, streams and decoded frames", (name) => {
    const a = join(dir, `in-${name}`);
    const b = join(dir, `out-${name}`);
    writeFileSync(a, fixture(name));
    writeFileSync(b, minimiseMp4(fixture(name)).bytes);
    expect(probe(b)).toEqual(probe(a));
    expect(frames(b)).toEqual(frames(a));
  });
});

describe("synthetic iOS MOV (moov/meta mdta keys)", () => {
  for (const faststart of [true, false]) {
    for (const co64 of [false, true]) {
      it(`faststart=${faststart} co64=${co64}: drops location/identifier keys, renumbers ilst, fixes chunk offsets`, async () => {
        const input = buildMov({ faststart, co64 });
        expect(inspectMp4(input)).toMatchObject({ hasUdta: true, hasLocation: true });
        const { bytes, report } = minimiseMp4(input);
        const after = inspectMp4(bytes);
        expect(after).toMatchObject({ hasUdta: false, hasLocation: false });
        expect(after.boxes).toContain("moov/meta/keys/com.apple.quicktime.make");
        expect(
          after.boxes.filter((b) => b.includes("location") || b.includes("identifier")),
        ).toEqual([]);
        expect(report.removed).toEqual(
          expect.arrayContaining([`meta/${KEYS[0]}`, `meta/${KEYS[2]}`, "udta", "udta/\xa9xyz"]),
        );
        expect(report).toMatchObject({ width: 640, height: 480 });
        // the kept "make" item (old index 2) is now index 1 and still holds "Apple"
        const text = Buffer.from(bytes).toString("latin1");
        expect(text).toContain("Apple");
        expect(text).not.toContain("UUID-1234");
        expect(text).not.toContain("-23.5505");
        // chunk offsets still point at the same media bytes
        const [c0, c1] = chunkOffsets(bytes);
        expect(
          Buffer.from(bytes.subarray(c0 as number, (c0 as number) + 32)).equals(
            MDAT.subarray(0, 32),
          ),
        ).toBe(true);
        expect(
          Buffer.from(bytes.subarray(c1 as number, (c1 as number) + 32)).equals(MDAT.subarray(32)),
        ).toBe(true);
        if (!faststart) expect(chunkOffsets(bytes)).toEqual(chunkOffsets(input));
        expect(Buffer.from(minimiseMp4(bytes).bytes).equals(bytes)).toBe(true);
        const s = await streamed(input, 7);
        expect(Buffer.from(s.bytes).equals(bytes)).toBe(true);
      });
    }
  }
});

describe("stream argument validation", () => {
  it("rejects bad sources, sinks and short reads", async () => {
    const b = buildMov({ faststart: true });
    await expect(minimiseMp4Stream({} as ByteSource, { write: () => {} })).rejects.toThrow(
      TypeError,
    );
    await expect(minimiseMp4Stream(source(b), {} as never)).rejects.toThrow(TypeError);
    await expect(
      minimiseMp4Stream(source(b), { write: () => {} }, { chunkSize: 0 }),
    ).rejects.toThrow(TypeError);
    const short: ByteSource = {
      size: b.length,
      read: async (o, l) => b.slice(o, o + Math.max(1, l - 1)),
    };
    await expect(minimiseMp4Stream(short, { write: () => {} })).rejects.toThrow(MinimiseError);
  });
});
