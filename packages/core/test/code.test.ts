import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  codeCandidate,
  codeToNato,
  deriveCode,
  encodeCode,
  formatCode,
  normaliseCode,
  predictCode,
} from "../src/code.js";
import vectors from "./vectors/codes.json" with { type: "json" };

const id = (b: string) => `0x${b.repeat(32)}` as Hex;

describe("frozen code vectors (plan §0.8)", () => {
  it.each([
    ["11", "5VEB-TVRA-F", 0],
    ["ab", "MR58-TTN8-D", 1],
    ["07", "6NJ9-RNXC-P", 0],
    ["c3", "W0SB-9TAX-B", 0],
  ])("stampId 0x%s… → %s (attempt %i)", (b, code, attempt) => {
    const r = predictCode(id(b));
    expect(formatCode(encodeCode(r.code))).toBe(code);
    expect(r.attempt).toBe(attempt);
  });

  it("vectors file agrees, including forced-collision cases", () => {
    for (const v of vectors.vectors) {
      const taken = new Set(v.taken.map((t) => BigInt(t)));
      const r = deriveCode(v.stampId as Hex, (c) => taken.has(c));
      expect(formatCode(encodeCode(r.code))).toBe(v.code);
      expect(r.attempt).toBe(v.attempt);
    }
  });
});

describe("deriveCode", () => {
  it("skips collisions and reserved check / Z-prefixed codes like the contract", () => {
    const first = predictCode(id("11"));
    const second = deriveCode(id("11"), (c) => c === first.code);
    expect(second.attempt).toBeGreaterThan(first.attempt);
    expect(second.code).not.toBe(first.code);
    expect(second.code % 37n < 32n).toBe(true);
    expect(second.code >> 35n).not.toBe(31n);
    expect(deriveCode(id("11"), () => false, second.attempt)).toEqual(second);
  });
  it("attempt 1 for 0xab… because attempt 0 is reserved", () => {
    const c0 = codeCandidate(id("ab"), 0);
    expect(c0 % 37n >= 32n || c0 >> 35n === 31n).toBe(true);
  });
  it("rejects malformed stampId", () => {
    expect(() => predictCode("0x1234" as Hex)).toThrow();
  });
});

describe("codec", () => {
  it("encode/normalise round trip and lenient input", () => {
    const n = normaliseCode("5veb tvra-f");
    expect(n).toEqual({ ok: true, code9: "5VEBTVRAF", value: predictCode(id("11")).code });
    expect(normaliseCode("W0SB-9TAX-B").ok).toBe(true);
    expect(normaliseCode("WOSB-9TAX-B")).toMatchObject({ ok: true, code9: "W0SB9TAXB" });
    expect(normaliseCode("w0sb.9tax_b").ok).toBe(true);
  });
  it("maps I/L to 1", () => {
    const v = 1n * 37n * 1000n; // check symbol 0
    const code = encodeCode(v);
    expect(code).toContain("1");
    const lenient = code.replace(/1/g, "l");
    expect(normaliseCode(lenient)).toMatchObject({ ok: true, code9: code });
    expect(normaliseCode(code.replace(/1/g, "I"))).toMatchObject({ ok: true, code9: code });
  });
  it("rejects non-ASCII, bad length, bad symbol, bad check", () => {
    expect(normaliseCode("5VEB-TVRA-Ｆ")).toEqual({ ok: false, reason: "non-ascii" });
    expect(normaliseCode("5VEВ-TVRA-F")).toEqual({ ok: false, reason: "non-ascii" }); // Cyrillic В
    expect(normaliseCode("5VEB-TVRA")).toEqual({ ok: false, reason: "length" });
    expect(normaliseCode("5VEB-TVUA-F")).toEqual({ ok: false, reason: "symbol" });
    expect(normaliseCode("5VEB-TVRA-G")).toEqual({ ok: false, reason: "check" });
  });
  it("encodeCode throws for reserved check values and out-of-range", () => {
    expect(() => encodeCode(32n)).toThrow();
    expect(() => encodeCode(1n << 40n)).toThrow();
    expect(() => encodeCode(-1n)).toThrow();
  });
  it("NATO spoken form", () => {
    expect(codeToNato("5VEB-TVRA-F")).toBe(
      "Five Victor Echo Bravo / Tango Victor Romeo Alfa / Foxtrot",
    );
  });
});

describe("distance-2 property (exhaustive for one code)", () => {
  it("no single substitution or adjacent transposition yields another valid code", () => {
    const base = "5VEBTVRAF";
    const symbols = `${CODE_ALPHABET}*~$=U`;
    let checked = 0;
    for (let i = 0; i < 9; i++) {
      for (const s of i === 8 ? symbols : CODE_ALPHABET) {
        if (s === base[i]) continue;
        const cand = base.slice(0, i) + s + base.slice(i + 1);
        expect(normaliseCode(cand).ok).toBe(false);
        checked++;
      }
    }
    for (let i = 0; i < 8; i++) {
      if (base[i] === base[i + 1]) continue;
      const cand = base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2);
      expect(normaliseCode(cand).ok).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});
