import type { Address, Hex } from "viem";

/** Canonical public origin of the verify site. The one place @stamper/core names the domain. */
export const DEFAULT_ORIGIN = "https://stamper.media";

export type ChainId = 314 | 314159;
export type DomainChainId = ChainId | 31337;

export type ChainConfig = {
  genesis: number;
  pdpVerifier: Address;
  fwss: Address;
  stateView: Address;
  sessionKeyRegistry: Address;
  spRegistry: Address;
  usdfc: Address;
  multicall3: Address;
  rpc: string[];
};

/** Frozen per-chain addresses (IMPLEMENTATION-PLAN §0.8). */
export const CHAINS: Record<ChainId, ChainConfig> = {
  314: {
    genesis: 1598306400,
    pdpVerifier: "0xBADd0B92C1c71d02E7d520f64c0876538fa2557F",
    fwss: "0x8408502033C418E1bbC97cE9ac48E5528F371A9f",
    stateView: "0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172",
    sessionKeyRegistry: "0x74FD50525A958aF5d484601E252271f9625231aB",
    spRegistry: "0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB",
    usdfc: "0x80B98d3aa09ffff255c3ba4A241111Ff1262F045",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    rpc: ["https://api.node.glif.io/rpc/v1"],
  },
  314159: {
    genesis: 1667326380,
    pdpVerifier: "0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C",
    fwss: "0x02925630df557F957f70E112bA06e50965417CA0",
    stateView: "0x1B68d64f01bAa42014B9774605867BF4eDC0320f",
    sessionKeyRegistry: "0x518411c2062E119Aaf7A8B12A2eDf9a939347655",
    spRegistry: "0x839e5c9988e4e9977d40708d0094103c0839Ac9D",
    usdfc: "0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    rpc: ["https://api.calibration.node.glif.io/rpc/v1"],
  },
};

export const P256VERIFY_PRECOMPILE: Address = "0x0000000000000000000000000000000000000100";

/** Seconds per Filecoin epoch. */
export const EPOCH_SECONDS = 30;

export const KT = { SECP256K1: 0, P256_RAW: 1, P256_APPATTEST: 2, ERC1271: 3 } as const;
export const PF = { WEB: 0, IOS: 1, ANDROID: 2 } as const;
export const FLAG = { SEALED: 1, OFFLINE: 2, PIECECID_SERVER_COMPUTED: 4 } as const;
export const MEDIA = { IMAGE: 1, VIDEO: 2 } as const;
export const DERIV_KIND = {
  MARKED_IMAGE: 1,
  MARKED_VIDEO: 2,
  SHARE_CARD: 3,
  PREVIEW: 4,
  C2PA: 5,
  RECORD: 6,
} as const;

/** Frozen EIP-712 type hashes (IMPLEMENTATION-PLAN §0.8); tests recompute them from the type strings. */
export const TYPEHASH = {
  CLAIM: "0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d",
  ENROL: "0x7cb29957345ff6dd94fc3cb78ee4044ae8619ff8786f86bb6c77f22c441843e7",
  POP: "0xfc0478f5a3dfeff23ec3fb1779f37df3143b281d435c0e0de41764917e479cd8",
  COUNTER: "0xf7fb5b96fbc4c59566fcca7f60f35138b0af22e784946255d4442bf44c788168",
  REVOKE: "0x169060174d2edeac658ea958ad9e96c24d210e733ea82d4211aa7de1653292da",
  DERIV: "0xa07110a54c833a87d3b59fba0bff52f23466711b8ae0691c319c8db808e704a8",
} as const satisfies Record<string, Hex>;

export const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** `block.timestamp = genesis + 30·epoch` exactly. Returns unix seconds. */
export function epochToUnix(chainId: ChainId, epoch: bigint): number {
  const chain = CHAINS[chainId];
  if (!chain) throw new RangeError(`unsupported chainId ${String(chainId)}`);
  if (typeof epoch !== "bigint" || epoch < 0n)
    throw new RangeError("epoch must be a non-negative bigint");
  const t = BigInt(chain.genesis) + BigInt(EPOCH_SECONDS) * epoch;
  if (t > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("epoch out of range");
  return Number(t);
}
