// Emergency: revoke the custodian session key's AddPieces authorisation.
// Usage: FOC_PAYER_PK=0x… pnpm tsx scripts/session-revoke.ts --session-address 0x…
import { AddPiecesPermission, revoke } from "@filoz/synapse-core/session-key";
import { type Address, isAddress } from "viem";
import { arg, ceremony } from "./_common.js";

const { synapse } = ceremony();
const address = arg("session-address");
if (!address || !isAddress(address)) throw new Error("--session-address 0x… required");
const hash = await revoke(synapse.client, {
  address: address as Address,
  permissions: [AddPiecesPermission],
  origin: "stamper",
});
// A revocation only protects anything once it is mined; confirm before reporting success.
const receipt = await synapse.client.waitForTransactionReceipt({
  hash,
  timeout: 300_000,
  pollingInterval: 5_000,
});
if (receipt.status !== "success") throw new Error(`session revoke reverted: ${hash}`);

console.log(`revoke tx ${hash}`);
