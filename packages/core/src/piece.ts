/**
 * PieceCID v2 (FRC-0069) helpers. Primary implementation: `@filoz/synapse-core/piece`;
 * fallback: the pure-JS fr32 tree in `./fr32`. Both yield byte-identical CIDs (tested).
 */

import type { PieceCID } from "@filoz/synapse-core/piece";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes, isHex } from "./encoding.js";
import { fr32Hasher } from "./fr32/index.js";

export type { PieceCID } from "@filoz/synapse-core/piece";

export type PieceImpl = "synapse" | "fr32";

export async function pieceCidOf(
  bytes: Uint8Array,
  opts?: { impl?: PieceImpl },
): Promise<PieceCID> {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
  if ((opts?.impl ?? "synapse") === "fr32") {
    const h = fr32Hasher();
    h.write(bytes);
    return Piece.from(h.digest());
  }
  return Piece.calculate(bytes);
}

/** Streaming hasher: `write` chunks in order, then `finalize()` once. */
export function pieceCidHasher(opts?: { impl?: PieceImpl }): {
  write(chunk: Uint8Array): void;
  finalize(): PieceCID;
} {
  if ((opts?.impl ?? "synapse") === "fr32") {
    const h = fr32Hasher();
    return { write: (c) => h.write(c), finalize: () => Piece.from(h.digest()) };
  }
  const h = Piece.hasher();
  return {
    write: (c) => {
      h.write(c);
    },
    finalize: () => h.finalize(),
  };
}

export function pieceCidBytes(cid: PieceCID): Uint8Array {
  return cid.bytes;
}

/** Raw CID bytes as hex: the value carried in `CaptureClaim.pieceCid` and `pieceCidHex` on the wire. */
export function pieceCidHex(cid: PieceCID): Hex {
  return bytesToHex(cid.bytes);
}

/** Text form (`bafkzcib…`). */
export function pieceCidString(cid: PieceCID): string {
  return cid.toString();
}

/** Accepts raw CID bytes, their hex, or the base32 text form. Throws on anything that is not a PieceCID v2. */
export function parsePieceCid(input: Hex | Uint8Array | string): PieceCID {
  const bytes = input instanceof Uint8Array ? input : isHex(input) ? hexToBytes(input) : null;
  if (bytes) {
    const v = validateCommPv2(bytes);
    if (!v.ok) throw new TypeError(`invalid PieceCID: ${v.reason}`);
    return Piece.from(bytes);
  }
  if (typeof input !== "string") throw new TypeError("invalid PieceCID input");
  const cid = Piece.from(input.trim());
  const v = validateCommPv2(cid.bytes);
  if (!v.ok) throw new TypeError(`invalid PieceCID: ${v.reason}`);
  return cid;
}

function readUvarint(
  b: Uint8Array,
  off: number,
): { value: bigint; next: number } | { error: string } {
  let value = 0n;
  for (let i = 0; i < 9; i++) {
    const p = off + i;
    if (p >= b.length) return { error: "truncated uvarint" };
    const byte = b[p] as number;
    value |= BigInt(byte & 0x7f) << BigInt(7 * i);
    if ((byte & 0x80) === 0) {
      if (i > 0 && byte === 0) return { error: "non-minimal uvarint" };
      return { value, next: p + 1 };
    }
  }
  return { error: "uvarint too long" };
}

/**
 * TS mirror of PDPVerifier `Cids.validateCommPv2`: prefix `01 55 91 20`, minimal uvarints,
 * `mhLen ≥ 34`, digest = uvarint(padding) ‖ height ‖ 32-byte root filling the multihash exactly.
 */
export function validateCommPv2(
  bytes: Uint8Array,
): { ok: true; padding: bigint; height: number; root: Hex } | { ok: false; reason: string } {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: "not bytes" };
  if (bytes.length < 4 + 1 + 34) return { ok: false, reason: "too short" };
  if (bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x91 || bytes[3] !== 0x20) {
    return { ok: false, reason: "bad prefix" };
  }
  const mh = readUvarint(bytes, 4);
  if ("error" in mh) return { ok: false, reason: `mhLen: ${mh.error}` };
  if (mh.value < 34n) return { ok: false, reason: "mhLen < 34" };
  if (BigInt(bytes.length - mh.next) !== mh.value) return { ok: false, reason: "length mismatch" };
  const pad = readUvarint(bytes, mh.next);
  if ("error" in pad) return { ok: false, reason: `padding: ${pad.error}` };
  if (bytes.length - pad.next !== 33) return { ok: false, reason: "digest layout" };
  const height = bytes[pad.next] as number;
  const root = bytesToHex(bytes.subarray(pad.next + 1));
  return { ok: true, padding: pad.value, height, root };
}

/**
 * Raw payload size range implied by a PieceCID: `127·2^(height−2) − padding` (exact for v2, so min = max).
 * Throws when padding exceeds the unpadded capacity or the height is below one quad.
 */
export function rawPieceSizeBounds(padding: bigint, height: number): { min: bigint; max: bigint } {
  if (!Number.isInteger(height) || height < 2 || height > 255)
    throw new RangeError("height out of range");
  if (typeof padding !== "bigint" || padding < 0n)
    throw new RangeError("padding must be non-negative");
  const unpadded = 127n << BigInt(height - 2);
  if (padding >= unpadded) throw new RangeError("padding exceeds capacity");
  const raw = unpadded - padding;
  return { min: raw, max: raw };
}

/** True when `length` is the payload size the PieceCID bytes commit to. */
export function contentLengthFits(length: bigint, pieceCid: Uint8Array): boolean {
  const v = validateCommPv2(pieceCid);
  if (!v.ok) return false;
  try {
    const { min, max } = rawPieceSizeBounds(v.padding, v.height);
    return length >= min && length <= max;
  } catch {
    return false;
  }
}
