import { sha256 } from "@noble/hashes/sha2";
import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  fromBase64,
  toBase64,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from "../src/encoding.js";
import { expandQuad, fr32PieceCid, node, sizing, zeroComm } from "../src/fr32/index.js";

describe("fr32 primitives", () => {
  it("all-ones quad expands with two zero bits per 256-bit element", () => {
    const out = new Uint8Array(128);
    expandQuad(new Uint8Array(127).fill(0xff), out);
    for (const i of [31, 63, 95, 127]) expect(out[i]).toBe(0x3f);
    expect(out.filter((b) => b === 0xff).length).toBe(124);
  });
  it("node truncates to 254 bits; zeroComm chains", () => {
    const a = new Uint8Array(32).fill(1);
    const expected = sha256(new Uint8Array(64).fill(1));
    expected[31] = (expected[31] as number) & 0x3f;
    expect(bytesToHex(node(a, a))).toBe(bytesToHex(expected));
    expect(bytesToHex(zeroComm(1))).toBe(bytesToHex(node(new Uint8Array(32), new Uint8Array(32))));
  });
  it("sizing", () => {
    expect(sizing(1n)).toEqual({ quads: 1n, padding: 126n, height: 2 });
    expect(sizing(128n)).toEqual({ quads: 2n, padding: 126n, height: 3 });
    expect(sizing(254n)).toEqual({ quads: 2n, padding: 0n, height: 3 });
  });
  it("throws on wrong quad size and double finalise", () => {
    expect(() => expandQuad(new Uint8Array(10), new Uint8Array(128))).toThrow();
    expect(fr32PieceCid(new Uint8Array(1)).length).toBe(39);
  });
});

describe("encoding helpers", () => {
  it("base64 / base64url / utf8 round trips", () => {
    for (let n = 0; n < 10; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 97 + 251) & 0xff);
      expect(fromBase64(toBase64(b))).toEqual(b);
      expect(fromBase64(toBase64Url(b))).toEqual(b);
    }
    expect(toBase64(utf8Encode("hello"))).toBe("aGVsbG8=");
    expect(utf8Decode(utf8Encode("ação"))).toBe("ação");
    expect(() => fromBase64("a$==")).toThrow();
  });
});
