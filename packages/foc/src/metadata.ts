import type { MetadataObject } from "@filoz/synapse-core/utils";
import { FocError, type PieceMetadataInput } from "./types.js";

/** FWSS limits for per-piece metadata (Stamper keeps a stricter budget). */
export const METADATA_MAX_KEYS = 3;
export const METADATA_MAX_KEY_BYTES = 32;
export const METADATA_MAX_VALUE_BYTES = 96;

const utf8 = new TextEncoder();
const STAMP_RE = /^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]$/;
const SHA_RE = /^[0-9a-f]{64}$/;

/** ≤ 3 keys, key ≤ 32 bytes, value ≤ 96 bytes (UTF-8). Throws FocError("metadata"). */
export function validatePieceMetadata(m: Record<string, string>): void {
  if (m === null || typeof m !== "object" || Array.isArray(m)) {
    throw new FocError("metadata", "metadata must be an object");
  }
  const entries = Object.entries(m);
  if (entries.length > METADATA_MAX_KEYS) {
    throw new FocError(
      "metadata",
      `at most ${METADATA_MAX_KEYS} metadata keys (got ${entries.length})`,
    );
  }
  for (const [k, v] of entries) {
    if (k.length === 0) throw new FocError("metadata", "empty metadata key");
    if (typeof v !== "string")
      throw new FocError("metadata", `metadata value for ${k} must be a string`);
    if (utf8.encode(k).length > METADATA_MAX_KEY_BYTES) {
      throw new FocError("metadata", `metadata key ${k} exceeds ${METADATA_MAX_KEY_BYTES} bytes`);
    }
    if (utf8.encode(v).length > METADATA_MAX_VALUE_BYTES) {
      throw new FocError(
        "metadata",
        `metadata value for ${k} exceeds ${METADATA_MAX_VALUE_BYTES} bytes`,
      );
    }
  }
}

/** Validate Stamper's typed piece metadata and return the on-chain key/value object. */
export function toPieceMetadata(m: PieceMetadataInput): MetadataObject {
  if (!STAMP_RE.test(m.stamp))
    throw new FocError("metadata", "stamp must be 9 Crockford base32 symbols");
  if (m.role !== "original") throw new FocError("metadata", "role must be 'original'");
  if (!SHA_RE.test(m.sha256))
    throw new FocError("metadata", "sha256 must be 64 lowercase hex chars");
  const out = { stamp: m.stamp, role: m.role, sha256: m.sha256 };
  validatePieceMetadata(out);
  return out;
}
