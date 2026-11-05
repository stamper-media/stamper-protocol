# @stamper/foc

Everything that touches Filecoin Onchain Cloud (FOC), wrapped around `@filoz/synapse-sdk@2.0.2` /
`@filoz/synapse-core@0.10.0`, behind two interfaces:

- **`FocReader`** (worker, holds no key): `storeOriginal` (`StorageContext.store` with the
  precomputed PieceCID, which the SP checks), `pieceStatus`, `retrievalUrls`, `providerServiceUrl`,
  `dataSetHealth` and `priceList`.
- **`FocCustodian`** (api only): everything in the reader, plus `commitPieces` (`createContext({ dataSetId, providerId })` →
  `commit`, signed by an **AddPieces-only session key**), `preflight` (`storage.prepare`),
  `runway` (`payments.accountInfo`) and `sessionExpiry` (`authorizationExpiry`).

## Public API (`src/index.ts`)

| Export | Notes |
|---|---|
| `createFocReader(cfg)` | `Synapse.create({ account: payerAddress, chain, transport, source: "stamper" })` |
| `createFocCustodian({ ...cfg, sessionKeyPk })` | `fromSecp256k1` + `syncExpirations([AddPiecesPermission])`. **Throws at start-up** if the key is missing AddPieces or it has expired. Uses `requiredPermissions: [AddPiecesPermission]` and `pieceBatching: { wait: { kind: "limiter" } }`. |
| `downloadAndVerify(url, { sha256, pieceCid }, { signal, timeoutMs, maxBytes })` | Streams the body through `Piece.transformStream()` and an incremental sha256. It never throws, so failures come back as `ok:false` with an `error`. |
| `validatePieceMetadata(m)` / `toPieceMetadata({ stamp, role, sha256 })` | Allows at most 3 keys. Each key is at most 32 B and each value at most 96 B (UTF-8). |
| `retrievalUrls` / `filbeamPieceUrl` / `providerPieceUrl` / `ProviderUrlResolver` | FilBeam is used only when a set has `withCDN`: `https://{payer}.{chain.filbeam.retrievalDomain}/{cid}`. Providers come from `SPRegistryService.getProvider` → `serviceURL` + `/piece/{cid}`, cached for 10 min. |
| `readDataSetHealth` | PDPVerifier reads, plus the FWSS StateView resolved through `viewContractAddress()`. A failed view read gives `viewOk:false`. |
| `createMockFoc({ dir, port, onCommit })` (also `@stamper/foc/mock`) | Plan §4.3. `store` checks the CID and writes `<dir>/<cid>`. `GET/HEAD /piece/<cid>` is served on `port` (0 picks a free port). `commit` calls `onCommit(ds, cidBytes)` once per piece. Mock data sets are A=1, B=2. |
| `focConfigFromEnv(env)`, `focModeFromEnv`, `mockSpFromEnv`, `parseFocConfig` | Validated with zod. Data set ids must be > 0. |
| `assertPinnedContext`, `pinnedContextOptions` | **No code path creates a data set.** Every context is opened with the pinned `dataSetId` and checked after resolution. A commit that reports `isNewDataSet` or a different set throws `FocError("pin")`. |

## Env

`FOC_CHAIN_ID` (314 or 314159), `FOC_RPC_URL` (defaults to the chain's RPC), `FOC_PAYER_ADDRESS`,
`FOC_DATASET_A_ID`, `FOC_DATASET_A_PROVIDER_ID` (A = the CDN set), `FOC_DATASET_B_ID`,
`FOC_DATASET_B_PROVIDER_ID`, `FOC_SESSION_PK` (custodian only), `FOC_MODE=real|mock`,
`MOCK_SP_DIR`, `MOCK_SP_PORT` (default 7878). The scripts use `FOC_PAYER_PK`.

## Tests

```
pnpm --filter @stamper/foc test        # unit tests, no network (msw + in-process HTTP)
pnpm --filter @stamper/foc typecheck
pnpm --filter @stamper/foc test:calibration   # needs the FOC_* env above; otherwise skipped with a reason
```

The unit tests cover:
- metadata limits and config
- retrieval URLs on both chains
- `downloadAndVerify` with good bytes, wrong bytes, 404, 402, a timeout and `maxBytes`
- a MockFoc round-trip and the traversal guard
- reader `store()` against msw (the SP receives the precomputed CID, and a CID that differs is rejected)
- custodian start-up refusing a key that is unauthorised or expired
- the pinned data set guard

## Payer ceremony runbook (laptop with the payer key, never the VPS)

1. **Pick providers:** `pnpm tsx scripts/select-providers.ts` ranks the approved PDP providers by HEAD latency.
2. **Create data sets:** `pnpm tsx scripts/create-data-sets.ts --provider-a <id> --provider-b <id> --env prod --deposit 5 --rate-allowance 1 --lockup-allowance 20`.
   It runs `storage.prepare`, then `depositWithPermitAndApproveOperator` with **capped** rate and lockup allowances. It then commits one 200-byte piece to each set and prints `FOC_DATASET_{A,B}_ID`.
3. **Session key rotation (every 7 days):** generate a fresh key, then run
   `pnpm tsx scripts/session-login.ts --session-address <addr> --days 7`. Deploy the new
   `FOC_SESSION_PK` to the api. The api refuses to start once the authorisation has expired.
4. **Emergency:** `pnpm tsx scripts/session-revoke.ts --session-address <addr>`. The key can then
   no longer add pieces. The worst a leaked key could have done is add pieces (and pay their per-piece fees) to the two pinned sets.
5. **Runway:** `FOC_PAYER_ADDRESS=… pnpm tsx scripts/runway.ts`.

## Stubbed or not run here

- **Calibration integration test:** not run, because no wallet, keys or USDFC exist on the build host (see `docs/spikes/foc-split.md`).
- **`--ledger` signing in the scripts:** not wired, so the scripts sign with `FOC_PAYER_PK` only.
- **`MockFoc` stand-ins:** `runway`, `preflight`, `priceList` and `sessionExpiry` return static values.
