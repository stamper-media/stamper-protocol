# Blockscout verification of the Calibration deployment (2026-10-01)

**Symptom.** filecoin-testnet.blockscout.com reported `is_verified: false` for StampRegistry
`0xb64F15D327C9953C8fCaB3700C5e92772a5021c9` and StampResolver `0x08298D447E7f1215939E48A64FEfF75075722B0c`
(deployed 2026-10-01 04:47Z, `contracts/broadcast/Deploy.s.sol/314159/run-1790830050689.json`).

**Why the verify step of `deploy-calibration.sh` did not take effect.**
1. Publication existed only as `--verify` flags inside the one `forge script --broadcast` call (old lines 82–89).
   The steps after that call never ran on this host: `packages/contracts-abi/src/deployments.gen.ts` (02:19Z)
   predates the deploy and has no Calibration addresses, and `infra/env/calibration.env` does not exist. So either
   that forge call stopped with an error (a verify error makes forge exit non-zero after the broadcast, and
   `set -e` ends the script) or `Deploy.s.sol` was run by hand. The run's log is not on the host, so which one
   happened is not known. In both cases nothing retried or reported the missing publication, and a re-run
   refuses because `deployments/calibration.json` exists (`--force` deploys a new registry).
2. A manual retry does nothing either. Blockscout indexes the runtime code of these FEVM contracts as `0xfe` and
   links them to an unrelated verified "twin" (`FilecoinMarketConsumer`, `0xad8BC443766AaA8ffB214fD2F8E1Dc5Cac7F6B0D`).
   Its Etherscan-compatible `getsourcecode` then returns the twin's source, so `forge verify-contract` prints
   "is already verified. Skipping verification." and exits 0, while `/api/v2/smart-contracts/<addr>` still says
   `is_verified: false`. Reproduced on 2026-10-01.
3. The sources did not drift: the local build (`contracts/out`, sources unchanged since 02:18Z) is a byte-exact
   prefix of both creation inputs on Blockscout. The rest of each input is the constructor arguments.

**Fix.**
- Published 05:38Z with `forge verify-contract <addr> src/<C>.sol:<C> --chain 314159 --verifier blockscout
  --verifier-url https://filecoin-testnet.blockscout.com/api/ --constructor-args <from the creation input>
  --skip-is-verified-check --watch`, which returned "Pass - Verified" for both. The v2 API now reports `is_verified: true` under
  the right names. This is a partial match, because `bytecode_hash = "none"` leaves no metadata hash to match.
- `infra/scripts`: publication is now its own step, `verify_on_blockscout` in `lib/common.sh` (it uses `lib/blockscout.mjs`).
  It always passes `--skip-is-verified-check`, takes the constructor arguments from the indexed creation input
  after checking the local build, and treats the v2 API (`is_verified` under the expected name) as the authority.
  When publication fails, the script prints a red error at once, still runs the remaining steps, and exits
  non-zero at the end. `--verify-only` retries publication without keys or RPC. `deploy-mainnet.sh` works the same way.
