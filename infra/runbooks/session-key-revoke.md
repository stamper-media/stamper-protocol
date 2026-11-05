# Runbook: FOC session key revoke (suspected leak or routine rotation)

**Blast radius of a leaked session key:** it can only `AddPieces` to Stamper's data sets at Stamper's
expense until it expires (7 days) or is revoked, capped by the FWSS allowances. It cannot withdraw funds,
create or terminate data sets, or schedule removals.

## Emergency (leak suspected)
1. Laptop, payer key in the shell only:
   `FOC_PAYER_PK=0x… infra/scripts/foc-session-rotate.sh revoke --address <current session address>`
   (the address is `FOC_SESSION_ADDRESS` in the env file, or `cast wallet address --private-key "$(cat infra/secrets/foc_session_pk)"` on the VPS).
2. From now on commits fail (`commit` jobs retry with back-off; uploads keep being accepted and stored
   off-box in the mirror, so nothing is lost).
3. Run the full rotation below, starting with `generate`.
4. Check payer runway and allowance use: `FOC_PAYER_ADDRESS=0x… pnpm --filter @stamper/foc exec tsx scripts/runway.ts`.
   Unexpected pieces in data sets A/B are harmless to stamps (a stamp binds a specific CID).
5. Post-mortem: how the key left the api container (it exists only in `infra/secrets/foc_session_pk`).

## Weekly rotation
| Where | Command |
|---|---|
| VPS | `infra/scripts/foc-session-rotate.sh generate` → prints the new address |
| laptop | `FOC_PAYER_PK=… infra/scripts/foc-session-rotate.sh login --address <new>` |
| VPS | `infra/scripts/foc-session-rotate.sh activate` → recreates `api`, prints the old address |
| laptop | `FOC_PAYER_PK=… infra/scripts/foc-session-rotate.sh revoke --address <old>` |
| VPS | `infra/scripts/foc-session-rotate.sh cleanup` |

Then `unset FOC_PAYER_PK` and close the shell. Confirm `/v1/health/storage` is green after the next commit.
