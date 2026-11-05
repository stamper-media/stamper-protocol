// Authorise the custodian session key for AddPieces only, for 7 days (rotate weekly).
// Usage: FOC_PAYER_PK=0x… pnpm tsx scripts/session-login.ts --session-address 0x… [--days 7]
import { AddPiecesPermission, login } from "@filoz/synapse-core/session-key";
import { type Address, isAddress } from "viem";
import { arg, ceremony } from "./_common.js";

const { synapse } = ceremony();
const address = arg("session-address");
if (!address || !isAddress(address)) throw new Error("--session-address 0x… required");
const days = Number(arg("days") ?? "7");
if (!(days > 0 && days <= 30)) throw new Error("--days must be in (0, 30]");
const expiresAt = BigInt(Math.floor(Date.now() / 1000 + days * 86_400));
const hash = await login(synapse.client, {
  address: address as Address,
  permissions: [AddPiecesPermission],
  expiresAt,
  origin: "stamper",
});
// Wait for inclusion: the custodian checks the on-chain grant at start-up, so an unmined login
// makes it fail with "lacks AddPiecesPermission" for 30–90 s after this script returns.
const receipt = await synapse.client.waitForTransactionReceipt({
  hash,
  timeout: 300_000,
  pollingInterval: 5_000,
});
if (receipt.status !== "success") throw new Error(`session login reverted: ${hash}`);
console.log(
  `login tx ${hash}; AddPieces expires ${new Date(Number(expiresAt) * 1000).toISOString()}`,
);
