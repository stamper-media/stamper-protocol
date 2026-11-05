import type { ContractFunctionArgs, ContractFunctionReturnType } from "viem";
import type { stampRegistryAbi } from "./abis.gen.js";

type RegistryAbi = typeof stampRegistryAbi;

/** On-chain `Stamp` as returned by `getStamp`. */
export type Stamp = ContractFunctionReturnType<RegistryAbi, "view", "getStamp">;
/** On-chain `DeviceKey` as returned by `getKey`. */
export type DeviceKey = ContractFunctionReturnType<RegistryAbi, "view", "getKey">;
/** One of the 8 binding slots (`setId == 0n && boundEpoch == 0n` means empty). */
export type StoredBinding = ContractFunctionReturnType<RegistryAbi, "view", "getBindings">[number];
export type Derivative = ContractFunctionReturnType<RegistryAbi, "view", "getDerivatives">[number];
export type BindingStatus = ContractFunctionReturnType<RegistryAbi, "view", "bindingStatus">;
/** `CaptureClaim` calldata struct of `registerStamp`/`hashClaim`/`verifyClaim`. */
export type CaptureClaimStruct = ContractFunctionArgs<
  RegistryAbi,
  "nonpayable",
  "registerStamp"
>[0];
export type KeyEnrolmentStruct = ContractFunctionArgs<RegistryAbi, "nonpayable", "registerKey">[0];
export type KeyRevocationStruct = ContractFunctionArgs<RegistryAbi, "nonpayable", "revokeKey">[0];
export type DerivativeStruct = ContractFunctionArgs<
  RegistryAbi,
  "nonpayable",
  "attachDerivative"
>[1];
export type BindingStruct = ContractFunctionArgs<
  RegistryAbi,
  "nonpayable",
  "bindStorage"
>[1][number];
