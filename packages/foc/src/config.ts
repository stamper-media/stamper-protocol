import { calibration, type FilecoinChain, mainnet } from "@filoz/synapse-core/chains";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { type DataSetRole, type FocChainId, type FocConfig, FocError } from "./types.js";

export const DEFAULT_MOCK_SP_PORT = 7878;

const positiveId = z
  .union([z.bigint(), z.string().regex(/^\d+$/), z.number().int()])
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, "must be a positive id (data sets are always pinned; 0 is not allowed)");

const pinSchema = z.object({
  id: positiveId,
  providerId: positiveId,
  withCDN: z.boolean(),
});

export const focConfigSchema = z.object({
  chainId: z.union([z.literal(314), z.literal(314159)]),
  rpcUrl: z.url({ protocol: /^(https?|wss?)$/ }),
  payerAddress: z
    .string()
    .refine((a) => isAddress(a, { strict: false }), "invalid address")
    .transform((a) => getAddress(a)),
  source: z.literal("stamper"),
  dataSets: z.object({ A: pinSchema, B: pinSchema }),
});

/** Validate and normalise a FocConfig. Throws FocError("config"). */
export function parseFocConfig(input: unknown): FocConfig {
  const r = focConfigSchema.safeParse(input);
  if (!r.success) {
    throw new FocError("config", `invalid FOC config: ${z.prettifyError(r.error)}`);
  }
  return r.data as FocConfig;
}

export function chainFor(chainId: FocChainId): FilecoinChain {
  if (chainId === 314) return mainnet;
  if (chainId === 314159) return calibration;
  throw new FocError("config", `unsupported chain id ${String(chainId)}`);
}

type Env = Record<string, string | undefined>;

function req(env: Env, k: string): string {
  const v = env[k];
  if (v === undefined || v.trim() === "") throw new FocError("config", `missing env ${k}`);
  return v.trim();
}

/**
 * Build a FocConfig from FOC_* env vars. Data set A is the CDN (FilBeam) set, B is not.
 * FOC_RPC_URL defaults to the chain's default RPC.
 */
export function focConfigFromEnv(env: Env): FocConfig {
  const chainId = Number(req(env, "FOC_CHAIN_ID"));
  const chain = chainFor(chainId as FocChainId);
  const pin = (role: DataSetRole) => ({
    id: req(env, `FOC_DATASET_${role}_ID`),
    providerId: req(env, `FOC_DATASET_${role}_PROVIDER_ID`),
    withCDN: role === "A",
  });
  return parseFocConfig({
    chainId,
    rpcUrl: env.FOC_RPC_URL?.trim() || chain.rpcUrls.default.http[0],
    payerAddress: req(env, "FOC_PAYER_ADDRESS"),
    source: "stamper",
    dataSets: { A: pin("A"), B: pin("B") },
  });
}

export type FocMode = "real" | "mock";

export function focModeFromEnv(env: Env): FocMode {
  const m = (env.FOC_MODE ?? "real").trim();
  if (m !== "real" && m !== "mock") throw new FocError("config", `FOC_MODE must be real|mock`);
  return m;
}

export function mockSpFromEnv(env: Env): { dir: string; port: number } {
  const dir = req(env, "MOCK_SP_DIR");
  const port = env.MOCK_SP_PORT ? Number(env.MOCK_SP_PORT) : DEFAULT_MOCK_SP_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new FocError("config", "MOCK_SP_PORT must be an integer port");
  }
  return { dir, port };
}
