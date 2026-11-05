import { describe, expect, it } from "vitest";
import { inspectJpeg, inspectMp4, MinimiseError, sniff } from "../src/index.js";
import { buildMov, fixture } from "./helpers.js";

describe("sniff", () => {
  it.each([
    ["iphone.jpg", "image/jpeg"],
    ["pixel.mp4", "video/mp4"],
    ["iphone.mov", "video/quicktime"],
  ])("%s -> %s", (name, type) => expect(sniff(fixture(name))).toBe(type));

  it("recognises HEIC, ftyp-less QuickTime and junk", () => {
    const ftyp = (brand: string) =>
      Uint8Array.from(`\0\0\0\x18ftyp${brand}\0\0\0\0`, (c) => c.charCodeAt(0));
    expect(sniff(ftyp("heic"))).toBe("image/heic");
    expect(sniff(ftyp("isom"))).toBe("video/mp4");
    expect(sniff(Uint8Array.from("\0\0\0\x08wide\0\0\0\0", (c) => c.charCodeAt(0)))).toBe(
      "video/quicktime",
    );
    expect(sniff(new Uint8Array(32))).toBe("unknown");
    expect(sniff(new Uint8Array(0))).toBe("unknown");
  });
});

describe("inspectJpeg", () => {
  it("lists segments in file order", () => {
    const i = inspectJpeg(fixture("pixel.jpg"));
    expect(i.segments.slice(0, 5)).toEqual([
      "SOI",
      "APP0:JFIF",
      "APP1:Exif",
      "APP1:XMP",
      "APP1:XMPExtended",
    ]);
    expect(i.segments).toContain("EOI");
    expect(i.segments.at(-1)).toBe("Trailer");
    expect(i.dims).toEqual({ w: 48, h: 32 });
  });
  it("throws MinimiseError on non-JPEG input", () => {
    expect(() => inspectJpeg(fixture("pixel.mp4"))).toThrow(MinimiseError);
  });
});

describe("inspectMp4", () => {
  it("lists box paths including mdta key names", () => {
    const i = inspectMp4(buildMov({ faststart: true }));
    expect(i.boxes.slice(0, 3)).toEqual(["ftyp", "moov", "moov/mvhd"]);
    expect(i.boxes).toContain("moov/meta/keys/com.apple.quicktime.location.ISO6709");
    expect(i.boxes).toContain("moov/udta/\xa9xyz");
  });
  it("throws MinimiseError on non-MP4 input", () => {
    expect(() => inspectMp4(fixture("iphone.jpg"))).toThrow(MinimiseError);
  });
});
