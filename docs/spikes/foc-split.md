# Spike: FOC store/commit split (DESIGN §5.2), WP-03

**Status: NOT RUN (2026-10-01).** The build host has no Filecoin wallet, no payer key, no USDFC and no Calibration data sets, so this spike could not run here.

## What the spike checks

`packages/foc/test/calibration.int.test.ts` runs these steps on Calibration:

1. The reader stores a 200-byte random piece on data sets A and B with `StorageContext.store`. This step uses no key, and the SP checks the precomputed PieceCID.
2. The custodian calls `commitPieces` on each set, signed by the AddPieces-only session key.
3. `pieceStatus` returns a `pieceId`.
4. `downloadAndVerify` succeeds from the provider URL, and also from FilBeam for set A only.
5. `dataSetHealth` reports `listenerIsFwss && live`.
6. `sessionExpiry` is greater than 0.

The test logs the store and commit latencies and the transaction hashes.

## What ran locally instead

The same code paths ran against msw with the `@filoz/synapse-core/mocks` JSON-RPC preset and an SP stand-in. They showed that:

- `store()` sends the precomputed CID, and the SP rejects a CID that differs.
- The custodian refuses a session key that is unauthorised or expired.
- The `MockFoc` store, serve, download, check and commit cycle works.

## How to run it

```
FOC_CHAIN_ID=314159 FOC_PAYER_ADDRESS=0x… FOC_SESSION_PK=0x… \
FOC_DATASET_A_ID=… FOC_DATASET_A_PROVIDER_ID=… FOC_DATASET_B_ID=… FOC_DATASET_B_PROVIDER_ID=… \
pnpm --filter @stamper/foc test:calibration
```

Create the prerequisites first with the ceremony in `packages/foc/README.md`.

## Results

_To be filled in on the first run with keys: store and commit latency for A and B, tx hashes, FilBeam time to first byte, and any SDK surprises._
