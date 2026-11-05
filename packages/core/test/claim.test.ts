import { type Address, concat, encodeAbiParameters, type Hex, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
  type CaptureClaim,
  captureClaimTypes,
  captureCountersignatureTypes,
  claimDeadline,
  derivativeAttachmentTypes,
  hashCaptureClaim,
  hashCountersignature,
  hashDerivativeAttachment,
  hashKeyEnrolment,
  hashKeyPossession,
  hashKeyRevocation,
  keyEnrolmentTypes,
  keyPossessionTypes,
  keyRevocationTypes,
  stamperDomain,
} from "../src/claim.js";
import { TYPEHASH } from "../src/constants.js";
import vectors from "./vectors/claims.json" with { type: "json" };
import typehashes from "./vectors/typehashes.json" with { type: "json" };

const typeString = (types: Record<string, readonly { name: string; type: string }[]>) => {
  const [name, fields] = Object.entries(types)[0] as [
    string,
    readonly { name: string; type: string }[],
  ];
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
};

const ALL = {
  CLAIM: captureClaimTypes,
  ENROL: keyEnrolmentTypes,
  POP: keyPossessionTypes,
  COUNTER: captureCountersignatureTypes,
  REVOKE: keyRevocationTypes,
  DERIV: derivativeAttachmentTypes,
} as const;

describe("frozen type hashes (plan §0.8)", () => {
  it.each(Object.keys(ALL) as (keyof typeof ALL)[])("%s", (k) => {
    const s = typeString(ALL[k]);
    expect(s).toBe(typehashes[k].type);
    expect(keccak256(toBytes(s))).toBe(TYPEHASH[k]);
    expect(TYPEHASH[k]).toBe(typehashes[k].hash);
  });
});

const parseClaim = (c: Record<string, string | number>): CaptureClaim => ({
  contentHash: c.contentHash as Hex,
  pieceCid: c.pieceCid as Hex,
  contentLength: BigInt(c.contentLength as string),
  mediaKind: c.mediaKind as 1 | 2,
  capturedAt: BigInt(c.capturedAt as string),
  recordHash: c.recordHash as Hex,
  keyId: c.keyId as Hex,
  nonce: BigInt(c.nonce as string),
  flags: c.flags as number,
  deadline: BigInt(c.deadline as string),
});

/** Solidity-style digest computed by hand (abi.encode), independent of viem's typed-data encoder. */
function manualDigest(chainId: number, registry: Address, c: CaptureClaim): Hex {
  const ds = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          toBytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(toBytes("Stamper")),
        keccak256(toBytes("1")),
        BigInt(chainId),
        registry,
      ],
    ),
  );
  const sh = keccak256(
    encodeAbiParameters(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "uint64",
        "uint8",
        "uint64",
        "bytes32",
        "bytes32",
        "uint64",
        "uint8",
        "uint64",
      ].map((type) => ({ type })),
      [
        TYPEHASH.CLAIM,
        c.contentHash,
        keccak256(c.pieceCid),
        c.contentLength,
        c.mediaKind,
        c.capturedAt,
        c.recordHash,
        c.keyId,
        c.nonce,
        c.flags,
        c.deadline,
      ],
    ),
  );
  return keccak256(concat(["0x1901", ds, sh]));
}

describe("hashCaptureClaim", () => {
  const domain = stamperDomain(
    vectors.domain.chainId as 31337,
    vectors.domain.verifyingContract as Address,
  );
  it.each(vectors.claims.map((v) => [v.name, v] as const))("%s digest", (_n, v) => {
    const c = parseClaim(v.claim);
    expect(hashCaptureClaim(domain, c)).toBe(v.digest);
    expect(manualDigest(31337, domain.verifyingContract, c)).toBe(v.digest);
  });
  it("rejects empty pieceCid and out-of-range fields", () => {
    const c = parseClaim((vectors.claims[0] as (typeof vectors.claims)[number]).claim);
    expect(() => hashCaptureClaim(domain, { ...c, pieceCid: "0x" })).toThrow(/pieceCid/);
    expect(() => hashCaptureClaim(domain, { ...c, flags: 256 })).toThrow(/flags/);
    expect(() => hashCaptureClaim(domain, { ...c, nonce: 1n << 64n })).toThrow(/nonce/);
    expect(() => hashCaptureClaim(domain, { ...c, mediaKind: 3 as 1 })).toThrow(/mediaKind/);
  });
  it("domain validation", () => {
    expect(() => stamperDomain(1 as 314, domain.verifyingContract)).toThrow();
    expect(() => stamperDomain(314, "0x12" as Address)).toThrow();
  });
});

describe("other structs hash without error and differ per domain", () => {
  const z = `0x${"00".repeat(32)}` as Hex;
  const one = `0x${"11".repeat(32)}` as Hex;
  const a = stamperDomain(314, "0x0000000000000000000000000000000000000001");
  const b = stamperDomain(314159, "0x0000000000000000000000000000000000000001");
  it("all six", () => {
    const enrol = {
      keyId: one,
      keyType: 0,
      platform: 1,
      level: 1,
      x: z,
      y: z,
      addr: "0x0000000000000000000000000000000000000002" as Address,
      rpIdHash: z,
      attestationHash: one,
      expiresAt: 10n,
    };
    const hs = [
      (d: typeof a) => hashKeyEnrolment(d, enrol),
      (d: typeof a) =>
        hashKeyPossession(d, { keyId: one, keyType: 0, platform: 1, x: z, y: z, addr: enrol.addr }),
      (d: typeof a) => hashCountersignature(d, { stampId: one, level: 1 }),
      (d: typeof a) => hashKeyRevocation(d, { keyId: one, effectiveEpoch: 5n, reason: 1 }),
      (d: typeof a) =>
        hashDerivativeAttachment(d, {
          stampId: one,
          contentHash: one,
          pieceCid: "0x",
          kind: 1,
          paramsHash: z,
        }),
    ];
    const seen = new Set<string>();
    for (const h of hs) {
      expect(h(a)).not.toBe(h(b));
      seen.add(h(a));
    }
    expect(seen.size).toBe(5);
  });
});

describe("claimDeadline", () => {
  it("+1 h online, +72 h offline, seconds", () => {
    expect(claimDeadline(1_790_000_000_123n, false)).toBe(1_790_000_000n + 3600n);
    expect(claimDeadline(1_790_000_000_999n, true)).toBe(1_790_000_000n + 259_200n);
    expect(() => claimDeadline(-1n, false)).toThrow();
  });
});
