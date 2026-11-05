# Stamper — Architecture Decision Records

Format per ADR: context, options considered, decision, consequences. Status is **Accepted** unless noted. Dates are 2026-10-01. "Immutable" below means the `StampRegistry` cannot be changed after deployment, so chain-touching decisions are final for a registry version.

---

## ADR-001 — Filecoin Onchain Cloud is the storage layer (fixed decision)

**Context.** The brief requires Filecoin for storage and a trustless workflow: anyone must be able to fetch the original and prove it is what was registered, without Stamper. Installed: `@filoz/synapse-sdk` 2.0.2 / `@filoz/synapse-core` 0.10.0; deployed: FWSS 1.4.0, PDPVerifier 3.5.0, FilBeam, Filecoin Pay with USDFC.
**Options.** (a) FOC via Synapse; (b) Storacha/Lighthouse/Akave as primary with Filecoin deals behind them; (c) IPFS pinning plus classic deals.
**Decision.** (a). FOC data sets with PDP proofs are the only option whose storage state is readable from a Filecoin contract (`PDPVerifier.getPieceCid`, `pieceLive`, `dataSetLive`) and whose identifier (PieceCID v2) is computable on the device before upload. Storacha and friends are at most fallbacks.
**Consequences.** The registry anchors PieceCID v2 bytes; the SDK runs only in Node/browser (no React Native); pricing follows the live `getPriceList()` (0.12 USDFC/data set/month, 0.008 + 0.003 per piece, 0.5 reserve); FOC proxies are upgradeable beta contracts, so fork tests re-run on every upgrade and the registry depends only on the PDPVerifier proxy in write paths; Calibration storage is not persistent, so demos run on mainnet.

## ADR-002 — One immutable Solidity registry on the FEVM plus an advisory resolver (fixed decision, shape chosen here)

**Context.** The brief fixes Solidity/Foundry on 314/314159. The proposals disagreed on governance: no roles at all (trustless-first), a timelocked registrar set inside the registry (product-first), a governor managing verifiers (security-ops).
**Options.** (a) Zero roles; (b) UUPS proxy with an owner; (c) immutable logic with the smallest possible governed membership (registrars, binders) and a separate owned resolver for presentation flags.
**Decision.** (c). Level ≥ 1 and derivative attachment must come from governed keys (ADR-006, ADR-010), which requires a membership set; everything else is permissionless and nothing privileged can create, alter or re-point a stamp. The resolver is replaceable and ignorable.
**Consequences.** All v1/v2 chain mechanisms (P-256 key types, ERC-1271, sealed flag, derivative bindings, dead-slot reuse) are implemented and tested in the MVP contract; a new registry version is the only upgrade path and old records stay valid forever; the governor starts as a hardware-wallet EOA and moves to a Safe via `transferOwnership`.

## ADR-003 — EIP-712 `CaptureClaim` is the signed artefact; `stampId` is its digest

**Context.** The contract must hash and index the claim in Solidity; devices (Hermes) and browsers must produce the same digest; the rich capture record is privacy-sensitive.
**Options.** (a) COSE_Sign1 / DAG-CBOR claim parsed on chain; (b) opaque hash of a CBOR blob; (c) EIP-712 struct for the signed claim and DAG-CBOR for the record, committed by `recordHash`.
**Decision.** (c). `stampId = EIP-712 digest`, so anyone recomputes it from the claim and replay is "already registered"; signature malleability cannot change the id. The record carries everything optional or sensitive and is redactable by sub-object hashes.
**Consequences.** `bytes pieceCid` hashes as `keccak256(pieceCid)` inside `hashStruct`; the typehash is frozen (`0xe768d843…`); wallet users can sign with `eth_signTypedData_v4`; P-256 devices sign the 32-byte digest (`sha256(digest)` or Apple's assertion nonce).

## ADR-004 — 40-bit code derived on chain from `stampId` with re-draw; 8 + 1 Crockford symbols; no neighbour rule

**Context.** Three incompatible schemes were proposed: 55-bit on-chain derivation (unresolvable prefix in the 40-bit watermark, heavy badge), issuer-chosen CSPRNG 40-bit with an off-chain neighbour rule (mempool hijack of the code, squatting), nonce-derived 40-bit with a 248-SLOAD on-chain neighbour revert (grindable DoS, breaks offline capture). The product critic asked for issuer-chosen codes with on-chain neighbour checks; the security and feasibility critics asked for on-chain derivation without the neighbour rule.
**Options.** (a) caller-supplied; (b) nonce-derived with revert on neighbours; (c) deterministic `keccak(stampId, attempt)` with re-draw on check ≥ 32, collision, or reserved `Z` prefix.
**Decision.** (c) at 40 bits. Satisfies the product critic's real needs (40 bits = TrustMark payload, 9 typeable symbols, no grinding, offline-safe, app can predict) while removing the attack surface the security critic identified (no caller chooses a code, no reverting neighbour check to grief). The neighbour rule is dropped: the mod-37 check symbol already guarantees distance ≥ 2 between valid codes, and deliberate distance-2 look-alikes are grindable with or without it; the UI defends by always showing the original.
**Consequences.** Codes are shown only after the registration receipt; collision probability ≈ N/2^40; enumeration is moot (public stamps are enumerable from events anyway); `predictCode` lets the app pre-render the share preview.

## ADR-005 — MVP device key is software secp256k1; P-256 key types are in the contract from day one, clients switch in v1

**Context.** Hardware P-256 signing needs two custom native modules, an alpha Expo package whose input hashing is unverified, and a precompile whose gas is unmeasured. The product critic priced that at +3.5–4.5 engineer-weeks of the riskiest kind.
**Options.** (a) P-256 on chain in the MVP; (b) secp256k1 forever; (c) secp256k1 in `expo-secure-store` now, `KT_P256_RAW` / `KT_P256_APPATTEST` implemented, odyssey- and fork-tested, unused by clients until the gas number exists.
**Decision.** (c). Combined with ADR-006 so the software key never yields an L1 label by itself.
**Consequences.** MVP stamps are L1 through the registrar countersignature; a `0x0100` wrapper measurement is a week-1 task whose result is recorded, not acted on; the App Attest convention is fixed now (`clientData := digest`, counter == nonce); v1 needs no redeploy.

## ADR-006 — A level ≥ 1 requires a governed registrar's enrolment endorsement **and** either a per-capture registrar countersignature or an on-chain hardware signature

**Context.** With software keys, an extracted key plus self-submission would otherwise mint unlimited "Captured in the Stamper app" stamps; with an open registrar set, `level` would be attacker-chosen for every consumer except Stamper's own UI.
**Options.** (a) level inherited from the key unconditionally; (b) rename to `claimedLevel` and make every consumer show the registrar; (c) level set by the contract only when the chain saw a countersignature (registrar verified this capture's attestation) or verified a P-256 signature itself.
**Decision.** (c). `stamp.level = countersigned ? cs.level : (P-256 key ? key.level : 0)`, where the countersigned level is carried in the signature blob and must be ≤ the key's enrolment level (a registrar may vouch below it, never above); endorsements must come from an active registrar and cover the whole `KeyEnrolment` struct; every key needs a proof of possession.
**Consequences.** Self-submitted software-key claims are L0 (correct: nothing attested them); the verify page states that the attestation was checked by Stamper and the chain verified both signatures; a compromised registrar is detectable (rate anomalies) and removable immediately (ADR-018).

## ADR-007 — The PieceCID is always device-signed; deferred CIDs do not exist

**Context.** Two proposals let the first `bindStorage` caller fix an empty video PieceCID: a permissionless writer poisoning the stamp forever for 0.003 USDFC.
**Options.** (a) deferral fixed by the first binder; (b) deferral fixed by a device-signed `PieceCidAssertion`; (c) no deferral: photos compute the PieceCID on device; videos get it from the API while staging, the device confirms the sha256 and signs the complete claim.
**Decision.** (c), with `flags.PIECECID_SERVER_COMPUTED` for transparency. `bindStorage` compares against the signed CID and never writes it.
**Consequences.** Video claims are signed at upload rather than at capture when the device cannot hash the tree itself (labelled); a dishonest server can only make a stamp unbindable, never bind foreign bytes; the contract validates CommPv2 encoding on registration.

## ADR-008 — Used-nonce bitmap instead of strictly increasing nonces

**Context.** Submission is permissionless and receipts land next tipset; strict monotonicity loses offline captures whose later claim lands first.
**Options.** (a) strict `nonce > last`; (b) relayer serialisation per key; (c) `usedNonce[keyId][word]` bitmap, order-independent.
**Decision.** (c). For App Attest keys the counter must equal the nonce on chain; Apple's strict monotonicity is enforced by the registrar off chain.
**Consequences.** One SLOAD/SSTORE per claim; replay impossible; offline queues safe; the relayer still serialises per key for tidiness, not correctness.

## ADR-009 — Permissionless `bindStorage` with PDPVerifier-only checks, slot policy, no StateView in any write path

**Context.** `findPieceIdsByCid` from 0 is a linear scan; the FWSS StateView is replaceable and a constructor immutable would brick an immutable contract's bind path; unbounded or fixed-4 bindings are griefable.
**Options.** (a) registrar-only binding; (b) permissionless with StateView checks; (c) permissionless with `getDataSetListener == FWSS`, `dataSetLive`, `pieceLive`, `getPieceCid` equality, 4 trusted + 4 third-party slots, dead-slot reuse.
**Decision.** (c). Payment termination (`pdpEndEpoch`) is reported by `bindingStatus` through `viewContractAddress()` inside try/catch, never required in `bindStorage`.
**Consequences.** Community re-pins stay first-class; griefing is capped at four live, correct-CID third-party bindings; the registry survives any StateView replacement; trusted binders are a governed membership (the relayer EOA) that affects only slot reservation, never verdicts.

## ADR-010 — Derivatives are attached only under a governed signature; exact-match verdicts never come from permissionless writes

**Context.** A permissionless `registerDerivative` lets anyone attach a doctored image to a real stamp and earn a byte-exact "marked copy" verdict; a write-once registrar-attached hash on a hot registrar lets a compromise block the real derivative.
**Options.** (a) anyone with any signature; (b) write-once `onlyRegistrar`; (c) multiple derivatives per stamp, each under an active registrar's `DerivativeAttachment` signature (v2: or the stamp's device key), duplicates rejected.
**Decision.** (c). `stampByDerivativeHash` is first-writer-wins among governed writers only.
**Consequences.** The "STAMPER MARKED COPY" verdict is sound by construction; the verify page need not re-check who wrote it; the registrar key gains one more use and keeps its immediate-removal property.

## ADR-011 — Only the device-signed original goes to Filecoin in the MVP; derivative bytes live on disk and in the mirror; their hashes go on chain

**Context.** Every proposal stored the marked copy (and some the record) as FOC pieces, doubling or tripling the per-piece fee and the transaction count for an artefact that is reproducible from the original plus `paramsHash` and served from Stamper's cache anyway.
**Options.** (a) original + derivative on FOC; (b) original only, derivative hash on chain; (c) nothing on FOC until moderation (rejected: the original is the product).
**Decision.** (b). `Binding.asset` and `Derivative.pieceCid` exist so a FOC copy of a derivative can be added later without a contract change.
**Consequences.** ≈ $0.008 per photo instead of $0.02–0.03; two chain transactions fewer per stamp; the marked copy's durability is Stamper's (disk + bucket), disclosed on the page.

## ADR-012 — Cold payer plus an AddPieces-only session key with 7-day expiry, pinned data sets, held only by the custodian container

**Context.** Session keys are the FilOz-sanctioned way to keep the funded account cold. The security critic asked for ≤ 24 h keys; the product critic capped the MVP at six containers with no KMS. A 24-hour expiry would force daily use of the cold payer key, making it effectively hot.
**Options.** (a) payer key on the VPS; (b) 24-h session keys with a signer service/KMS; (c) 7-day `[AddPiecesPermission]` key, data sets created once from the payer, `dataSetIds` pinned, Filecoin Pay allowances capped, weekly hardware-wallet rotation, `revoke()` runbook.
**Decision.** (c) for the MVP; (b) in v1 when the signer service exists.
**Consequences.** A custodian compromise can add pieces at Stamper's expense up to the allowance cap and until revocation, never withdraw or terminate; the typed permission constants are used (`requiredPermissions: [AddPiecesPermission]`, not strings); `commit()` never falls into implicit data-set creation because `dataSetId` is always pinned.

## ADR-013 — Register the hash immediately; commit bytes to Filecoin only after automated pre-publication checks

**Context.** Registration seconds after capture gives the earliest hard time anchor; FOC commits make bytes world-retrievable under Stamper's payer address and third-party re-pins are permanent.
**Options.** (a) commit first, register after; (b) register and commit concurrently; (c) register first, `ingest` checks, then store/commit and FilBeam exposure.
**Decision.** (c). Hashes of rejected bytes remain registered (harmless) and are flagged `RejectedPrePublication` in the resolver.
**Consequences.** Staging holds bytes for minutes; the verify page has a designed "Filecoin proof pending" state; moderation can run before publication without delaying the time anchor.

## ADR-014 — One verdict ladder; only byte-exact may say "original"

**Context.** Each proposal had a non-exact verdict ("MATCHES", "SAME PICTURE, RE-ENCODED") that a transplanted watermark plus a sub-threshold edit could earn.
**Options.** (a) threshold-graded positive verdicts; (b) ORIGINAL / STAMPER MARKED COPY / RELATED TO `<code>` — COMPARE / NOT REGISTERED.
**Decision.** (b). The diff map and PDQ distance appear in the header for every non-exact result; "same", "matches", "identical" are banned outside byte-exact outcomes; "verified", "authentic", "real" are banned everywhere.
**Consequences.** Some users will find "RELATED — COMPARE" unsatisfying for a re-encoded copy; the compare slider is the answer, and the wording is the product's honesty guarantee.

## ADR-015 — Tier-distinct badge families; no QR in the badge; share card carries the QR

**Context.** All proposals rejected printing the level because pixels are forgeable, yet would have issued pixel-identical badges for L2 captures and L0 uploads; a scannable in-badge QR needs ≈ 12 % of the short side.
**Options.** (a) one badge for all; (b) level text in the badge; (c) three visual families (F0 plain grey text, F1 wordmark, F2 wordmark + HW) with no level number, QR only on the 1080×1350 share card and the verify page.
**Decision.** (c). L0 web uploads get no mark unless opted in.
**Consequences.** Stamper's own mark is never lent to unattested content; forgery of any family remains trivial and the verify page remains the authority; badge geometry (5 % pill, inset for 4:5 crops) is frozen after the week-6 PDQ-drift measurement.

## ADR-016 — Signing keys live only in the custodian (`api`); media is decoded only in `worker` and `ml`; six containers, no KMS in the MVP

**Context.** Media parsers (libvips, ffmpeg, pillow) have routine CVEs; proposals put relayer, session and C2PA keys in the same process that parsed attacker-chosen uploads. The product critic capped the footprint at six containers.
**Options.** (a) separate relayer/signer container with KMS; (b) keys in the worker; (c) `api` holds relayer, registrar and session keys and never decodes media (uploads are streamed and hashed only; `/verify/upload` is parsed by the worker); `worker`/`ml` hold no secrets; same image, different `ROLE`.
**Decision.** (c) for the MVP; (a) in v1.
**Consequences.** The SDK's one-shot `upload()` is replaced by `store()` in the worker and `commit()` in the api; the api still parses App Attest CBOR, Play Integrity verdict JSON and DAG-CBOR records (small parsers, disclosed in the threat model).

## ADR-017 — The off-box mirror is written at ingest; the retrieval probe is the primary storage-health signal

**Context.** PDP proves possession of a data set, not durability of each piece; a lost piece passes every boolean for weeks; a mirror on the same VPS shares its fate.
**Options.** (a) PDP booleans as the panel; (b) local mirror; (c) S3-compatible bucket written before the FOC store, plus a probe that downloads and re-hashes at bind time and weekly samples, shown as the panel's first line.
**Decision.** (c).
**Consequences.** Three copies from the first minute; bucket cost is small (≈ $5/TB-month); repair restores from the mirror into a fresh data set and reuses the dead slot.

## ADR-018 — Asymmetric governance: additions wait 48 h, removals are immediate; retroactive revocation only by the governor with a reason

**Context.** Timelocks on registrar changes also delayed removing a compromised registrar; a plain registrar signature could revoke keys retroactively.
**Options.** (a) symmetric timelock; (b) no timelock; (c) announce-and-wait for additions, immediate removal by owner or the role holder itself, retroactive `effectiveEpoch` only by the governor with `retroactive = true` and a reason code.
**Decision.** (c), implemented in-contract with `activeFrom` timestamps (no `TimelockController` dependency).
**Consequences.** A compromised registrar key can be cut by either party within one tipset; stamps endorsed by a removed registrar keep their on-chain level and are flagged in the resolver; the governor starts as a hardware-wallet EOA and becomes a Safe.

## ADR-019 — Sealed mode uses `contentHash = sha256(ciphertext)` with a salted plaintext commitment in the record (v1, contract-ready in MVP)

**Context.** Putting `sha256(plaintext)` on chain lets anyone with a candidate image confirm it was secretly stamped — the opposite of what sealed users need.
**Options.** (a) plaintext hash on chain, ciphertext stored; (b) `hashKind` enum with salted hash; (c) the stored bytes are the ciphertext, so `contentHash` is naturally `sha256(ciphertext)`; the record carries `sha256(salt ‖ plaintext)`; `flags.SEALED`.
**Decision.** (c): no extra enum, no change to `firstStampOf` semantics.
**Consequences.** Keys wrapped to the device key and to Stamper's custodian key; an export flow ships with the feature; crypto-shredding gives tractable erasure; PDQ of sealed assets is never computed.

## ADR-020 — Attestation bundles are hashed on chain and kept encrypted; never published raw

**Context.** Android attestation chains carry keybox intermediate certificates that fingerprint a device across every app's attestation server.
**Options.** (a) raw bundle as a public FOC piece; (b) hash on chain, bundle encrypted at rest with release on request (v1: encrypted piece on FOC).
**Decision.** (b).
**Consequences.** Third-party re-audit of a level requires a release request; the public trail is `attestationHash` + registrar identity; the registrar's honesty is auditable after the fact, not in real time.

## ADR-021 — Finality is a displayed policy: included → safe (≥ 30 epochs) → final (`finalized` tag or ≥ 900 epochs)

**Context.** Mainnet F3 has produced no certificate since 2026-03-09; the eth `finalized` tag is the FRC-0089 calculator (~20–30 epochs); `block.timestamp` is exact per epoch.
**Decision.** Three states shown with epoch age; never "final in seconds"; receipts polled ≥ 120 s with a 2-epoch reorg re-check.
**Consequences.** The share sheet gates on *included*; evidence bundles record the state at export time.

## ADR-022 — MVP scope: lean, mainnet inside, 15–19 engineer-weeks

**Context.** The proposals' MVPs were 28–40 engineer-weeks presented as 6–8 calendar weeks; one was Calibration-only although Calibration storage is not persistent.
**Decision.** The §12 list: photo + capped video, software keys with countersigned L1, custodian/worker split, originals-only on FOC, badge families + TrustMark + PDQ, verify page with the ladder and failure screens, six containers, mainnet deployment. Everything else is v1/v2 but every chain mechanism is in the immutable contract now.
**Consequences.** Two engineers for 8–10 weeks; the critical chain is contract → mobile capture; the verify page runs in parallel.

## ADR-023 — Tooling: TypeScript ~6.0.3 workspace-wide; `packages/core` depends on `@filoz/synapse-core` (import only `/piece`), never on the SDK

**Context.** `typescript ^7.0.2` is pinned in `packages/core` but ships no programmatic API until 7.1 (breaks `jest-expo`, typescript-eslint); `@filoz/synapse-sdk` has no React Native support and would be pulled into the mobile bundle.
**Decision.** Pin `~6.0.3` everywhere (optionally `@typescript/native-preview` for typecheck speed); core imports only the pure-JS hasher; `foundry.toml` pins `solc 0.8.30`, `evm_version = "cancun"`, `via_ir = true`.
**Consequences.** One TypeScript major in the workspace; the Hermes `exports`-resolution smoke test runs in CI.

## ADR-024 — Offline capture: sign at capture when the device can hash, otherwise at upload; 72-hour deadline; attestation at upload, labelled

**Context.** Journalists capture without connectivity; attestation tokens prove device state when requested, not at capture.
**Decision.** Photos sign at capture (`flags.OFFLINE`, no server challenge); videos without an on-device PieceCID sign at upload; `deadline = capturedAt + 72 h`; the page shows "captured offline; device attested on upload"; v1 limits L2 offline claims to 24 h.
**Consequences.** The chain anchor is "no later than upload"; `capturedAt` stays a labelled claim; the mmkv queue is encrypted.

## ADR-025 — C2PA deferred to v1; `digitalCapture` only for level ≥ 1

**Context.** Until Stamper is on the Conforming Products List every validator shows "unknown source", so the MVP user sees nothing; a `c2pa.created` + `digitalCapture` claim on an L0 upload would be a Stamper-signed falsehood.
**Decision.** v1 ships sidecar manifests for originals and embedded manifests for derivatives with the gating rule; the registry-facing anchor assertion carries `stampId`, `code`, hashes, tx and epoch.
**Consequences.** Interop with C2PA validators arrives with v1; Stamper's own page remains the canonical UX.
