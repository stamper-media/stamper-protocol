# Critique — Filecoin / FOC / FEVM feasibility of the three Stamper proposals

Critic lens: can each FOC, Synapse SDK and FEVM claim work with `@filoz/synapse-sdk@2.0.2` / `@filoz/synapse-core@0.10.0` and the deployed FWSS 1.4.0 / PDPVerifier 3.5.0 contracts, as they exist on 2026-10-01? Sources: `VERIFIED-SDK-FACTS.md`, `filecoin-storage.md`, `fevm-contracts.md`, `app-stack.md`, plus my own reads of the installed packages under `node_modules` and of the PDPVerifier 3.5.0 / `Cids.sol` sources in `research/src`, and three live `cast call`s against mainnet. Where a proposal and a research report disagree, I state which is right and why.

## 0. New facts established during this review (override earlier notes where they conflict)

1. **`findPieceIdsByCid` is a linear storage scan.** PDPVerifier 3.5.0 `_findCompactPieceIdsByCid` loops `for (i = startPieceId; i < pieceCount && count < limit; i++)` reading `compactPieces[setId][i]` (root + packed metadata + leaf count) on every iteration. Called with `startPieceId = 0` on a data set holding N pieces it costs O(N) cold SLOADs. On FEVM, where a modest PDP transaction already burns 100–900 M gas, a scan over a 100k-piece Stamper data set will not fit in a 10 B-gas message and will also exceed public gateways' `eth_call` budgets. The only O(1) use is `findPieceIdsByCid(setId, cid, pieceId, 1)` (start at the known id; the loop exits on the first hit). `VERIFIED-SDK-FACTS.md` §"Trustless storage check" recommends `findPieceIdsByCid(setId, cid, 0, 1)`; that recommendation is wrong for anything but tiny data sets.
2. **The FWSS StateView is replaceable and discoverable.** `cast call <FWSS proxy> "viewContractAddress()(address)"` on mainnet returns `0xcf184Ab1…8172` today; `filecoin-storage.md` §1.4 says the view is "immutable but replaceable". A Stamper registry that hard-codes the StateView as a constructor `immutable` will break (or, worse, brick a write path) the day FilOz publishes a new view.
3. **Live pricing = the docs figures, not the README figures in VERIFIED-SDK-FACTS.** `getPriceList()` on mainnet StateView decodes to: storage 2.5 USDFC/TiB/month, **data-set fee 0.12 USDFC/month**, data-set creation 0.025, **add-pieces 0.008 + 0.003/piece**, removal scheduling 0.007, termination 0.006, **lifecycle reserve 0.5 USDFC** (replenish threshold 0.025), CDN rates 7/7, CDN lockups 0.7 + 0.3. The "0.024 / 0.0005 + 0.0003 / 0.10 reserve" numbers in `VERIFIED-SDK-FACTS.md` §Pricing are stale.
4. **Piece metadata limits in the SDK:** `METADATA_LIMITS = { MAX_KEY_LENGTH: 32, MAX_VALUE_LENGTH: 96, MAX_KEYS_PER_DATASET: 10, MAX_KEYS_PER_PIECE: 3 }` — 3 keys, 96-byte values; the SDK throws before the SP is even contacted.
5. **`Synapse.create({ requiredPermissions })` takes `Permission[]`** = the `bytes32` typehash constants exported from `@filoz/synapse-core/session-key` (`AddPiecesPermission`, …), checked against `sessionKey.hasPermission()`; it is not a string array. `login(client, { address, permissions?, expiresAt?, origin?, contractAddress? })` is the real signature.
6. **`StorageContext.commit()` with no `dataSetId` silently falls into `createDataSetAndAddPieces`,** signed by `sessionClient ?? client`. An AddPieces-only session key therefore fails the first time a context resolves to a provider without an existing data set. `presignForCommit()` exists so a *secondary* SP can pull from the primary and commit with a pre-signed `AddPieces`/`CreateDataSetAndAddPieces` typed-data blob (`pull({ extraData })`); it is not a device-signing mechanism.
7. **SP upload endpoints carry no auth header** in `sp/upload.js` (`POST pdp/piece {pieceCid}` → `PUT pdp/piece/upload/{uuid}` with only `Content-Type/Length`), and a streaming variant exists (`POST pdp/piece/uploads`, `PUT …/uploads/{uuid}`, `POST …/uploads/{uuid}` finalize). So "the phone uploads bytes to the SP and the server commits" is protocol-plausible; whether SPs rate-limit or GC anonymous uploads is still unverified.
8. **FilBeam URL builder:** `createPieceUrlFilBeam` → `https://{payer}.filbeam.io/{cid}` (no `/piece/` segment).
9. **`@filoz/synapse-core/piece` is not a leaf module.** Its `index.js` re-exports `download.js` and `resolve-piece-url.js`, which import `warm-storage/get-pdp-data-sets`, `p-locate`, `p-some`, `iso-web`, viem actions and the full generated ABI. The hasher itself (`internal/hasher.js`) uses only `sync-multihash-sha2` and `multiformats` `varint` (pure JS, no WebCrypto). On Hermes the subpath will *likely* bundle, but it drags the SDK's whole read layer with it and Metro cannot deep-import `calculate.js` because `package.json#exports` only exposes `./piece`. Plan the week-1 spike exactly as the proposals say; do not call it "Hermes-safe" yet.
10. **`forge test --odyssey` exists in forge 1.3.5** ("Whether to enable Odyssey features"), so the RIP-7212 `0x100` precompile is available in revm for local P-256 tests.
11. **ABI coverage:** `pieceLive`, `getDataSetLastProvenEpoch`, `pieceChallengable`, `provenPeriods`, `provingActivationEpoch`, `nextPDPChallengeWindowStart`, `setDataSetAuthorizer`, `viewContractAddress`, `PiecesAddedV2`, `FaultRecord`, `PDPPaymentTerminated` are all in `synapse-core/abis/generated.js`. `hasBeenProvenRecently` is **not** in the ABI (consistent with the fork probe where it reverted). Live mainnet `getPDPConfig()` = `(2880, 60, 5, 6419794)`.

---

## 1. Proposal: trustless-first

### What is right
- Keeping the Synapse SDK off the phone and running only the PieceCID hasher there matches the SDK's documented platforms (Node/browser). Signing the full PieceCID on device (no deferral) is the correct choice for a registry whose storage check is `getPieceCid == claim.pieceCid`.
- Storing `pieceCid` as raw bytes, `sig` and `authData` in **state** (not only in events) is the only design of the three where the CLI's "chain + Filecoin only" promise survives public RPCs' ~2,000-block history guarantee. The other two need an archival node or Blockscout to re-verify a signature.
- `bindStorage` checks `getPieceCid` equality and `pieceLive`, and does not require `listener == FWSS`, so a user-run bare PDPVerifier data set can be bound; `storageStatus` reads the StateView only when `listener == FWSS`. That is coherent, provided the UI distinguishes "bound" from "paid-and-proven".
- The `included → safe → final` policy and the F3-stall caveat match `fevm-contracts.md` §1.5 exactly. `block.timestamp = genesis + 30·E` is used correctly.
- Session-key custody (cold payer, hot session key) is the FilOz-sanctioned model; `prepare()` → `depositWithPermitAndApproveOperator` is the real API.
- `--odyssey` + `vm.etch` of the daimo verifier as a second oracle is a sound test plan.

### Flagged
1. **`bindStorage` default hint = `findPieceIdsByCid(setId, cid, 0, 1)` (§4.3).** Per fact 0.1 this is O(N) and will revert out of gas once the data set has more than a few thousand pieces; it is also the path the "community re-pin" story relies on. Correct mechanism: require `pieceId` (the worker knows it from `commit().pieceIds` / `onPiecesConfirmed`), check `pieceLive(setId, pieceId)` and `keccak256(getPieceCid(setId, pieceId).data) == keccak256(s.pieceCid)`, both O(1). Off-chain binders learn their `pieceId` from the `PiecesAddedV2` log or the SP status URL. Keep `findPieceIdsByCid(setId, cid, pieceId, 1)` only as an optional consistency check.
2. **`FWSS_VIEW` as an `immutable` (§4.1).** Fact 0.2: resolve it at call time via `IFWSS(FWSS).viewContractAddress()` (one extra staticcall in `storageStatus`), or move StateView reads off-chain entirely (Multicall3 from the verify page) and keep the registry dependent on the PDPVerifier proxy only. Because `bindStorage` here depends only on PDPVerifier, nothing bricks; only `storageStatus` goes stale, but the fix is a one-liner.
3. **Session key granted `CreateDataSetPermission` for 30 days (§5.1).** Not needed after the two data sets exist and it widens the VPS-compromise blast radius: each `createDataSetAndAddPieces` locks 0.5 USDFC lifecycle reserve + 0.025 fee + 0.12/month from the cold payer's deposit. Correct mechanism (as security-ops does): create data sets once from the root account, pin `dataSetIds` in config, grant the session key `[AddPiecesPermission]` only and pass `requiredPermissions: [AddPiecesPermission]`.
4. **Cost table (§5.5) treats the lower README figures as "verified".** Fact 0.3: budget with 0.12 USDFC/data-set/month, 0.011 per single-piece `addPieces`, 0.5 USDFC reserve per data set. The per-stamp number becomes ≈ 0.02 USDFC one-time, dominated by piece fees, as product-first and security-ops already state.
5. **Two full `store()`s from the VPS per piece (§5.2 MVP).** Works, but it uploads every byte twice from one VPS and skips the SDK's SP-to-SP `pull`. If egress matters, use `createContexts({ copies: 2, dataSetIds })` → `primary.store` → `secondary.presignForCommit` → `secondary.pull({ from: cid => primary.getPieceUrl(cid), extraData })` → `primary.commit`. The proposal's reason for the split pipeline (register on chain before commit, deterministic `pieceIds`) is valid either way.
6. **Strictly increasing nonce per key (`c.nonce > k.lastCounter`) vs the offline queue (§7.5).** Receipts land next tipset and the relayer is concurrent; if claim #2 of an offline batch lands before #1, #1 is unregistrable forever. Either serialize per key in the relayer (fragile) or use a `usedNonce[keyId][nonce]` bitmap as product-first does, keeping the App Attest counter check as a separate strict inequality.
7. **`storageStatus` as one monolithic on-chain view** (≈ 10 external calls per binding, up to N bindings) may exceed gateway `eth_call` gas caps on FEVM. Prefer per-binding views and Multicall3 from the client.
8. Minor: `getDataSetLastProvenEpoch` and `getPieceCid` **revert** when `dataSetLive == false` (`require(dataSetLive(setId), DataSetNotLive())`), so `storageStatus` must short-circuit on `dataSetLive` before calling them or the whole view reverts once any bound set dies. Same for `findPieceIdsByCid`.
9. Piece metadata `{stamp, role, sha256}` = exactly 3 keys with values ≤ 64 chars: fits (3 keys / 96 B). Data-set key `withCDN` on data set B only: fine. The direct-to-SP upload spike (§5.2 v1) is correctly listed as unverified; fact 0.7 says the HTTP protocol has no client auth, so the spike is about SP policy, not the SDK.

### Score: 7.5 / 10
Best trustlessness story and the only one whose independent CLI works from state alone, but it ships an O(N) scan on its default bind path and the stale fee table; both are easy fixes.

---

## 2. Proposal: product-first

### What is right
- `upload({ pieceCid, copies: 2, providerIds, pieceMetadata, callbacks: { onPiecesConfirmed } })` is the real API shape (`UploadOptions extends StoreOptions`, `onPiecesConfirmed(dataSetId, providerId, PieceRecord[])`). Using `onPiecesConfirmed` to enqueue `bindStorage` with a known `pieceId` is correct.
- Pricing (§5.5) uses the live figures. Piece batching with `limiter` + `flush()` is a real option.
- `bindStorage` uses `getPieceCid(setId, pieceId)` (O(1)) and requires `getDataSetListener == fwss` — correct and cheap.
- FilBeam first for `withCDN` sets, then provider `/piece`, then mirror, always re-hashing: matches `filecoin-storage.md` §1.9/§4.
- Finality policy and the `finality-tracker` job match the research. Receipt polling ≥ 120 s is right.
- The note that `pieceLive`/`getDataSetLastProvenEpoch` are "not in the SDK-verified list" is over-cautious: both are in `generated.js` (fact 0.11); use them on chain.

### Flagged
1. **Permissionless `bindStorage` fixes a deferred `pieceCid` (§4.1 line `if (s.pieceCid.length == 0) s.pieceCid = cid`).** For video the claim carries an empty `pieceCid` and *anyone* may bind. Between `registerStamp` (seconds after capture) and Stamper's bind (minutes later), any party can bind any live FWSS piece they control as the stamp's "original"; bindings are append-only and the CID is then fixed forever. The verify page will show a sha256 mismatch, but the chain record is permanently poisoned and the real original can never be bound. This is a must-fix. Correct mechanisms, in order of preference: (a) do not defer — the API has native crypto; `Piece.calculate` of a 500 MB file in Node takes seconds, so compute `pieceCid` server-side, return it to the device, have the device sign the complete claim, then relay (adds seconds, not minutes); (b) if deferral is kept, make the CID fixing an authenticated step — `fixPieceCid(stampId, pieceCid, sig)` with a device-key signature over `PieceCidAttestation(stampId, pieceCid)` — and have `bindStorage` require a non-empty `pieceCid`.
2. **`requiredPermissions: ['AddPieces']` (§5.1) is the wrong type** (fact 0.5) and, more importantly, **AddPieces-only + `upload({copies: 2, providerIds})` fails on first contact with a provider that has no data set yet** (fact 0.6: `commit()` falls into `createDataSetAndAddPieces`, which needs `CreateDataSetPermission`). Correct mechanism: create the two data sets once from the payer (or a short-lived session key with `CreateDataSetPermission`), then run the worker with `dataSetIds: [A, B]` and `requiredPermissions: [AddPiecesPermission]`.
3. **`storageStatus` uses `findPieceIdsByCid(setId, cid, 0, 1)` for `stillThere`** (§4.1). Fact 0.1: O(N). Use `pieceLive(setId, pieceId) && keccak256(getPieceCid(...).data) == keccak256(s.pieceCid)`; if you want to detect a *re-added* piece after removal, call `findPieceIdsByCid(setId, cid, pieceId, 1)` only.
4. **`fwssView` as an `immutable`** (§4.1): see fact 0.2; `bindStorage` does not depend on it, so it only degrades `storageStatus`, but resolve via `viewContractAddress()` anyway.
5. **Signature re-verification needs the event, not state.** `Stamp` stores no `sig`; `verifyClaim` is a pure re-check you can only feed from a `StampRegistered` log. With public RPCs guaranteeing ~2,000 blocks and `eth_getLogs` capped at 360 epochs, "re-checkable offline forever" depends on an archival node, Goldsky or Blockscout. Either store `sig`/`authData` in state (≈ 3 extra slots; FEVM storage is cheap) or state the dependency on the verify page and in the CLI.
6. **`withCDN: true` on the primary data set holding originals** means every original download via FilBeam is metered egress (7–14 USDFC/TiB) and the data set carries 0.7 + 0.3 USDFC CDN lockups. The proposal already routes originals "on explicit click"; fine, but note that FilBeam eligibility is per data set, so originals and share copies in one CDN set cannot be metered separately.
7. **Secondary copies via SP-to-SP pull require the secondary to be an approved provider that supports pull;** when you pin `providerIds`, confirm both support it (the SDK's default selection does this for you).
8. **Piece metadata `{stampId (66 chars), kind, sha256 (64 chars)}`**: 3 keys, values ≤ 96 — fits, barely; do not add a fourth key.
9. ERC-7053 `Commit` emitted with `assetCid = PieceCID text` is fine; note `_cidString` must base32-encode on chain (not trivial; consider emitting the hex multibase `f…` form instead).

### Score: 6 / 10
The SDK call shapes are the most accurate of the three and the fee maths is right, but the deferred-CID poisoning bug and the AddPieces-only/implicit-data-set-creation mismatch would both surface in the first week on Calibration.

---

## 3. Proposal: security-ops

### What is right
- **Session-key handling is the most correct of the three:** data sets created once from the root account, `dataSetIds` pinned in config, session key with `[AddPiecesPermission]` only, 7-day expiry, and the explicit statement that `presignForCommit` is not needed when one worker both stores and commits (true for the MVP path; see fact 0.6 for what presign is actually for).
- `findPieceIdsByCid(setId, pieceCid, pieceId, 1)` with `ids[0] == pieceId` is the O(1) form (fact 0.1). Requiring `getDataSetListener == FWSS`, `dataSetLive` and `pdpEndEpoch == 0` at bind time is a tight definition of "stored".
- Pricing (§5.6) matches the live price list; four data sets × 0.12 USDFC/month + 4 × 0.5 USDFC reserve is budgeted.
- Retrieval order, re-hashing, FilBeam 402 handling and monitoring via `FaultRecord`/`PiecesRemoved`/`DataSetDeleted`/`PDPPaymentTerminated`/`ServiceTerminated` are all real events in the ABI.
- Honest about public-RPC history limits (the CLI accepts the user's evidence bundle).

### Flagged
1. **`bindStorage` reverts forever if the StateView moves.** `require(FWSS_VIEW.getDataSet(setId).pdpEndEpoch == 0)` is inside a write path of an immutable, ownerless contract, and `FWSS_VIEW` is a constructor `immutable`. Fact 0.2: the view is replaceable; the day FilOz publishes a new one, `getDataSet` on the old address may revert or return stale data and *no stamp can ever be bound again*. This is a must-fix. Correct mechanism: read the view through `IFWSS(FWSS).viewContractAddress()` at call time (the FWSS proxy address is the stable one), or drop the StateView dependency from `bindStorage` (PDPVerifier `dataSetLive` + `getDataSetListener == FWSS` already imply an FWSS-managed, un-deleted set) and leave `pdpEndEpoch` to the off-chain status page.
2. **Permissionless `bindStorage` fixes a deferred `pieceCidHash`** (`if (s.pieceCidHash == 0) s.pieceCidHash = h`). Same poisoning bug as product-first; the proposal even notes "shown as piece identity asserted by binder" without noticing that the binder can be anyone. Must-fix; same remedies as product-first §2.1.
3. **PieceCID stored only as `keccak256(cidBytes)`** in `Stamp`. The raw CID bytes appear only in the `StorageBound` event and `bindStorage` calldata. An independent verifier that has only `eth_call` cannot learn *which* piece to download; it needs logs (archival/Blockscout) or Stamper's bundle. For a stamp that is registered but not yet bound, nothing on chain names the piece at all. Correct mechanism: store the three components `(bytes32 root, uint8 height, uint64 padding)` — they pack into the existing partial slot plus one word — and reconstruct the CID with `Cids.CommPv2FromDigest` logic client-side, or just store the ≈ 36–40-byte `bytes`. The gas saved by hashing is irrelevant on FEVM.
4. **`_noNeighbour(code)` = 248 cold SLOADs per registration** (§4.3). On FEVM each cold SLOAD is an IPLD state read charged by Wasm instrumentation; the proposal's own estimate (30–120 M gas) is likely low by a large factor, and the check buys nothing the off-chain `codeIsFree` pre-check does not already give (the app has already ground the nonce against `codeIsFree`). Keep `stampByCode[code] == 0` on chain, keep the neighbour rule in the app/API, and measure before deciding otherwise.
5. **`StampRegistered` carries `sig` and `authData` only in the event;** see product-first §2.5 for the history-availability consequence. The proposal is honest about it (CLI accepts the evidence bundle), but it contradicts "everything a verifier needs is in the logs" when the logs are not served.
6. **`getPieceCid`/`getDataSetLastProvenEpoch`/`findPieceIdsByCid` revert on dead sets** (fact 0.1's source: `require(dataSetLive(...))`). `storageStatus` must check `dataSetLive` first per binding, else one dead binding reverts the aggregate view.
7. **Four data sets at two providers**: supported (FWSS allows several data sets per payer per provider; `clientDataSets(payer)` is an array). But `upload({ copies: 2, dataSetIds: [origA, origB] })` requires `origB`'s provider to accept SP-to-SP pull from `origA`'s provider; confirm when pinning providers.
8. Session-key `login` call shape: the proposal writes `login(signer, expiry, [AddPiecesPermission], origin)`; the SDK signature is `login(client, { address, permissions, expiresAt, origin })` (fact 0.5). Cosmetic.
9. Piece metadata `{ 'stamper.stamp': 0x…(66), 'stamper.role' }`: 2 keys, fits.

### Score: 6.5 / 10
Operationally the soundest FOC integration (payer/session-key split, pinned data sets, O(1) CID check, correct fees), undermined by two contract-level defects that an immutable registry cannot recover from: the StateView `immutable` inside `bindStorage` and the permissionless deferred-CID fix.

---

## 4. Cross-cutting

### 4.1 SDK platform support
All three correctly keep `@filoz/synapse-sdk` on Node (worker) and in the browser (verify page / wallet self-custody). None puts the SDK on React Native. The residual risk is the same in all three: `@filoz/synapse-core/piece` on Hermes (fact 0.9). It is pure JS, but the barrel pulls the whole read layer; a Metro `exports` resolution + bundle-size spike is required before the API contract "device signs PieceCID" is frozen. Fallback (already in trustless-first and security-ops): a ~150-line fr32 tree hasher over `react-native-quick-crypto` SHA-256 — the tree is simple (127-byte quads → 128 bytes → sha256 pairs → root), and the on-chain `Cids.sol` encoding is pinned.

### 4.2 Who signs and pays
The SP relays and pays gas for `addPieces`/`createDataSetAndAddPieces`; the payer (or an authorized session key) signs EIP-712; the payer's Filecoin Pay account is debited. All three have this right at the architecture level. Only security-ops has it right at the API level (pinned `dataSetIds`, AddPieces-only key). The final design should take security-ops §5.1–5.3 verbatim and fix product-first's `requiredPermissions` type and trustless-first's over-broad permission set.

### 4.3 store / presignForCommit / commit
- `store(data, { pieceCid })`: the SP verifies the CID (verified in the storage report; the SDK also polls `findPiece` until the SP confirms). Uploading precomputed-CID bytes from the worker is correct in all three.
- `commit({ pieces })` returns `pieceIds` (from the SP's confirmation) and `dataSetId`; use these for `bindStorage`. All three do.
- `presignForCommit` is for the pull flow (fact 0.6). Product-first's "right tool when the signer is not the uploader" is half-right; trustless-first's v1 "phone uploads to SP, worker commits with session key" needs no presign at all — it needs the unauthenticated SP upload (fact 0.7) plus the worker's `commit`.

### 4.4 PieceCID v2 in Solidity
`Cids.Cid { bytes data }` is the raw CIDv1 (`0x01 0x55 0x91 0x20 | uvarint(mhLen) | uvarint(padding) | height | root32`); `PiecesAddedV2` emits `PackedCid { bytes32 header, bytes32 root }` instead. All three compare `keccak256(getPieceCid(...).data)` against the registered bytes, which is correct; only security-ops registers a hash instead of bytes (flagged). `Cids.validateCommPv2` is the authoritative validator — product-first's `_isPieceCidV2` should copy it (prefix, minimal uvarints, `mhLength >= 34`). Pinning a Calibration fork-test vector before mainnet (all three say so) remains right because FRC-0069 is a Draft.

### 4.5 PDPVerifier / FWSS view semantics and gas
- O(1) checks: `dataSetLive`, `pieceLive`, `getPieceCid`, `getDataSetListener`, `getDataSetStorageProvider`, `getDataSetLastProvenEpoch`, `getNextChallengeEpoch`; StateView `provenThisPeriod`, `provingDeadline`, `getDataSet`, `provenPeriods(id, period)`. O(N): `findPieceIdsByCid` from 0, `getActivePieces` pages. Never put an O(N) call in a transaction path.
- Several PDPVerifier getters revert on dead sets; order checks accordingly.
- `hasBeenProvenRecently`: absent from the ABI and reverted on the deployed view; all three avoid it — keep it that way.
- FEVM external calls are expensive relative to Ethereum; on-chain `storageStatus` aggregators should be per-binding views, with Multicall3 (`0xcA11…CA11`, deployed on both networks) doing the fan-out from the client.
- `P256VERIFY` (`0x0100`): live since nv28, EIP-7951 semantics, empty output on failure, high-s not rejected, not callable at top level. All three handle it identically and correctly; the gas is unmeasured in all three and must be the first Calibration experiment. `--odyssey` (fact 0.10) covers local tests.

### 4.6 Finality, timestamps, receipts
All three adopt the `included → safe (≥ 30 epochs) → final (FRC-0089 `finalized` tag or ≥ 900 epochs)` policy and acknowledge the mainnet F3 stall; `block.timestamp = genesis + 30·E` is used as the hard time anchor. Correct. The relayer must tolerate next-tipset receipts (≥ 120 s), re-check 2 epochs for head reorgs, and never promise seconds.

### 4.7 RPC limits and indexing
Ponder with `ethGetLogsBlockRange: 360` and Goldsky as the hosted alternative are both correct. The verify page in all three uses `eth_call` only — correct. The remaining difference is whether the *signature* and the *PieceCID* live in state (trustless-first) or only in logs (the other two); given the 2,000-block history guarantee on public gateways, state is the only option that keeps the "no Stamper needed" promise without an archival node.

### 4.8 Retrieval
Provider `{serviceURL}/piece/{cid}` resolved on chain (`getDataSet(setId).providerId` → `ServiceProviderRegistry`), FilBeam `https://{payer}.filbeam.io/{cid}` for `withCDN` sets (402 on quota), Stamper mirror last, re-hash always: all three agree and all three are right. Calibration storage is not persistent, so MVP demos on Calibration must expect pieces to vanish.

### 4.9 Complexity that is not needed
- Trustless-first: full `StorageBinding` with `listener`/`provider` snapshots (fine), but `registerDerivative` with its own EIP-712 scheme and `stampByDerivativeHash` is a second signed-claim system; product-first's single registrar-attached `derivedHash` or security-ops' resolver event achieve the same lookup with less contract surface.
- Security-ops: the 248-SLOAD neighbour check and the "shard a data set at 200k pieces" rule (leaf count is irrelevant to challenge sampling cost for the client; the SP pays proving gas).
- Product-first: a timelocked registrar set inside the "immutable" registry is an admin surface the other two avoid; acceptable, but then the resolver split is redundant.

---

## 5. Must-fix list for the merged design
1. Never call `findPieceIdsByCid` with `startPieceId = 0` on chain (trustless-first `bindStorage` default; product-first `storageStatus`); use `pieceLive` + `getPieceCid`, or `findPieceIdsByCid(setId, cid, pieceId, 1)`.
2. Do not pin the FWSS StateView as an `immutable` in any write path (security-ops `bindStorage`), and preferably not at all; resolve through `FWSS.viewContractAddress()` or read the view off-chain.
3. Do not let a permissionless `bindStorage` fix a deferred PieceCID (product-first, security-ops); compute the PieceCID server-side before the device signs, or require a device-signed `fixPieceCid`.
4. Session key: AddPieces-only, data sets pre-created from the payer, `dataSetIds` pinned, `requiredPermissions: [AddPiecesPermission]` (fix product-first's string array and trustless-first's `CreateDataSet` grant).
5. Budget with the live price list (0.12/data set/month, 0.008 + 0.003/piece, 0.5 reserve); correct trustless-first §5.5 and `VERIFIED-SDK-FACTS.md` §Pricing.
6. Keep `pieceCid` bytes and the device signature in contract state (trustless-first already does) so verification works from `eth_call` alone; security-ops' hash-only CID and product-first's event-only `sig` must change.
7. Guard every PDPVerifier getter with `dataSetLive` first; they revert on dead sets.
8. Treat `@filoz/synapse-core/piece` on Hermes as a spike with a native-hasher fallback, not as a settled fact.

## 6. Ideas worth grafting into the final design
- From trustless-first: state-resident `sig`/`authData`/`pieceCid`; stampId = EIP-712 digest; permissionless `bindStorage` that re-derives trust from PDPVerifier only; `--odyssey` + daimo `vm.etch` dual oracle; monitoring of `provenPeriods` history per copy.
- From security-ops: payer/session-key split with pinned `dataSetIds` and AddPieces-only scope; `getDataSetListener == FWSS` + `dataSetLive` at bind; O(1) `findPieceIdsByCid(…, pieceId, 1)` cross-check; `ServiceTerminated`/`PDPPaymentTerminated` subscriptions; honest "what breaks first" list.
- From product-first: `upload({ copies: 2, providerIds, pieceMetadata, callbacks.onPiecesConfirmed })` as the MVP call; `usedNonce` bitmap (order-independent offline claims); live price list in the cost table; registering before the FOC commit for the earliest time anchor.
