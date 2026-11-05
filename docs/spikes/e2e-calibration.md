# e2e on Calibration (`e2e/run-calibration.sh`)

Status 2026-10-30: **every flow leg passes on Calibration with real FOC** (stamp `1YB9-05HR-5`, see Report). The roles activated on 2026-10-03; the section below is the original pre-flight record.

## Role activation (read from chain 2026-10-01 ~05:47Z, registry `0xb64F15D327C9953C8fCaB3700C5e92772a5021c9`)

| Role | Address | `*ActiveFrom` |
|---|---|---|
| registrar | `0xe5bFf4995fbF6b4C99c535b200AdCE47f000302F` | 2026-10-03T04:46:00Z |
| binder (relayer) | `0x461CF9fb97d97182a3990a2628394B3fcD746F7a` | 2026-10-03T04:47:00Z |

These times are later than the deploy block time + 48 h (2026-10-03T04:42:30Z), because the roles were
announced in later blocks. The full flow needs both roles, so the earliest useful run is **after 2026-10-03T04:47:00Z**.

## What the script does now

- `e2e/roles.ts` runs before anything starts. While a role is pending it prints
  `SKIP run-calibration: registry roles are announced but not active until <time> …` and exits 0.
  Set `E2E_ROLE_WAIT_S=<seconds>` to wait instead. A role that was never announced stops the script with exit 1.
- The first attempt (04:59Z) failed at enrol (`NotRegistrar`). It then hung in the pipeline poll, because a
  skipped leg counted as passed. Now `flow.ts` skips the pipeline when there is no stamp, and `poll()` fails at
  once on non-transient errors.

## Report

First full run, 2026-10-30 (`E2E_SKIP_VIDEO=1`), stamp **`1YB9-05HR-5`** registered at epoch 4201347
(2026-10-30T13:26:30Z). Every flow leg passed on real FOC:

| Leg | Result |
|---|---|
| capture→202 / 202→receipt / receipt→marked / marked→bound / bound→probe-ok | 0.51 s / 127.97 s / 111.97 s / 273.57 s / 5.97 s |
| enrol, claim | level 1, code predicted and confirmed |
| pipeline | stored on both providers, 2 bindings (data sets 40026 and 40027, piece id 2 in each), probe ok |
| chain re-verify | digest rebuilt, signature checks, `cidMatches && listenerIsFWSS` on both bindings |
| ORIGINAL | re-hashed from the provider `calib.ezpdpz.net` |
| STAMPER MARKED COPY, RELATED | pass (PDQ distance 0 on the q70 re-encode) |
| verify-independently | all checks hold (after the fix below) |

The verify site pointed at Calibration (api-less) shows ORIGINAL with the bytes served by FilBeam, and its PDP
explorer links open https://pdp.filecoin.cloud/calibration/dataset/40026 and …/40027.

Bugs this run found, fixed the same day:

- `flow.ts` read `getKey` right after the enrolment `201`, which means "registering" (tx sent, not mined).
  Instant on anvil; on Calibration the key was still empty. It now waits for the `registerKey` receipt.
- `verify-independently.sh` recovered the secp256k1 signer with an `eth_call` to the ecrecover precompile at
  `0x01`. FEVM answers a direct call to a precompile with empty data, so the check failed on Calibration (anvil
  answers it). It now recovers locally through `@stamper/core` (noble); `docs/verify-independently.md` says so.
- Sourcing the owner's env files whole put `FOC_PAYER_PK` in the api's environment, and the api refused to start
  (by design). `run-calibration.sh` now unsets `FOC_PAYER_PK` and `DEPLOYER_PK`.
- The session key's 7-day AddPieces grant from 2026-10-01 had expired; renewed with
  `packages/foc/scripts/session-login.ts` (expires 2026-11-06T13:19:30Z).

The script's own run still reported red because of the ecrecover check; the fixed `verify-independently.sh` was
then run on its own against the same stamp and passed. A single end-to-end green run of the fixed script is
still to do.

### Duplicate pieces on a retried commit (2026-10-30, stamp `1FP4-T34E-H`)

A later photo run (`E2E_PHOTO`, `E2E_LOCATION`) stalled at marked→bound. Provider 4
(`caliberation-pdp.infrafolio.com`, data set 40027) landed AddPieces about a minute after it was sent, but its
status endpoint never confirmed it. Synapse's `waitForAddPieces` timed out after 300 s, the commit job failed,
and each of the five retries sent a fresh AddPieces. Data set 40027 now holds piece 3 plus five copies of it
(pieces 4 to 8). Data set 40026 (provider 9) took the same piece once, as piece 3.

Fix: `SynapseFocCustodian.commitPieces` now reads `findPieceIdsByCid` on PDPVerifier before it sends anything,
and commits only the pieces that are not already live. It also checks the chain again when the SP never confirms
a submitted commit. A commit with nothing left to add returns `txHash: null`. The mock custodian does the same.
Checked against Calibration: re-committing the `1FP4-T34E-H` piece returned ids 3/3 with no transaction. The
duplicate pieces stay on chain: removing them needs the payer, and the session key holds only AddPieces.

Re-run the same day with the fix: stamp **`PDSE-8WYH-H`**, RESULT green. Every leg passed, and so did
verify-independently. The photo bytes were the same as `1FP4-T34E-H`, so the commit found piece 3 already live in
both data sets: marked→bound took 0.01 s and sent no AddPieces. Two stamps now bind the same piece, whose
metadata names the first stamp. Nothing deletes pieces today. Any future removal path must first check that no
other binding uses the piece. This stamp is the site's labelled demo example. A second chip checks an edited copy: the photo resized to 1080 px
with the right-hand boat removed (`apps/web/public/examples/PDSE8WYHH-edited.jpg`). The api search finds the
stamp at PDQ distance 4 (SSIM 0.988), and the stamp page draws the removed hull in the diff map:

```
NEXT_PUBLIC_EXAMPLES="PDSE-8WYH-H|Harbour at dusk|/examples/PDSE8WYHH.jpg|demo;PDSE-8WYH-H|Harbour at dusk, a boat removed|/examples/PDSE8WYHH-edited-thumb.jpg|demo|/examples/PDSE8WYHH-edited.jpg"
```
