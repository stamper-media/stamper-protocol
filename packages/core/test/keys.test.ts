import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { bytesToHex, concatBytes, hexToBytes } from "../src/encoding.js";
import {
  appAttestBinding,
  type DeviceKeyInfo,
  keyIdFromAddress,
  keyIdFromP256,
  verifyDeviceSignature,
} from "../src/keys.js";
import vectors from "./vectors/claims.json" with { type: "json" };

const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

describe("key ids", () => {
  it("address → bytes32(uint160)", () => {
    expect(keyIdFromAddress("0x00000000000000000000000000000000000000Ab")).toBe(
      `0x${"00".repeat(31)}ab`,
    );
    expect(() => keyIdFromAddress("0x12" as Address)).toThrow();
  });
  it("P-256 → sha256(04‖x‖y)", () => {
    const pub = p256.getPublicKey(p256.utils.randomPrivateKey(), false);
    const x = bytesToHex(pub.subarray(1, 33));
    const y = bytesToHex(pub.subarray(33));
    expect(keyIdFromP256(x, y)).toBe(bytesToHex(sha256(pub)));
  });
});

describe("verifyDeviceSignature on the claims vectors", () => {
  it.each(vectors.claims.map((v) => [v.name, v] as const))("%s", (_n, v) => {
    const info = v.keyInfo as DeviceKeyInfo;
    const nonce = BigInt(v.claim.nonce);
    expect(
      verifyDeviceSignature(info, v.digest as Hex, v.sig as Hex, v.authData as Hex, nonce),
    ).toBe(true);
    // wrong digest
    const other = `0x${"22".repeat(32)}` as Hex;
    expect(verifyDeviceSignature(info, other, v.sig as Hex, v.authData as Hex, nonce)).toBe(false);
    // flipped signature byte
    const bad = hexToBytes(v.sig);
    bad[10] = (bad[10] as number) ^ 1;
    expect(
      verifyDeviceSignature(info, v.digest as Hex, bytesToHex(bad), v.authData as Hex, nonce),
    ).toBe(false);
  });

  it("secp256k1 rejects high-s and v ∉ {27,28}", () => {
    const v = vectors.claims[0] as (typeof vectors.claims)[number];
    const sig = hexToBytes(v.sig);
    const s = BigInt(bytesToHex(sig.subarray(32, 64)));
    const high = new Uint8Array(sig);
    high.set(hexToBytes(`0x${(SECP_N - s).toString(16).padStart(64, "0")}`), 32);
    high[64] = sig[64] === 27 ? 28 : 27;
    const info = v.keyInfo as DeviceKeyInfo;
    expect(verifyDeviceSignature(info, v.digest as Hex, bytesToHex(high), "0x", 1n)).toBe(false);
    const v01 = new Uint8Array(sig);
    v01[64] = (sig[64] as number) - 27;
    expect(verifyDeviceSignature(info, v.digest as Hex, bytesToHex(v01), "0x", 1n)).toBe(false);
  });

  it("App Attest checks rpIdHash and counter", () => {
    const v = vectors.claims.find((c) => c.keyType === 2) as (typeof vectors.claims)[number];
    const info = v.keyInfo as DeviceKeyInfo;
    const nonce = BigInt(v.claim.nonce);
    expect(
      verifyDeviceSignature(info, v.digest as Hex, v.sig as Hex, v.authData as Hex, nonce + 1n),
    ).toBe(false);
    expect(
      verifyDeviceSignature(
        { ...info, rpIdHash: `0x${"00".repeat(32)}` },
        v.digest as Hex,
        v.sig as Hex,
        v.authData as Hex,
        nonce,
      ),
    ).toBe(false);
    expect(
      verifyDeviceSignature(info, v.digest as Hex, v.sig as Hex, `${v.authData}00` as Hex, nonce),
    ).toBe(false);
  });

  it("P256_RAW with fresh noble keys; high-s rejected; ERC1271 false", () => {
    const pk = p256.utils.randomPrivateKey();
    const pub = p256.getPublicKey(pk, false);
    const info: DeviceKeyInfo = {
      keyType: 1,
      x: bytesToHex(pub.subarray(1, 33)),
      y: bytesToHex(pub.subarray(33)),
    };
    const digest = bytesToHex(sha256(Uint8Array.of(1, 2, 3)));
    const sig = p256.sign(sha256(hexToBytes(digest)), pk, { prehash: false, lowS: true });
    expect(verifyDeviceSignature(info, digest, bytesToHex(sig.toCompactRawBytes()), "0x", 0n)).toBe(
      true,
    );
    const highS = new p256.Signature(sig.r, p256.CURVE.n - sig.s);
    expect(
      verifyDeviceSignature(info, digest, bytesToHex(highS.toCompactRawBytes()), "0x", 0n),
    ).toBe(false);
    expect(
      verifyDeviceSignature(
        { keyType: 3, addr: "0x0000000000000000000000000000000000000001" },
        digest,
        "0x",
        "0x",
        0n,
      ),
    ).toBe(false);
  });
});

describe("appAttestBinding", () => {
  it("sha256(digest ‖ challenge)", () => {
    const d = `0x${"aa".repeat(32)}` as Hex;
    const c = `0x${"bb".repeat(32)}` as Hex;
    expect(appAttestBinding(d, c)).toBe(
      bytesToHex(sha256(concatBytes(hexToBytes(d), hexToBytes(c)))),
    );
  });
});
