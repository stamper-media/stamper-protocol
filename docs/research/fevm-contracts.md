# Stamper research — Filecoin EVM (FEVM) smart contracts and on-chain trustless verification (state of 2026-10-01)

Scope: FEVM toolchain and chain facts; verifying Filecoin storage from Solidity (MarketAPI vs the PDP / Warm Storage / Filecoin Pay stack); gasless device-key UX (ERC-4337, relayers, EIP-712, P-256); event indexing; registry/notarization design references; and a concrete contract + relayer + tooling recommendation.

Legend used throughout: **[verified]** = read from a primary source (official docs, repo source/README, release notes, or a live RPC/HTTP probe I ran on 2026-09-30/10-01); **[inferred]** = my reasoning on top of verified facts; **[unverified]** = could not reach a primary source; treat as a lead.

---

## 0. Executive summary

1. **Chain facts [verified by live RPC]**: mainnet chain id 314, Calibration 314159; 30-second epochs; `block.timestamp` is exactly `genesis + 30 * epoch` on both networks (mainnet genesis 1598306400, Calibration 1667326380); base fee sits at its 100 attoFIL floor; real transactions cost ~1e-6 to 2e-4 FIL (≈ $0.000001–$0.0002 at FIL ≈ $1.04), dominated by `gasLimit × gasPremium` (premium ≈ 2.0e5 attoFIL/gas).
2. **Finality — important nuance [verified by probing 3 independent mainnet providers]**: F3 (FIP-0086) activated on mainnet 2025-04-29 (epoch 4920480), but as of 2026-10-01 every mainnet node I queried (Glif 1.36.2, Ankr 1.36.3, Zondax 1.36.0) reports the **same last F3 certificate: instance 466453, finalizing epochs 5824137–5824156 (≈ 2026-03-09 04:38 UTC)**, and "certificate not found" for the next instance. The eth `finalized` tag on mainnet is therefore being produced by the FRC-0089 EC finality calculator (observed 21–24 epochs ≈ 10–12 min behind head), and the native `ChainGetFinalizedTipSet` returns head−900 (7.5 h, classic EC finality). On Calibration, F3 is live (re-bootstrapped in Feb 2026 as network `calibrationnet2`) and certificates trail head by ~5 epochs (≈ 2.5 min). I found no public post-mortem for the mainnet state; treat "F3 is running on mainnet" as **not currently true** until confirmed with the FilOz team. Stamper must not hard-code "F3 = seconds"; design the UX around a *policy* (pending → included → safe after N epochs → finalized) driven by the node's `finalized` tag plus your own epoch-count threshold.
3. **Storage proofs from Solidity [verified]**: the production path is the FilOzone stack — `PDPVerifier` v3.5.0 (mainnet proxy `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F`, Calibration `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C`) + `FilecoinWarmStorageService` (FWSS) v1.4.0 + `FilecoinPayV1` + USDFC. A third-party contract can trustlessly check "piece X is in a live, proven data set" with read-only calls: `PDPVerifier.pieceLive(setId, pieceId)`, `getPieceCid(setId, pieceId)` (compare bytes), `dataSetLive(setId)`, `getDataSetLastProvenEpoch(setId)`, and FWSS view `provenThisPeriod(setId)` / `FaultRecord` events. Mainnet proving cadence: `maxProvingPeriod = 2880` epochs (24 h), `challengeWindowSize = 60`, `challengesPerProof = 5`, `challengeFinality = 150` epochs. Limits: data sets are per payer per provider, `pieceId` is only known after the SP's `addPieces` lands, and the stored CID is the PieceCID (v2, FRC-0069) of the padded piece, not the file's sha256/IPFS CID. The legacy `MarketAPI` (deal-based) path still works (`filecoin-solidity-api` 1.1.3) but deal ids exist only after `PublishStorageDeals`, activation takes hours-days, and nv29 "Solstice" (FIP-0118) deprecates FIL+ — do not build on verified-deal semantics.
4. **Gasless UX [verified]**: there is **no ERC-4337 infrastructure on Filecoin**: EntryPoint v0.6/v0.7/v0.8 have no code on 314 or 314159; Pimlico's chain list has no Filecoin; EAS has no Filecoin deployment. What *does* exist: the Safe singleton factory and Multicall3 (deployed on both networks), the **secp256r1 `P256VERIFY` precompile at `0x0100`** (FIP-0113, EIP-7951 semantics, live on mainnet since nv28 "Fire Horse" 2026-05-27, bundled in builtin-actors v18.0.0), and FilOz's `SessionKeyRegistry`. Recommended design: device key signs an EIP-712 `StampClaim`; a Stamper-run relayer (e.g. OpenZeppelin Relayer, self-hosted, any-EVM via RPC) submits `registerStamp(claim, sig)`; the contract verifies with `ecrecover` (secp256k1 app key) or the `0x0100` precompile (Secure Enclave / Android StrongBox / passkey P-256 key). Note: precompiles are **not callable as a top-level `eth_call` target** on FEVM (ecrecover and identity return empty too) — only from EVM bytecode — so test via a tiny wrapper contract.
5. **Indexing [verified]**: Goldsky hosts subgraphs for Filecoin (`filecoin`, `filecoin-testnet` slugs; subgraph product only; the FilOz Filecoin Pay explorer itself runs on Goldsky). The Graph's decentralized network and Subsquid do **not** list Filecoin; Envio HyperIndex and Ponder work in RPC mode. Fallback `eth_getLogs` limits on Glif: mainnet (Lotus 1.36.2) max 2880-epoch range and 10,000 results; Calibration (Lotus 1.37.0-rc1) **max 360-epoch range** — the new Lotus ≥1.36.3 default, so expect mainnet providers to drop to 360 soon. Also: Glif's hosted Graph endpoint from the docs now redirects elsewhere (stale), the Lava endpoint in the docs is discontinued, ChainupCloud's mainnet endpoint failed during my probe.
6. **Toolchain [verified]**: Foundry and Hardhat both work; EVM feature level is effectively **Cancun + BLS12-381 + CLZ** (PUSH0, MCOPY, TLOAD/TSTORE, EIP-2537 precompiles, EIP-7939 CLZ all implemented; no BLOBHASH/BLOBBASEFEE; EIP-7702 only a Draft FIP-0111). Use `solc ≥ 0.8.25`, `evm_version = "cancun"`. Receipts land in the *next* tipset (30–90 s) so raise receipt timeouts; `forge script` needs `--skip-simulation` and benefits from `--resume --retries 10`. Verification: Blockscout (`filecoin.blockscout.com`, `filecoin-testnet.blockscout.com`, Rust verifier enabled) and Filfox (`@fil-b/filfox-verifier`). Upcoming: nv29 Solstice already live on Calibration (epoch 4109133, 2026-09-28); mainnet not yet scheduled (Lotus v1.37.0 stable expected week of 2026-10-05).

---

## 1. FEVM developer toolchain and chain facts

### 1.1 Networks, chain IDs, RPCs

| | Mainnet | Calibration |
|---|---|---|
| Chain ID | **314** (`eth_chainId` → `0x13a`) [verified] | **314159** (`0x4cb2f`) [verified] |
| Epoch (block) time | 30 s (`BlockDelay: 30` in `Filecoin.Version`) [verified] | 30 s [verified] |
| Genesis timestamp | 1598306400 [verified by arithmetic against live blocks] | 1667326380 [verified by arithmetic] |
| Native token | FIL (18 decimals; attoFIL = 1e-18) | tFIL |
| Current network version | nv28 "Fire Horse" since epoch 6052800 (2026-05-27T14:00Z); nv29 not scheduled [verified: Lotus v1.36.0 notes, `params_mainnet.go`] | nv29 "Solstice" since epoch 4109133 (2026-09-28T12:59:30Z) [verified: Lotus v1.37.0 release thread #13760] |
| Node versions seen | Lotus 1.36.0–1.36.3 | Lotus 1.37.0-rc1 |

Public RPC endpoints (docs.filecoin.io, re-checked live on 2026-10-01):

- **Glif** mainnet `https://api.node.glif.io/rpc/v1` (WSS `wss://wss.node.glif.io/apigw/lotus/rpc/v1`); Calibration `https://api.calibration.node.glif.io/rpc/v1` (WSS `wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1`) — **working** [verified].
- **Ankr** `https://rpc.ankr.com/filecoin`, `https://rpc.ankr.com/filecoin_testnet` — **working**; Ankr's Calibration node exposed a live F3 certificate while Glif's did not [verified].
- **ChainupCloud** `https://filecoin.chainup.net/rpc/v1` — returned `failure to get a peer from the ring-balancer` during my probe [verified, flag as unreliable].
- **Lava** `https://filecoin.lava.build` — **discontinued** ("This endpoint has been discontinued", points to gateway.lavanet.xyz). The Filecoin docs page still lists it — stale [verified].
- **NOWNodes** `https://fil.nownodes.io` — listed in docs; not probed (API key).
- Also working: **dRPC** `https://filecoin.drpc.org` (eth methods only; `Filecoin.F3*` "method is not available"), **Zondax** `https://api.zondax.ch/fil/node/mainnet/rpc/v1` (full Lotus API) [verified]. thirdweb exposes `https://314.rpc.thirdweb.com` / `https://314159.rpc.thirdweb.com` [verified from thirdweb chain pages].
- Docs caveat: public endpoints are "read-only + `MPoolPush`/`EthSendRawTransaction`" and "only guarantee 2000 of the latest blocks" of state (~16.7 h). Archival access needs a paid/own node. Rate limits are not documented anywhere I could find [unverified].
- Gateways do **not** expose `Filecoin.F3IsRunning`, `F3GetProgress`, `F3GetManifest` (method not found); they do expose `F3GetLatestCertificate`, `F3GetCertificate`, `ChainGetFinalizedTipSet` [verified].

### 1.2 Block explorers

| Explorer | Mainnet | Calibration | Status 2026-10-01 |
|---|---|---|---|
| Blockscout (FEVM) | https://filecoin.blockscout.com | https://filecoin-testnet.blockscout.com | **Alive**, API v2 works, contract verification enabled (`/api/v2/smart-contracts/verification/config` reports Rust verifier microservice on) [verified] |
| Filfox | https://filfox.info | https://calibration.filfox.info | Mainnet alive with JSON API (`/api/v1/message/<hash>` gives the full fee breakdown). **Calibration explorer stuck at height 4109133 = the nv29 upgrade epoch** (its node was not upgraded for Solstice) [verified] |
| Beryx (Zondax) | https://beryx.zondax.ch | same | Alive for humans; curl gets a Vercel security checkpoint (429) — not automation-friendly [verified] |
| Filscan | https://filscan.io | https://calibration.filscan.io | Alive [verified] |
| Starboard FVM explorer | https://fvm.starboard.ventures | same | Page loads, but it is a 2023-era product; treat as possibly unmaintained [inferred] |
| Glif Explorer | explorer.glif.io → redirects to glif.io | | [verified] |

### 1.3 Faucets (Calibration) [verified from docs.filecoin.io calibration page]

- tFIL: Chainsafe `https://faucet.calibnet.chainsafe-fil.io`; Forest `https://forest-explorer.chainsafe.dev/faucet/calibnet`; Zondax `https://beryx.zondax.ch/faucet/`; thirdweb (0.01 tFIL/day).
- **tUSDFC**: `https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc` (needed for Warm Storage payments on Calibration).
- DataCap faucet: `https://faucet.calibnet.chainsafe-fil.io/datacap.html` (irrelevant post-Solstice).

### 1.4 Gas, fees and real costs

How FEVM gas works [verified: docs "How gas works"]: gas is charged by Wasm instrumentation of the EVM interpreter, so Filecoin gas units are *much* larger than Ethereum gas for the same bytecode, but the unit price is tiny. Fee = `gasUsed × baseFee` (burned) + `gasLimit × gasPremium` (miner tip) + over-estimation burn. `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_estimateGas`, `eth_baseFee` (new in Lotus 1.36.1) map onto this. Block gas limit is 10 B per block; an "eth block" is a tipset (several Filecoin blocks), so `eth_getBlockByNumber.gasLimit` reports e.g. 30 B on mainnet (3 blocks) [verified observation + inferred explanation]. Per-message gas limit is also 10 B [docs].

Live numbers (2026-09-30/10-01) [verified]:

- Mainnet: `baseFeePerGas = 100` attoFIL (the protocol floor); `eth_maxPriorityFeePerGas ≈ 199,964–201,662` attoFIL; `eth_gasPrice ≈ 199,601`.
- Calibration: base fee 113–128 attoFIL; priority ≈ 110,193.
- Real PDP transactions on mainnet (receipts from the last 300 blocks): `gasUsed` 112 M – 930 M Filecoin gas, `effectiveGasPrice` 244k–252k attoFIL → **2.8e-5 … 2.3e-4 FIL per tx** (≈ $0.00003–$0.00024 at $1.043/FIL, CoinGecko 2026-10-01). Filfox breakdown of one `InvokeContract` message: gasLimit 511,985,923; gasPremium 199,644; minerTip 1.02e-4 FIL; baseFeeBurn 4.1e-8 FIL; overEstimationBurn 1.5e-9 FIL — i.e. **fee ≈ gasLimit × premium**, the base fee is noise at the floor.
- A plain value transfer to a fresh address estimates at 6,144,442 gas (placeholder-actor creation) ≈ 1.2e-6 FIL.
- Estimate for a Stamper `registerStamp` (a few SSTOREs + ecrecover + one event): on the order of 10–40 M Filecoin gas → **≈ 2e-6 … 8e-6 FIL (≈ $0.000002–$0.00001)** [inferred; measure with `eth_estimateGas` once deployed]. Gas cost is not a constraint for Stamper; throughput and latency are (2,880 epochs/day, receipts next tipset).
- FIL price is volatile; all USD figures are snapshot values.

### 1.5 Finality: F3 status and what "the stamp is final" can mean

Design [verified: FIP-0086 Final; mainnet F3 manifest embedded in Lotus `build/buildconstants/f3manifest_mainnet.json`]:
- F3 (GossiPBFT) finalizes tipsets voted by > 2/3 QAP and emits **finality certificates** (BLS-aggregated, independently verifiable). EC keeps running underneath with 900-epoch probabilistic finality as the fallback. Mainnet manifest: `NetworkName "filecoin"`, `BootstrapEpoch 4920480`, `EC.HeadLookback 4`, `EC.Finality 900`, `EC.Finalize true`, `Gpbft.Delta 6 s`, `ChainProposedLength 20`, `Pause false`. Because of the 4-epoch head lookback plus instance time, the *best case* F3 lag is ~2–3 minutes, not "tens of seconds" [inferred from manifest; consistent with Calibration observation].
- Lotus mapping of Ethereum tags [verified: Lotus v1.34.0 and v1.35.1 release notes]: since 1.34.0 the `/v1` eth API resolves `finalized` to the F3-finalized epoch and `safe` to max(F3 finalized, head−200); since 1.35.1 the FRC-0089 **EC finality calculator** is integrated so that when F3 lags, `finalized`/`safe` "reflect actual chain health (~20–30 epochs)" rather than the static 900. Env `LOTUS_ETH_V1_DISABLE_F3_FINALITY_RESOLUTION=1` restores legacy behaviour. `Filecoin.ChainGetFinalizedTipSet` returns the F3-finalized tipset with fallback to EC finality if F3 is unavailable or lags behind EC.

Observed on 2026-10-01 [verified, 3 providers]:
- **Mainnet**: `F3GetLatestCertificate` → instance **466453**, ECChain epochs 5824137–5824156 (epoch 5824156 = **2026-03-09T04:38Z**) on Glif, Ankr and Zondax; `F3GetCertificate(466454)` → "certificate not found". `ChainGetFinalizedTipSet` = head−900 (6415997 at head 6416897) — pure EC fallback. `eth_getBlockByNumber("finalized")` = head−21…24 (≈ 10.5–12 min) and `safe` == `finalized` — the FRC-0089 calculator. Conclusion: **mainnet F3 has not produced a certificate for ~7 months**. Corroborating context: go-f3 issue #1054 "Resume F3 on Calibration" (Calibration F3 stalled Nov 2025, resumed by deploying a new network name — the Calibration manifest is now `calibrationnet2`, bootstrap epoch 3451774 ≈ 2026-02-12) and #1056 "Set an upper bound on exponential backoff" ("impacted by the lack of a cap multiple times in the last 6-7 months since F3 has been activated"). I could not find a public statement about the mainnet stall (GitHub search/API was rate-limited; WebSearch budget exhausted) — **open question #1**.
- **Calibration**: Ankr node: certificate instance 642326 covering epochs 4116226–4116227 at head 4116232 → **~5 epochs (2.5 min) lag**, `finalized` = that epoch. Glif's Calibration node could not reach its F3 module ("client error (Connect)") and reported `finalized` = head−63 — i.e. **the meaning of `finalized` depends on which node you hit**.

What this means for Stamper UX [inferred]:
- Treat chain inclusion as three states: **included** (receipt available; next tipset, 30–90 s), **safe** (your own threshold, e.g. ≥ 30 epochs ≈ 15 min, matching FRC-0089's ~2^-30 reorg probability under healthy conditions), **final** (F3 certificate covers the epoch, or ≥ 900 epochs). Show "stamped · pending finality" until the chosen threshold passes; never promise seconds-level finality on mainnet today.
- Query `finalized` from a node you control or at least a provider you have checked, and expose the policy in the verify page ("anchored at epoch N; 1,204 epochs ago; finalized").
- Because `block.timestamp` is deterministic per epoch, the stamp's on-chain time is exact and auditable; the device-signed `capturedAt` is the only "soft" timestamp.

### 1.6 Block timestamp reliability, null rounds, re-orgs

- [verified] `block.timestamp == genesis + 30 × block.number` exactly: mainnet block 6416863 → 1790812290 = 1598306400 + 30×6416863; Calibration block 4116196 → 1790812260 = 1667326380 + 30×4116196. So `block.timestamp` on FEVM is a function of the epoch, not of miner clocks — stronger than Ethereum. `block.number` is the Filecoin epoch.
- Null rounds exist (an epoch with no blocks); block numbers may be skipped in eth APIs, so never assume contiguous numbers when paging logs [inferred from Filecoin consensus; Lotus 1.36.3 notes mention "canonical non-null tipsets" handling in `eth_getLogs`].
- Shallow re-orgs of the head tipset are normal in EC; do not act on a receipt until it is a few epochs deep (indexers: use a reorg-aware tool; see §4).
- Message execution: messages included in tipset N execute in N+1, so receipts appear 30–90 s after submission — raise toolchain receipt timeouts to ≥ 90–120 s [verified: docs best practices].

### 1.7 Foundry / Hardhat / Solidity constraints

- **EVM feature level** [verified from `builtin-actors` interpreter source + FIP index]: PUSH0 (`def_push! { PUSH0 }`), MCOPY (FIP-0094), TLOAD/TSTORE (FIP-0097), BASEFEE, PREVRANDAO, SELFDESTRUCT present; BLS12-381 precompiles 0x0b–0x11 (FIP-0105); CLZ 0x1e (FIP-0114, nv28); **secp256r1 P256VERIFY at 0x0100** (FIP-0113, nv28). Not present: BLOBHASH, BLOBBASEFEE (no blobs), EIP-7702 (FIP-0111 Draft). Transactions: EIP-1559 type-2 (FIP-0055) and legacy Homestead/EIP-155 (FIP-0091).
  - Recommendation: `solc 0.8.30`, `evm_version = "cancun"` (safe); "prague" only if you rely solely on BLS precompiles. Both FilOz kits pin `0.8.23`; FilOz's own PDP/FWSS contracts use `^0.8.20`, `SessionKeyRegistry` `^0.8.30`.
- **Foundry** [verified: FEVM Foundry kit README]: `forge create --rpc-url … --private-key … --broadcast` works; `forge script … --broadcast --skip-simulation`; known issue "empty transaction receipts / mempool drops" → `--resume --retries 10`; verification `forge verify-contract --verifier blockscout --verifier-url https://filecoin.blockscout.com/api/ --force --skip-is-verified-check` (testnet `https://filecoin-testnet.blockscout.com/api/`), or `npx filfox-verifier forge <addr> <file:contract> --chain 314|314159`. The kit's `foundry.toml` uses `via_ir = true`, optimizer 200 runs, and sets no `evm_version` [verified]. Add `--slow` for multi-tx scripts (sequential, nonce-safe on 30-s blocks) and `--timeout 180` [inferred].
- **Hardhat** [verified: `fevm-hardhat-kit/hardhat.config.ts`]: solc 0.8.23, optimizer 1000 runs, networks `filecoin` (314, Ankr RPC) and `calibration` (314159), `hardhat-verify` custom chains pointing at Blockscout, Sourcify enabled, plus `@fil-b/filfox-verifier/hardhat`. Both kits bundle `filecoin-solidity-api`.
- **Deterministic deployment** [verified by `eth_getCode`]: Safe singleton factory `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` and Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` are deployed on both networks; the Arachnid deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, Permit2 and the daimo P256 verifier are **not**.
- **Addresses**: contracts and EOAs are `f410…` (delegated) addresses with 0x aliases; sending FIL to non-EVM actors must use the `call_actor` precompile (`0xfe00…03`/`…05`), not `transfer()` [verified: docs best practices]. Filecoin precompiles: resolve_address `0xfe…01`, lookup_delegated_address `0xfe…02`, call_actor `0xfe…03`, call_actor_id `0xfe…05`, get_randomness `0xfe…06` (get_actor_type `…04` disabled) [verified: precompile table in source].
- **Precompiles are not top-level callable** [verified]: `eth_call` to `0x01` (ecrecover) with a valid signature, to `0x04` (identity) and to `0x0100` all return `0x` and `eth_estimateGas` prices them as placeholder-actor creation. They only work when invoked from EVM bytecode (`staticcall` from a contract). Unit-test P-256 via a wrapper.

### 1.8 Network upgrade pipeline to watch

- nv27 "Golden Week": epoch 5348280 (2025-09-24) [verified].
- nv28 "Fire Horse": epoch 6052800 (2026-05-27T14:00Z), Lotus v1.36.0, builtin-actors **v18.0.0** (published 2026-04-28): FIP-0112 sector liveness export to FEVM, **FIP-0113 P256VERIFY**, FIP-0114 CLZ, FIP-0115 premium-percentile base-fee target [verified].
- nv29 "Solstice": **FIP-0118 "Deprecate FIL+ and Fund Services via Block-Reward Split"** (Accepted); builtin-actors v19.0.1 (2026-09-22); Lotus v1.37.0 (rc1 2026-09-22, rc2 2026-09-29, stable expected week of 2026-10-05); Calibration upgraded at epoch 4109133 (2026-09-28); mainnet epoch not scheduled yet [verified]. Impact: verifreg/datacap (FIL+ "verified deals", DataCap faucet, `VerifRegAPI`, `getDealVerified`) are being deprecated — do not build on them.
- Lotus 1.36.3 (Sept 2026, recommended): **default `eth_getLogs`/filter range limit 360 epochs**, `eth_getLogs` no longer returns partial results when the event index is incomplete, CVE-2026-57497 fix [verified].

---

## 2. Verifying Filecoin storage FROM a Solidity contract

### 2.1 The modern path: PDP + Warm Storage + Filecoin Pay ("Filecoin Onchain Cloud")

Deployed addresses [verified: `FilOzone/filecoin-services/service_contracts/deployments.json`, commit 4cbbea4, deployed 2026-08-21, `fwss_version 1.4.0`, `pdp_version 3.5.0`; VERSION() strings confirmed live]:

| Contract | Mainnet (314) | Calibration (314159) |
|---|---|---|
| PDPVerifier proxy (ERC-1967) | `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F` | `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` |
| PDPVerifier implementation | `0x04D4CdB99E34D7e9a366E7eba7A835e034bc41b1` | `0x04D4CdB99E34D7e9a366E7eba7A835e034bc41b1` |
| FilecoinWarmStorageService proxy | `0x8408502033C418E1bbC97cE9ac48E5528F371A9f` | `0x02925630df557F957f70E112bA06e50965417CA0` |
| FWSS implementation | `0xa874C7333c8e1689C33155AD7bEE980926086e21` | `0xF5436B44354735588B20CA18F7D3e95a14FAcA10` |
| FWSS StateView | `0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172` | `0x1B68d64f01bAa42014B9774605867BF4eDC0320f` |
| FilecoinPayV1 | `0x23b1e018F08BB982348b15a86ee926eEBf7F4DAa` | `0x09a0fDc2723fAd1A7b8e3e00eE5DF73841df55a0` |
| USDFC (ERC-20, 18 dec, "USD for Filecoin Community") | `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045` | `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0` |
| ServiceProviderRegistry proxy | `0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB` | `0x839e5c9988e4e9977d40708d0094103c0839Ac9D` |
| SessionKeyRegistry | `0x74FD50525A958aF5d484601E252271f9625231aB` | `0x518411c2062E119Aaf7A8B12A2eDf9a939347655` |
| Endorsement set (ProviderIdSet) | `0x59eFa2e8324E1551d46010d7B0B140eE2F5c726b` | `0xAA2f7CfC7ecAc616EC9C1f6d700fAd19087FAC84` |

All are MIT + Apache-2.0, Solidity `^0.8.20`, UUPS/ERC-1967 upgradeable (FilOz can upgrade; the PDP README says "still in beta testing and might be upgraded") — your contract should read them through an **admin-settable address with a timelock**, not a constant.

Live state [verified 2026-10-01]: mainnet `getNextDataSetId() = 1663` (1,662 data sets created), Calibration 39,990; `getChallengeFinality()` = 150 (mainnet) / 10 (Calibration); `feePerTiB()` = 2.3e14 attoFIL (0.00023 FIL per TiB per proof); FWSS `getPDPConfig()` = mainnet `[maxProvingPeriod 2880, challengeWindowSize 60, challengesPerProof 5, initChallengeWindowStart 6419699]`, Calibration `[240, 20, 5, …]`. Sample mainnet data set 1662: `dataSetLive = true`, leafCount 336,746, `lastProvenEpoch 6416686`.

PDPVerifier public read API (v3.5.0) [verified from source]:

```solidity
function dataSetLive(uint256 setId) view returns (bool);
function pieceLive(uint256 setId, uint256 pieceId) view returns (bool);
function pieceChallengable(uint256 setId, uint256 pieceId) view returns (bool);
function getPieceCid(uint256 setId, uint256 pieceId) view returns (Cids.Cid memory); // struct Cid { bytes data; }
function getPieceLeafCount(uint256 setId, uint256 pieceId) view returns (uint256);
function getDataSetLeafCount(uint256 setId) view returns (uint256);
function getDataSetLastProvenEpoch(uint256 setId) view returns (uint256);
function getNextChallengeEpoch(uint256 setId) view returns (uint256);
function getDataSetListener(uint256 setId) view returns (address);          // == FWSS proxy for Warm Storage sets
function getDataSetStorageProvider(uint256 setId) view returns (address, address);
function getActivePieces(uint256 setId, uint256 offset, uint256 limit) view returns (Cids.Cid[] memory, uint256[] memory, bool);
function findPieceIdsByCid(uint256 setId, Cids.Cid calldata pieceCid, uint256 startPieceId, uint256 limit) view returns (uint256[] memory);
function getScheduledRemovals(uint256 setId) view returns (uint256[] memory);
event DataSetCreated(uint256 indexed setId, address indexed storageProvider);
event PiecesAdded(uint256 indexed setId, uint256[] pieceIds, Cids.Cid[] pieceCids);
event PiecesAddedV2(uint256 indexed setId, uint256 firstPieceId, Cids.PackedCid[] pieceCids);
event PossessionProven(uint256 indexed setId, IPDPTypes.PieceIdAndOffset[] challenges);
event NextProvingPeriod(uint256 indexed setId, uint256 challengeEpoch, uint256 leafCount);
event PiecesRemoved(uint256 indexed setId, uint256[] pieceIds);
event DataSetDeleted(uint256 indexed setId, uint256 deletedLeafCount);
```

FWSS StateView (v1.4.0) [verified from source]: `getDataSet(id) → DataSetInfoView{pdpRailId, cacheMissRailId, cdnRailId, payer, payee, serviceProvider, commissionBps, clientDataSetId, pdpEndEpoch, providerId, pendingOneTimePayments, lifecycleReserveBalance, dataSetId}`, `getDataSetStatus(id) → {Inactive, Active}`, `provenThisPeriod(id)`, `provenPeriods(id, periodId)`, `provingDeadline(id)`, `nextPDPChallengeWindowStart(id)`, `provingActivationEpoch(id)`, `getDataSetMetadata(id, key)`, `clientDataSets(payer)`, `railToDataSet(railId)`, `isProviderApproved(providerId)`; events `DataSetCreated(dataSetId, providerId, pdpRailId, cacheMissRailId, cdnRailId, payer, serviceProvider, payee, metadataKeys[], metadataValues[])`, `PieceAdded(dataSetId, pieceId, pieceCid, keys[], values[])`, **`FaultRecord(dataSetId, periodsFaulted, deadline)`**, `PDPPaymentTerminated`, `ServiceTerminated`. Piece metadata: ≤ 3 keys per piece, key ≤ 32 B, value ≤ 96 B — enough to tag a piece with Stamper's `stampId`. `addPieces` is authorized by an **EIP-712 signature from the payer (or an authorized session key)** over `AddPieces{dataSetId, clientDataSetId, pieceCids[], nonce, metadata}` — the SP submits it. (Note: a few view functions on `main`, e.g. `hasBeenProvenRecently`, reverted on the deployed 1.4.0 view in my probe; stick to `provenThisPeriod`, `provingDeadline`, `getDataSetLastProvenEpoch`.)

**Can a third-party contract check "piece X is in a live, proven data set"? Yes, trustlessly, read-only** [inferred from verified API]:

```solidity
interface IPDPVerifier { function dataSetLive(uint256) external view returns (bool);
  function pieceLive(uint256,uint256) external view returns (bool);
  function getPieceCid(uint256,uint256) external view returns (Cids.Cid memory);
  function getDataSetLastProvenEpoch(uint256) external view returns (uint256);
  function getDataSetListener(uint256) external view returns (address); }
interface IFWSSView { function provenThisPeriod(uint256) external view returns (bool);
  function provingDeadline(uint256) external view returns (uint256); }

function storageStatus(bytes32 stampId) public view returns (bool bound, bool live, uint256 lastProven, bool provenThisPeriod) {
    Binding memory b = bindings[stampId];           // (setId, pieceId) set by bindStorage()
    if (!b.set) return (false,false,0,false);
    live = pdp.dataSetLive(b.setId) && pdp.pieceLive(b.setId, b.pieceId)
        && keccak256(pdp.getPieceCid(b.setId, b.pieceId).data) == stamps[stampId].pieceCidHash;
    lastProven = pdp.getDataSetLastProvenEpoch(b.setId);
    provenThisPeriod = fwssView.provenThisPeriod(b.setId);
    return (true, live, lastProven, provenThisPeriod);
}
```

Limits and gotchas [verified/inferred as marked]:
- Data sets are **per payer (client) per provider**; a piece is identified by `(setId, pieceId)`; `pieceId` is assigned when the SP's `addPieces` executes (emits `PieceAdded`) — your backend learns it from the Synapse SDK upload result / event, then calls `bindStorage` (anyone can call; the contract re-checks the CID) [verified semantics; binding flow inferred].
- The CID stored on-chain is the **PieceCID** (CommP). PDPVerifier 3.5.0 emits `PiecesAddedV2` with `PackedCid` (PieceCID v2 per FRC-0069: multihash `0x1011`, payload `uvarint padding | uint8 height | 32-byte root`) and keeps `Cids.Cid{bytes}` for reads. Compute the PieceCID client-side (Synapse SDK `PieceCID` helpers) and store its bytes hash in the stamp; FRC-0069 is still a **Draft**, so pin the exact encoding you compare against and add a test vector [verified status; pinning advice inferred].
- "Proven" is periodic: mainnet proving period 2880 epochs (24 h) with 5 challenges per proof; `getDataSetLastProvenEpoch` is the freshness signal; `FaultRecord` events mark missed periods. "Live" (`pieceLive`) means not removed/deleted, not "proven in the last hour".
- PDP proofs are *possession* proofs by one SP; Stamper should (a) store each original in ≥ 2 providers' data sets or (b) at least keep the sha256 + PieceCID on-chain so anyone can re-verify bytes served from the Stamper site or FilBeam CDN. The FIP-0112 miner methods (`ValidateSectorStatus` 3092458564, `GenerateSectorLocation` 1321604665, `GetNominalSectorExpiration` 3010055991, via `call_actor`) only matter for sealed-sector (deal) storage.
- Payment/economics: USDFC deposits into FilecoinPay rails per data set; Stamper (as payer) funds storage; `pdpEndEpoch != 0` means payment terminated → treat as "not stored" even if `pieceLive`.
- Client SDK: `@filoz/synapse-sdk` **2.0.2** (Apache-2.0 OR MIT; viem 2.x peer dep; `@filoz/synapse-core ^0.10.0`; `multiformats 14`) — the docs call the product "Filecoin Onchain Cloud" (docs.filecoin.cloud). Earlier `synapse-sdk` 0.x APIs (ethers-based) are superseded [verified version; rename note inferred from package metadata].

### 2.2 The legacy path: `MarketAPI` / `VerifRegAPI` (filecoin-solidity)

- Package: `filecoin-solidity-api` **1.1.3** on npm (repo `filecoin-project/filecoin-solidity`, "Protocol Labs are now the owners… will maintain it", originally Zondax; last GitHub tag v1.1.2 2024-03-27; MIT/Apache-2.0; `forge install filecoin-project/filecoin-solidity`, remapping `filecoin-solidity-api=lib/filecoin-solidity/`). The old `Zondax/filecoin-solidity` releases (v4.0.x, 2023) and docs.zondax.ch are **stale** — use the PL fork [verified].
- `MarketAPI` [verified from Zondax docs; same in PL fork]: `getDealDataCommitment(uint64 dealId) → (bytes data /* CommP v1 */, uint64 size)`, `getDealActivation(uint64) → (int64 activated, int64 terminated)`, `getDealTerm(uint64) → (int64 start, int64 end /*duration*/)`, `getDealClient`, `getDealProvider`, `getDealLabel`, `getDealVerified`, `getDealTotalPrice`, `getDealClientCollateral`, `getDealProviderCollateral`, plus `publishStorageDeals`, `addBalance`, `withdrawBalance`. Each is a `call_actor` into the built-in market actor with CBOR params.
- Limits [verified/inferred]: deal ids exist only after `PublishStorageDeals` lands; `activated` becomes non-zero only after the SP seals and proves the sector (hours to days); deals are 180-day-to-5-year terms with renewal problems; no "is it still there" signal finer than sector faults (FIP-0112 helps); FIP-0118 (nv29) deprecates FIL+ so `getDealVerified`/`VerifRegAPI`/DataCap are dead ends. Use this path only if you also need Boost/deal-based archival; for Stamper's "original copy, retrievable now" requirement, PDP/Warm Storage is the fit.

---

## 3. Gasless / device-key UX on FEVM

### 3.1 ERC-4337 — not available on Filecoin [verified]

- `eth_getCode` on mainnet and Calibration: EntryPoint v0.6 `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, v0.8 `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` → all `0x`. No canonical EntryPoint ⇒ no bundler/paymaster vendor can serve the chain today.
- Pimlico's supported-chains page: 76 chains, **no Filecoin** [verified]. Biconomy, Alchemy, ZeroDev, Candide, Etherspot: pages 404/unreachable in my session [unverified individually, but moot given no EntryPoint]. thirdweb lists Filecoin RPC/explorers but no AA products for 314/314159 [verified].
- Gelato Relay supported-networks API was unreachable [unverified]; EAS (attestations) has **no Filecoin deployment** [verified: eas-contracts/deployments has no filecoin dir].
- You *could* deploy EntryPoint v0.7 yourself (Safe singleton factory exists for CREATE2) and run your own bundler, but with no vendor support it is strictly more infrastructure than a relayer, for no benefit on a chain where gas is ~$0.00001/tx [inferred].

### 3.2 Recommended: EIP-712 "stamp claims" + a Stamper relayer (meta-transactions)

Pattern [inferred; uses verified primitives]:
1. Device generates a key at install (see §3.3). The app computes `contentHash = sha256(bytes)` and `pieceCid` (PieceCID v2) locally, then signs an EIP-712 typed struct:
   ```
   StampClaim { bytes32 contentHash; bytes32 pieceCidHash; uint64 pieceSize; uint64 capturedAt; bytes32 deviceKeyId; uint256 nonce; uint256 deadline; bytes32 metaHash }
   domain = { name:"Stamper", version:"1", chainId: 314 | 314159, verifyingContract }
   ```
2. The app POSTs `(claim, sig, upload)` to Stamper's API; the relayer submits `registerStamp(claim, sig)` from a funded hot wallet (EIP-1559 tx on FEVM). The relayer never sees the device key; replay is prevented by `(deviceKey, nonce)` and `deadline`; the relayer cannot alter the claim.
3. Contract verifies the signature and stores the stamp; emits `StampRegistered`. Later `bindStorage(stampId, setId, pieceId)` after the Warm Storage upload lands (cross-checked on-chain against `PDPVerifier.getPieceCid`).
- Why custom verify over OpenZeppelin `ERC2771Forwarder`/`ERC2771Context` (OZ Contracts **5.6.1**, MIT) [verified version]: ERC-2771 only tells the contract *who* the `_msgSender()` is; Stamper needs the *signed claim itself* as the artefact (so anyone can re-verify the device signature off-chain from the event). A dedicated `registerStamp(claim, sig)` is simpler and more auditable. Keep ERC-2771 out unless you later add many user-initiated functions.
- Relayer implementation options: **OpenZeppelin Relayer** (self-hosted Rust service, AGPL-3.0, REST API, any EVM chain via RPC config, signers: local keystore / AWS KMS / GCP KMS / Azure KV / HashiCorp Vault / Turnkey / Coinbase CDP, nonce management + fee estimation) [verified features]; or a ~200-line viem worker with a KMS signer. Filecoin specifics: set receipt polling ≥ 120 s, retry on "not found" for 2–3 epochs, use `eth_maxPriorityFeePerGas`, cap `maxFeePerGas` to, say, 10× the current premium, and keep the hot wallet topped (1 FIL ≈ 10^5–10^6 stamps at today's fees).
- Smart-account users: support **EIP-1271** in the verifier (`isValidSignature(hash, sig)` when `signer.code.length > 0`) so a Safe (deployable via the singleton factory) or a future FEVM smart wallet can also own stamps [inferred]. FilOz's `SessionKeyRegistry` (`login(signer, expiry, permissions[], origin)`, `revoke(...)`, `authorizationExpiry(user, signer, permission) → uint256`) is the FilOz-sanctioned way to let a *temporary* key act for a wallet; Stamper can accept a stamp signed by a session key if `authorizationExpiry(owner, signer, keccak("stamper.stamp")) > block.timestamp` [verified interface].

### 3.3 Key type: secp256k1 vs P-256 (Secure Enclave / StrongBox / passkeys)

- **secp256k1 app key**: verified with `ecrecover` (precompile `0x01`), cheapest and simplest; the key lives in the app sandbox (Keychain/Keystore item, *not* hardware-bound). Fine for v1 if the threat model is "prove this came from an enrolled device", with server-side device attestation (App Attest / Play Integrity) done off-chain at enrolment [inferred].
- **P-256 hardware key**: Apple Secure Enclave, Android StrongBox and WebAuthn/passkeys only do **secp256r1**. On FEVM this is now cheap: **`P256VERIFY` precompile at `0x0000000000000000000000000000000000000100`, FIP-0113 (Final), EIP-7951 semantics (interface-compatible with RIP-7212 plus the point-at-infinity and `r' ≡ r mod n` fixes), input = 160 bytes `hash‖r‖s‖x‖y`, output = 32 bytes `…01` on success, empty on failure/malformed input (never reverts), implemented with the Rust `p256` crate 0.13.2, test vectors vendored from EIP-7951, live on mainnet since nv28 (2026-05-27) and on Calibration** [verified: FIP-0113, PR #1708, `secp256r1.rs`, Lotus v1.36.0 notes, precompile table]. Usage (from the actors' own test contract):
  ```solidity
  (bool ok, bytes memory out) = address(0x0100).staticcall(abi.encodePacked(hash, r, s, x, y));
  bool valid = ok && out.length == 32 && out[31] == 0x01;
  ```
  Gas: **not a fixed 6,900 like Ethereum**; FIP-0113 charges "via FEVM's normal instrumented Wasm instruction accounting" — expect single-digit millions of Filecoin gas (≈ 1e-6 FIL) [inferred; measure with a wrapper]. Malleability (`s > n/2`) is **not** rejected by the precompile — enforce low-s in the contract if you need uniqueness of signatures (you do, if `stampId` derives from the signature; better derive `stampId` from the claim, not the sig) [verified note in FIP-0113 + inferred].
  - Passkey/WebAuthn signatures sign `sha256(authenticatorData ‖ sha256(clientDataJSON))`, so the contract must reconstruct that hash (and parse the challenge from clientDataJSON) — use a WebAuthn library (daimo's `WebAuthn.sol`, audited by Veridise, MIT) with the precompile as backend. Raw Secure Enclave ECDSA (`SecKeyCreateSignature` with `.ecdsaSignatureMessageX962SHA256`) and Android `Signature("SHA256withECDSA")` sign `sha256(message)` directly — simplest: sign the EIP-712 digest's bytes32 and verify `sha256(digest)` on-chain [inferred].
  - Fallback if you must run on an EVM without the precompile (not Filecoin): daimo `p256-verifier` ≈ 330k EVM gas, CREATE2 address `0xc2b78104907F722DABAc4C69f826a522B2754De4` — **not deployed on Filecoin** (`eth_getCode` empty); FreshCryptoLib ~200k gas [daimo verified; FCL figure unverified].

---

## 4. Event indexing on Filecoin

| Option | Filecoin support (2026) | Notes |
|---|---|---|
| **Goldsky** subgraphs | **Yes** — network slugs `filecoin` (mainnet) and `filecoin-testnet` (Calibration); Subgraphs product only (no Turbo/Edge RPC/Compose); "partner sponsorship" / subgraph usage covered for approved developers [verified: Goldsky chain page + docs.filecoin.io FEVM indexers]. The FilOz `filecoin-pay-explorer` uses The Graph subgraphs **hosted on Goldsky** for both networks [verified]. | First choice: standard subgraph (AssemblyScript), GraphQL out of the box. |
| The Graph (Subgraph Studio / decentralized network) | **No** — Filecoin absent from the supported-networks table [verified]. The docs' "Protofire/Glif graph node at api.node.glif.io/graph" now 308-redirects to filecoin.chain.love (a toolbox page) — treat as gone [verified]. | Self-host `graph-node` against your own Lotus if you want The Graph without Goldsky [inferred]. |
| Envio HyperIndex | RPC mode only ("index Filecoin Mainnet events with HyperIndex using your own RPC endpoint"); no HyperSync endpoint; Calibration not mentioned [verified]. | Works, but you must respect Lotus log-range caps (see below). |
| Ponder | Any EVM via RPC; `ethGetLogsBlockRange` config to pin the range; auto-detects provider limits "as best it can" [verified]. | Good self-hosted choice: Postgres + TypeScript, built-in reorg handling. |
| Subsquid (SQD) | **No** Filecoin in the network list (120+ networks) [verified]. | — |
| SubQuery | Not checked [unverified]. | — |
| Blockscout API | Both networks; `/api/v2/…` logs/tx endpoints; fine for a verify page's "show me the tx" link, not for bulk indexing [verified alive]. | — |

Raw `eth_getLogs` behaviour on Glif [verified by probe]:
- Mainnet (Lotus 1.36.2): `fromBlock..latest` of 2880 OK (3,204 PDPVerifier logs returned), 2881 OK, **5000 → `-32005 "block range exceeds maximum of 2880"`**; results capped at **10,000** (`"filter matches too many events, try a more restricted filter"`); max 4 topic positions (1.36.2).
- Calibration (Lotus 1.37.0-rc1): **`-32005 "block range exceeds maximum of 360"`** for anything > 360 blocks — the Lotus ≥ 1.36.3 default (`--event-filter-max-height-range`, configurable per node). Expect mainnet providers to tighten to 360 as they upgrade; page in ≤ 360-block windows (3 h) and ≤ 10,000 results.
- Lotus defaults (`[Fevm.Events]`): `MaxFilterHeightRange 2880` (pre-1.36.3), `MaxFilterResults 10000`, `MaxFilters 100`, `FilterTTL 24h`; historic/real-time filter APIs can be disabled by operators [verified].
- WebSocket `eth_subscribe` logs exist on Glif WSS; use it for live updates and `eth_getLogs` windows for catch-up [inferred].

---

## 5. Contract design references

- **ERC-7053 / Numbers Protocol "Commit"** [verified: EIP text, Final]: `function commit(string assetCid, string commitData) returns (uint256 blockNumber)`; `event Commit(address indexed recorder, string indexed assetCid, string commitData)`. Lessons: index by *content identifier* (indexed topic = keccak of the CID string), keep the rich metadata (`commitData`, their "asset tree") off-chain and content-addressed, treat the chain as an append-only log of commits per asset, and let the first commit per CID define provenance ordering. Numbers' Nit CLI/Capture SDK show the UX (nid = CID; "nit log" = chronicle). Weakness for Stamper: anyone can `commit` any CID — it is a chronicle, not an authenticity claim; Stamper adds the *device signature* and the *storage binding*.
- **OpenTimestamps-style anchoring** [general knowledge]: hash many stamps into a Merkle tree and anchor only the root; each stamp gets an inclusion proof. Useful for Stamper only at scale (Filecoin fees make per-stamp txs affordable; batching helps throughput and keeps a single tx per epoch). Keep per-stamp events for indexability if you batch (emit `StampRegistered` per leaf or publish the leaf list to Filecoin and emit the root + CID).
- **ENS-style registry/resolver split** [general knowledge]: a minimal, non-upgradeable `StampRegistry` (who stamped what, when, signature, storage binding) and upgradeable `StampResolver`s for presentation/metadata (short-code mapping, C2PA manifest CID, takedown flags). Short code resolution lives in the resolver; the registry stays immutable, which is what "trust" needs.
- **EAS attestations**: the right abstraction (schema + attester + recipient + revocable + off-chain refUID) but **not deployed on Filecoin**; copying EAS's schema-registry idea (a `bytes32 schemaId` per stamp version) keeps the registry forward-compatible [verified absence; inferred advice].
- **FilOz FWSS** as a design reference [verified]: EIP-712 payer authorization with a nonce ledger (`clientNonces[payer][nonce]` packs state), session-key delegation via `SessionKeyRegistry`, metadata limited to small key/values, state exposed through a separate `StateView` contract to keep the main contract under the size limit, and an announced-upgrade pattern (`UpgradeAnnounced`/`nextUpgrade`) — all worth copying.

---

## 6. Recommended architecture for Stamper (contracts, relayer, tooling)

### 6.1 Contracts (Solidity 0.8.30, evm_version cancun, Foundry)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract StampRegistry /* immutable; no proxy */ {
    struct Stamp {
        bytes32 contentHash;    // sha256 of the original bytes
        bytes32 pieceCidHash;   // keccak256(PieceCID v2 bytes) as stored by PDPVerifier
        uint64  pieceSize;      // padded piece size
        uint64  capturedAt;     // device-claimed capture time (soft)
        uint64  registeredEpoch;// block.number at registration (hard; timestamp = genesis + 30*epoch)
        address signer;         // secp256k1 signer (or synthetic address for P-256 keys)
        bytes32 deviceKeyId;    // keccak(P-256 x||y) or 0 for secp256k1
        uint256 pdpSetId;       // 0 until bound
        uint256 pdpPieceId;
        uint8   keyType;        // 0=secp256k1, 1=P-256 raw, 2=WebAuthn, 3=EIP-1271
    }
    mapping(bytes32 stampId => Stamp) public stamps;
    mapping(address signer => mapping(uint256 nonce => bool)) public usedNonce;
    IPDPVerifier public immutable pdp;      // 0xBADd…557F on mainnet (behind a settable+timelocked slot if you prefer)
    IFWSSView   public immutable fwssView;  // 0xcf18…8172
    event StampRegistered(bytes32 indexed stampId, bytes32 indexed contentHash, address indexed signer, bytes32 pieceCidHash, uint64 pieceSize, uint64 capturedAt, uint8 keyType, bytes sig);
    event StorageBound(bytes32 indexed stampId, uint256 indexed setId, uint256 pieceId, address storageProvider);

    function registerStamp(StampClaim calldata c, bytes calldata sig) external {
        bytes32 digest = _hashTypedDataV4(_hashClaim(c));   // EIP-712 domain: name "Stamper", version "1", chainId, this
        address signer = _verify(c.keyType, digest, sig, c.pubkey); // ecrecover | P256VERIFY(0x0100) | EIP-1271
        require(block.timestamp <= c.deadline && !usedNonce[signer][c.nonce]);
        usedNonce[signer][c.nonce] = true;
        bytes32 stampId = keccak256(abi.encode(block.chainid, address(this), signer, c.contentHash, c.nonce));
        require(stamps[stampId].registeredEpoch == 0);
        stamps[stampId] = Stamp(c.contentHash, c.pieceCidHash, c.pieceSize, c.capturedAt, uint64(block.number), signer, c.deviceKeyId, 0, 0, c.keyType);
        emit StampRegistered(stampId, c.contentHash, signer, c.pieceCidHash, c.pieceSize, c.capturedAt, c.keyType, sig);
    }

    /// Anyone may bind; the contract re-derives trust from PDPVerifier state.
    function bindStorage(bytes32 stampId, uint256 setId, uint256 pieceId) external {
        Stamp storage s = stamps[stampId];
        require(s.registeredEpoch != 0 && s.pdpSetId == 0);
        require(pdp.dataSetLive(setId) && pdp.pieceLive(setId, pieceId));
        require(keccak256(pdp.getPieceCid(setId, pieceId).data) == s.pieceCidHash);
        (address sp,) = pdp.getDataSetStorageProvider(setId);
        s.pdpSetId = setId; s.pdpPieceId = pieceId;
        emit StorageBound(stampId, setId, pieceId, sp);
    }

    function storageStatus(bytes32 stampId) external view returns (bool bound, bool live, uint256 lastProvenEpoch, bool provenThisPeriod) { /* see §2.1 */ }
}
```
- `StampResolver` (upgradeable, owner = Stamper multisig/Safe): short code ↔ `stampId`, C2PA manifest CID, display metadata, dispute/takedown flags. Short code = base32 of the first 8–10 bytes of `stampId` with a 1-byte checksum; collisions handled by the resolver.
- Verification page logic (trustless path): resolve code → `stamps[id]` → fetch original by PieceCID from the SP / FilBeam → recompute sha256 and PieceCID → compare → show `storageStatus` → show inclusion epoch and finality state (§1.5) → re-verify the device signature from the `StampRegistered` event's `sig` with the public key.
- Register in two phases if you want the earliest possible time anchor: `registerStamp` right after capture (hash only; tiny tx), `bindStorage` once the upload is in a data set (minutes later) [inferred].
- Testing: Foundry fork tests against Calibration (`--fork-url https://api.calibration.node.glif.io/rpc/v1`) exercising real PDPVerifier state (data set 1 is live with 602k leaves); a wrapper contract for the `0x0100` precompile with the EIP-7951 vectors (the actors repo's `Secp256r1Precompile.sol` is a ready-made example). Note Foundry's local EVM lacks the 0x0100 precompile unless you mock it (`vm.etch` a stub or run the P-256 test only on fork/Calibration).

### 6.2 Relayer / backend

- Self-hosted **OpenZeppelin Relayer** (or a viem worker) with a KMS-held key; one relayer per environment; `eth_sendRawTransaction` through Glif (primary) and Ankr (failover); poll receipts with a 180-s budget and 2-epoch re-check for reorgs; alert when `finalized` lag > 60 epochs.
- Storage: `@filoz/synapse-sdk` 2.0.2 to deposit USDFC, approve the FWSS operator, create one data set per approved provider (two providers for redundancy), upload pieces with metadata `{stampId}`; read back `(setId, pieceId)` from the `PieceAdded` event and call `bindStorage`.
- Device enrolment: App Attest / Play Integrity verified server-side; the server records `deviceKeyId → attestation` off-chain (or as a resolver attestation) so "stamped by an attested device" is a claim the UI can show; keep the chain free of PII.

### 6.3 Indexing and read path

- Goldsky subgraph on `filecoin` + `filecoin-testnet` indexing `StampRegistered`, `StorageBound`, and PDPVerifier `PiecesRemoved`/`DataSetDeleted` + FWSS `FaultRecord`/`PDPPaymentTerminated` for the bound data sets; expose GraphQL to the website/app. Keep a Ponder (or Envio) deployment as the self-hosted fallback with `ethGetLogsBlockRange: 360`.
- For the verify page's "is the original still proven?" use direct `eth_call`s (Multicall3 `0xcA11…CA11` is deployed) rather than the indexer, so the answer is live and trustless.

### 6.4 Deployment checklist

- Calibration first (chain 314159, faucets §1.3, tUSDFC for storage), then mainnet; verify on Blockscout + Filfox; publish ABIs + addresses in the app with the chain id; pin `solc 0.8.30`, optimizer on, `evm_version = "cancun"`; `forge script --broadcast --skip-simulation --slow --retries 10`.
- Watch nv29 Solstice mainnet scheduling (Lotus v1.37.0 stable ~week of 2026-10-05) — nothing in FIP-0118 touches the EVM, but re-run the integration suite on upgrade day; watch Lotus ≥ 1.36.3 log-range tightening on providers.

---

## 7. Open questions / risks

1. **Mainnet F3**: why have no certificates been produced since instance 466453 (2026-03-09), and is a re-bootstrap planned (as was done for Calibration → `calibrationnet2`)? Ask in Filecoin Slack `#fil-fast-finality` / FilOz. Until then, finality UX must rely on FRC-0089 (`finalized` ≈ 20–30 epochs) and your own thresholds.
2. **P256VERIFY gas on FEVM** — unknown; measure via a wrapper on Calibration before choosing P-256 as the default key type.
3. **Glif/Ankr rate limits and paid tiers** — undocumented; budget for a dedicated node or paid plan (archival logs beyond ~2000 blocks are not guaranteed).
4. **Goldsky sponsorship** for Filecoin subgraphs ("covered for approved developers") — confirm eligibility; otherwise price the plan or self-host Ponder.
5. **PieceCID v2 encoding** (FRC-0069 Draft) vs what `PDPVerifier.getPieceCid` returns for pieces added via `addPieces` in 3.5.0 (`Cids.Cid.data` bytes vs `PackedCid`) — fix with a fork test before freezing `pieceCidHash` semantics.
6. **Provider selection**: FWSS `isProviderApproved`/endorsement set; pick ≥ 2 approved SPs and test retrieval latency (FilBeam CDN for the "serve the original" page).
7. **Upgradeability of FilOz contracts**: PDPVerifier/FWSS are proxies in beta; read addresses from a timelocked slot and listen for `UpgradeAnnounced`/`ContractUpgraded`.
8. **Device key UX**: hardware-bound P-256 vs app-sandbox secp256k1; decide after measuring (2), and whether passkeys (cross-device) are needed for web capture.

---

## Sources

Filecoin docs
- https://docs.filecoin.io/networks-and-tools/networks/mainnet/rpcs.md
- https://docs.filecoin.io/networks-and-tools/networks/calibration/rpcs.md
- https://docs.filecoin.io/networks-and-tools/networks/calibration.md
- https://docs.filecoin.io/networks-and-tools/networks/mainnet/explorers.md
- https://docs.filecoin.io/networks-and-tools/networks/calibration/explorers.md
- https://docs.filecoin.io/build-on-filecoin/advanced/fevm-indexers.md
- https://docs.filecoin.io/build-on-filecoin/development-frameworks/foundry.md
- https://docs.filecoin.io/build-on-filecoin/development-frameworks/hardhat.md
- https://docs.filecoin.io/core-concepts/filecoin-evm-runtime/how-gas-works.md
- https://docs.filecoin.io/core-concepts/filecoin-evm-runtime/precompiles.md
- https://docs.filecoin.io/build-on-filecoin/developing-contracts/best-practices.md
- https://docs.filecoin.cloud/getting-started/
- https://lotus.filecoin.io/lotus/configure/defaults/

Protocol / FIPs / Lotus / actors
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FIPS/fip-0086.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FIPS/fip-0112.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FIPS/fip-0113.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FRCs/frc-0069.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FRCs/frc-0089.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/README.md
- https://github.com/filecoin-project/lotus/releases/tag/v1.34.0
- https://github.com/filecoin-project/lotus/releases/tag/v1.36.0
- https://github.com/filecoin-project/lotus/releases/tag/v1.36.1
- https://github.com/filecoin-project/lotus/releases/tag/v1.36.2
- https://github.com/filecoin-project/lotus/releases/tag/v1.36.3
- https://github.com/filecoin-project/lotus/issues/13760 (v1.37.0 / nv29 Solstice release thread)
- https://raw.githubusercontent.com/filecoin-project/lotus/master/CHANGELOG.md
- https://raw.githubusercontent.com/filecoin-project/lotus/master/build/buildconstants/params_mainnet.go
- https://raw.githubusercontent.com/filecoin-project/lotus/master/build/buildconstants/f3manifest_mainnet.json
- https://raw.githubusercontent.com/filecoin-project/lotus/master/build/buildconstants/f3manifest_calibnet.json
- https://github.com/filecoin-project/go-f3 (README), https://github.com/filecoin-project/go-f3/releases
- https://github.com/filecoin-project/go-f3/issues/1054 , https://github.com/filecoin-project/go-f3/issues/1056
- https://api.github.com/repos/filecoin-project/builtin-actors/releases
- https://github.com/filecoin-project/builtin-actors/pull/1708 (+ /files)
- https://raw.githubusercontent.com/filecoin-project/builtin-actors/master/actors/evm/src/interpreter/instructions/mod.rs
- https://raw.githubusercontent.com/filecoin-project/builtin-actors/master/actors/evm/src/interpreter/precompiles/mod.rs
- https://raw.githubusercontent.com/filecoin-project/builtin-actors/master/actors/evm/src/interpreter/precompiles/secp256r1.rs
- https://raw.githubusercontent.com/filecoin-project/builtin-actors/master/actors/evm/tests/contracts/Secp256r1Precompile.sol
- https://eips.ethereum.org/EIPS/eip-7951
- https://github.com/filecoin-project/community/discussions/74

FilOz services (PDP / Warm Storage / Pay / Synapse / Session keys)
- https://github.com/FilOzone/pdp
- https://raw.githubusercontent.com/FilOzone/pdp/main/src/PDPVerifier.sol
- https://github.com/FilOzone/filecoin-services
- https://raw.githubusercontent.com/FilOzone/filecoin-services/main/service_contracts/deployments.json
- https://raw.githubusercontent.com/FilOzone/filecoin-services/main/service_contracts/src/FilecoinWarmStorageService.sol
- https://raw.githubusercontent.com/FilOzone/filecoin-services/main/service_contracts/src/FilecoinWarmStorageServiceStateView.sol
- https://raw.githubusercontent.com/FilOzone/filecoin-services/main/.gitmodules
- https://github.com/FilOzone/filecoin-pay , https://raw.githubusercontent.com/FilOzone/filecoin-pay/main/CHANGELOG.md
- https://github.com/FilOzone/SessionKeyRegistry , https://raw.githubusercontent.com/FilOzone/SessionKeyRegistry/main/src/SessionKeyRegistry.sol
- https://github.com/FilOzone/filecoin-pay-explorer
- https://registry.npmjs.org/@filoz/synapse-sdk/latest , https://raw.githubusercontent.com/FilOzone/synapse-sdk/main/README.md

filecoin-solidity
- https://raw.githubusercontent.com/filecoin-project/filecoin-solidity/master/README.md
- https://api.github.com/repos/filecoin-project/filecoin-solidity/releases
- https://registry.npmjs.org/filecoin-solidity-api/latest
- https://docs.zondax.ch/fevm/filecoin-solidity/api/actors/Market (older Zondax docs; API shapes)
- https://api.github.com/repos/Zondax/filecoin-solidity/releases (stale 2023 releases)

Tooling kits / libraries
- https://raw.githubusercontent.com/filecoin-project/fevm-foundry-kit/main/README.md , https://raw.githubusercontent.com/filecoin-project/fevm-foundry-kit/main/foundry.toml
- https://raw.githubusercontent.com/filecoin-project/fevm-hardhat-kit/main/README.md , https://raw.githubusercontent.com/filecoin-project/fevm-hardhat-kit/main/hardhat.config.ts
- https://registry.npmjs.org/@openzeppelin/contracts/latest
- https://github.com/OpenZeppelin/openzeppelin-relayer
- https://github.com/daimo-eth/p256-verifier

AA / relayers / attestations
- https://docs.pimlico.io/guides/supported-chains
- https://api.github.com/repos/ethereum-attestation-service/eas-contracts/contents/deployments
- https://thirdweb.com/filecoin , https://thirdweb.com/filecoin---calibration-testnet

Indexing
- https://docs.goldsky.com/chains/filecoin , https://docs.goldsky.com/chains/supported-networks
- https://thegraph.com/docs/en/supported-networks/
- https://envio.dev/chains/filecoin
- https://docs.sqd.dev/subsquid-network/reference/networks/
- https://ponder.sh/docs/config/chains

Registry references
- https://eips.ethereum.org/EIPS/eip-7053
- Numbers Protocol docs (search results): https://docs.captureapp.xyz/capture-sdk/asset-signature-verification/ , https://numbersprotocol.io/blog/erc-7053-transforming-digital-media-provenance-for-the-modern-web

Live probes (2026-09-30 → 2026-10-01; scripts in the scratchpad `research/probe*.sh`)
- JSON-RPC: https://api.node.glif.io/rpc/v1 , https://api.calibration.node.glif.io/rpc/v1 , https://rpc.ankr.com/filecoin , https://rpc.ankr.com/filecoin_testnet , https://api.zondax.ch/fil/node/mainnet/rpc/v1 , https://filecoin.drpc.org , https://filecoin.chainup.net/rpc/v1 (failed) , https://filecoin.lava.build (discontinued)
- Explorers/APIs: https://filecoin.blockscout.com/api/v2/stats , https://filecoin-testnet.blockscout.com/api/v2/stats , https://filecoin.blockscout.com/api/v2/smart-contracts/verification/config , https://filfox.info/api/v1/tipset/recent , https://calibration.filfox.info/api/v1/tipset/recent , https://filfox.info/api/v1/message/<hash> , https://beryx.zondax.ch , https://api.node.glif.io/graph (redirect)
- Price: https://api.coingecko.com/api/v3/simple/price?ids=filecoin&vs_currencies=usd
