import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/encoding.js";
import {
  type CaptureClaim,
  captureClaimTypes,
  claimDeadline,
  decide,
  encodeCode,
  encodeRecord,
  FLAG,
  formatCode,
  hashCaptureClaim,
  keyIdFromAddress,
  MEDIA,
  normaliseCode,
  pieceCidHex,
  pieceCidOf,
  predictCode,
  recordHash,
  stamperDomain,
  verifyDeviceSignature,
  verifyUrl,
  ZERO_BYTES32,
} from "../src/index.js";
import { sampleRecord } from "./fixtures/record.js";

describe("roundtrip: fixture JPEG → claim → signature → code → ORIGINAL", () => {
  it("works end to end", async () => {
    const jpeg = new Uint8Array(readFileSync(new URL("./fixtures/sample.jpg", import.meta.url)));
    const contentHash = bytesToHex(sha256(jpeg));
    const cidA = await pieceCidOf(jpeg);
    const cidB = await pieceCidOf(jpeg, { impl: "fr32" });
    expect(pieceCidHex(cidB)).toBe(pieceCidHex(cidA));

    const domain = stamperDomain(31337, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
    const account = privateKeyToAccount(`0x${"5a".repeat(32)}`);
    const capturedAt = 1_790_000_000_000n;
    const record = encodeRecord(
      sampleRecord({
        contentHash,
        pieceCid: pieceCidHex(cidA),
        contentLength: jpeg.length,
        capturedAt: Number(capturedAt),
      }),
    );
    const claim: CaptureClaim = {
      contentHash,
      pieceCid: pieceCidHex(cidA),
      contentLength: BigInt(jpeg.length),
      mediaKind: MEDIA.IMAGE,
      capturedAt,
      recordHash: recordHash(record),
      keyId: keyIdFromAddress(account.address),
      nonce: 1n,
      flags: FLAG.OFFLINE,
      deadline: claimDeadline(capturedAt, true),
    };
    const stampId = hashCaptureClaim(domain, claim);
    const sig = await account.signTypedData({
      domain,
      types: captureClaimTypes,
      primaryType: "CaptureClaim",
      message: claim,
    });
    expect(
      verifyDeviceSignature({ keyType: 0, addr: account.address }, stampId, sig, "0x", claim.nonce),
    ).toBe(true);

    const { code } = predictCode(stampId);
    const formatted = formatCode(encodeCode(code));
    expect(formatted).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
    const n = normaliseCode(formatted);
    expect(n.ok && n.value === code).toBe(true);
    expect(verifyUrl(formatted)).toContain(`/v/${formatted}`);

    const d = await decide(
      { sha256: contentHash, pieceCid: pieceCidHex(cidA) },
      {
        firstStampOf: async (h) => (h === contentHash ? stampId : ZERO_BYTES32),
        stampByDerivativeHash: async () => ZERO_BYTES32,
        stampByCode: async (c) => (c === code ? stampId : ZERO_BYTES32),
        getStamp: async (id) =>
          id === stampId ? { contentHash, pieceCid: claim.pieceCid, code } : null,
      },
    );
    expect(d).toMatchObject({
      verdict: "ORIGINAL",
      path: "exact",
      stampId,
      code9: encodeCode(code),
    });
  });
});
