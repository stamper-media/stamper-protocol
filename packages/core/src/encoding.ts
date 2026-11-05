/**
 * Byte/text encodings without Buffer or any Node built-in (runs on Hermes, browsers and Node).
 */
import type { Hex } from "viem";

// Minimal ambient declarations: the base lib has no DOM/Node types, but every target runtime
// (Hermes, browsers, Node) provides these globals.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: {
  new (label: string, opts: { fatal: boolean }): { decode(input: Uint8Array): string };
};

const HEX_RE = /^0x([0-9a-fA-F]{2})*$/;

/** True when `value` is a 0x-prefixed, even-length hex string. */
export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && HEX_RE.test(value);
}

/** True when `value` is a 0x-prefixed hex string of exactly `bytes` bytes. */
export function isHexOfLength(value: unknown, bytes: number): value is Hex {
  return isHex(value) && value.length === 2 + bytes * 2;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!isHex(hex)) throw new TypeError(`invalid hex string: ${String(hex).slice(0, 20)}`);
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function bytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < bytes.length; i++) s += HEX_TABLE[bytes[i] as number];
  return s as Hex;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62;
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Standard base64 with padding (RFC 4648 §4). */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      B64.charAt((n >> 18) & 63) +
      B64.charAt((n >> 12) & 63) +
      B64.charAt((n >> 6) & 63) +
      B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Decodes base64 or base64url, with or without padding. Throws on any other character. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new TypeError("invalid base64 length");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? (B64_LOOKUP[c] as number) : -1;
    if (v < 0) throw new TypeError(`invalid base64 character at ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** base64url without padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const fromBase64Url = fromBase64;
