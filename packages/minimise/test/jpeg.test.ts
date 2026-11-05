import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { inspectJpeg, minimiseJpeg } from "../src/index.js";
import { parseJpeg } from "../src/jpeg.js";
import { cat, fixture, hasTool, JPEGS } from "./helpers.js";

const ORIENT: Record<string, number> = {
  "iphone.jpg": 6,
  "pixel.jpg": 1,
  "orient-3.jpg": 3,
  "orient-8.jpg": 8,
};
const LEAKS =
  /GPS|latitude|longitude|Serial|Owner|MakerNote|UserComment|ImageUniqueID|creator|Byline|Artist|Copyright/i;

async function pixels(b: Uint8Array): Promise<Buffer> {
  return sharp(b).raw().toBuffer();
}

describe.each(JPEGS)("minimiseJpeg(%s)", (name) => {
  const input = fixture(name);
  const { bytes, report } = minimiseJpeg(input);

  it("input fixture really carries the metadata", () => {
    const i = inspectJpeg(input);
    expect(i).toMatchObject({
      hasGps: true,
      hasSerial: true,
      hasMakerNote: true,
      orientation: ORIENT[name],
    });
  });

  it("drops GPS, serials, MakerNote and XMP; keeps orientation and dims", () => {
    const before = inspectJpeg(input);
    const after = inspectJpeg(bytes);
    expect(after).toMatchObject({
      hasGps: false,
      hasSerial: false,
      hasMakerNote: false,
      hasXmp: false,
    });
    expect(after.orientation).toBe(before.orientation);
    expect(after.dims).toEqual(before.dims);
    expect(after.segments.filter((s) => /APP13|APP1:XMP|MPF|COM|Trailer/.test(s))).toEqual([]);
  });

  it("copies SOS..EOI byte for byte", () => {
    const a = parseJpeg(input);
    const b = parseJpeg(bytes);
    expect(b.eoiEnd).toBe(bytes.length);
    expect(
      Buffer.from(bytes.subarray(b.scanStart, b.eoiEnd)).equals(
        input.subarray(a.scanStart, a.eoiEnd),
      ),
    ).toBe(true);
  });

  it("decodes to the identical pixel buffer (sharp)", async () => {
    expect((await pixels(bytes)).equals(await pixels(input))).toBe(true);
  });

  it("exifr finds no identifying fields and the same orientation", async () => {
    const opts = {
      tiff: true,
      exif: true,
      gps: true,
      ifd1: true,
      xmp: true,
      iptc: true,
      makerNote: true,
      userComment: true,
      translateValues: false,
    };
    const raw = await exifr.parse(Buffer.from(input), opts);
    expect(Object.keys(raw).some((k) => LEAKS.test(k))).toBe(true);
    const out = (await exifr.parse(Buffer.from(bytes), opts)) as Record<string, unknown>;
    expect(Object.keys(out).filter((k) => LEAKS.test(k))).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/Fixture Owner|SN-/);
    expect(await exifr.orientation(Buffer.from(bytes))).toBe(ORIENT[name]);
    expect(out.Make).toBeTypeOf("string");
    expect(out.ExposureTime).toBeCloseTo(1 / 120);
  });

  it("reports what it did", () => {
    expect(report.removed).toEqual(
      expect.arrayContaining([
        "GPSInfo",
        "MakerNote",
        "BodySerialNumber",
        "LensSerialNumber",
        "CameraOwnerName",
        "UserComment",
        "ImageUniqueID",
        "IFD1Thumbnail",
      ]),
    );
    expect(report.kept).toEqual(
      expect.arrayContaining(["Orientation", "PixelXDimension", "PixelYDimension"]),
    );
    expect(report.orientation).toBe(ORIENT[name]);
    expect(report).toMatchObject({ width: 48, height: 32 });
    expect(report.publicExif).toMatchObject({ exposure: "1/120", iso: 64, focalLength: "6.78 mm" });
    expect(report.publicExif.make).toMatch(/Apple|Google/);
  });

  it("is idempotent", () => {
    const again = minimiseJpeg(bytes);
    expect(Buffer.from(again.bytes).equals(bytes)).toBe(true);
    expect(again.report.removed).toEqual([]);
  });
});

describe.skipIf(!hasTool("exiftool", "-ver"))("exiftool cross-check", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamper-minimise-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it.each(JPEGS)("%s: output has no identifying tags and no errors", (name) => {
    const p = join(dir, name);
    writeFileSync(p, minimiseJpeg(fixture(name)).bytes);
    const tags = JSON.parse(
      execFileSync("exiftool", ["-j", "-a", "-G1", "-n", p]).toString(),
    )[0] as Record<string, unknown>;
    expect(
      Object.keys(tags).filter((k) => LEAKS.test(k) || k.startsWith("XMP") || k.startsWith("IPTC")),
    ).toEqual([]);
    expect(JSON.stringify(tags)).not.toMatch(/Fixture Owner|SN-/);
    expect(tags["ExifTool:Error"]).toBeUndefined();
    expect(tags["IFD0:Orientation"]).toBe(ORIENT[name]);
  });
});

describe("segment policy", () => {
  const seg = (marker: number, body: string | Uint8Array) => {
    const b = typeof body === "string" ? Uint8Array.from(body, (c) => c.charCodeAt(0)) : body;
    return cat(Uint8Array.of(0xff, marker, (b.length + 2) >> 8, (b.length + 2) & 0xff), b);
  };

  it("keeps ICC_PROFILE and Adobe, drops comments and vendor APPn, on progressive JPEGs too", async () => {
    const prog = new Uint8Array(
      await sharp({ create: { width: 40, height: 24, channels: 3, background: "#3a7" } })
        .jpeg({ progressive: true })
        .toBuffer(),
    );
    const p = parseJpeg(prog);
    expect(p.scanMarkers.filter((m) => m === "SOS").length).toBeGreaterThan(1);
    const first = p.segments[0]?.start ?? p.scanStart;
    const icc = seg(0xe2, "ICC_PROFILE\0\x01\x01fake-profile");
    const adobe = seg(0xee, "Adobe\0\x64\0\0\0\0\x01");
    const input = cat(
      prog.subarray(0, first),
      icc,
      seg(0xfe, "comment"),
      seg(0xec, "Ducky vendor"),
      adobe,
      prog.subarray(first),
    );
    const { bytes, report } = minimiseJpeg(input);
    const labels = inspectJpeg(bytes).segments;
    expect(labels).toContain("APP2:ICC_PROFILE");
    expect(labels).toContain("APP14:Adobe");
    expect(labels).not.toContain("COM");
    expect(labels).not.toContain("APP12");
    expect(report.removed).toEqual(expect.arrayContaining(["Comment", "APP12"]));
    expect(report.kept).toEqual(expect.arrayContaining(["ICC_PROFILE", "Adobe"]));
    expect((await pixels(bytes)).equals(await pixels(prog))).toBe(true);
  });

  it("passes a metadata-free JPEG through unchanged", async () => {
    const plain = new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
        .jpeg()
        .toBuffer(),
    );
    const { bytes, report } = minimiseJpeg(plain);
    expect(Buffer.from(bytes).equals(plain)).toBe(true);
    expect(report.removed).toEqual([]);
    expect(report.orientation).toBeUndefined();
  });

  it("rejects non-Uint8Array input", () => {
    expect(() => minimiseJpeg("nope" as unknown as Uint8Array)).toThrow(TypeError);
  });
});
