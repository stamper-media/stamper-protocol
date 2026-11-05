import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { encodeCode, predictCode } from "../src/code.js";
import { BANNED_WORDS, containsBannedWord, FOOTER, tierSentence } from "../src/copy.js";
import {
  decide,
  effectiveLevel,
  finalityState,
  type VerifyIO,
  verdictLabel,
} from "../src/verdict.js";

const Z = `0x${"00".repeat(32)}` as Hex;
const H = (b: string) => `0x${b.repeat(32)}` as Hex;
const S1 = H("11");
const S2 = H("22");
const code1 = predictCode(S1).code;
const code2 = predictCode(S2).code;
const stamps: Record<string, { contentHash: Hex; pieceCid: Hex; code: bigint }> = {
  [S1]: { contentHash: H("aa"), pieceCid: "0x0155aa", code: code1 },
  [S2]: { contentHash: H("bb"), pieceCid: "0x0155bb", code: code2 },
};
const io = (over: Partial<VerifyIO> = {}): VerifyIO => ({
  firstStampOf: async (h) => (h === H("aa") ? S1 : Z),
  stampByDerivativeHash: async (h) => (h === H("dd") ? S2 : Z),
  stampByCode: async (c) => (c === code1 ? S1 : c === code2 ? S2 : Z),
  getStamp: async (id) => stamps[id] ?? null,
  ...over,
});

describe("decide() ladder", () => {
  it.each([
    ["exact", { sha256: H("aa") }, io(), "ORIGINAL", "exact", S1],
    ["derivative", { sha256: H("dd") }, io(), "STAMPER_MARKED_COPY", "derivative", S2],
    [
      "typed code",
      { sha256: H("ee") },
      io({ typedCode: encodeCode(code2).toLowerCase() }),
      "RELATED_COMPARE",
      "code",
      S2,
    ],
    [
      "watermark",
      { sha256: H("ee") },
      io({ watermarkDecode: async () => code1 }),
      "RELATED_COMPARE",
      "watermark",
      S1,
    ],
    [
      "invalid typed code falls through",
      { sha256: H("ee") },
      io({ typedCode: "AAAA-AAAA-A" }),
      "NOT_REGISTERED",
      "none",
      undefined,
    ],
    ["none", { sha256: H("ee") }, io(), "NOT_REGISTERED", "none", undefined],
  ] as const)("%s", async (_n, copy, ioImpl, verdict, path, stampId) => {
    const d = await decide(copy, ioImpl);
    expect(d.verdict).toBe(verdict);
    expect(d.path).toBe(path);
    expect(d.stampId).toBe(stampId);
    if (stampId) expect(d.code9).toBe(encodeCode(stamps[stampId]?.code ?? 0n));
  });

  it("perceptual returns sorted candidates within 31 bits and never auto-picks", async () => {
    const d = await decide(
      { sha256: H("ee") },
      io({
        perceptualSearch: async () => [
          { stampId: S2, distance: 12 },
          { stampId: S1, distance: 3 },
          { stampId: H("33"), distance: 40 },
        ],
      }),
    );
    expect(d).toEqual({
      verdict: "RELATED_COMPARE",
      path: "perceptual",
      candidates: [
        { stampId: S1, distance: 3 },
        { stampId: S2, distance: 12 },
      ],
    });
  });

  it("PieceCID hit without sha256 hit is an anomaly, not a verdict", async () => {
    const d = await decide(
      { sha256: H("ee"), pieceCid: "0x0155BB" },
      io({ typedCode: encodeCode(code2) }),
    );
    expect(d).toMatchObject({
      verdict: "NOT_REGISTERED",
      anomaly: "piececid-hit-without-sha256",
      stampId: S2,
    });
  });

  it("exact beats every later rung", async () => {
    const d = await decide(
      { sha256: H("aa") },
      io({ typedCode: encodeCode(code2), watermarkDecode: async () => code2 }),
    );
    expect(d.verdict).toBe("ORIGINAL");
  });

  it("rejects malformed input", async () => {
    await expect(decide({ sha256: "0x12" }, io())).rejects.toThrow();
  });
});

describe("labels and copy tables", () => {
  const combos: Parameters<typeof tierSentence>[0][] = [];
  for (const level of [0, 1, 2, 3])
    for (const keyType of [0, 1, 2])
      for (const flags of [0, 1, 2, 4, 8, 15, 31])
        combos.push({
          level,
          keyType,
          countersigned: (flags & 1) > 0,
          revokedBeforeStamp: (flags & 2) > 0,
          registrarRemoved: (flags & 4) > 0,
          offline: (flags & 8) > 0,
          serverComputedCid: (flags & 16) > 0,
        });
  it("no tier sentence, label or the footer uses a banned word", () => {
    for (const c of combos) {
      const t = tierSentence(c);
      for (const s of [t.headline, t.means, t.doesNotMean])
        expect(containsBannedWord(s), s).toBeNull();
    }
    expect(containsBannedWord(FOOTER)).toBeNull();
    for (const v of [
      "ORIGINAL",
      "STAMPER_MARKED_COPY",
      "RELATED_COMPARE",
      "NOT_REGISTERED",
    ] as const) {
      expect(containsBannedWord(verdictLabel(v, "5VEBTVRAF"))).toBeNull();
    }
    expect(BANNED_WORDS).toContain("matches");
    expect(containsBannedWord("hash matches chain")).toBe("matches");
    expect(containsBannedWord("already streams")).toBeNull();
  });
  it("tier headlines follow DESIGN §1.3 and revocation drops to L0", () => {
    const base = {
      keyType: 0,
      countersigned: true,
      revokedBeforeStamp: false,
      registrarRemoved: false,
      offline: false,
      serverComputedCid: false,
    };
    expect(tierSentence({ ...base, level: 0 }).headline).toBe(
      "Registered upload — device not attested",
    );
    expect(tierSentence({ ...base, level: 1 }).headline).toBe(
      "Captured in the Stamper app — attestation checked by Stamper at upload",
    );
    expect(tierSentence({ ...base, level: 2, keyType: 2 }).headline).toBe(
      "Hardware-attested capture",
    );
    expect(tierSentence({ ...base, level: 1, revokedBeforeStamp: true }).headline).toBe(
      "Registered upload — device not attested",
    );
  });
  it("verdict labels", () => {
    expect(verdictLabel("RELATED_COMPARE", "5VEBTVRAF")).toBe("RELATED TO 5VEB-TVRA-F — COMPARE");
    expect(verdictLabel("STAMPER_MARKED_COPY", "5VEBTVRAF")).toBe(
      "STAMPER MARKED COPY of 5VEB-TVRA-F",
    );
  });
});

describe("finalityState / effectiveLevel", () => {
  it("boundaries 30 and 900 and the finalized tag", () => {
    expect(finalityState(129n, null, 100n)).toBe("included");
    expect(finalityState(130n, null, 100n)).toBe("safe");
    expect(finalityState(999n, null, 100n)).toBe("safe");
    expect(finalityState(1000n, null, 100n)).toBe("final");
    expect(finalityState(101n, 100n, 100n)).toBe("final");
    expect(finalityState(101n, 99n, 100n)).toBe("included");
  });
  it("revocation at or before the registration epoch zeroes the level", () => {
    expect(effectiveLevel({ level: 1, registeredEpoch: 100n }, { revokedEpoch: 0n })).toBe(1);
    expect(effectiveLevel({ level: 1, registeredEpoch: 100n }, { revokedEpoch: 100n })).toBe(0);
    expect(effectiveLevel({ level: 1, registeredEpoch: 100n }, { revokedEpoch: 101n })).toBe(1);
  });
});

describe("tierSentence countersignature note", () => {
  const base = {
    level: 2,
    countersigned: false,
    revokedBeforeStamp: false,
    registrarRemoved: false,
    offline: false,
    serverComputedCid: false,
  };
  it("hardware keys (P256_RAW, P256_APPATTEST) need no countersignature note", () => {
    for (const keyType of [1, 2]) {
      expect(tierSentence({ ...base, keyType }).doesNotMean).not.toMatch(/countersignature/);
    }
  });
  it("a software key at L1 without a countersignature is disclosed", () => {
    expect(tierSentence({ ...base, level: 1, keyType: 0 }).doesNotMean).toMatch(
      /no per-capture countersignature/,
    );
  });
});
