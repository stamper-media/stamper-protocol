import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/encoding.js";
import {
  approxLocation,
  cellBounds,
  decodePrivateRecord,
  decodeRecord,
  encodeDagCbor,
  encodePrivateRecord,
  encodeRecord,
  exactLocation,
  fixInCell,
  privateRecordHash,
  recordHash,
} from "../src/record.js";
import { sampleRecord } from "./fixtures/record.js";

describe("CaptureRecord DAG-CBOR", () => {
  it("is deterministic regardless of key insertion order", () => {
    const a = sampleRecord();
    const b = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(bytesToHex(encodeRecord(b))).toBe(bytesToHex(encodeRecord(a)));
    expect(recordHash(encodeRecord(a))).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("round-trips through decodeRecord", () => {
    const r = sampleRecord({
      dims: { w: 1920, h: 1080, durationMs: 4000, fps: 30 },
      sealed: undefined,
    });
    const bytes = encodeRecord(r);
    const back = decodeRecord(bytes);
    expect(back.dims).toEqual({ w: 1920, h: 1080, durationMs: 4000, fps: 30 });
    expect(bytesToHex(encodeRecord(back))).toBe(bytesToHex(bytes));
  });
  it("rejects floats anywhere", () => {
    expect(() => encodeRecord(sampleRecord({ dims: { w: 1.5, h: 2 } }))).toThrow(/non-integer/);
    expect(() => encodeRecord(sampleRecord({ publicExif: { fNumber: 1.8 } }))).toThrow(
      /non-integer/,
    );
    expect(() => encodeDagCbor({ a: [1, 2, 0.1] })).toThrow(/a\[2\]/);
    expect(() => encodeDagCbor(Number.NaN)).toThrow();
  });
  it("rejects unknown keys and malformed fields", () => {
    expect(() => encodeRecord({ ...sampleRecord(), extra: 1 } as never)).toThrow();
    expect(() => encodeRecord(sampleRecord({ contentHash: "0x12" }))).toThrow();
    expect(() => encodeRecord(sampleRecord({ platform: "desktop" as "web" }))).toThrow();
  });
  it("rejects non-canonical encodings", () => {
    const bytes = encodeRecord(sampleRecord());
    expect(() => decodeRecord(bytes.subarray(0, bytes.length - 1))).toThrow();
  });
});

describe("location", () => {
  // Praça da Sé, São Paulo: south and west of 0, so floor and rounding are tested on negatives
  const fix = {
    latitude: -23.5503099,
    longitude: -46.6342009,
    accuracy: 7.4,
    altitude: 760.6,
    timestamp: 1_790_000_000_123.9,
  };
  const salt = `0x${"11".repeat(32)}` as const;

  it("keeps the exact fix in integers and the public cell as its south-west corner", () => {
    const exact = exactLocation(fix);
    expect(exact).toEqual({
      latE7: -235503099,
      lonE7: -466342009,
      accuracyM: 8,
      altitudeM: 761,
      fixAt: 1_790_000_000_123,
    });
    const cell = approxLocation(exact, "gps");
    expect(cell).toEqual({ latE2: -2356, lonE2: -4664, source: "gps" });
    expect(fixInCell(exact, cell)).toBe(true);
    expect(fixInCell({ ...exact, latE7: -235400000 }, cell)).toBe(false);
    const b = cellBounds(cell);
    expect(b.south).toBeCloseTo(-23.56);
    expect(b.north).toBeCloseTo(-23.55);
    expect(b.south <= fix.latitude && fix.latitude < b.north).toBe(true);
    expect(b.west <= fix.longitude && fix.longitude < b.east).toBe(true);
  });

  it("clamps the poles and wraps the antimeridian", () => {
    const e = (lat: number, lon: number) =>
      exactLocation({ latitude: lat, longitude: lon, accuracy: 1, timestamp: 0 });
    expect(approxLocation(e(90, 180), "fused")).toEqual({
      latE2: 8999,
      lonE2: -18000,
      source: "fused",
    });
    expect(approxLocation(e(-90, -180), "fused")).toEqual({
      latE2: -9000,
      lonE2: -18000,
      source: "fused",
    });
  });

  it("commits the exact fix through privateHash", () => {
    const priv = { v: 1 as const, salt, location: exactLocation(fix) };
    const bytes = encodePrivateRecord(priv);
    expect(decodePrivateRecord(bytes)).toEqual(priv);
    const r = sampleRecord({
      privateHash: privateRecordHash(bytes),
      location: approxLocation(priv.location, "gps"),
    });
    const back = decodeRecord(encodeRecord(r));
    expect(back.location).toEqual({ latE2: -2356, lonE2: -4664, source: "gps" });
    expect(back.privateHash).toBe(privateRecordHash(bytes));
  });

  it("keeps the encoding of records without a location unchanged", () => {
    const r = sampleRecord();
    expect(Object.hasOwn(decodeRecord(encodeRecord(r)), "location")).toBe(false);
  });

  it("refuses a public location without a committed exact fix, and malformed cells", () => {
    const cell = { latE2: -2356, lonE2: -4664, source: "gps" as const };
    expect(() => encodeRecord(sampleRecord({ privateHash: null, location: cell }))).toThrow(
      /privateHash/,
    );
    const ph = privateRecordHash(encodePrivateRecord({ v: 1, salt }));
    expect(() =>
      encodeRecord(sampleRecord({ privateHash: ph, location: { ...cell, latE2: 9000 } })),
    ).toThrow();
    expect(() =>
      encodeRecord(
        sampleRecord({ privateHash: ph, location: { ...cell, source: "wifi" as "gps" } }),
      ),
    ).toThrow();
    expect(() => encodePrivateRecord({ v: 1, salt: "0x12" })).toThrow();
  });
});
