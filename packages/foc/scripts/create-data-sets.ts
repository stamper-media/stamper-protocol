// Payer ceremony: fund + approve FWSS with capped allowances, then create data sets A (CDN) and B
// by committing one 200-byte piece to each. Prints FOC_DATASET_{A,B}_ID.
// Usage: FOC_PAYER_PK=0x… FOC_CHAIN_ID=314159 pnpm tsx scripts/create-data-sets.ts \
//   --provider-a <id> --provider-b <id> --env prod --deposit 5 --rate-allowance 1 --lockup-allowance 20
import { parseUnits } from "viem";
import { arg, ceremony, json } from "./_common.js";

const { synapse } = ceremony();
const providerA = BigInt(arg("provider-a") ?? NaN);
const providerB = BigInt(arg("provider-b") ?? NaN);
const stamperEnv = arg("env") ?? "dev";
const usd = (k: string, d: string) => parseUnits(arg(k) ?? d, 18);

const meta = { source: "stamper", "stamper.env": stamperEnv };
const ctxA = await synapse.storage.createContext({
  providerId: providerA,
  withCDN: true,
  metadata: meta,
});
const ctxB = await synapse.storage.createContext({
  providerId: providerB,
  withCDN: false,
  metadata: meta,
});
const prep = await synapse.storage.prepare({ context: [ctxA, ctxB], pieceSizes: [200n] });
console.log("costs", json(prep.costs));
if (prep.transaction) {
  const hash = await synapse.payments.depositWithPermitAndApproveOperator({
    amount:
      prep.transaction.depositAmount > usd("deposit", "5")
        ? prep.transaction.depositAmount
        : usd("deposit", "5"),
    rateAllowance: usd("rate-allowance", "1"),
    lockupAllowance: usd("lockup-allowance", "20"),
  });
  console.log("deposit+approve tx", hash);
  // The provider simulates createDataSet against chain state, so the deposit must be mined first
  // (Filecoin epochs are 30 s; a receipt can take 30–90 s). Without this wait the SP sees
  // InsufficientLockupFunds(available = 0) even though the deposit succeeds moments later.
  const receipt = await synapse.client.waitForTransactionReceipt({
    hash,
    timeout: 300_000,
    pollingInterval: 5_000,
  });
  if (receipt.status !== "success") throw new Error(`deposit+approve reverted: ${hash}`);
  console.log("deposit+approve mined in block", receipt.blockNumber);
}
for (const [role, ctx] of [
  ["A", ctxA],
  ["B", ctxB],
] as const) {
  if (ctx.dataSetId !== undefined) {
    console.log(`FOC_DATASET_${role}_ID=${ctx.dataSetId} (existing)`);
    continue;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(200));
  const stored = await ctx.store(bytes);
  const res = await ctx.commit({ pieces: [{ pieceCid: stored.pieceCid }] });
  console.log(
    `FOC_DATASET_${role}_ID=${res.dataSetId}  FOC_DATASET_${role}_PROVIDER_ID=${ctx.provider.id}  tx=${res.txHash}`,
  );
}
