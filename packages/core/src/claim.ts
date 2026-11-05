/**
 * EIP-712 typed data for every struct the device key, the registrar or a governed writer signs
 * (DESIGN §3.3, §4.1). Domain `{ name: "Stamper", version: "1", chainId, verifyingContract }`.
 */
import type { TypedData, TypedDataDomain } from "abitype";
import { type Address, type Hex, hashTypedData, isAddress } from "viem";
import type { DomainChainId } from "./constants.js";
import { isHex, isHexOfLength } from "./encoding.js";

const DOMAIN_CHAINS: readonly number[] = [314, 314159, 31337];

export const stamperDomain = (
  chainId: DomainChainId,
  verifyingContract: Address,
): TypedDataDomain & {
  name: "Stamper";
  version: "1";
  chainId: DomainChainId;
  verifyingContract: Address;
} => {
  if (!DOMAIN_CHAINS.includes(chainId))
    throw new RangeError(`unsupported chainId ${String(chainId)}`);
  if (!isAddress(verifyingContract, { strict: false }))
    throw new TypeError("invalid verifyingContract");
  return { name: "Stamper", version: "1", chainId, verifyingContract } as const;
};

export const captureClaimTypes = {
  CaptureClaim: [
    { name: "contentHash", type: "bytes32" },
    { name: "pieceCid", type: "bytes" },
    { name: "contentLength", type: "uint64" },
    { name: "mediaKind", type: "uint8" },
    { name: "capturedAt", type: "uint64" },
    { name: "recordHash", type: "bytes32" },
    { name: "keyId", type: "bytes32" },
    { name: "nonce", type: "uint64" },
    { name: "flags", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const satisfies TypedData;

export const keyEnrolmentTypes = {
  KeyEnrolment: [
    { name: "keyId", type: "bytes32" },
    { name: "keyType", type: "uint8" },
    { name: "platform", type: "uint8" },
    { name: "level", type: "uint8" },
    { name: "x", type: "bytes32" },
    { name: "y", type: "bytes32" },
    { name: "addr", type: "address" },
    { name: "rpIdHash", type: "bytes32" },
    { name: "attestationHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const satisfies TypedData;

export const keyPossessionTypes = {
  KeyPossession: [
    { name: "keyId", type: "bytes32" },
    { name: "keyType", type: "uint8" },
    { name: "platform", type: "uint8" },
    { name: "x", type: "bytes32" },
    { name: "y", type: "bytes32" },
    { name: "addr", type: "address" },
  ],
} as const satisfies TypedData;

export const captureCountersignatureTypes = {
  CaptureCountersignature: [
    { name: "stampId", type: "bytes32" },
    { name: "level", type: "uint8" },
  ],
} as const satisfies TypedData;

export const keyRevocationTypes = {
  KeyRevocation: [
    { name: "keyId", type: "bytes32" },
    { name: "effectiveEpoch", type: "uint64" },
    { name: "reason", type: "uint8" },
  ],
} as const satisfies TypedData;

export const derivativeAttachmentTypes = {
  DerivativeAttachment: [
    { name: "stampId", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "pieceCid", type: "bytes" },
    { name: "kind", type: "uint8" },
    { name: "paramsHash", type: "bytes32" },
  ],
} as const satisfies TypedData;

export type CaptureClaim = {
  contentHash: Hex;
  pieceCid: Hex;
  contentLength: bigint;
  mediaKind: 1 | 2;
  capturedAt: bigint;
  recordHash: Hex;
  keyId: Hex;
  nonce: bigint;
  flags: number;
  deadline: bigint;
};
export type KeyEnrolment = {
  keyId: Hex;
  keyType: number;
  platform: number;
  level: number;
  x: Hex;
  y: Hex;
  addr: Address;
  rpIdHash: Hex;
  attestationHash: Hex;
  expiresAt: bigint;
};
export type KeyPossession = {
  keyId: Hex;
  keyType: number;
  platform: number;
  x: Hex;
  y: Hex;
  addr: Address;
};
export type CaptureCountersignature = { stampId: Hex; level: number };
export type KeyRevocation = { keyId: Hex; effectiveEpoch: bigint; reason: number };
export type DerivativeAttachment = {
  stampId: Hex;
  contentHash: Hex;
  pieceCid: Hex;
  kind: number;
  paramsHash: Hex;
};

const U64 = (1n << 64n) - 1n;

function req(cond: boolean, msg: string): void {
  if (!cond) throw new TypeError(msg);
}
const b32 = (v: unknown, n: string) => req(isHexOfLength(v, 32), `${n} must be bytes32 hex`);
const u8 = (v: unknown, n: string) =>
  req(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255, `${n} must be uint8`);
const u64 = (v: unknown, n: string) =>
  req(typeof v === "bigint" && v >= 0n && v <= U64, `${n} must be a uint64 bigint`);

/** Throws a TypeError naming the first invalid field. `pieceCid` must be non-empty (DESIGN §3.3). */
export function assertCaptureClaim(c: CaptureClaim): void {
  req(typeof c === "object" && c !== null, "claim must be an object");
  b32(c.contentHash, "contentHash");
  req(isHex(c.pieceCid) && c.pieceCid.length > 2, "pieceCid must be non-empty hex");
  u64(c.contentLength, "contentLength");
  req(c.mediaKind === 1 || c.mediaKind === 2, "mediaKind must be 1 or 2");
  u64(c.capturedAt, "capturedAt");
  b32(c.recordHash, "recordHash");
  b32(c.keyId, "keyId");
  u64(c.nonce, "nonce");
  u8(c.flags, "flags");
  u64(c.deadline, "deadline");
}

type Domain = TypedDataDomain;

export function captureClaimTypedData(domain: Domain, claim: CaptureClaim) {
  assertCaptureClaim(claim);
  return { domain, types: captureClaimTypes, primaryType: "CaptureClaim", message: claim } as const;
}

/** EIP-712 digest of the claim; equals `stampId` and `StampRegistry.hashClaim`. */
export function hashCaptureClaim(domain: Domain, claim: CaptureClaim): Hex {
  return hashTypedData(captureClaimTypedData(domain, claim));
}

export function hashKeyEnrolment(domain: Domain, e: KeyEnrolment): Hex {
  b32(e.keyId, "keyId");
  return hashTypedData({
    domain,
    types: keyEnrolmentTypes,
    primaryType: "KeyEnrolment",
    message: e,
  });
}

export function hashKeyPossession(domain: Domain, p: KeyPossession): Hex {
  b32(p.keyId, "keyId");
  return hashTypedData({
    domain,
    types: keyPossessionTypes,
    primaryType: "KeyPossession",
    message: p,
  });
}

export function hashCountersignature(domain: Domain, c: CaptureCountersignature): Hex {
  b32(c.stampId, "stampId");
  u8(c.level, "level");
  return hashTypedData({
    domain,
    types: captureCountersignatureTypes,
    primaryType: "CaptureCountersignature",
    message: c,
  });
}

export function hashKeyRevocation(domain: Domain, r: KeyRevocation): Hex {
  b32(r.keyId, "keyId");
  u64(r.effectiveEpoch, "effectiveEpoch");
  return hashTypedData({
    domain,
    types: keyRevocationTypes,
    primaryType: "KeyRevocation",
    message: r,
  });
}

export function hashDerivativeAttachment(domain: Domain, d: DerivativeAttachment): Hex {
  b32(d.stampId, "stampId");
  b32(d.contentHash, "contentHash");
  return hashTypedData({
    domain,
    types: derivativeAttachmentTypes,
    primaryType: "DerivativeAttachment",
    message: d,
  });
}

/** Claim deadline in unix seconds: `capturedAt/1000 + 72 h` offline, `+ 1 h` online. */
export function claimDeadline(capturedAtMs: bigint, offline: boolean): bigint {
  if (typeof capturedAtMs !== "bigint" || capturedAtMs < 0n) {
    throw new RangeError("capturedAtMs must be a non-negative bigint");
  }
  return capturedAtMs / 1000n + (offline ? 72n * 3600n : 3600n);
}
