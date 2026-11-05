import { type Address, getAddress, isAddress, zeroAddress } from "viem";
import { generatedDeployments } from "./deployments.gen.js";

export type ChainId = 31337 | 314159 | 314;
export const SUPPORTED_CHAIN_IDS: readonly ChainId[] = [31337, 314159, 314];

export type Deployment = {
  chainId: ChainId;
  registry: Address;
  resolver: Address;
  pdpVerifier: Address;
  fwss: Address;
  /** Informational only: the StateView is resolved through FWSS at call time and never pinned. */
  stateView: Address;
  governor: Address;
  resolverOwner: Address;
  registrars: readonly Address[];
  binders: readonly Address[];
  deployedAtBlock: number;
  /** anvil only: mock PDP data sets created by DeployLocal (1 = A, 2 = B). */
  mockDataSets?: readonly { id: number; provider: Address }[];
};

/** Well-known FOC addresses (IMPLEMENTATION-PLAN §0). The registry is zero until deployed. */
const FOC: Record<314159 | 314, Pick<Deployment, "pdpVerifier" | "fwss" | "stateView">> = {
  314159: {
    pdpVerifier: "0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C",
    fwss: "0x02925630df557F957f70E112bA06e50965417CA0",
    stateView: "0x1B68d64f01bAa42014B9774605867BF4eDC0320f",
  },
  314: {
    pdpVerifier: "0xBADd0B92C1c71d02E7d520f64c0876538fa2557F",
    fwss: "0x8408502033C418E1bbC97cE9ac48E5528F371A9f",
    stateView: "0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172",
  },
};

export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

function placeholder(chainId: 314159 | 314): Deployment {
  return {
    chainId,
    registry: zeroAddress,
    resolver: zeroAddress,
    ...FOC[chainId],
    governor: zeroAddress,
    resolverOwner: zeroAddress,
    registrars: [],
    binders: [],
    deployedAtBlock: 0,
  };
}

function addr(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) {
    throw new Error(`deployment: ${field} is not an address`);
  }
  return getAddress(v);
}

/** Validates a deployments JSON object (contracts/deployments/*.json) into a typed Deployment. */
export function parseDeployment(raw: unknown): Deployment {
  if (typeof raw !== "object" || raw === null) throw new Error("deployment: not an object");
  const o = raw as Record<string, unknown>;
  const chainId = o.chainId;
  if (chainId !== 31337 && chainId !== 314159 && chainId !== 314) {
    throw new Error(`deployment: unsupported chainId ${String(chainId)}`);
  }
  const list = (v: unknown, field: string): Address[] => {
    if (!Array.isArray(v)) throw new Error(`deployment: ${field} is not an array`);
    return v.map((x, i) => addr(x, `${field}[${i}]`));
  };
  const block = o.deployedAtBlock;
  if (typeof block !== "number" || !Number.isInteger(block) || block < 0) {
    throw new Error("deployment: deployedAtBlock is not a block number");
  }
  const d: Deployment = {
    chainId,
    registry: addr(o.registry, "registry"),
    resolver: addr(o.resolver, "resolver"),
    pdpVerifier: addr(o.pdpVerifier, "pdpVerifier"),
    fwss: addr(o.fwss, "fwss"),
    stateView: addr(o.stateView, "stateView"),
    governor: addr(o.governor, "governor"),
    resolverOwner: addr(o.resolverOwner, "resolverOwner"),
    registrars: list(o.registrars, "registrars"),
    binders: list(o.binders, "binders"),
    deployedAtBlock: block,
  };
  if (o.mockDataSets !== undefined) {
    if (!Array.isArray(o.mockDataSets)) throw new Error("deployment: mockDataSets is not an array");
    d.mockDataSets = o.mockDataSets.map((m: unknown, i) => {
      const r = m as Record<string, unknown>;
      if (typeof r?.id !== "number") throw new Error(`deployment: mockDataSets[${i}].id`);
      return { id: r.id, provider: addr(r.provider, `mockDataSets[${i}].provider`) };
    });
  }
  return d;
}

const generated = generatedDeployments as Record<string, unknown>;

export const deployments: Partial<Record<ChainId, Deployment>> = {
  314159: generated["314159"] ? parseDeployment(generated["314159"]) : placeholder(314159),
  314: generated["314"] ? parseDeployment(generated["314"]) : placeholder(314),
  ...(generated["31337"] ? { 31337: parseDeployment(generated["31337"]) } : {}),
};

/** True when the registry of `d` has been deployed (non-zero address). */
export function isDeployed(d: Deployment): boolean {
  return d.registry !== zeroAddress;
}

/** Deployment for `chainId`; throws if the chain is unknown or the registry is not deployed there yet. */
export function deploymentFor(chainId: number): Deployment {
  const d = deployments[chainId as ChainId];
  if (!d) throw new Error(`no Stamper deployment for chainId ${chainId}`);
  if (!isDeployed(d)) throw new Error(`StampRegistry is not deployed on chainId ${chainId} yet`);
  return d;
}
