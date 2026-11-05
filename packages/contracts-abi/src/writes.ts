import { encodeFunctionData, type Hex, size } from "viem";
import { stampRegistryAbi, stampResolverAbi } from "./abis.gen.js";
import type {
  BindingStruct,
  CaptureClaimStruct,
  DerivativeStruct,
  KeyEnrolmentStruct,
  KeyRevocationStruct,
} from "./types.js";

/** StampResolver.Flag */
export const ResolverFlag = {
  None: 0,
  WithdrawnByAuthor: 1,
  TakedownLegal: 2,
  Disputed: 3,
  RejectedPrePublication: 4,
  RegistrarRemoved: 5,
} as const;
export type ResolverFlag = (typeof ResolverFlag)[keyof typeof ResolverFlag];

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** registerStamp calldata. `countersig` is empty or `uint8 level ‖ 65-byte ECDSA` (66 bytes). */
export function encodeRegisterStamp(args: {
  claim: CaptureClaimStruct;
  sig: Hex;
  authData: Hex;
  countersig: Hex;
}): Hex {
  const cs = size(args.countersig);
  check(cs === 0 || cs === 66, "countersig must be empty or 66 bytes");
  check(size(args.claim.pieceCid) > 0, "claim.pieceCid must not be empty");
  return encodeFunctionData({
    abi: stampRegistryAbi,
    functionName: "registerStamp",
    args: [args.claim, args.sig, args.authData, args.countersig],
  });
}

/** registerKey calldata. `endorsement` is empty (level 0) or a 65-byte registrar signature. */
export function encodeRegisterKey(args: {
  enrolment: KeyEnrolmentStruct;
  popSig: Hex;
  endorsement: Hex;
}): Hex {
  const e = size(args.endorsement);
  check(e === 0 || e === 65, "endorsement must be empty or 65 bytes");
  return encodeFunctionData({
    abi: stampRegistryAbi,
    functionName: "registerKey",
    args: [args.enrolment, args.popSig, args.endorsement],
  });
}

export function encodeRevokeKey(args: {
  revocation: KeyRevocationStruct;
  sig: Hex;
  authData: Hex;
}): Hex {
  return encodeFunctionData({
    abi: stampRegistryAbi,
    functionName: "revokeKey",
    args: [args.revocation, args.sig, args.authData],
  });
}

export function encodeAttachDerivative(args: {
  stampId: Hex;
  derivative: DerivativeStruct;
  registrarSig: Hex;
}): Hex {
  check(size(args.registrarSig) === 65, "registrarSig must be 65 bytes");
  return encodeFunctionData({
    abi: stampRegistryAbi,
    functionName: "attachDerivative",
    args: [args.stampId, args.derivative, args.registrarSig],
  });
}

export function encodeBindStorage(args: { stampId: Hex; bindings: readonly BindingStruct[] }): Hex {
  check(args.bindings.length > 0, "bindings must not be empty");
  return encodeFunctionData({
    abi: stampRegistryAbi,
    functionName: "bindStorage",
    args: [args.stampId, args.bindings],
  });
}

/** StampResolver.setFlag calldata (resolver owner only). */
export function encodeSetFlag(args: { stampId: Hex; flag: ResolverFlag; reasonUri: string }): Hex {
  check(Object.values(ResolverFlag).includes(args.flag), "unknown flag");
  return encodeFunctionData({
    abi: stampResolverAbi,
    functionName: "setFlag",
    args: [args.stampId, args.flag, args.reasonUri],
  });
}
