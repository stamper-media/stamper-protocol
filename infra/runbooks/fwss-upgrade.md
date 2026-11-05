# Runbook: FWSS / StateView upgrade

The registry pins the **FWSS proxy** and reads the StateView through `IFWSS(fwss).viewContractAddress()`
at call time, so a FOC upgrade behind the proxy needs no Stamper redeploy. Never pin the StateView in a
write path.

1. Watch FilOz release notes; on announcement, run the contracts fork test against Calibration
   (`CALIBRATION_RPC_URL=… forge test --root contracts --match-path 'test/fork/*'`).
2. After the upgrade: `cast call $FWSS "viewContractAddress()(address)"` resolves, and
   `bindingStatus` for a known stamp still returns `cidMatches = true`.
3. Bump `@filoz/synapse-sdk` / `synapse-core` in the pnpm catalog if the SDK requires it, rebuild the
   api image, run `scripts/smoke.sh`, deploy.
4. If the proxy itself moves (new address), that is a new registry deployment: ADR + `deploy-*.sh`.
