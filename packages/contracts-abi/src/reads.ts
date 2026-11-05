import { type Address, type Hex, type PublicClient, zeroHash } from "viem";
import { stampRegistryAbi } from "./abis.gen.js";
import type { BindingStatus, Derivative, DeviceKey, Stamp, StoredBinding } from "./types.js";

export const BINDING_SLOTS = 8;

export type StampBundle = {
  stamp: Stamp;
  key: DeviceKey;
  bindings: StoredBinding[];
  derivatives: Derivative[];
  effectiveLevel: number;
  /** activation timestamp of the key's registrar (0n = none or removed). */
  registrarActiveFrom: bigint;
};

/** Multicall3 is used only when the client's chain declares it (Filecoin chains do; plain anvil does not). */
function hasMulticall(client: PublicClient): boolean {
  return client.chain?.contracts?.multicall3 !== undefined;
}

function assertBytes32(v: Hex, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be a 0x-prefixed bytes32`);
}

/** stampId for a 40-bit code, or 0x00…00 when no stamp holds it. */
export async function readStampByCode(
  client: PublicClient,
  registry: Address,
  code: bigint,
): Promise<Hex> {
  if (code < 0n || code >= 1n << 40n) throw new Error("code must be a 40-bit unsigned integer");
  return client.readContract({
    address: registry,
    abi: stampRegistryAbi,
    functionName: "stampByCode",
    args: [Number(code)],
  });
}

/** Everything the verify ladder needs about one stamp, in two round trips. Throws if the stamp does not exist. */
export async function readStampBundle(
  client: PublicClient,
  registry: Address,
  stampId: Hex,
): Promise<StampBundle> {
  assertBytes32(stampId, "stampId");
  const base = { address: registry, abi: stampRegistryAbi } as const;
  let stamp: Stamp;
  let bindings: readonly StoredBinding[];
  let derivatives: readonly Derivative[];
  let level: number;
  if (hasMulticall(client)) {
    [stamp, bindings, derivatives, level] = await client.multicall({
      allowFailure: false,
      contracts: [
        { ...base, functionName: "getStamp", args: [stampId] },
        { ...base, functionName: "getBindings", args: [stampId] },
        { ...base, functionName: "getDerivatives", args: [stampId] },
        { ...base, functionName: "effectiveLevel", args: [stampId] },
      ],
    });
  } else {
    [stamp, bindings, derivatives, level] = await Promise.all([
      client.readContract({ ...base, functionName: "getStamp", args: [stampId] }),
      client.readContract({ ...base, functionName: "getBindings", args: [stampId] }),
      client.readContract({ ...base, functionName: "getDerivatives", args: [stampId] }),
      client.readContract({ ...base, functionName: "effectiveLevel", args: [stampId] }),
    ]);
  }
  if (stamp.registeredEpoch === 0n) throw new Error(`stamp ${stampId} is not registered`);
  const key = await client.readContract({ ...base, functionName: "getKey", args: [stamp.keyId] });
  const registrarActiveFrom =
    key.registrar === "0x0000000000000000000000000000000000000000"
      ? 0n
      : await client.readContract({
          ...base,
          functionName: "registrarActiveFrom",
          args: [key.registrar],
        });
  return {
    stamp,
    key,
    bindings: [...bindings],
    derivatives: [...derivatives],
    effectiveLevel: level,
    registrarActiveFrom: BigInt(registrarActiveFrom),
  };
}

/** Per-slot binding health (one `bindingStatus` per slot, batched through Multicall3 when available). */
export async function readBindingStatuses(
  client: PublicClient,
  registry: Address,
  stampId: Hex,
  slots: number[],
): Promise<BindingStatus[]> {
  assertBytes32(stampId, "stampId");
  for (const s of slots) {
    if (!Number.isInteger(s) || s < 0 || s >= BINDING_SLOTS)
      throw new Error(`slot ${s} out of range 0-7`);
  }
  const calls = slots.map(
    (slot) =>
      ({
        address: registry,
        abi: stampRegistryAbi,
        functionName: "bindingStatus",
        args: [stampId, slot],
      }) as const,
  );
  if (hasMulticall(client) && calls.length > 1) {
    return client.multicall({ allowFailure: false, contracts: calls });
  }
  return Promise.all(calls.map((c) => client.readContract(c)));
}

/** Whether `nonce` has been consumed for `keyId` (bitmap word nonce>>8, bit nonce&255). */
export async function readUsedNonce(
  client: PublicClient,
  registry: Address,
  keyId: Hex,
  nonce: bigint,
): Promise<boolean> {
  assertBytes32(keyId, "keyId");
  if (nonce < 0n || nonce >= 1n << 64n) throw new Error("nonce must be a uint64");
  const word = await client.readContract({
    address: registry,
    abi: stampRegistryAbi,
    functionName: "usedNonce",
    args: [keyId, nonce >> 8n],
  });
  return ((word >> (nonce & 255n)) & 1n) === 1n;
}

/** The code the registry would assign to `stampId` now (provisional until the registration receipt). */
export async function readPredictCode(
  client: PublicClient,
  registry: Address,
  stampId: Hex,
): Promise<{ code: bigint; attempt: number }> {
  assertBytes32(stampId, "stampId");
  const [code, attempt] = await client.readContract({
    address: registry,
    abi: stampRegistryAbi,
    functionName: "predictCode",
    args: [stampId],
  });
  return { code: BigInt(code), attempt };
}

export { zeroHash as NO_STAMP };
