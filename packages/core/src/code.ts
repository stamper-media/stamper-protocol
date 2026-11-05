/**
 * Stamp codes: 40-bit payload as 8 Crockford base32 symbols + 1 mod-37 check symbol (DESIGN §3.5, §4.5).
 */
import { encodeAbiParameters, type Hex, keccak256 } from "viem";
import { isHexOfLength } from "./encoding.js";

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Crockford check alphabet; values 32..36 (`*~$=U`) are never emitted because such codes are skipped. */
const CHECK_ALPHABET = `${CODE_ALPHABET}*~$=U`;
const CODE_MAX = (1n << 40n) - 1n;
/** Safety bound for the derivation loop (the chain loop is unbounded; reaching this means a broken `isTaken`). */
const MAX_ATTEMPTS = 1_000_000;

export type NormaliseResult =
  | { ok: true; code9: string; value: bigint }
  | { ok: false; reason: "non-ascii" | "length" | "symbol" | "check" };

/** Encodes a 40-bit value as 9 symbols (no separators). Throws when the check symbol would be ≥ 32. */
export function encodeCode(value40: bigint): string {
  if (typeof value40 !== "bigint" || value40 < 0n || value40 > CODE_MAX) {
    throw new RangeError("code value must be a 40-bit unsigned bigint");
  }
  const check = Number(value40 % 37n);
  if (check >= 32) throw new RangeError("code value needs a reserved check symbol");
  let s = "";
  for (let i = 7; i >= 0; i--) s += CODE_ALPHABET[Number((value40 >> BigInt(i * 5)) & 31n)];
  return s + CHECK_ALPHABET[check];
}

/** `XXXXXXXXC` → `XXXX-XXXX-C`. Accepts any input `normaliseCode` accepts; throws otherwise. */
export function formatCode(code9: string): string {
  const n = normaliseCode(code9);
  if (!n.ok) throw new RangeError(`invalid code (${n.reason})`);
  return `${n.code9.slice(0, 4)}-${n.code9.slice(4, 8)}-${n.code9.slice(8)}`;
}

/**
 * Lenient decoding: ASCII only (UTS #39), case-insensitive, I/L→1, O→0, hyphens, spaces, dots and
 * underscores ignored. Returns the canonical 9-symbol form and the 40-bit value.
 */
export function normaliseCode(input: string): NormaliseResult {
  if (typeof input !== "string") return { ok: false, reason: "symbol" };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate ASCII range check
  if (/[^\x00-\x7f]/.test(input)) return { ok: false, reason: "non-ascii" };
  const s = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (s.length !== 9) return { ok: false, reason: "length" };
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    const v = CODE_ALPHABET.indexOf(s[i] as string);
    if (v < 0) return { ok: false, reason: "symbol" };
    value = (value << 5n) | BigInt(v);
  }
  const check = CHECK_ALPHABET.indexOf(s[8] as string);
  if (check < 0) return { ok: false, reason: "symbol" };
  if (BigInt(check) !== value % 37n) return { ok: false, reason: "check" };
  return { ok: true, code9: s, value };
}

/** One step of the on-chain derivation: `uint40(uint256(keccak256(abi.encode(stampId, uint32 attempt))))`. */
export function codeCandidate(stampId: Hex, attempt: number): bigint {
  const h = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [stampId, attempt]),
  );
  return BigInt(h) & CODE_MAX;
}

/** Mirrors `StampRegistry._deriveCode` exactly (DESIGN §4.5). */
export function deriveCode(
  stampId: Hex,
  isTaken: (code: bigint) => boolean,
  startAttempt = 0,
): { code: bigint; attempt: number } {
  if (!isHexOfLength(stampId, 32)) throw new TypeError("stampId must be a bytes32 hex string");
  if (!Number.isInteger(startAttempt) || startAttempt < 0 || startAttempt > 0xffffffff) {
    throw new RangeError("startAttempt must be a uint32");
  }
  for (let attempt = startAttempt; attempt < startAttempt + MAX_ATTEMPTS; attempt++) {
    if (attempt > 0xffffffff) break;
    const code = codeCandidate(stampId, attempt);
    if (code % 37n < 32n && code >> 35n !== 31n && !isTaken(code)) return { code, attempt };
  }
  throw new Error("code derivation exhausted its attempt budget");
}

/** Local prediction (no collisions known). Provisional until the registration receipt. */
export function predictCode(stampId: Hex): { code: bigint; attempt: number } {
  return deriveCode(stampId, () => false);
}

const NATO: Record<string, string> = {
  "0": "Zero",
  "1": "One",
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  J: "Juliett",
  K: "Kilo",
  M: "Mike",
  N: "November",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

/** Spoken form: NATO words, groups separated by " / " (e.g. "Five Victor … / … / Foxtrot"). */
export function codeToNato(code9: string): string {
  const n = normaliseCode(code9);
  if (!n.ok) throw new RangeError(`invalid code (${n.reason})`);
  const words = (part: string) => [...part].map((c) => NATO[c]).join(" ");
  return [words(n.code9.slice(0, 4)), words(n.code9.slice(4, 8)), words(n.code9.slice(8))].join(
    " / ",
  );
}
