import * as Piece from "@filoz/synapse-core/piece";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../src/encoding.js";
import {
  contentLengthFits,
  parsePieceCid,
  pieceCidHasher,
  pieceCidHex,
  pieceCidOf,
  pieceCidString,
  rawPieceSizeBounds,
  validateCommPv2,
} from "../src/piece.js";
import commp from "./vectors/commpv2.json" with { type: "json" };

function prng(seed: number): (n: number) => Uint8Array {
  let s = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

const SIZES = [
  1,
  2,
  31,
  32,
  33,
  64,
  65,
  66,
  126,
  127,
  128,
  129,
  253,
  254,
  255,
  256,
  257,
  508,
  1000,
  1016,
  4064,
  65535,
  65536,
  65537,
  130048,
  1 << 20,
  4 * 1024 * 1024 - 1,
  4 * 1024 * 1024,
];

describe("pieceCidOf: synapse vs fr32 on boundary sizes", () => {
  const rnd = prng(42);
  it.each(SIZES)("size %i", async (n) => {
    const bytes = rnd(n);
    const a = await pieceCidOf(bytes);
    const b = await pieceCidOf(bytes, { impl: "fr32" });
    expect(pieceCidHex(b)).toBe(pieceCidHex(a));
    expect(pieceCidHex(a)).toBe(pieceCidHex(await Piece.calculate(bytes)));
    const v = validateCommPv2(a.bytes);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const { min, max } = rawPieceSizeBounds(v.padding, v.height);
      expect(min <= BigInt(n) && BigInt(n) <= max).toBe(true);
    }
    expect(contentLengthFits(BigInt(n), a.bytes)).toBe(true);
    expect(contentLengthFits(BigInt(n + 1), a.bytes)).toBe(false);
    expect(pieceCidString(a)).toMatch(/^bafkzcib/);
  });
});

describe("fr32 equals synapse on 200 random inputs", () => {
  it("random sizes and contents, streamed in random chunks", () => {
    const rnd = prng(7);
    for (let k = 0; k < 200; k++) {
      const n = 1 + ((rnd(3).reduce((a, b) => a * 256 + b, 0) % 20000) >>> 0);
      const bytes = rnd(n);
      const s = pieceCidHasher();
      const f = pieceCidHasher({ impl: "fr32" });
      let off = 0;
      while (off < n) {
        const step = 1 + ((rnd(2)[0] as number) * 7 + (rnd(1)[0] as number));
        s.write(bytes.subarray(off, off + step));
        f.write(bytes.subarray(off, off + step));
        off += step;
      }
      expect(pieceCidHex(f.finalize())).toBe(pieceCidHex(s.finalize()));
    }
  });
});

describe("validateCommPv2 / parsePieceCid", () => {
  it("accepts the positive vectors and round-trips text/hex/bytes", () => {
    for (const v of commp.valid) {
      const r = validateCommPv2(hexToBytes(v.hex));
      expect(r).toMatchObject({ ok: true, height: v.height, padding: BigInt(v.padding) });
      const cid = parsePieceCid(v.hex as `0x${string}`);
      expect(pieceCidString(cid)).toBe(v.text);
      expect(pieceCidHex(parsePieceCid(v.text))).toBe(v.hex);
      expect(bytesToHex(parsePieceCid(hexToBytes(v.hex)).bytes)).toBe(v.hex);
    }
  });
  it("rejects the negative vectors", () => {
    for (const v of commp.invalid) {
      expect(validateCommPv2(hexToBytes(v.hex)).ok, v.why).toBe(false);
      expect(() => parsePieceCid(v.hex as `0x${string}`)).toThrow();
    }
  });
  it("rawPieceSizeBounds rejects impossible inputs", () => {
    expect(() => rawPieceSizeBounds(0n, 1)).toThrow();
    expect(() => rawPieceSizeBounds(127n, 2)).toThrow();
  });
});
