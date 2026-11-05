# Filecoin storage from a web/mobile app in 2026 — research for Stamper

Dimension: *Filecoin storage from a web/mobile app in 2026* (FOC/Synapse, Storacha, Lighthouse/Akave/Filecoin Pin/direct deals, IPFS retrieval, client-side CID computation, and the registry→bytes→proof scheme).

Research date: 2026-09-30/10-01. Method: all claims below were checked against primary sources fetched directly (GitHub source files/READMEs/CHANGELOGs, npm registry metadata, docs sites, DNS-over-HTTPS and HTTP probes). Each section marks what was **verified** from a primary source and what is **inferred**. Web search was only available for the first few queries; everything else is from fetched primary sources.

---

## 0. Executive summary (what matters for Stamper)

1. **Filecoin Onchain Cloud (FOC) is the only Filecoin storage path in 2026 that gives Stamper what the brief demands: a trustless, on-chain-verifiable record that a specific piece (identified by a content hash) is stored and continuously proven.** It is live on mainnet (FOC "live on mainnet" post dated 2026-03-26; FWSS v1.4.0 and PDPVerifier v3.5.0 deployed 2026-08-21 on both mainnet and Calibration). The developer surface is the Synapse SDK: `@filoz/synapse-sdk` **2.0.2** (2026-09-25), `@filoz/synapse-core` **0.10.0**, `@filoz/synapse-react`, all MIT/Apache-2.0, viem-based, Node + browser.
2. **Storacha (ex web3.storage, w3up/UCAN) should not be the foundation.** Verified signals: `up.storacha.network` and `console.storacha.network` are NXDOMAIN (Google DoH), `storacha/console` is archived, `storacha.link`/`w3s.link` gateways now 301-redirect to `dweb.link`, storacha.network and docs.storacha.network now serve "Fil One" (an S3-compatible product launched 2026-08-11), the upload-service repo's last release/commit is 2026-05-20, and that last release shipped `@storacha/filecoin-pin-migration` + `storacha space migrate` to move Storacha spaces to FOC. Its status page still says "Operational" (stale). Treat the w3up service as sunset.
3. **Pricing on FOC is low for Stamper's data shapes**: 2.5 USDFC/TiB/month per copy + 0.12 USDFC/month per data set (proving fee) + small one-time fees (add-pieces: 0.008 + 0.003 USDFC per piece per batch). The per-piece one-time fee, not storage, dominates for many small files: 100k photos x 2 copies ≈ 600 USDFC one-time vs ≈2 USDFC/month recurring.
4. **Identifier to put on-chain**: the **PieceCID v2** (FRC-0069: CIDv1, codec `raw` 0x55, multihash `fr32-sha256-trunc254-padbintree` 0x1011; prefix bytes `0x01559120`) of the *exact bytes* uploaded. This is what PDPVerifier stores (`getPieceCid`) and challenges, so `registry.pieceCid == PDPVerifier.getPieceCid(dataSetId, pieceId)` is a direct on-chain equality. Add a plain SHA-256 / IPFS raw CID of the same bytes for web interop. Compute both client-side with `@filoz/synapse-core/piece` (`Piece.calculate`, `Piece.hasher`, `Piece.transformStream`).
5. **A third-party contract or verifier can prove storage trustlessly** with only `eth_call`s: `PDPVerifier.getPieceCid/pieceLive/dataSetLive/getDataSetListener/getDataSetLastProvenEpoch` and `FilecoinWarmStorageServiceStateView.hasBeenProvenRecently(dataSetId)` / `provenPeriods(dataSetId, periodId)` / `getDataSet(dataSetId)` (payer, provider, rails). Proofs are per data set (5 random challenges per ~24h proving period on mainnet), so per-piece assurance is probabilistic; the registry should store `(dataSetId, pieceId)` for every copy.
6. **Retrieval for the verification site**: serve the original from the storage provider's `/piece/{pieceCid}` endpoint (or Filecoin Beam, the renamed FilCDN, `https://{payer}.filbeam.io/...`), and *always* recompute the PieceCID client/server-side (`downloadAndValidate`). The IPFS public gateways (`ipfs.io`, `dweb.link`) are being wound down (rate limits since Aug 2026; browser navigations redirect to `inbrowser.link`), so they must not be in the critical path. Self-hosted fallback: a Stamper-run object store plus optionally a Rainbow/Kubo gateway or `@helia/verified-fetch` in the browser.

---

## 1. Filecoin Onchain Cloud (FOC) and the Synapse SDK

### 1.1 Status and naming (verified)

- FOC = Filecoin Warm Storage Service (FWSS) contract + PDP (Proof of Data Possession) verifier + Filecoin Pay payment rails + Filecoin Beam (CDN) + the Synapse SDK. Testnet launch was announced 2025-11-18; the "Filecoin Onchain Cloud Is Live on Mainnet" post has `datePublished: 2026-03-26`; FWSS CHANGELOG says the v1.3.0 upgrade "coincides with Filecoin Onchain Cloud's General Availability" and `@filoz/synapse-sdk` 1.0.1 (2026-06-12) was the GA SDK. Current stack: **FWSS 1.4.0 + PDPVerifier 3.5.0, deployed 2026-08-21** on chain 314 and 314159 (`service_contracts/deployments.json`).
- Renames to be aware of (all verified in the SDK migration guide / source): *Pandora → Warm Storage*, *proof sets → data sets*, *roots → pieces*, *storage providers → service providers*, and **FilCDN → Filecoin Beam ("FilBeam")**. `filcdn.com` is NXDOMAIN today; the service lives at `filbeam.io` / `docs.filbeam.com`; the SDK module is `synapse.filbeam`.
- The old "Synapse SDK = one package" model is gone: the repo is a monorepo with `@filoz/synapse-sdk` (high-level), `@filoz/synapse-core` (viem-style actions, PieceCID primitives, SP HTTP client), `@filoz/synapse-react` (wagmi/TanStack hooks). A `script-tag` (CDN) example exists for no-bundler use.

### 1.2 Packages, versions, runtime support (verified from npm + repo)

| Package | Latest | Published | Notes |
|---|---|---|---|
| `@filoz/synapse-sdk` | 2.0.2 | 2026-09-25 | deps: `@filoz/synapse-core ^0.10.0`, `multiformats 14.0.5`; peer `viem 2.x`. 2.0.0 (2026-09-03) was breaking (cost API takes `pieceSizes`, automatic piece batching, piece-metadata getters removed). Dual MIT/Apache-2.0. |
| `@filoz/synapse-core` | 0.10.0 | 2026-09-25 | deps: `ox`, `zod`, `dnum`, `iso-web` (fetch wrapper), `multiformats`, `sync-multihash-sha2`; peer `viem 2.x`. |
| `@filoz/synapse-react` | (tracks sdk) | — | needs `wagmi@3.x`, `@tanstack/react-query@5.x`, `viem@2.x`, React 18+. |
| `filecoin-pin` | 2.1.1 | 2026-09-16 | IPFS-flavoured wrapper on Synapse (CLI, library, GitHub Action, beta pinning server). |

Runtime: the root README says "Works in Node.js, browsers, and all major bundlers". The getting-started guide shows the browser flow (`account: address, transport: custom(window.ethereum)`), and `upload()` accepts `Uint8Array | ReadableStream<Uint8Array>` (`file.stream()` for browser `File`). **React Native: not documented anywhere in the repo or docs; no issues mention it (GitHub search returned only unrelated dependabot PRs).** *Inferred:* the core relies on `fetch`, web streams (`TransformStream`, `ReadableStream`, `Blob.stream()`), `Promise.withResolvers`, `AbortSignal.any`, and viem; on Hermes you would need polyfills (web-streams, `AbortSignal.any`, `TextEncoder`, `crypto.getRandomValues`) and should prefer the non-streaming `Uint8Array` path (`sp.uploadPiece`) — treat RN as "possible but unsupported; prototype early".

### 1.3 Networks, RPCs, explorers (verified from `packages/synapse-core/src/chains.ts`)

| | Mainnet | Calibration |
|---|---|---|
| chain id | 314 | 314159 |
| default RPC | `https://api.node.glif.io/rpc/v1` (ws `wss://wss.node.glif.io/apigw/lotus/rpc/v1`) | `https://api.calibration.node.glif.io/rpc/v1` (ws `wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1`) |
| alt RPC | `https://rpc.ankr.com/filecoin`, `https://filecoin.drpc.org` | `https://rpc.ankr.com/filecoin_testnet`, `https://filecoin-calibration.drpc.org` |
| explorers | filecoin.blockscout.com, filfox.info, beryx.io | filecoin-testnet.blockscout.com, calibration.filfox.info |
| genesis ts | 1598306400 | 1667326380 |
| FilBeam domain | `filbeam.io` | `calibration.filbeam.io` |
| epoch | 30 s; 2880/day; "month" = 86,400 epochs = 30 days | same |

`Synapse.create()` defaults to **calibration**; pass `chain: mainnet`. `getTransport(chain)` gives ranked RPC fallbacks. Devnet (31415926) exists via `foc-devnet`/`foc-localnet`.

Faucets (Calibration): tFIL `https://faucet.calibnet.chainsafe-fil.io/funds.html`; tUSDFC `https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc`. Mainnet USDFC: swap FIL on Sushi/Squid (docs link `https://www.sushi.com/filecoin/swap?token0=NATIVE&token1=0x80b98d3aa09ffff255c3ba4a241111ff1262f045`). Note filecoin-pin README: Calibration storage is "not persistent".

### 1.4 Contract addresses (verified: `FilOzone/filecoin-services/service_contracts/deployments.json`, commit 4cbbea4, deployed 2026-08-21; FWSS 1.4.0 / PDP 3.5.0)

| Contract | Mainnet (314) | Calibration (314159) |
|---|---|---|
| FilecoinWarmStorageService (FWSS) proxy | `0x8408502033C418E1bbC97cE9ac48E5528F371A9f` | `0x02925630df557F957f70E112bA06e50965417CA0` |
| FWSS implementation (1.4.0) | `0xa874C7333c8e1689C33155AD7bEE980926086e21` | `0xF5436B44354735588B20CA18F7D3e95a14FAcA10` |
| FWSS StateView (read-only, `extsload`) | `0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172` | `0x1B68d64f01bAa42014B9774605867BF4eDC0320f` |
| PDPVerifier proxy | `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F` | `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` |
| PDPVerifier implementation (3.5.0) | `0x04D4CdB99E34D7e9a366E7eba7A835e034bc41b1` | `0x04D4CdB99E34D7e9a366E7eba7A835e034bc41b1` |
| FilecoinPayV1 (immutable) | `0x23b1e018F08BB982348b15a86ee926eEBf7F4DAa` | `0x09a0fDc2723fAd1A7b8e3e00eE5DF73841df55a0` |
| USDFC (ERC-20, 18 decimals) | `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045` | `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0` |
| ServiceProviderRegistry proxy | `0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB` | `0x839e5c9988e4e9977d40708d0094103c0839Ac9D` |
| SessionKeyRegistry | `0x74FD50525A958aF5d484601E252271f9625231aB` | `0x518411c2062E119Aaf7A8B12A2eDf9a939347655` |
| Endorsements (ProviderIdSet) | `0x59eFa2e8324E1551d46010d7B0B140eE2F5c726b` | `0xAA2f7CfC7ecAc616EC9C1f6d700fAd19087FAC84` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | same |

Caveats: FWSS, PDPVerifier and the registry are **UUPS proxies** with a two-step announce-then-upgrade owner flow (a multisig); FilecoinPayV1 and SessionKeyRegistry are immutable; StateView is immutable but replaceable (`FWSS.viewContractAddress()` is the discovery hook). The PDP README still calls the contracts "beta... might be upgraded". Audits: PDP (Zellic, Apr 2025), Filecoin Pay (Zellic Aug 2025; Composable Security Jan 2026), USDFC (Hexens Jan/Aug 2025, Decurity Mar 2025). `legacyPieceStorageIdLimit`: data sets with id < 1559 (mainnet) / < 32331 (calibration) use the legacy piece storage layout; new data sets use compact storage (cheaper gas, no 80-piece batch cap).

### 1.5 Data model and limits (verified)

- **Data set**: container of pieces at one provider, with one PDP payment rail (+2 CDN rails if `withCDN`). Status `Inactive` (no pieces) / `Active`. Metadata ≤10 keys (key ≤32 chars, value ≤128). Well-known keys: `source` (app namespace; required by `Synapse.create({ source })`, set `null` to opt out), `withCDN` (""), `withIPFSIndexing` ("" — SP indexes CAR/PoDSI content and announces to IPNI).
- **Piece**: one upload = one piece. Piece metadata ≤5 keys (SDK docs say 3 in one place, 5 in another; contract-enforced), **emitted in the FWSS `PieceAdded` event only — since FWSS 1.4.0 piece metadata is no longer stored in contract state**. Well-known piece key: `ipfsRootCID` (advisory link from a CAR piece to its IPFS root).
- **Size**: `SIZE_CONSTANTS.MIN_UPLOAD_SIZE = 127` bytes, `MAX_UPLOAD_SIZE = 1,065,353,216` bytes (1 GiB x 127/128) per piece; larger files need app-level chunking/aggregation (tracked in synapse-sdk#110). Provider offerings advertise `minPieceSizeInBytes`/`maxPieceSizeInBytes` (Curio default offering 1 MiB–64 GiB, but FWSS/SDK enforce the above).
- **Copies**: `upload()` stores **2 copies by default** (primary on an *endorsed* provider, secondary pulled SP-to-SP by an *approved* provider); each copy is its own data set, rail and proof stream. Check `result.complete`.
- **Message-size batching**: an `addPieces` message must fit 64 KiB − 288 bytes; SDK batches concurrent uploads automatically (`pieceBatching`, default zero-delay window; `limiter` mode + `storage.flush()`).

### 1.6 Upload from a client (verified API, 2.0.x)

```ts
import { Synapse, mainnet, SIZE_CONSTANTS } from '@filoz/synapse-sdk'
import { custom } from 'viem'
import 'viem/window'

// Browser: user wallet
const [address] = await window.ethereum!.request({ method: 'eth_requestAccounts' })
const synapse = Synapse.create({
  account: address,
  transport: custom(window.ethereum!),
  chain: mainnet,          // default is calibration
  source: 'stamper',       // data-set namespace
  withCDN: false,          // true => FilBeam rails (+0.7 & +0.3 USDFC lockups)
})

// 1) fund + approve FWSS as operator in ONE tx (depositWithPermitAndApproveOperator)
const prep = await synapse.storage.prepare({ pieceSizes: [BigInt(file.size)] })
if (prep.transaction) await prep.transaction.execute()

// 2) upload (store on primary SP -> SP-to-SP pull to secondary -> addPieces commit)
const res = await synapse.storage.upload(file.stream(), {
  copies: 2,
  pieceMetadata: { name: file.name, contentType: file.type },
  callbacks: {
    onStored: (providerId, pieceCid) => {},
    onPiecesAdded: (txHash, providerId, pieces) => {},
    onPiecesConfirmed: (dataSetId, providerId, pieces) => {}, // pieces: {pieceId, pieceCid}
  },
})
res.pieceCid.toString()  // bafkzcib...
res.copies               // [{ providerId, dataSetId, pieceId, role, retrievalUrl, isNewDataSet }]
res.complete             // true only if all requested copies committed

// 3) download (SP-agnostic; validates PieceCID on the way)
const bytes = await synapse.storage.download({ pieceCid: res.pieceCid })
```

Split pipeline for production (`store → pull → commit`): `const [primary, secondary] = await synapse.storage.createContexts({ copies: 2 })`, `primary.store(data, { pieceCid: precomputed })`, `secondary.presignForCommit([...])`, `secondary.pull({ pieces, from: cid => primary.getPieceUrl(cid), extraData })`, `primary.commit({ pieces })`. Commit failures can be retried without re-upload.

Under the hood (synapse-core `sp/upload.ts`): `POST {serviceURL}/pdp/piece {pieceCid}` → 200 (already exists) or `Location: .../pdp/piece/upload/{uuid}` → `PUT /pdp/piece/upload/{uuid}` (`application/octet-stream`) → poll `GET /pdp/piece?pieceCid=…` (202 while processing) → SP computes PieceCID and must match the client's → EIP-712-signed `addPieces` / `createDataSetAndAddPieces` relayed by the SP to PDPVerifier (the **SP pays gas**; the client pays USDFC fees). Session keys (`@filoz/synapse-core/session-key`, `SessionKeyRegistry`) let an ephemeral key sign `CreateDataSet/AddPieces/SchedulePieceRemovals/TerminateService` for a root wallet for 1 h (configurable) — this is how `pin.filecoin.cloud` avoids wallet popups and how a mobile app can avoid per-upload signatures. FWSS 1.4.0 also added `setDataSetAuthorizer` (programmable ACL contract per data set) — a Stamper contract could become the sole authorizer of its data sets.

### 1.7 Pricing and funding (verified: `docs/.../storage-costs.mdx`, FWSS SPEC/CHANGELOG 1.4.0, price list on-chain via `StateView.getPriceList()`)

| Item | Price (USDFC) |
|---|---|
| Storage | **2.50 / TiB / month per copy** (priced on PDP leaf count x 127/128; up to +31 B per piece) |
| Proving service | **0.12 / data set / month** (flat; raised from 0.024 in 1.4.0 after FIP-0115 gas changes) |
| Create data set | 0.025 one-time |
| Add pieces | **0.008 + 0.003 x N** per `addPieces` call (so 0.011 for a single piece; batching is cheaper) |
| Schedule removals | 0.007 per call |
| Terminate (client-signed, SP-relayed) | 0.006; none for direct termination |
| Lifecycle reserve | ~0.50 locked per data set (refundable), replenished when below 0.025 + pending |
| CDN (FilBeam) | egress up to **14 / TiB (cache miss), 7 / TiB (cache hit)**; data-set lockups 0.7 (CDN) + 0.3 (cache-miss) |
| Lockup | 30 days of the current rate must stay deposited; below that the SP may terminate; after termination the SP is still paid up to `endEpoch` from lockup |

Worked numbers for Stamper (per the formulas; *inferred arithmetic*):
- 100,000 photos x 4 MiB ≈ 0.38 TiB → storage ≈ 0.95 USDFC/month/copy; 2 copies + 2 proving fees ≈ **2.1 USDFC/month**. One-time add-pieces: 100k x 0.003 x 2 copies ≈ **600 USDFC** (+0.008 per batch), i.e. ≈0.006 USDFC per asset. Videos at 50 MiB avg: 100k ≈ 4.8 TiB → ≈12 USDFC/month/copy.
- The client (or Stamper's sponsoring wallet) needs FIL only for its own deposit/approval transactions; SP-relayed `addPieces` needs none.
- `synapse.storage.getUploadCosts({ pieceSizes, isNewDataSet, withCDN })` returns `rates.perEpoch/perMonth`, `fees`, `lockups`, `depositNeeded`, `ready`; `prepare()` builds the single funding tx. `synapse.payments.*` (deposit/withdraw/allowances/settle), `pay.accounts()` gives `availableFunds`; runway = `fundedUntilEpoch` math (Filecoin Pay `getAccountInfoIfSettled`).

### 1.8 PDP: how proving works and its parameters (verified: FWSS source/tools README, PDP design doc, PDPVerifier 3.5.0)

- Each data set is a Merkle tree of 32-byte leaves over the FR32-padded pieces. Every proving period the SP must answer **`CHALLENGES_PER_PROOF = 5`** random leaf challenges (randomness from the Filecoin drand beacon at `challengeEpoch`) with Merkle inclusion proofs in `provePossession()`, then call `nextProvingPeriod()`.
- **Mainnet**: `maxProvingPeriod = 2880` epochs (≈24 h), `challengeWindowSize = 60` epochs (30 min), `challengeFinality = 150`. **Calibration**: 240 / 20 / 10. Readable from `StateView.getPDPConfig()` → `(maxProvingPeriod, challengeWindowSize, challengesPerProof, initChallengeWindowStart)`.
- Proving is activated by the SP's first `nextProvingPeriod()` after the first piece (`provingActivationEpoch`); period N = `(A + N*M, A + (N+1)*M]`; deadline = last epoch of the period. A missed deadline is a **Faulted** period: FWSS records `FaultRecord(dataSetId, periodsFaulted, deadline)` and settlement pays the SP **zero** for those epochs (payment only for proven epochs — this is the "trustless" link between proof and money).
- Per-piece guarantee is probabilistic: with K=5 challenges/day, a provider that lost 1% of a data set evades detection with p=(0.99)^5/day → detected with ≈78% confidence in 30 days, >99% in 90; 5% loss → 99.95% in 30 days (PDP design doc table). For Stamper this is a reason to keep 2 copies and to show proof history, not a single boolean.
- Dealbot continuously tests providers; approval needs ≥97% storage success, ≤0.2% proving fault rate, ≥97% retrieval success (dealbot methodology doc); approval/endorsement sets are on-chain (`getApprovedProviders` on StateView; `getProviderIds` on Endorsements).

### 1.9 Retrieval (verified: `core-concepts/retrieval.mdx`, synapse-core `piece/download.ts`, `piece/resolve-piece-url.ts`, FilBeam docs)

Three paths, same PieceCID:
1. **Direct SP**: `GET {serviceURL}/piece/{pieceCid}` (bytes verbatim; byte ranges supported per filecoin-pin docs). The SDK's `download()` reads your data sets on-chain, `HEAD`s candidate providers' `/piece/{cid}` in parallel (`findPieceOnProviders`, concurrency 5), downloads from the first responder and **recomputes the PieceCID while streaming** (`downloadAndValidate`), rejecting mismatches. No egress charge.
2. **Filecoin Beam (CDN)**: per-payer subdomain `https://{payerAddress}.filbeam.io/{pieceCid}` (mainnet; SDK builder `createPieceUrlFilBeam` puts the CID at the path root) — FilBeam's own docs write it as `https://{payer-address}.filbeam.io/piece/{piece-cid}`; *use the SDK builder and test both*. Only data sets with `withCDN` metadata are eligible; FilBeam picks a random eligible (SP, piece) candidate, retries on 4xx/5xx/network error, returns 502 if all fail, and sets `X-Data-Set-ID`. Quotas: CDN-egress and cache-miss quotas are both checked before serving (HTTP 402 when either is exhausted; worker#398 tracks fixing that). Stats API: `GET https://stats.filbeam.io/data-set/{id}` and `/payer/{address}` (docs use `*.filbeam.io`; the SDK's `FilBeamService` uses `stats.filbeam.com` / `calibration.stats.filbeam.com` — both hostnames resolve). FilBeam docs still say "Calibration testnet" and "file size limited to 254 MiB" on the landing page — **likely stale**; the SDK config and FWSS SPEC treat mainnet FilBeam as live. FilBeam roadmap: IPFS (`/ipfs`) interoperability is not yet supported (FilBeam#85).
3. **IPFS**: SPs expose `/ipfs/{cid}` as a trustless gateway and, for data sets with `withIPFSIndexing`, announce CIDs to IPNI (cid.contact) so `inbrowser.link`, Helia/`@helia/verified-fetch`, Kubo, and the public gateways can resolve them. This only works for pieces that are CARs (or PoDSI containers); a raw JPEG piece is not IPFS-retrievable by its IPFS CID.

### 1.10 How a third-party contract or off-chain verifier proves "this piece is stored and being proven" (verified ABIs/signatures)

What Stamper's registry should hold per asset: `pieceCid` (bytes or 32-byte root + height + padding), `size`, and for each copy `(dataSetId, pieceId, providerId)`; optionally the payer address.

**On-chain checks (all `view`, callable from Solidity or `eth_call`):**

PDPVerifier (proxy `0xBADd…557F` / `0x85e3…417C`):
- `getPieceCid(setId, pieceId) → bytes` (the full PieceCID v2 bytes) — must equal the registry's PieceCID.
- `pieceLive(setId, pieceId) → bool`, `pieceChallengable(setId, pieceId) → bool`, `dataSetLive(setId) → bool`.
- `getDataSetListener(setId) → address` — must equal the FWSS proxy, otherwise the data set is not under FWSS's proof→payment semantics.
- `getDataSetStorageProvider(setId) → (address, address)`, `getDataSetLeafCount(setId)`, `getPieceLeafCount(setId, pieceId)`, `getNextChallengeEpoch(setId)`, `getDataSetLastProvenEpoch(setId) → uint256` (0 = never proven), `getScheduledRemovals(setId)`.
- `findPieceIdsByCid(setId, Cid{data}, startPieceId, limit) → uint256[]` — CID → pieceId lookup (added in 3.2.0).
- Events: `DataSetCreated(setId, storageProvider)`, `PiecesAddedV2(setId, firstPieceId, PackedCid[] {bytes32 header, bytes32 root})` (legacy `PiecesAdded` is no longer emitted), `PossessionProven(setId, PieceIdAndOffset[] challenges)`, `NextProvingPeriod(setId, challengeEpoch, leafCount)`, `PiecesScheduledForRemoval`, `PiecesRemoved`, `DataSetDeleted`.

FWSS StateView (`0xcf18…8172` / `0x1B68…320f`):
- `hasBeenProvenRecently(dataSetId) → bool` — true if the data set was proven in the current or previous proving period (library implementation verified).
- `provenThisPeriod(dataSetId) → bool`, `provenPeriods(dataSetId, periodId) → bool` (a per-period proof bitmap — lets a verifier reconstruct the whole proof history), `provingActivationEpoch(dataSetId)`, `provingDeadline(setId)`, `nextPDPChallengeWindowStart(setId)`, `getPDPConfig()`.
- `getDataSet(dataSetId) → DataSetInfo{pdpRailId, cacheMissRailId, cdnRailId, payer, payee, serviceProvider, commissionBps, clientDataSetId, pdpEndEpoch, providerId, pendingOneTimePayments, lifecycleReserveBalance, dataSetId}` (`pdpRailId == 0` → does not exist; `pdpEndEpoch != 0` → terminated), `getDataSetStatus(dataSetId) → 0 Inactive / 1 Active`, `getDataSetMetadata(dataSetId, key)`, `getAllDataSetMetadata(dataSetId)`, `isProviderApproved`, `getApprovedProviders`, `getPriceList()`.
- FWSS events: `DataSetCreated(dataSetId, providerId, pdpRailId, cacheMissRailId, cdnRailId, payer, serviceProvider, payee, metadataKeys, metadataValues)`, `PieceAdded(dataSetId, pieceId, pieceCid, keys, values)`, `FaultRecord(dataSetId, periodsFaulted, deadline)`, `RailRateUpdated`, `ServiceTerminated`, `PDPPaymentTerminated`, `DataSetAbandoned`.

Solidity sketch (inside a Stamper verifier/registry contract; use `FilecoinWarmStorageServiceStateInternalLibrary` for the cheapest embedded reads, or call StateView):

```solidity
interface IPDPVerifierView {
  function getPieceCid(uint256 setId, uint256 pieceId) external view returns (bytes memory);
  function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool);
  function dataSetLive(uint256 setId) external view returns (bool);
  function getDataSetListener(uint256 setId) external view returns (address);
  function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256);
}
interface IFWSSView {
  function hasBeenProvenRecently(uint256 dataSetId) external view returns (bool);
  function provenPeriods(uint256 dataSetId, uint256 periodId) external view returns (bool);
}
function isStoredAndProven(bytes memory pieceCid, uint256 setId, uint256 pieceId) public view returns (bool) {
  if (PDP.getDataSetListener(setId) != FWSS_PROXY) return false;
  if (!PDP.dataSetLive(setId) || !PDP.pieceLive(setId, pieceId)) return false;
  if (keccak256(PDP.getPieceCid(setId, pieceId)) != keccak256(pieceCid)) return false;
  return VIEW.hasBeenProvenRecently(setId);
}
```

Off-chain (TypeScript, read-only, no wallet):

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from '@filoz/synapse-core/chains'
import * as Piece from '@filoz/synapse-core/piece'
import { findPieceIdsByCid, dataSetLive, getNextChallengeEpoch } from '@filoz/synapse-core/pdp-verifier'
import { getDataSet, getPdpDataSet } from '@filoz/synapse-core/warm-storage'
const client = createPublicClient({ chain: mainnet, transport: http() })
const pieceCid = Piece.from('bafkzcib...')
const ids = await findPieceIdsByCid(client, { dataSetId, pieceCid })   // page.items
const ds = await getPdpDataSet(client, { dataSetId })                   // live, managed, provider, cdn, hasActivePieces
const proven = await client.readContract({ address: mainnet.contracts.fwssView.address,
  abi: mainnet.contracts.fwssView.abi, functionName: 'hasBeenProvenRecently', args: [dataSetId] })
```

The Synapse `StorageContext.pieceStatus({ pieceCid })` wraps part of this (returns `dataSetLastProven`, `dataSetNextProofDue`, `inChallengeWindow`, `isProofOverdue`, `retrievalUrl`) but it is scoped to the caller's own contexts; a public verifier should use the core actions above. Indexed history: PDP Explorer (`https://pdp.filecoin.cloud/mainnet`, Goldsky subgraph, open source `FilOzone/pdp-explorer`), FWSS subgraph (`FIL-Builders/fwss-subgraph`), Filecoin Pay explorer (`https://pay.filecoin.cloud`).

Trust boundaries to state honestly in Stamper's UI: (a) PDP proves possession of the *data set*; the chance a specific missing piece goes undetected decays daily (see 1.8); (b) FWSS/PDPVerifier are upgradeable proxies controlled by a multisig; (c) the registry is only as good as the equality between the on-chain PieceCID and the bytes the viewer re-hashes — which is why the verification site must re-hash downloaded bytes rather than trust any gateway.

### 1.11 PieceCID v2 / CommPv2 vs IPFS CID (verified: FRC-0069, `Cids.sol`, synapse-core `piece/*`, multicodec table)

- **PieceCID v2** = CIDv1 + codec `raw` (0x55) + multihash `fr32-sha256-trunc254-padbintree` (0x1011, multicodec status *draft*; FRC-0069 itself is status **Draft**, created 2023-07-26, but it is what PDPVerifier 3.x and FWSS require: `Cids.validateCommPv2` enforces prefix `0x01559120`). Digest = `uvarint(padding) | uint8(height) | 32-byte root`. Text form starts with `bafkzcib`, 64–65 chars. It encodes size: `rawSize = 2^(height-2) * 127 - padding`; padded size = `2^height * 32`. Legacy PieceCID v1 (`baga6ea4seaq…`, codec `fil-commitment-unsealed` 0xf101 + `sha2-256-trunc254-padded` 0x1012) is convertible from v2; v1→v2 needs the size.
- An **IPFS CID** (e.g. `bafkrei…` = raw block, sha2-256; `bafybei…` = dag-pb/UnixFS root) is a *different* hash of the *same or differently-structured* bytes; neither can be derived from the other. PDPVerifier only knows PieceCIDs. If the piece is a CAR, `ipfsRootCID` piece metadata is an advisory link (in the `PieceAdded` event), not a proof.
- Client-side computation (browser/Node): `@filoz/synapse-core/piece` — `await Piece.calculate(Uint8Array | Blob | ReadableStream | AsyncIterable)`, incremental `Piece.hasher()` (`write/finalize`), `Piece.transformStream()` (hash while uploading/downloading), `Piece.from(str)`, `.size`, `.paddedSize`, `.root`, `.height`, `.padding`, `.toHex()`; sizing helpers without hashing (`paddedSizeFor`, `heightFor`). The primitives are vendored from `@web3-storage/data-segment` 5.3.0 (last published 2024-10-18; still fine, Apache/MIT) which also exposes `Piece.fromPayload(bytes)`, `Proof.verify` (PoDSI, FRC-0058) and `MIN_PAYLOAD_SIZE` (65 bytes; SPs require ≥127). The on-chain side: `Cids.CommPv2FromDigest(padding, height, root)`, `rawPieceSize`, `leafCount`. A 1 GiB PieceCID takes "upwards of a minute" client-side (filecoin-pin doc) — hash while streaming the upload.

### 1.12 Filecoin Pay and USDFC (verified)

- FilecoinPayV1 (v1.0.0 "M4: Filecoin Service Liftoff"; mainnet `0x23b1…4DAa`, calibration `0x09a0…55a0`; immutable). Model: accounts (deposit ERC-20 or FIL), **rails** (payer→payee, `paymentRate`/epoch, `lockupPeriod`, `lockupFixed`, `endEpoch`), **operators** (FWSS; needs payer approval with rate/lockup allowances — `depositWithPermitAndApproveOperator` does deposit+approval in one tx), **validators** (FWSS validates settlement: pays only proven epochs). Monitoring primitive: `getAccountInfoIfSettled(token, payer) → (fundedUntilEpoch, currentFunds, availableFunds, currentLockupRate)`.
- USDFC: USD-pegged stablecoin by Secured Finance, ≥110% over-collateralised in FIL, 18 decimals; mainnet `0x80B9…F045`, calibration `0xb304…cDf0`. Mainnet launch May 2025. Supports EIP-2612 permits (used by Synapse).

---

## 2. Storacha (ex web3.storage; w3up, UCAN, `@storacha/client`)

### 2.1 Status — treat as sunset (verified evidence, 2026-09-30/10-01)

| Evidence | Result |
|---|---|
| `storacha.network`, `docs.storacha.network`, `storacha.network/pricing`, `storacha.network/blog` | all serve **"Fil One — S3 object storage built for the AI era"** ($4.99/TB/month, no egress; launched 2026-08-11 per `fil.one/blog/rss.xml`; docs at `docs.fil.one`, app at `app.fil.one`). No mention of w3up/UCAN/Storacha migration in the Fil One docs home. |
| `up.storacha.network` (w3up API), `console.storacha.network` | **NXDOMAIN** via Google DNS-over-HTTPS; `up.web3.storage` SERVFAIL. |
| `storacha.link` / `w3s.link` gateways | 301 → `dweb.link` (and subdomain form → `*.ipfs.dweb.link`). |
| GitHub `storacha/console` | **archived** (2025-07-10). `storacha/upload-service`: not archived but last push 2026-05-20; last releases 2026-05-20: `@storacha/cli@3.0.1`, `@storacha/filecoin-pin-migration@2.0.0` ("Migration library from Storacha to Filecoin on Chain (FOC)"; `storacha space migrate` makes exactly 2 copies per space on 2 FOC providers). `storacha/docs` last commit 2026-03-20: "Change termination notice period to 30 days" (terms: "We reserve the right to terminate the Services… 30 days' notice"). |
| Filecoin docs | Filecoin Pin is pitched to "people moving from… Storacha"; the Pin CLI guide says "Coming from Storacha? Refer to the email we sent you for the specific USDFC amount". |
| `storacha.statuspage.io` | "All Systems Operational" (Upload Service / Filecoin L1 Pipeline / w3name) — contradicts DNS; treat as stale. |

Conclusion: the UCAN hot-storage product that `@storacha/client` 2.1.4 (2026-05-15, Node ≥18) talks to is no longer reachable; the company pivoted to Fil One. **Do not build Stamper on it.** If a future Stamper feature wanted S3-style blob storage "backed by Filecoin" without on-chain verifiability, Fil One is that product, but it exposes no registry-grade proof to third parties (verified: Fil One docs mention PDP-style provider proofs only as marketing; no public verification API).

### 2.2 How it worked (for comparison; verified from docs source and client code)

- Client `@storacha/client` (`create()`, `login(email)`, `createSpace`, `uploadFile/uploadDirectory/uploadCAR`, `capability.filecoin.offer/info`). Browser + Node; delegated UCAN flow (backend `createDelegation(audience, ['space/blob/add','space/index/add','filecoin/offer','upload/add'])` → frontend `addSpace(delegation)`) allowed direct-from-browser uploads without exposing keys. React Native: never documented; package has no `react-native` field; stores are IndexedDB/conf/memory.
- Data path: files → UnixFS DAG (`@ipld/unixfs`, raw leaves, **1 MiB fixed chunks**, balanced width 1024, directory sharding >1000 entries) → CAR shards (`SHARD_SIZE = 133,169,152` bytes) → per-shard **PieceCID v2** computed client-side (`@web3-storage/data-segment/multihash`) and surfaced in `onShardStored({ cid, piece, size, roots, slices })` → aggregated (FRC-0058) into 16–32 GiB aggregates → Filecoin deals (renewed by Storacha).
- Proof: `client.capability.filecoin.info(piece)` → `aggregates[{aggregate, inclusion}]` (PoDSI, verifiable with `Proof.verify(inclusion.subtree, { tree: Piece.fromLink(aggregate).root, node: Piece.fromLink(piece).root })`) and `deals[{provider, aux.dataSource.dealID}]`; receipts for `filecoin/accept`. This proved inclusion in a sealed deal (PoRep/PoSt), with hours-to-days latency, and the deal was Storacha's, not the user's — weaker and slower than FOC's per-data-set PDP for Stamper's purpose.
- Gateway: `https://{cid}.ipfs.storacha.link` (200 req/min/IP) — now redirects to dweb.link.

---

## 3. Other paths, briefly

### 3.1 Lighthouse.storage (verified from docs + SDK source)

- `@lighthouse-web3/sdk` **0.4.7** (2026-07-10, MIT); Node + browser (`lighthouse.upload(fileList, apiKey, { cidVersion, onProgress, headers: { storageType: 'annual' } })`), Python/Go SDKs, CLI, REST (`POST https://upload.lighthouse.storage/api/v0/add`), new **S3-compatible endpoint** (`https://s3.lighthouse.storage`, CID in object metadata), Walrus (Sui) tier, IPNS, encryption via Kavach (BLS threshold keys across 5 nodes, token-gating/ACL, zkTLS). Max 24 GB per request. Default CIDs are **CIDv0 `Qm…`** unless `cidVersion: 1`.
- Filecoin proof: deals are made by Lighthouse's aggregator ("couple of hours to 1 day"); `lighthouse.dealStatus(cid)` → `[{DealID, Provider}]` / richer `GET https://api.lighthouse.storage/api/lighthouse/deal_status?cid=` (pieceCID, payloadCid, dealId, miner, dealStatus, start/endEpoch); PoDSI via `GET https://api.lighthouse.storage/api/lighthouse/get_proof?cid=&network=` (inclusion proof + verifierData); an optional on-chain `DealStatus.complete()` RaaS contract on Calibration (`0x4015c3E5453d38Df71539C0F7440603C69784d7a`). The "Filecoin First" product (pay-per-deal endowment pool `0x0E8b07CefDC0363cA6e0Ca06093c2596746f7d3d`) is Lighthouse-operated. There is a tutorial literally titled "Document Verification with PoDSI".
- Pricing (lighthouse.storage/pricing): Free 5 GB; Lite $12/mo 500 GB; Premium $49/mo 2.5 TB; add-ons for encryption/IPNS. `gateway.lighthouse.storage` is **premium-only** (HTTP 402 observed).
- Verdict: good hot-IPFS + encryption toolbox, but the Filecoin layer is Lighthouse-mediated (their deals, their API for proofs) — not trustless for a third-party verifier.

### 3.2 Akave (verified from docs)

- Akave O3: S3-compatible object storage (hosted or self-hosted gateway, "Akave Cloud" GUI, erasure coding, geofencing); CLI `akavecli` with a **PDP archival tier** (`--node-address connect.akave.ai:9500`; data aggregated into ~2 GB pieces and pushed to PDP SPs, then deleted from Akave nodes; `archival-metadata` shows per-block PDP-SP URLs; verifiable on the PDP Explorer). No first-party npm SDK found (`@akave/sdk` 404; only `akave-client` 0.5.0 from 2024 and MCP packages). Verdict: enterprise S3 with Filecoin PDP as a background tier; the client does not control the data set, so the registry→proof link is indirect.

### 3.3 Filecoin Pin (verified)

- `filecoin-pin` 2.1.1 (2026-09-16): CLI (`filecoin-pin add`, `data-set show`, `payments setup --auto`, `login` via session key approved in the Filecoin Cloud console), JS library (Node + browser: `filecoin-pin/core/*`), GitHub Action, beta IPFS Pinning Service API daemon (localhost-only, no quotas). Node 24+. Builds on Synapse 2.x.
- It packs files with Helia using the **IPIP-499 `unixfs-v1-2025` profile** (1 MiB chunks, raw leaves, CIDv1, 1024-link width, block-bytes HAMT sharding — matching Kubo/Boxo/Helia under the same profile) into a single-root CARv1, uploads the CAR as the piece (`withIPFSIndexing` on the data set, `ipfsRootCID` + `name` piece metadata), waits for the SP's `GET /pdp/piece/{pieceCid}/status` → `synced: true`, then confirms a provider record at `https://cid.contact/cid/{cid}`. Output: Root CID (IPFS) + PieceCID (Filecoin). Live demo `https://pin.filecoin.cloud` embeds a global session key so visitors don't need a wallet.
- Verdict: the right choice **if Stamper wants IPFS-CID retrieval of originals through standard tooling**; the cost is that the on-chain PieceCID then covers the CAR, not the raw media bytes, so the registry must store both identifiers.

### 3.4 Direct deal-making (Lotus / Boost / Curio) (verified where noted)

- Classic sealed deals (PoRep + WindowPoSt) still exist, but for an app they mean running a Lotus client, finding SPs, negotiating deals (Boost), waiting hours for sealing, and only then verifying `StateMarketStorageDeal` — the Boost README has no deprecation banner but Curio docs frame Curio as the successor for SPs, and the FOC docs describe sealed PoRep copies as a *future* add-on ("Further out. Sealed backup copies via PoRep alongside hot replicas"). Running your own **PDP provider** (Curio with `EnablePDP`, Lotus full node, YugabyteDB, 32–64 GiB RAM, public HTTPS) and registering it in the ServiceProviderRegistry (5 FIL fee) is possible and documented ("alpha" on the full-cluster path; a Dockerized Curio-PDP path exists); but a self-run SP would not be *approved/endorsed* without Dealbot vetting, and it defeats the independence argument. Verdict: not for the MVP; keep as a later "Stamper-operated replica" option.

---

## 4. Serving the original copy: gateways and what to rely on (verified)

- **IPFS Foundation gateways are winding down**: blog "IPFS is moving beyond the sponsored gateways" (2026-08-25): `ipfs.io`/`dweb.link` now hand browsers a service-worker gateway (`inbrowser.link`, phased redirect since 2026-05-11); "rate limiting has begun on ipfs.io and dweb.link for hotlinked and backend traffic, and will be increasing"; recommended paths: `@helia/verified-fetch` (8.1.2, 2026-09-22) for apps, self-hosted Rainbow/Kubo (0.43.1) for backends; `trustless-gateway.link` serves only verifiable responses (raw/CAR/IPNS). Our probes: `ipfs.io` and `dweb.link` returned **403** to curl for a valid CID; `trustless-gateway.link/ipfs/{cid}?format=raw` returned 200. Public delegated routing: `https://delegated-ipfs.dev/routing/v1`.
- **Storacha gateway**: gone (redirects). **Lighthouse gateway**: paywalled. **FilBeam**: pay-per-byte, per-payer URL, only `/piece` (no `/ipfs` yet), both quotas must be non-zero, 502 if all SPs fail.
- **Storage provider endpoints**: `GET {serviceURL}/piece/{pieceCid}` (exact bytes; discover `serviceURL` on-chain via `ServiceProviderRegistry` / `getPdpDataSet(...).provider.pdp.serviceURL`) and `GET {serviceURL}/ipfs/{cid}` (trustless gateway for CAR pieces). The SDK race (`resolvePieceUrl`: FilBeam HEAD vs chain-resolved SP HEADs) is the reference behaviour.

**Recommendation for the Stamper verification site**: resolve `(dataSetId → providerId → serviceURL)` on-chain and fetch `/piece/{pieceCid}` from *any* copy's provider (parallel HEAD, first wins), with FilBeam as the fast path for popular assets (`withCDN` data sets, quota monitoring via the stats API), and a **Stamper-operated mirror** (object storage keyed by PieceCID, populated at upload time) as the last-resort fallback. Every path ends with re-hashing: compare the recomputed PieceCID (and SHA-256) with the registry before showing "original". For IPFS-native sharing, add the CAR/`unixfs-v1-2025` variant and let browsers use `inbrowser.link` or `@helia/verified-fetch` with `gateways` pointed at the SP `/ipfs` endpoints and a self-hosted Rainbow.

---

## 5. Computing the CID client-side so the registry hash equals what storage produces (verified defaults)

| Tool / path | What is hashed | Chunking / layout | Resulting identifier |
|---|---|---|---|
| Synapse `upload()` / `store()` | the raw bytes you pass (no DAG) | none (single piece ≤ 1,065,353,216 B; FR32 pad internally) | **PieceCID v2** `bafkzcib…` — identical whether computed by `Piece.calculate` client-side, by the SP, or by `Cids.CommPv2FromDigest` on-chain |
| filecoin-pin / Helia with `profile: 'unixfs-v1-2025'` | UnixFS DAG → CARv1 | 1 MiB fixed chunks, raw leaves, CIDv1, max 1024 links, HAMT by block-bytes | IPFS root CID (`bafkrei…` raw block if ≤1 MiB, else `bafybei…` dag-pb) + PieceCID v2 of the CAR |
| `ipfs-unixfs-importer` 17.1.1 defaults (no profile) | UnixFS DAG | CIDv1, raw leaves, **256 KiB** fixed chunks (`fixedSize` default `DEFAULT_CHUNK_SIZE_256KIB`), balanced | different root CID than the 2025 profile for files >256 KiB |
| Kubo 0.43 `ipfs add` defaults | UnixFS DAG | `Import.CidVersion=0`, `UnixFSRawLeaves=false`, chunker `size-262144`; `--cid-version 1` turns raw leaves on; `ipfs config profile apply unixfs-v1-2025` matches the Helia profile | `Qm…` CIDv0 by default |
| Storacha `uploadFile` (historical) | UnixFS DAG → CAR shards | 1 MiB chunks, raw leaves, width 1024 | root CID + per-shard PieceCID v2 |
| Lighthouse `upload` | UnixFS via their node | their defaults, CIDv0 unless `cidVersion: 1` | `Qm…` |

Rules for Stamper:
1. Hash the **exact bytes** that go into the piece. Write the final media file (with the visible mark baked in, since a visible mark changes the bytes) and *then* compute `PieceCID = Piece.calculate(bytes)` and `sha256(bytes)`; upload those bytes unchanged (`store(data, { pieceCid })` skips the SP-side recomputation race and the SP verifies equality).
2. For a UnixFS/IPFS identifier, fix the profile explicitly (`unixfs-v1-2025`: `cidVersion: 1`, `rawLeaves: true`, 1 MiB fixed chunks, 1024 width) in both the app and any import tool; for files ≤ 1 MiB the IPFS CID is simply the raw-block CID (`bafkrei…` = sha2-256 of the bytes), so a registry storing `sha256(bytes)` can derive it.
3. Never derive the registry hash from a gateway response or from a provider's reported value; compute locally and compare (`findPiece`/`pieceStatus` give the SP's view, `getPieceCid` the chain's).
4. Minimum piece size is 127 bytes (pad tiny payloads, e.g., metadata JSON); maximum ~1 GiB — videos above that need app-level chunking with a manifest (and a PieceCID per chunk, or a CAR per chunk).

Snippet (browser or Node, no wallet needed):

```ts
import * as Piece from '@filoz/synapse-core/piece'
import { sha256 } from '@noble/hashes/sha2'          // or crypto.subtle.digest('SHA-256', ...)
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { create as createDigest } from 'multiformats/hashes/digest'

const bytes = new Uint8Array(await file.arrayBuffer())      // or stream via Piece.transformStream()
const pieceCid = await Piece.calculate(bytes)               // bafkzcib..., .size, .root, .height, .padding
const sha = sha256(bytes)
const ipfsRawCid = CID.createV1(raw.code, createDigest(0x12, sha)) // valid IPFS CID only if bytes <= 1 MiB raw block
// registry: pieceCid.bytes (or root/height/padding), sha, bytes.length
```

---

## 6. Recommendation for Stamper

**Primary path: Filecoin Onchain Cloud via Synapse (mainnet; Calibration for dev/test).**
- Store each stamped asset as **one raw piece** (the bytes as rendered with the visible mark). Compute PieceCID client-side; upload with `copies: 2`; put `(pieceCid, sha256, size, [dataSetId, pieceId, providerId] x copies, payer)` into the Stamper registry contract on the Filecoin EVM in the same user flow (ideally the registry contract *is* the data set authorizer / reads PDPVerifier at write time to check `getPieceCid(dataSetId, pieceId) == pieceCid`, so a registry entry can never point at bytes that are not already on-chain).
- Payments: hold a Stamper-funded Filecoin Pay account (USDFC) and use **session keys** (`SessionKeyRegistry`) or a backend relayer so end users never sign per upload; alternatively `setDataSetAuthorizer` to a Stamper contract. Budget ≈0.006 USDFC per asset one-time (2 copies, batched) + ≈2.6 USDFC per TiB-month (2 copies) + 0.12/month per data set.
- Retrieval for the verification page: on-chain `dataSetId → provider.serviceURL` → `/piece/{pieceCid}` (parallel across copies), FilBeam for hot assets, Stamper mirror as fallback; **re-hash on receipt**; show proof status from `hasBeenProvenRecently`, `provenPeriods`, `getDataSetLastProvenEpoch`, and `FaultRecord` history, plus explorer deep links.
- Optional IPFS variant (CAR with `unixfs-v1-2025`, `withIPFSIndexing`, `ipfsRootCID` metadata) only if public IPFS-CID sharing is a product requirement; it doubles storage cost and adds complexity.

**Fallbacks**: (1) a second FOC data set at a different approved provider (already the default), (2) Stamper's own object-storage mirror for serving, (3) later, a Stamper-run Curio PDP node or sealed PoRep copies when FOC exposes them. Lighthouse is the pragmatic non-trustless fallback (hot IPFS + optional encryption) if FOC providers are unavailable, but it cannot feed the on-chain registry proof.

**Registry identifier scheme (trustless chain from entry → bytes → proof):**
1. `pieceCid` (bytes, PieceCID v2) — primary key; equality-checkable on-chain against `PDPVerifier.getPieceCid`.
2. `sha256` of the same bytes (+ optional UnixFS root CID) — web/IPFS interop and cheap client-side comparison.
3. `copies[] = {dataSetId, pieceId, providerId}` — lets any verifier call `pieceLive`, `getDataSetListener == FWSS`, `hasBeenProvenRecently`, `provenPeriods`, `getDataSet(...).payer/pdpEndEpoch`.
4. `size`, `capturedAt`, device/user signature over `(pieceCid, metadata)` — out of this dimension's scope but should be hashed into the same entry.
5. Short code shown on the mark: a Stamper-assigned index or a truncated base32 of `pieceCid` resolved by the registry (never the proof itself).

---

## 7. Open questions / things to validate before committing

1. React Native support for `@filoz/synapse-sdk` (web streams, `AbortSignal.any`, `Promise.withResolvers`, `iso-web/http`); plan a spike with polyfills or route mobile uploads through the web runtime / a backend relayer.
2. FilBeam URL path (`/{cid}` per SDK vs `/piece/{cid}` per docs), the "254 MiB" and "Calibration only" statements on docs.filbeam.com, and mainnet FilBeam quota top-up UX.
3. 1 GiB per-piece cap vs Stamper's video sizes; chunking + manifest design.
4. Whether to use `setDataSetAuthorizer` (FWSS 1.4.0) so the Stamper registry contract gates piece additions — new feature, check audit status.
5. Provider set depth on mainnet (how many endorsed/approved SPs) and geographic latency for `/piece` retrieval; consider `withCDN` only for hot assets.
6. Upgradeability risk: FWSS/PDPVerifier/registry are owner-upgradeable proxies; monitor `UpgradeAnnounced` events.
7. Confirm current pricing from `getPriceList()` at integration time (owner-adjustable; changed in 1.3.0 and 1.4.0).
8. Legal/abuse: FilBeam filters sanctioned payers and badbits; SPs may refuse content — define Stamper's takedown story.

---

## Sources

FOC / Synapse / contracts
- https://github.com/FilOzone/synapse-sdk (README; `packages/synapse-core/src/chains.ts`, `utils/constants.ts`, `piece/*.ts`, `pdp-verifier/*.ts`, `sp/upload.ts`; `packages/synapse-sdk/src/storage/{manager,context}.ts`, `types.ts`, `filbeam/service.ts`; `docs/src/content/docs/**` — getting-started, retrieval, pdp-overview, fwss-overview, filecoin-pay-overview, storage-providers, storage/upload-pipeline, storage/storage-operations, storage/storage-costs, synapse-core, synapse-react, session-keys, migration-guide, cookbooks/payments-and-storage, resources/contracts, resources/community-projects, resources/devnet; `packages/synapse-sdk/CHANGELOG.md`)
- https://docs.filecoin.cloud/ (rendered docs of the above)
- https://registry.npmjs.org/@filoz%2Fsynapse-sdk , https://registry.npmjs.org/@filoz%2Fsynapse-core , https://registry.npmjs.org/filecoin-pin
- https://github.com/FilOzone/filecoin-services (README, `SPEC.md`, `CHANGELOG.md`, `service_contracts/README.md`, `service_contracts/deployments.json`, `service_contracts/abi/FilecoinWarmStorageService.abi.json`, `.../FilecoinWarmStorageServiceStateView.abi.json`, `service_contracts/src/FilecoinWarmStorageService.sol`, `src/lib/FilecoinWarmStorageServiceStateLibrary.sol`, `service_contracts/tools/README.md`)
- https://github.com/FilOzone/pdp (README, `CHANGELOG.md`, `docs/design.md`, `src/PDPVerifier.sol`, `src/Cids.sol`, `src/interfaces/IPDPVerifier.sol`, `src/interfaces/IPDPEvents.sol`)
- https://github.com/FilOzone/filecoin-pay (README, `CHANGELOG.md`, `docs/concepts.md`, `docs/monitoring.md`)
- https://github.com/Secured-Finance/stablecoin-contracts (USDFC README, deployed addresses)
- https://www.filecoin.io/blog/posts/filecoin-onchain-cloud-is-live-on-mainnet/ (datePublished 2026-03-26)
- https://docs.filecoin.io/build-on-filecoin/filecoin-onchain-cloud , https://docs.filecoin.io/networks/mainnet/rpcs , https://docs.filecoin.io/provide-storage/pdp/install-and-run-pdp , https://docs.filecoin.io/builder-cookbook/filecoin-pin/filecoin-pin-cli
- https://github.com/FilOzone/pdp-explorer (README; https://pdp.filecoin.cloud), https://github.com/FIL-Builders/fwss-subgraph , https://github.com/FilOzone/filecoin-pay-explorer (https://pay.filecoin.cloud), https://github.com/FilOzone/dealbot/blob/main/docs/checks/production-configuration-and-approval-methodology.md
- https://docs.curiostorage.org/experimental-features/enable-pdp , https://github.com/filecoin-project/curio , https://github.com/filecoin-project/boost
- FilBeam: https://filbeam.com/ , https://docs.filbeam.com/ (how-it-works/pricing, retrieval-and-fallback, quota-system, payment-model; reference/stats-api; getting-started/quickstart)
- Filecoin Pin: https://github.com/filecoin-project/filecoin-pin (README, `documentation/behind-the-scenes-of-adding-a-file.md`, `documentation/retrieval.md`, `documentation/content-routing-faq.md`, `src/core/unixfs/importer-options.ts`)

PieceCID / CIDs
- https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md (Draft)
- https://github.com/multiformats/multicodec/blob/master/table.csv (0x1011 fr32-sha256-trunc254-padbintree, draft; 0xf101 fil-commitment-unsealed)
- https://registry.npmjs.org/@web3-storage%2Fdata-segment (5.3.0; README)
- https://github.com/ipfs/js-ipfs-unixfs (`packages/ipfs-unixfs-importer/src/index.ts`, `constants.ts`, `chunker/fixed-size.ts`; npm 17.1.1), https://registry.npmjs.org/multiformats (14.0.5), https://registry.npmjs.org/@ipld%2Fcar (5.4.7), https://registry.npmjs.org/@ipld%2Funixfs (3.0.0)
- https://github.com/ipfs/kubo (`config/import.go`, `docs/config.md`, `core/commands/add.go`; releases v0.43.1)
- https://github.com/ipfs/helia (`packages/unixfs/README.md`), https://github.com/ipfs/helia-verified-fetch (README; npm 8.1.2)

Storacha / Fil One
- https://github.com/storacha/upload-service (README; `packages/w3up-client/README.md` + `package.json`; `packages/upload-client/src/{unixfs,sharding,index}.js`; `packages/filecoin-pin-migration/README.md`; releases API; commits API; repo API), https://api.github.com/repos/storacha/console (archived), https://api.github.com/orgs/storacha/repos
- https://github.com/storacha/docs (`src/pages/how-to/filecoin-info.mdx`, `concepts/podsi.mdx`, `concepts/filecoin-storage.md`, `concepts/ipfs-gateways.md`, `how-to/upload.mdx`, `how-to/retrieve.mdx`, `js-client.md`, `concepts/architecture-options.mdx`, `concepts/car.md`, `faq.md`, `terms.md`, `service-level-agreement.md`; commits API)
- https://registry.npmjs.org/@storacha%2Fclient (2.1.4), https://registry.npmjs.org/@storacha%2Fupload-client (1.4.2), https://registry.npmjs.org/@storacha%2Ffilecoin-pin-migration (2.0.0), https://registry.npmjs.org/@storacha%2Findexing-service-client (2.6.10)
- https://storacha.network/ , https://docs.storacha.network/ , https://storacha.network/pricing , https://storacha.network/blog (all serve Fil One), https://www.fil.one/blog/rss.xml , https://docs.fil.one/ , https://storacha.statuspage.io/
- DNS-over-HTTPS probes: https://dns.google/resolve?name=up.storacha.network&type=A (NXDOMAIN), …console.storacha.network (NXDOMAIN), …filcdn.com (NXDOMAIN)

Lighthouse / Akave
- https://docs.lighthouse.storage/ (quick-start; how-to/upload-data/file; how-to/upload-encrypted-data/file; how-to/check-for-filecoin-deals; how-to/retrieve-file; filecoin-first/{deal-verification,podsi,pay-per-deal,section-a}; tutorials/document-verification-with-podsi; s3/quick-start; ipfs-walrus/quick-start), https://www.lighthouse.storage/pricing , https://github.com/lighthouse-web3/lighthouse-package (README, `src/Lighthouse/index.ts`, `dealStatus/index.ts`), https://registry.npmjs.org/@lighthouse-web3%2Fsdk (0.4.7)
- https://docs.akave.ai/ (home; akave-o3/introduction; discover-akave/what-is-akave; akave-sdk-cli/akavecli-pdp-archival), https://registry.npmjs.org/-/v1/search?text=akave

IPFS retrieval
- https://docs.ipfs.tech/concepts/public-utilities/ , https://blog.ipfs.tech/2026-08-beyond-sponsored-gateways/ (2026-08-25), https://ipshipyard.com/blog/2026-ipfs-gateways-redirect-inbrowser-link/ (2026-05-11), https://github.com/ipfs/rainbow , https://specs.ipfs.tech/http-gateways/trustless-gateway/
- HTTP probes (2026-09-30): storacha.link / w3s.link → 301 dweb.link; ipfs.io & dweb.link → 403 (curl); trustless-gateway.link `?format=raw` → 200; gateway.lighthouse.storage → 402; pdp.vxb.ai → 301 pdp.filecoin.cloud/mainnet; pay.filecoin.cloud → 307 /mainnet
