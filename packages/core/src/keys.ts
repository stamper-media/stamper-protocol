/**
 * Key identifiers and device-signature verification mirroring `StampRegistry._verifyDevice` (DESIGN §4.3).
 */
import { p256 } from "@noble/curves/p256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";
import { type Address, type Hex, isAddress, keccak256, pad } from "viem";
import { KT } from "./constants.js";
import {
  bytesEqual,
  bytesToHex,
  concatBytes,
  hexToBytes,
  isHex,
  isHexOfLength,
} from "./encoding.js";

const P256_N_HALF = p256.CURVE.n >> 1n;
const SECP_N_HALF = secp256k1.CURVE.n >> 1n;

/** `bytes32(uint256(uint160(addr)))` for secp256k1 and ERC-1271 keys. */
export function keyIdFromAddress(addr: Address): Hex {
  if (!isAddress(addr, { strict: false })) throw new TypeError("invalid address");
  return pad(addr.toLowerCase() as Hex, { size: 32 });
}

/** `sha256(0x04 ‖ x ‖ y)` for P-256 keys (equals Apple's App Attest keyId). */
export function keyIdFromP256(x: Hex, y: Hex): Hex {
  if (!isHexOfLength(x, 32) || !isHexOfLength(y, 32))
    throw new TypeError("x and y must be bytes32 hex");
  return bytesToHex(sha256(concatBytes(Uint8Array.of(4), hexToBytes(x), hexToBytes(y))));
}

export type DeviceKeyInfo = {
  keyType: 0 | 1 | 2 | 3;
  addr?: Address;
  x?: Hex;
  y?: Hex;
  rpIdHash?: Hex;
};

/** `sha256(digest ‖ challenge)`: what App Attest / Play Integrity bind to per capture. */
export function appAttestBinding(digest: Hex, challenge: Hex): Hex {
  if (!isHexOfLength(digest, 32)) throw new TypeError("digest must be bytes32 hex");
  if (!isHex(challenge)) throw new TypeError("challenge must be hex");
  return bytesToHex(sha256(concatBytes(hexToBytes(digest), hexToBytes(challenge))));
}

function verifySecp256k1(addr: Address | undefined, digest: Uint8Array, sig: Uint8Array): boolean {
  if (!addr || !isAddress(addr, { strict: false }) || sig.length !== 65) return false;
  const v = sig[64] as number;
  if (v !== 27 && v !== 28) return false; // ecrecover only accepts 27/28
  try {
    const s = secp256k1.Signature.fromCompact(sig.subarray(0, 64));
    if (s.s > SECP_N_HALF) return false; // OpenZeppelin ECDSA rejects high-s
    const pub = s
      .addRecoveryBit(v - 27)
      .recoverPublicKey(digest)
      .toRawBytes(false);
    const recovered = `0x${keccak256(pub.subarray(1)).slice(-40)}`;
    return recovered === addr.toLowerCase();
  } catch {
    return false;
  }
}

function verifyP256(info: DeviceKeyInfo, h: Uint8Array, sig: Uint8Array): boolean {
  if (sig.length !== 64 || !isHexOfLength(info.x, 32) || !isHexOfLength(info.y, 32)) return false;
  try {
    const s = p256.Signature.fromCompact(sig);
    if (s.s > P256_N_HALF) return false; // the contract rejects high-s; the precompile would not
    const pub = concatBytes(Uint8Array.of(4), hexToBytes(info.x), hexToBytes(info.y));
    return p256.verify(sig, h, pub, { prehash: false, lowS: false, format: "compact" });
  } catch {
    return false;
  }
}

/**
 * Off-chain mirror of the registry check. secp256k1: 65-byte r‖s‖v, v ∈ {27,28}, low-s.
 * P256_RAW: 64-byte r‖s over `sha256(digest)`. P256_APPATTEST: authData is 37 bytes,
 * `authData[0:32] == rpIdHash`, `authData[33:37] == uint32(nonce)`, message `sha256(authData ‖ sha256(digest))`.
 * ERC1271 always returns false here (needs the chain).
 */
export function verifyDeviceSignature(
  keyInfo: DeviceKeyInfo,
  digest: Hex,
  sig: Hex,
  authData: Hex,
  nonce: bigint,
): boolean {
  if (!isHexOfLength(digest, 32) || !isHex(sig) || !isHex(authData)) return false;
  const d = hexToBytes(digest);
  const s = hexToBytes(sig);
  switch (keyInfo.keyType) {
    case KT.SECP256K1:
      return verifySecp256k1(keyInfo.addr, d, s);
    case KT.P256_RAW:
      return verifyP256(keyInfo, sha256(d), s);
    case KT.P256_APPATTEST: {
      const a = hexToBytes(authData);
      if (a.length !== 37 || !isHexOfLength(keyInfo.rpIdHash, 32)) return false;
      if (!bytesEqual(a.subarray(0, 32), hexToBytes(keyInfo.rpIdHash))) return false;
      const counter = new DataView(a.buffer, a.byteOffset + 33, 4).getUint32(0, false);
      if (typeof nonce !== "bigint" || BigInt(counter) !== (nonce & 0xffffffffn)) return false;
      return verifyP256(keyInfo, sha256(concatBytes(a, sha256(d))), s);
    }
    default:
      return false;
  }
}
