/**
 * CaptureRecord (DESIGN §3.4): DAG-CBOR (codec 0x71), canonical key order, integers only.
 */
import * as dagCbor from "@ipld/dag-cbor";
import { sha256 } from "@noble/hashes/sha2";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { bytesEqual, bytesToHex } from "./encoding.js";

export type CaptureRecord = {
  v: 1;
  stampDomain: { chainId: number; registry: Address };
  contentHash: Hex;
  pieceCid: Hex;
  contentLength: number;
  mediaType: string;
  dims: { w: number; h: number; durationMs?: number; fps?: number };
  capturedAt: number;
  monotonicNs: string;
  platform: "ios" | "android" | "web";
  app: { id: string; version: string; build: string };
  capture: {
    source: "in-app-camera";
    facing: "back" | "front";
    lensId: string;
    physicalCameraIds: string[];
    physicalOnly: true;
  };
  serverChallenge: Hex | null;
  offline: boolean;
  sanitised: { removed: string[]; kept: string[] };
  publicExif: Record<string, string | number>;
  attestation: { kind: "appattest" | "playintegrity" | "none"; bundleHash: Hex };
  privateHash: Hex | null;
  sealed?: { plaintextCommitment: Hex; cipher: "AES-256-GCM" };
  /** Opt-in per capture. Public, approximate only; the exact fix is in the private record. */
  location?: ApproxLocation;
};

export type LocationSource = "gps" | "network" | "fused" | "unknown";

/**
 * The 0.01° grid cell that holds the fix (about 1.1 km north–south, less east–west away from the
 * equator), named by its south-west corner in hundredths of a degree. Never the fix itself.
 */
export type ApproxLocation = { latE2: number; lonE2: number; source: LocationSource };

/** The exact fix, only inside the private record. Degrees × 1e7, metres, unix ms. */
export type ExactLocation = {
  latE7: number;
  lonE7: number;
  accuracyM: number;
  altitudeM?: number;
  fixAt: number;
};

/**
 * Private sub-record (DESIGN §3.4): `privateHash = sha256(dag-cbor(PrivateRecord))`. The random salt keeps
 * the exact fix from being brute-forced out of the hash and the public cell.
 */
export type PrivateRecord = { v: 1; salt: Hex; location?: ExactLocation };

export const CELL_E2 = 1; // cell size in hundredths of a degree
const LOCATION_SOURCES = ["gps", "network", "fused", "unknown"] as const;

const int = () => z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sint = (max: number) => z.number().int().min(-max).max(max);
const bytes32 = () =>
  z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 hex") as unknown as z.ZodType<Hex>;
const hexBytes = () =>
  z.string().regex(/^0x([0-9a-fA-F]{2})+$/, "non-empty hex") as unknown as z.ZodType<Hex>;
const address = () =>
  z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address") as unknown as z.ZodType<Address>;
const text = (max = 256) => z.string().max(max);

/** Strict schema: unknown keys and non-integer numbers are rejected. */
export const captureRecordSchema: z.ZodType<CaptureRecord> = z
  .object({
    v: z.literal(1),
    stampDomain: z.object({ chainId: int(), registry: address() }).strict(),
    contentHash: bytes32(),
    pieceCid: hexBytes(),
    contentLength: int(),
    mediaType: text(128),
    dims: z
      .object({ w: int(), h: int(), durationMs: int().optional(), fps: int().optional() })
      .strict(),
    capturedAt: int(),
    monotonicNs: z.string().regex(/^\d{1,30}$/, "decimal string"),
    platform: z.enum(["ios", "android", "web"]),
    app: z.object({ id: text(), version: text(64), build: text(64) }).strict(),
    capture: z
      .object({
        source: z.literal("in-app-camera"),
        facing: z.enum(["back", "front"]),
        lensId: text(),
        physicalCameraIds: z.array(text()).max(16),
        physicalOnly: z.literal(true),
      })
      .strict(),
    serverChallenge: bytes32().nullable(),
    offline: z.boolean(),
    sanitised: z
      .object({ removed: z.array(text()).max(256), kept: z.array(text()).max(256) })
      .strict(),
    publicExif: z.record(z.string().max(64), z.union([text(512), z.number().int().safe()])),
    attestation: z
      .object({ kind: z.enum(["appattest", "playintegrity", "none"]), bundleHash: bytes32() })
      .strict(),
    privateHash: bytes32().nullable(),
    sealed: z
      .object({ plaintextCommitment: bytes32(), cipher: z.literal("AES-256-GCM") })
      .strict()
      .optional(),
    location: z
      .object({
        latE2: sint(9000).refine((v) => v < 9000, "latE2 names a south-west corner"),
        lonE2: sint(18000).refine((v) => v < 18000, "lonE2 names a south-west corner"),
        source: z.enum(LOCATION_SOURCES),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((r) => r.location === undefined || r.privateHash !== null, {
    message: "a public location needs the exact fix committed in privateHash",
    path: ["privateHash"],
  }) as unknown as z.ZodType<CaptureRecord>;

export const privateRecordSchema: z.ZodType<PrivateRecord> = z
  .object({
    v: z.literal(1),
    salt: bytes32(),
    location: z
      .object({
        latE7: sint(900_000_000),
        lonE7: sint(1_800_000_000),
        accuracyM: int().max(100_000),
        altitudeM: sint(100_000).optional(),
        fixAt: int(),
      })
      .strict()
      .optional(),
  })
  .strict() as unknown as z.ZodType<PrivateRecord>;

function assertNoFloats(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new TypeError(`non-integer number at ${path || "<root>"}`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertNoFloats(value[i], `${path}[${i}]`);
    return;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      assertNoFloats(v, path ? `${path}.${k}` : k);
    }
  }
}

function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = dropUndefined(v);
    return out;
  }
  return value;
}

/** Canonical DAG-CBOR. Throws on floats, NaN, undefined inside arrays and other non-IPLD values. */
export function encodeDagCbor(value: unknown): Uint8Array {
  assertNoFloats(value, "");
  return dagCbor.encode(dropUndefined(value));
}

export function encodeRecord(r: CaptureRecord): Uint8Array {
  assertNoFloats(r, "");
  const parsed = captureRecordSchema.parse(r);
  return encodeDagCbor(parsed);
}

/** Decodes and validates; rejects any encoding that is not the canonical one. */
export function decodeRecord(bytes: Uint8Array): CaptureRecord {
  const value = dagCbor.decode<unknown>(bytes);
  const record = captureRecordSchema.parse(value);
  if (!bytesEqual(encodeDagCbor(record), bytes))
    throw new TypeError("record is not canonical DAG-CBOR");
  return record;
}

export function recordHash(bytes: Uint8Array): Hex {
  return bytesToHex(sha256(bytes));
}

export function encodePrivateRecord(r: PrivateRecord): Uint8Array {
  assertNoFloats(r, "");
  return encodeDagCbor(privateRecordSchema.parse(r));
}

/** Decodes and validates; rejects any encoding that is not the canonical one. */
export function decodePrivateRecord(bytes: Uint8Array): PrivateRecord {
  const record = privateRecordSchema.parse(dagCbor.decode<unknown>(bytes));
  if (!bytesEqual(encodeDagCbor(record), bytes))
    throw new TypeError("private record is not canonical DAG-CBOR");
  return record;
}

/** `privateHash` of the public record. */
export const privateRecordHash = recordHash;

/** The exact fix in integers, from a platform reading in degrees and metres. */
export function exactLocation(fix: {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude?: number | null;
  timestamp: number;
}): ExactLocation {
  const out: ExactLocation = {
    latE7: Math.round(fix.latitude * 1e7),
    lonE7: Math.round(fix.longitude * 1e7),
    accuracyM: Math.min(100_000, Math.ceil(fix.accuracy ?? 100_000)),
    fixAt: Math.floor(fix.timestamp),
  };
  if (fix.altitude !== null && fix.altitude !== undefined && Number.isFinite(fix.altitude))
    out.altitudeM = Math.round(fix.altitude);
  return out;
}

/** The public cell that holds an exact fix. */
export function approxLocation(exact: ExactLocation, source: LocationSource): ApproxLocation {
  const latE2 = Math.min(8999, Math.floor(exact.latE7 / 100_000));
  let lonE2 = Math.floor(exact.lonE7 / 100_000);
  if (lonE2 >= 18000) lonE2 -= 36000;
  return { latE2, lonE2, source };
}

/** True when the exact fix lies in the public cell (what a revealed private record must satisfy). */
export function fixInCell(exact: ExactLocation, cell: ApproxLocation): boolean {
  const a = approxLocation(exact, cell.source);
  return a.latE2 === cell.latE2 && a.lonE2 === cell.lonE2;
}

/** The cell's edges in degrees, for display. */
export function cellBounds(cell: ApproxLocation): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  return {
    south: cell.latE2 / 100,
    west: cell.lonE2 / 100,
    north: (cell.latE2 + CELL_E2) / 100,
    east: (cell.lonE2 + CELL_E2) / 100,
  };
}
