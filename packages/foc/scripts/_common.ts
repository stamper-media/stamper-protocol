// Payer ceremony helpers. Run from a laptop holding the payer key, NEVER on the VPS.
import { Synapse } from "@filoz/synapse-sdk";
import { type Address, type Hex, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "../src/config.js";
import type { FocChainId } from "../src/types.js";

export function env(k: string, fallback?: string): string {
  const v = process.env[k]?.trim() || fallback;
  if (!v) {
    console.error(`missing env ${k}`);
    process.exit(2);
  }
  return v;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function ceremony() {
  if (process.argv.includes("--ledger")) {
    console.error(
      "--ledger is not wired in this build: sign with FOC_PAYER_PK on an offline laptop.",
    );
    process.exit(2);
  }
  const chainId = Number(env("FOC_CHAIN_ID", "314159")) as FocChainId;
  const chain = chainFor(chainId);
  const rpcUrl = env("FOC_RPC_URL", chain.rpcUrls.default.http[0]);
  const pk = env("FOC_PAYER_PK") as Hex;
  if (!isHex(pk) || pk.length !== 66) throw new Error("FOC_PAYER_PK must be 0x + 64 hex");
  const account = privateKeyToAccount(pk);
  const synapse = Synapse.create({ account, chain, transport: http(rpcUrl), source: "stamper" });
  return { chain, chainId, rpcUrl, account, synapse };
}

export function readOnly() {
  const chainId = Number(env("FOC_CHAIN_ID", "314159")) as FocChainId;
  const chain = chainFor(chainId);
  const rpcUrl = env("FOC_RPC_URL", chain.rpcUrls.default.http[0]);
  const payer = env("FOC_PAYER_ADDRESS") as Address;
  const synapse = Synapse.create({
    account: payer,
    chain,
    transport: http(rpcUrl),
    source: "stamper",
  });
  return { chain, chainId, payer, synapse };
}

export function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
}
