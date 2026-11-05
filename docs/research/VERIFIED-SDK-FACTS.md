# Verified facts from the installed Filecoin Onchain Cloud SDK (primary source: node_modules, 2026-09-30)

These were read directly from the installed packages `@filoz/synapse-sdk@2.0.2` and `@filoz/synapse-core@0.10.0` (pnpm, Node 22.20). Treat them as ground truth over anything a web page says.

## Packages
- `@filoz/synapse-sdk@2.0.2` — high-level SDK. Peer dep `viem@2.x`. Deps: `@filoz/synapse-core ^0.10.0`, `multiformats 14.0.5`. ESM only (`"import"` exports). Subpath exports: `.`, `./payments`, `./session`, `./storage`, `./warm-storage`, `./sp-registry`, `./filbeam`.
- `@filoz/synapse-core@0.10.0` — low-level actions. Subpath exports: `./chains ./client ./sp ./pdp-verifier ./erc20 ./usdfc ./abis ./auction ./pay ./warm-storage ./typed-data ./session-key ./sp-registry ./errors ./piece ./utils ./mocks ./endorsements ./devnet`. Deps: `dnum, iso-web, multiformats, ox 0.14.29, p-locate, p-some, sync-multihash-sha2, zod 4`.
- README states: "Works in Node.js, browsers, and all major bundlers." React Native is NOT mentioned anywhere in the packages.
- FilCDN appears in the SDK under the name **FilBeam** (`synapse.filbeam`, `FilBeamService`; chain config `filbeam.retrievalDomain: 'filbeam.io'`).

## Chains (`@filoz/synapse-core/chains`)
- `mainnet`: id 314, RPC default `https://api.node.glif.io/rpc/v1` (ws `wss://wss.node.glif.io/apigw/lotus/rpc/v1`), alt `https://rpc.ankr.com/filecoin`, `https://filecoin.drpc.org`. Explorers: Blockscout `https://filecoin.blockscout.com`, Beryx, Filfox, Glif. `genesisTimestamp: 1598306400`.
- `calibration`: id 314159, RPC default `https://api.calibration.node.glif.io/rpc/v1`, alt `https://rpc.ankr.com/filecoin_testnet`, `https://filecoin-calibration.drpc.org`. Explorer Blockscout `https://filecoin-testnet.blockscout.com`, Filfox `https://calibration.filfox.info`.
- `multicall3` at `0xcA11bde05977b3631167028862bE2a173976CA11` on both.

## Contract addresses (from `abis/generated.js`)
| Contract | Mainnet 314 | Calibration 314159 |
|---|---|---|
| USDFC (ERC-20 w/ permit) | 0x80B98d3aa09ffff255c3ba4A241111Ff1262F045 | 0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0 |
| FilecoinPay V1 | 0x23b1e018F08BB982348b15a86ee926eEBf7F4DAa | 0x09a0fDc2723fAd1A7b8e3e00eE5DF73841df55a0 |
| FilecoinWarmStorageService (FWSS) | 0x8408502033C418E1bbC97cE9ac48E5528F371A9f | 0x02925630df557F957f70E112bA06e50965417CA0 |
| FWSS StateView | 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 | 0x1B68d64f01bAa42014B9774605867BF4eDC0320f |
| PDPVerifier | 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F | 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C |
| ServiceProviderRegistry | 0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB | 0x839e5c9988e4e9977d40708d0094103c0839Ac9D |
| SessionKeyRegistry | 0x74FD50525A958aF5d484601E252271f9625231aB | 0x518411c2062E119Aaf7A8B12A2eDf9a939347655 |
| ProviderIdSet (endorsements) | 0x59eFa2e8324E1551d46010d7B0B140eE2F5c726b | 0xAA2f7CfC7ecAc616EC9C1f6d700fAd19087FAC84 |

## High-level API (`Synapse` class)
```ts
Synapse.create({ account: Account | Address, transport?, chain?, sessionKey?: SessionKey<'Secp256k1'>, requiredPermissions?, withCDN?: boolean, pieceBatching?: false | {...}, source: string | null })
synapse.client / readClient / sessionClient / chain
synapse.payments: PaymentsService     // USDFC deposits, allowances (Filecoin Pay)
synapse.storage: StorageManager       // upload/download/contexts
synapse.filbeam: FilBeamService       // CDN retrieval
synapse.providers: SPRegistryService
```
StorageManager:
```ts
upload(data: Uint8Array | ReadableStream, { contexts?, callbacks?, pieceCid?, signal?, pieceMetadata?: Record<string,string>, copies?, dataSetIds?, providerIds? }) => Promise<UploadResult>
// UploadResult { pieceCid: PieceCID; size: number; requestedCopies: number; complete: boolean; copies: CopyResult[]; failedAttempts: FailedAttempt[] }
download({ pieceCid, withCDN?, context?, providerAddress? }) => Promise<Uint8Array>
getUploadCosts(...), prepare({ pieceSizes, ... }) => PrepareResult   // preflight: allowances/funds
createContext({ providerId?, excludeProviderIds?, dataSetId?, withCDN?, metadata? }) => StorageContext
findDataSets({ address? }) => EnhancedDataSetInfo[]  // { pdpVerifierDataSetId, hasActivePieces, isLive, isManaged, withCDN, metadata, ... }
getStorageInfo() => { pricing: { noCDN: {perTiBPerMonth,...}, withCDN: {...}, tokenAddress, tokenSymbol, priceList }, providers, serviceParameters: { epochsPerMonth, epochDuration, minUploadSize, maxUploadSize }, allowances }
```
StorageContext (one data set on one provider):
```ts
store(data, { pieceCid?, signal?, onProgress? }) => { pieceCid, size }           // upload bytes to the SP (off-chain)
presignForCommit([{ pieceCid, pieceMetadata? }]) => Hex                          // EIP-712 signature for adding pieces (enables relayed commit)
commit({ pieces: [{ pieceCid, pieceMetadata? }], extraData?, onSubmitted? }) => { txHash, confirmedTxHash?, pieceIds: bigint[], dataSetId, isNewDataSet }  // on-chain addPieces
upload(data, opts) => UploadResult                                               // store + commit in one
download({ pieceCid, withCDN? }) => Uint8Array
getPieceUrl(pieceCid) => string
pieceStatus({ pieceCid }) => { dataSetLastProven: Date|null, dataSetNextProofDue: Date|null, retrievalUrl: string|null, pieceId?, inChallengeWindow?, hoursUntilChallengeWindow?, isProofOverdue? } | null
getPieces() => AsyncGenerator<{ pieceId: bigint, pieceCid: PieceCID }>
deletePieces / deletePiece / terminate / getScheduledRemovals
dataSetId: bigint | undefined; provider: PDPProvider; dataSetMetadata: Record<string,string>
```
Piece metadata: `pieceMetadata?: Record<string,string>` per piece is stored on chain with the piece (usable to carry a Stamper stamp id / content hash tag).

## PieceCID computation client-side (`@filoz/synapse-core/piece`)
```ts
import { calculate, hasher, transformStream, PieceCID, from, tryFrom, equals } from '@filoz/synapse-core/piece'
calculate(input: Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<PieceCID>
hasher(): { write(chunk), count(), finalize(): PieceCID, reset() }        // incremental / streaming
transformStream(): { transform: TransformStream<Uint8Array,Uint8Array>, result: Promise<PieceCID> }  // tee a stream while uploading
```
So a device can compute the exact PieceCID (CommPv2, multihash code exported as MULTIHASH_CODE) BEFORE uploading, and pass it as `pieceCid` to `store/upload` so the SP must match it. This is the identifier to anchor in the Stamper registry.

## PDPVerifier reads (`@filoz/synapse-core/pdp-verifier`) — all are `view` calls on the PDPVerifier contract, callable by ANY contract or client
`dataSetLive({dataSetId}) => boolean`, `findPieceIdsByCid({dataSetId, pieceCid}) => Page<bigint>`, `getActivePieceCount`, `getActivePiecesByCursor`, `getDataSetLeafCount(s)`, `getDataSetListener`, `getDataSetStorageProvider`, `getNextChallengeEpoch`, `getNextPieceId`, `getPieces`, `getScheduledRemovals`.
=> A Stamper registry contract on FEVM can, at registration or at any later time, call `PDPVerifier.findPieceIdsByCid(dataSetId, pieceCid)` and `dataSetLive(dataSetId)` to check trustlessly that the anchored PieceCID is a piece of a live, PDP-proven data set. `getNextChallengeEpoch` tells whether proving is ongoing.

## Warm Storage reads (`WarmStorageService` in the SDK; `FilecoinWarmStorageServiceStateView` on chain)
`getDataSet`, `getClientDataSets(+Length/+Ids/+WithDetails)`, `getAccountTotalStorageSize`, `validateDataSet`, `getActivePieceCount`, `hasActivePieces`, `getDataSetMetadata(+ByKey)`, `getPriceList`, `getPDPConfig`, provider approval reads, `terminateService`, `topUpCDNPaymentRails`.
Solidity: FilOzone/filecoin-services ships `FilecoinWarmStorageServiceStateInternalLibrary` for embedding these reads into a third-party contract.

## Session keys (`@filoz/synapse-core/session-key`) and typed data
- Session keys are secp256k1 keys authorized on the on-chain `SessionKeyRegistry` with scoped permissions: `CreateDataSetPermission`, `AddPiecesPermission`, `SchedulePieceRemovalsPermission`, `TerminateServicePermission` (+ expirations). `fromSecp256k1 / accountFromSecp256k1`, `login`, `revoke`, `authorizationExpiry`.
- `@filoz/synapse-core/typed-data`: EIP-712 signers `signAddPieces`, `signCreateDataset`, `signCreateDatasetAddPieces`, `signScheduleRemovals`, `signTerminateService`, `signErc20Permit`.
=> The Stamper backend can hold a low-privilege session key (AddPieces only) instead of the funded main account key; the funded account can stay cold/hardware.

## Pricing (from FilOzone/filecoin-services README, fetched 2026-09-30)
2.5 USDFC per TiB/month streaming + flat 0.024 USDFC/month per data set; one-time ops fees: 0.025 USDFC data-set creation, 0.0005 + 0.0003/piece per add-pieces call, 0.002 per removal scheduling; 0.10 USDFC lifecycle reserve locked per data set. Price catalogue on chain via `getPriceList()`.

## Exact on-chain view signatures (extracted from the SDK's generated ABIs)
PDPVerifier (mainnet 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F / calibration 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C):
```
dataSetLive(uint256 setId) view returns (bool)
findPieceIdsByCid(uint256 setId, (bytes data) pieceCid, uint256 startPieceId, uint256 limit) view returns (uint256[] pieceIds)
getActivePieceCount(uint256 setId) view returns (uint256)
getDataSetLeafCount(uint256 setId) view returns (uint256)
getDataSetListener(uint256 setId) view returns (address)        // = the FWSS service contract for FOC data sets
getDataSetStorageProvider(uint256 setId) view returns (address, address)
getNextChallengeEpoch(uint256 setId) view returns (uint256)
getNextPieceId(uint256 setId) view returns (uint256)
getPieceCid(uint256 setId, uint256 pieceId) view returns ((bytes data))
events: DataSetCreated(uint256 indexed setId, address indexed storageProvider); PiecesAdded(uint256 indexed setId, uint256[] pieceIds, (bytes)[] pieceCids); PiecesAddedV2(uint256 indexed setId, uint256 firstPieceId, (bytes)[] pieceCids); PiecesRemoved(...); PiecesScheduledForRemoval(...); ProofFeePaid(uint256 indexed setId, uint256 fee)
```
PieceCID is passed on chain as a struct `Cids.Cid { bytes data }` = the raw multiformats CID bytes (CIDv1, fil-commitment-unsealed codec, fr32-sha2-256-trunc254-padbintree multihash = PieceCID v2).

FilecoinWarmStorageServiceStateView (mainnet 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 / calibration 0x1B68d64f01bAa42014B9774605867BF4eDC0320f):
```
getDataSet(uint256 dataSetId) view returns ((uint256 pdpRailId, uint256 cacheMissRailId, uint256 cdnRailId, address payer, address payee, address serviceProvider, uint256 commissionBps, uint256 clientDataSetId, uint256 pdpEndEpoch, uint256 providerId, uint96 pendingOneTimePayments, uint96 lifecycleReserveBalance, uint256 dataSetId))
getDataSetStatus(uint256 dataSetId) view returns (uint8)       // 0 Inactive, 1 Active
provenThisPeriod(uint256 dataSetId) view returns (bool)
provingDeadline(uint256 setId) view returns (uint256)
getDataSetMetadata(uint256 dataSetId, string key) view returns (bool exists, string value)
clientDataSets(address payer) view returns (uint256[] dataSetIds)
getPDPConfig() view returns (uint64 maxProvingPeriod, uint256 challengeWindowSize, uint256 challengesPerProof, uint256 initChallengeWindowStart)
```
=> Trustless storage check available to a Stamper contract: `PDPVerifier.findPieceIdsByCid(dataSetId, cid, 0, 1).length > 0 && PDPVerifier.dataSetLive(dataSetId)`; liveness of proving via `FWSSView.provenThisPeriod(dataSetId)` / `provingDeadline`.
