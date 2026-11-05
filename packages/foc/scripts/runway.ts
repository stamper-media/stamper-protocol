// Read-only: payer funds, lockup and funded-until epoch.
// Usage: FOC_PAYER_ADDRESS=0x… FOC_CHAIN_ID=314159 pnpm tsx scripts/runway.ts
import { formatUnits } from "viem";
import { computeRunway } from "../src/custodian.js";
import { json, readOnly } from "./_common.js";

const { synapse } = readOnly();
const [acct, block] = await Promise.all([
  synapse.payments.accountInfo(),
  synapse.readClient.getBlockNumber(),
]);
const r = computeRunway(acct, block);
console.log(
  json({
    ...r,
    availableUsdfcHuman: formatUnits(r.availableUsdfc, 18),
    lockupUsdfcHuman: formatUnits(r.lockupUsdfc, 18),
    currentEpoch: block,
  }),
);
