# Stamper — Security / threat-model critique of the three architecture proposals

Critic: security / threat-model lens. Date: 2026-10-01. Inputs: `VERIFIED-SDK-FACTS.md`, the three proposals (`proposal-trustless-first.md` = **A**, `proposal-product-first.md` = **B**, `proposal-security-ops.md` = **C**), and the research reports (`threat-model.md`, `trusted-capture.md`, `watermarking.md`, `fevm-contracts.md`, `filecoin-storage.md`, `perceptual-hashing.md`, `c2pa-prior-art.md`, `codes-ux-legal.md`, `app-stack.md`).

Method: for every mechanism that produces a verdict, a label, or a pointer, I asked "who can make this say something false, at what cost, and what does the viewer see?" Each finding gives the attack, the impact, and the fix. Severity: **Critical** = a false positive verdict or a permanently broken stamp at trivial cost; **High** = a false label or a targeted DoS at low cost; **Medium** = bounded loss, privacy leak, or operational exposure.

All three proposals share the right core: device-signed EIP-712 claim, immutable registry, PieceCID re-hashed in the browser, badge-as-pointer, honest wording. The holes below are almost all in the *edges* of that core — who may write which field, what the first writer wins, and what the verify page says about non-exact matches.

---

## 1. Proposal A — trustless-first

### A1. `registerDerivative` is permissionless and feeds the exact-match verdict (Critical)

`registerDerivative(stampId, d, sig)` accepts a `DerivativeClaim` signed "by any secp256k1 key" and writes `stampByDerivativeHash[d.contentHash] = stampId`. The verify ladder (§8.1 step 1) then resolves an exact sha256 hit on that mapping to **"STAMPER MARKED COPY of <code>"**.

Attack: take a legitimate stamp S of a journalist's photo, produce a doctored image D' (face swap, removed object, added badge with S's real code), sign `DerivativeClaim(S, sha256(D'), …)` with any throwaway secp256k1 key, call `registerDerivative`. Cost: one tx (~$0.00002). Result: anyone who uploads D' to the verify page, the CLI, or any third-party verifier that reads the registry gets a byte-exact, chain-backed "marked copy of S" verdict. This is a complete bypass of the compare-to-original design, delivered through the strongest-looking path (exact hash).

Second attack: `stampByDerivativeHash` is first-writer-wins. Stamper's real `registerDerivative` tx is visible in the mempool for 30–90 s; a front-runner registers the same `contentHash` under a *different* stampId with a higher premium, so Stamper's genuine marked copy now resolves to the wrong stamp.

Fix: only two signers may register a derivative: the stamp's own device key (P-256 via the same `_verify` path) or a member of a governed renderer/registrar set. `registeredBy` must never be "anyone". The verify page and CLI must additionally require the derivative's `registeredBy` to be in the governed set before using the words "Stamper marked copy", and should fall back to perceptual comparison with the original (never the exact path alone) when it is not.

### A2. Open registrar set turns `level` into an attacker-chosen field (High)

`registerKey` accepts any `KeyEndorsement` from any secp256k1 "registrar"; the registry stores `level` and `registrar` verbatim. The proposal says the Stamper UI treats unknown registrars as L0, but the chain, the `CaptureRegistered` event, the ERC-7053 `Commit` consumers, the Goldsky/Ponder index, the C2PA anchor assertion (`level`), and `packages/verify-cli` all read `level == 2` → "Hardware-attested capture". An attacker self-endorses their own key at L2 with an `attestationCid` pointing at junk bytes and gets L2 labels everywhere except Stamper's own page.

Fix: either adopt C's governed verifier set (timelocked add, immediate remove) so `level ≥ 1` can only be written by a listed verifier, or rename the field `claimedLevel` and make every consumer (including the CLI and the C2PA assertion) display `registrar` with it. The first is the honest choice; "third parties may trust other registrars" is a v2 feature that needs an allowlist mechanism, not an open field.

### A3. `KeyEndorsement` does not cover the key struct (Medium)

`KeyEndorsement(keyId, level, attestationCid, expiresAt)` omits `keyType`, `platform`, `rpIdHash`, `x/y/addr`. `KeyRegistration` (the popSig) covers `(keyId, keyType, platform)` but is signed by the device itself. So a key endorsed at L2 after an App Attest validation can be registered as `KT_P256_RAW` with any `rpIdHash`, dropping the per-capture assertion/counter binding while keeping L2. Fix: endorse `keccak256(abi.encode(DeviceKey))` (C's `ENROL_TYPEHASH` does this correctly).

### A4. Unbounded `bindings[stampId]` and non-FWSS listeners (Medium)

`bindStorage` is permissionless, loops over all existing bindings, and accepts any PDPVerifier data set regardless of listener. A griefer creates many data sets (≈0.13 USDFC each) containing the public piece and binds them: `storageStatus` grows to hundreds of external calls per `eth_call` (timeouts on public RPCs), `bindStorage` for Stamper's own copies eventually exceeds message gas, and the storage panel fills with unproven "copies" (a PDP data set with a custom listener never faults). Fix: cap third-party bindings (e.g. 8), reserve slots for the stamp's device key/registrar, require `getDataSetListener(setId) == FWSS` in-contract (B and C do), and let dead bindings (`pdpEndEpoch != 0` or `!dataSetLive`) be replaced.

### A5. Strict per-key nonce + anyone-can-submit = lost captures (Medium)

`require(c.nonce > k.lastCounter)`: a user who captured offline signs nonces 5, 6, 7; if 7 lands first (relayer parallelism, Filecoin per-sender ordering does not constrain different senders, or a mempool observer resubmits claim 7 themselves), 5 and 6 are permanently rejected. Captures are lost, not delayed. Fix: used-nonce bitmap (B's `usedNonce`) for non-App-Attest keys; for App Attest keep Apple's strictly-increasing check off-chain and accept any unused counter on-chain. The relayer must serialize per key regardless.

### A6. Reentrancy window in `KT_ERC1271` path (Low)

`IERC1271.isValidSignature` is an external call into attacker code before `stamps[digest]` is written. The nonce write happens before the call, so same-claim reentry fails, but nested registration of other claims interleaves with code derivation. Add `nonReentrant` and finish all effects before the call.

### A7. Things A gets right that the others should copy

On-chain, deterministic code derivation with collision re-draw (immune to code squatting, hijack and neighbour-DoS; see B1, C2); `sig`/`authData` stored in state so re-verification never needs archival logs; sealed mode with `contentHash = sha256(ciphertext)` and a salted commitment (no plaintext-hash leak); sealed-key wrapped to the device key; device signs the PieceCID even when the server computed it (closes B2/C1).

---

## 2. Proposal B — product-first

### B1. Caller-chosen code: hijack, squatting and look-alikes (Critical)

`registerStamp(c, sig, authData, keyId, code)` takes `code` as a plain parameter; the contract checks only `code % 37 < 32 && stampByCode[code] == 0`. Uniqueness and the distance-2 rule live in Stamper's DB.

Attack 1 (hijack): the relayer's tx carrying the journalist's claim with code K sits in the mempool; the attacker (any registered key, including an L0 web account, self-submitting with their own FIL) submits a valid claim of their own with the same K at a higher premium. The journalist's tx reverts `"code"`; the share image the app already produced (B §2.2 pushes "share-ready" at ~10 s, before inclusion) now carries a code that resolves to the attacker's picture. Attack 2 (look-alikes): the attacker chooses any free code at symbol-distance 1–2 from a known stamp (the check symbol only forces distance ≥ 2 and the attacker controls both symbols). Attack 3: vanity/squatting of codes at $0.00001 each.

Fix: derive the code on chain from `stampId` (A's loop or C's hash) and remove the parameter. Gate sharing on `included`, not on the DB reservation.

### B2. Deferred PieceCID for video: first binder poisons the stamp forever (Critical)

`bindStorage`: `if (s.pieceCid.length == 0) s.pieceCid = cid;`. Anyone may call it. The `StampRegistered` event with empty `pieceCid` is public 1–3 minutes before Stamper's `onPiecesConfirmed` → `bindStorage` lands. Attacker uploads junk to their own FWSS data set (0.003 USDFC) and binds. The stamp's `pieceCid` is now the attacker's; Stamper's own bind reverts `cid-mismatch` permanently; the verify page downloads junk, re-hashes, and shows "bytes served do not match". Every video stamp can be bricked for a fraction of a cent. Fix: the deferred PieceCID must be fixed by a second device-signed struct (`PieceCidAssertion(stampId, pieceCid)`) or by a governed registrar signature, never by `msg.sender`. Better: sign the PieceCID on device always, with A's "server computes, device confirms sha256 and signs" fallback.

### B3. Software secp256k1 key + off-chain-only attestation + self-submit = unattended L1 forgery (High)

MVP keys are `generatePrivateKey()` in `expo-secure-store`. The App Attest assertion / Play Integrity token are checked by the API only; the contract verifies the secp256k1 signature alone and stamps inherit `k.level = 1`. A rooted/jailbroken device (or a Keychain/Keystore dump on an unlocked phone, or the extraction primitives Buchanan used) extracts the key **once**; the attacker then signs unlimited claims for arbitrary bytes off-device and self-submits them — never touching Stamper's API, never producing an assertion. Each gets "Captured in the Stamper app". This is worse than the confused-deputy case in the threat model (§1.6): no presence at the device is needed after extraction, and no per-capture attestation exists to revoke against. Fix (cheap, no redeploy): add an optional `registrarSig` over the digest to `registerStamp`; `stamp.level = k.level` only when a governed registrar countersigned (i.e. verified the per-capture attestation), otherwise `level = 0`. L0 self-submit stays free; L1/L2 self-submit requires Stamper's countersignature until P-256 moves on chain.

### B4. Single VPS holds registrar + relayer + session key + C2PA key + plaintext-decryptable private records (High)

`registerDeviceKey`, `revokeDeviceKey` and `attachDerivative` are `onlyRegistrar`, and the registrar must be hot (enrolment is synchronous). The Compose file puts `relayer_pk`, `session_pk`, `c2pa_key` on the worker; the private record is "encrypted at rest" with a server-side key. One box compromise = mint L1/L2 keys, attach a doctored `derivedHash` to any not-yet-attached stamp (it is write-once, so the real derivative can never be attached afterwards), mass-revoke keys, read every user's location, and sign C2PA manifests. The 7-day timelock on `setRegistrar` makes it *worse*: removing a compromised registrar also waits 7 days. Fix: timelock additions only, immediate removal; registrar/C2PA keys in KMS behind a signer service (C's layout); encrypt the private record on device to the device key (A/C); split media parsing from key holding (see X4).

### B5. Sealed mode publishes the plaintext hash (Medium)

B §11: `contentHash = sha256(plaintext)` on chain, ciphertext on FOC. `firstStampOf[sha256(plaintext)]` lets anyone holding a candidate image confirm that it was secretly stamped — exactly the deniability at-risk users want from sealed mode, and personal data under EDPB 02/2025. Fix: A's or C's salted commitment (`sha256(salt‖B)` or `sha256(ciphertext)` + commitment in the record).

### B6. Verdict wording over-claims for non-exact matches (Medium)

"SAME PICTURE, RE-ENCODED" at PDQ ≤ 15 (or PDQ ≤ 15 + SSIM ≥ 0.9 with no code at all). The watermarking report's own residual risk is a 5 %-of-pixels meaning-changing edit staying inside the PDQ threshold; `perceptual-hashing.md` reports unrelated-pair minima of 10 bits. "Same picture" will be read as "verified". Fix: only byte-exact may be called original/identical; everything else is "related — compare" with the diff map in the header, not below the fold.

### B7. C2PA original manifest asserts `digitalCapture` for L0 uploads (Medium)

B §6.3 writes `c2pa.created` + `digitalSourceType = digitalCapture` on every original's sidecar, including "plain upload, treated identically" web L0 assets. Third-party validators will show a camera-capture claim for arbitrary uploaded files signed by Stamper. Fix: gate `digitalSourceType` and `c2pa.created` on level ≥ 1; L0 gets `c2pa.published`/no source type.

### B8. Positives to keep

`usedNonce` bitmap (immune to A5/C3); `MAX_BINDINGS`; `getDataSetListener == fwss` in-contract; `appAttestRpIdHash` immutable; best failure-state UX; near-duplicate warning at ingest; share-card QR instead of an unscannable in-badge QR.

---

## 3. Proposal C — security/ops pragmatist

### C1. Deferred `pieceCidHash` for video: same first-binder poisoning as B2 (Critical)

`if (s.pieceCidHash == 0) s.pieceCidHash = h;` with caller-supplied `pieceCid` checked only against the caller's own data set. Identical attack and cost to B2; C's risk #14 notes the weaker identity but not that an adversary fixes it. Same fix.

### C2. `_noNeighbour` turns a cosmetic rule into a registration DoS (High)

`code40 = keccak("stamper.code.v1", stampId)`, `stampId` depends on the client-chosen `nonce`; `registerStamp` reverts `CodeNeighbour` if any of 248 distance-1 codes is taken. The attacker sees the relayer's tx in the mempool, computes the victim's code, grinds a nonce whose code is a distance-1 neighbour (248/2^40 → ~4.4·10⁹ keccaks, seconds on a GPU, a minute on a laptop), and front-runs with a higher premium. The victim's registration reverts; the app has already shown the predicted code; every retry (new nonce → new code) can be griefed again for ~$0.00003 each. The rule also does not achieve its goal: distance-2 look-alikes (`C(8,2)·31² ≈ 27k` targets) are grindable in ~4·10⁷ tries, trivial on a phone, and the check symbol already guarantees distance ≥ 2 between any two valid codes. Fix: delete `_noNeighbour`; use A's deterministic derivation with collision re-draw (the app can still predict). Accept that look-alikes exist and defend in the UI (always show the original; never auto-confirm by code alone).

### C3. Strictly increasing nonce + permissionless submit loses offline captures (Medium)

Same as A5 (`require(c.nonce > k.lastNonce)`). Same fix.

### C4. Verifier compromise is the most damaging key, and removal is timelocked (High)

C itself says so (risk #8) but `setVerifier` is "onlyGovernor (timelocked, 48 h)". A compromised verifier mints L2 keys and signs retroactive revocations (`effectiveEpoch` in the past, which `effectiveLevel` honours) for 48 h after detection. Fix: asymmetric governance — additions timelocked, removals immediate (guardian or any-of-N governor signers); verifiers may self-revoke; retroactive `effectiveEpoch < block.number` only via governor with a reason code and an event, not via a plain verifier signature.

### C5. `enrolSelf` has no proof of possession: key squatting (Medium)

Anyone can self-enrol any `(x, y)` at L0, and `deviceKeyId = sha256(04‖x‖y)` is then taken; the verifier's later `enrolDeviceKey` for the same key fails. Public keys leak (evidence bundles, attestation bundles stored on FOC, a device's own exported bundle). Fix: require a self-signature in `enrolSelf` (A's popSig) and let a governed `enrolDeviceKey` upgrade an existing L0 record in place.

### C6. Fixed `Binding[4]` slots are griefable (Medium)

Anyone can bind a legitimate copy of a *public* piece; a griefer re-pins the original into four of their own data sets, binds all four slots, then terminates the data sets. The stamp shows "0 of 4 live" forever and Stamper's re-replication cannot bind. Cost: a few USDFC per targeted stamp. Fix: slot reuse for dead bindings; reserved slots for the stamp's device key / governed binder; cap third-party bindings separately.

### C7. Public attestation bundles are a cross-service device fingerprint (Medium)

C (and A) store the raw attestation bundle as a public Filecoin piece. An Android chain contains the device's keybox intermediate certificate (serial, subject) that this device presents to *every* app's attestation server; publishing it lets any party correlate a Stamper key with the same device's enrolments elsewhere. The threat model's §4.1 users (sources, election observers) are exactly who this harms. Fix: publish `sha256(bundle)` on chain and keep the bundle encrypted on FOC with release to auditors/courts on request; or strip to leaf cert + verdict JSON.

### C8. Positives to keep (the best contract design of the three)

`ENROL_TYPEHASH` covers the whole key struct; governed verifier set; `getDataSetListener == FWSS` and `pdpEndEpoch == 0` enforced in `bindStorage`; `findPieceIdsByCid(setId, cid, pieceId, 1)` exact check; relayer as a separate KMS-backed service; ML sidecar holds no secrets; salted sealed hashes; CRL re-check per L2 capture; Android `setUserAuthenticationParameters` biometric window; "what breaks first" ordering; L0 web quota as the cheapest abuse vector.

---

## 4. Cross-cutting findings (all three)

### X1. A genuine Stamper badge on unattested content is the real fake-badge attack (High)

All three reject putting the tier in the badge because "anything in pixels is forgeable". That argument is symmetric: a forged "L2" badge costs the same as a forged plain badge. What the current design produces is worse — Stamper *itself* issues pixel-identical badges for an L2 hardware capture and for an L0 "plain upload, treated identically" of an AI image. The threat model (§2.2, §4.4) says most viewers never click through and that provenance labels raise trust even when misunderstood. Fix: visually distinct badge families by tier at render time (e.g. L0: text "REGISTERED UPLOAD", no wordmark glyph; L1+: "CAPTURED" wordmark). The verify page remains the authority; the badge merely stops Stamper from lending its own mark to L0 content. Also default L0 web stamps to *no* visible mark unless the user opts in.

### X2. Non-exact verdict wording (High)

A: "MATCHES <code>" at watermark ∧ PDQ ≤ 31; B: "SAME PICTURE, RE-ENCODED" at PDQ ≤ 15; C: "MATCHES STAMP X". Combined with a transplanted watermark (public TrustMark encoder, payload = the public code) and a sub-threshold edit, each produces a chain-backed-looking positive for a doctored image. Fix: one ladder for all: `ORIGINAL (byte-exact)` → `MARKED COPY (byte-exact derivative registered by a governed key)` → `RELATED TO <code> — COMPARE` (everything else, diff map in the header). No "same", no "matches".

### X3. Moderation after publication (High, legal/operational)

In every flow the worker commits bytes to FOC (two providers, FilBeam-served under `{payer}.filbeam.io`, CID in a public event) before any classifier/hash-match runs. Illegal content becomes world-retrievable under Stamper's payer address within minutes; removal is "schedule removal + provider GC" and third-party re-pins are permanent. Fix: registration (hash only) may be immediate; the FOC commit must wait for the automated pre-publication checks; staging holds the bytes meanwhile. Rate-limit L0 uploads hardest.

### X4. Media parsers and signing keys in the same process (High)

`/v1/verify/upload` (≤ 500 MB attacker-chosen video) and every capture are parsed by sharp/libvips, ffmpeg, c2pa-node, pillow/opencv. In A and B the same worker container holds the relayer key, the FOC session key and the C2PA key; in A the api holds the registrar key. A parser RCE (libvips/ffmpeg CVEs are routine) yields every key. C separates relayer (KMS) and ml (no secrets) but still gives the worker the session key. Fix: no key material in any process that decodes untrusted media; a small signer service (KMS or a sealed container) for relayer/registrar/C2PA; session key with 24-h expiry and a revoke runbook.

### X5. PDP "stored and proven" is not per-piece durability (Medium)

All three say it in prose and then render a storage panel that says "2 of 2 live, proven this period". A provider that silently lost one piece passes `pieceLive`, `provenThisPeriod` and `dataSetLive` for weeks (78 % detection in 30 days at 1 % loss). The retrieval probe (HEAD + re-hash) is the only real per-piece signal. Fix: the panel's primary line must be "last retrieval check: <time> (hash matched)"; proof state is secondary. The Stamper mirror is the actual durability layer and must be off-box (C puts Garage on the same VPS; B's "staging 30 days then S3" has a gap if the S3 copy is not written at ingest).

### X6. Device compromise, timing and offline claims (Medium)

All three accept a 72-h/7-day `deadline` and offline-signed claims. A has no server challenge in the signed record at all, so a stamp proves only "existed by epoch E" with no lower bound; B/C bind a server challenge in the record (good) but A should too. For B, attestation tokens are requested at upload, which proves nothing about the state of the device at capture; label it ("attested on upload") as B does, and never let an offline L1 claim exceed 24 h for L2.

### X7. Confirm-by-presence via `firstStampOf` / `stampByContentHash` (Low)

Any public plaintext hash on chain lets anyone test "was this exact file stamped?" — fine for public stamps, fatal for sealed ones (B5). Keep the salted form for anything not public.

### X8. Trust that cannot be bypassed and must be stated (disclosure)

FilOz UUPS proxies (PDPVerifier/FWSS can change `getPieceCid` encoding → immutable registry needs V2), Apple/Google roots and their revocation cadence, the P256VERIFY precompile semantics, RPC providers (B's verify page queries one; A and C query two — all should), and Stamper's KMS as the second wrapper of every sealed key (C risk #13: ship the export flow in v1).

---

## 5. Ranking and justification

**C — 7/10.** The soundest signing and enrolment model (hardware P-256 on chain, struct-covering verifier signature, governed verifier set, KMS relayer, secret-free ML). Loses points for one Critical (video first-binder poisoning), one self-inflicted High (`_noNeighbour` DoS), timelocked removal of a compromised verifier, and the shared cross-cutting items.

**A — 6/10.** The purest verifiability story and the best code and sealed-mode designs, but the permissionless `registerDerivative` is a direct false-positive on the exact-match path, and the open registrar set makes `level` meaningless to anyone but Stamper's own UI — both contradict the proposal's own principle that chain state alone must decide the verdict. Unbounded bindings and nonce ordering add medium issues.

**B — 4/10.** Ships fastest and has the best UX, but its security edges are the weakest of the three: caller-chosen codes (hijack via mempool), extractable software keys whose L1 label survives self-submission, write-once registrar-attached derivatives on a hot registrar with 7-day removal, video first-binder poisoning, server-side-only encryption of location, and a sealed mode that leaks the plaintext hash. Most are cheap to fix and the fixes are already present in A or C.

---

## 6. Must-fix list for the merged design

1. No permissionless write may feed an exact-match or level verdict: derivatives (A), codes (B), `level`/registrar (A), deferred PieceCID (B, C).
2. Deferred PieceCID fixed only by a device-signed or governed-registrar-signed struct; prefer device-signed PieceCID always (A's flow).
3. On-chain deterministic code with collision re-draw; no `_noNeighbour` (C), no caller-chosen code (B).
4. Used-nonce bitmap for non-App-Attest keys (B's design) — strict monotonic nonces lose offline captures under permissionless submission (A, C).
5. Governance asymmetry: adding verifiers/registrars timelocked, removal immediate; retroactive revocation only by governor with reason (B, C).
6. L1+ labels only when the chain saw either an on-chain P-256 assertion or a governed countersignature over that capture; software secp256k1 + self-submit is L0 (B).
7. Tier-distinct badge families; L0 web uploads default to no Stamper mark (all).
8. One verdict ladder: byte-exact only may say "original"/"identical"; all else "related — compare" (all).
9. FOC commit after pre-publication checks; registration may precede (all).
10. No signing keys in media-parsing processes; signer service/KMS; short-lived session keys (A, B; partially C).
11. Attestation bundles not public in raw form; publish hash, release on request (A, C).
12. Sealed mode uses salted/ciphertext hashes; private record encrypted on device to the device key (B).
13. Binding slots: cap, reserve, and allow replacement of dead bindings; require FWSS listener in-contract (A, C).
14. Storage panel leads with the last retrieval+re-hash check, not PDP booleans; mirror off-box, written at ingest (all).
15. Add `nonReentrant` / checks-effects-interactions around any ERC-1271 call (A).

## 7. Best ideas to graft into the final design

- A: on-chain code derivation with re-draw and client prediction; `sig`/`authData` in state (or at least `keccak(sig)`) so re-verification never needs archival logs; sealed mode with ciphertext hash + salted commitment and device-wrapped keys; device signs the PieceCID even when the server computed it; `storageStatus` per-binding struct.
- B: `usedNonce` bitmap; `MAX_BINDINGS`; immutable `appAttestRpIdHash`; share-card QR instead of in-badge QR; failure states as designed screens; near-duplicate "ingredient hint" at ingest; `verifyClaim` pure re-check view.
- C: `ENROL_TYPEHASH` over the full key struct; governed verifier set (with the asymmetry fix); `bindStorage` checks (`listener == FWSS`, `pdpEndEpoch == 0`, exact `findPieceIdsByCid`); separate KMS relayer and secret-free ML container; CRL re-check per L2 capture; biometric-gated Keystore window; `effectiveLevel` view; "what breaks first" runbook ordering.
