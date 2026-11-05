# Stamper — Final architecture (authoritative)

Status: **approved design, 2026-10-01**. Supersedes the three proposals in the research scratchpad. Companion documents: `docs/ADRS.md` (decision records) and `docs/THREAT-MODEL.md` (threat matrix). Ground truth for SDK and chain facts is `VERIFIED-SDK-FACTS.md` plus the feasibility critique's live `cast` reads (2026-10-01); where they disagree the live reads win (pricing, `findPieceIdsByCid` cost, replaceable StateView).

Fixed decisions, not relitigated here: Filecoin Onchain Cloud (`@filoz/synapse-sdk` 2.0.2 / `@filoz/synapse-core` 0.10.0, FWSS data sets with PDP proofs, FilBeam retrieval, Filecoin Pay / USDFC) is the storage layer; a Solidity/Foundry registry on the Filecoin EVM (314 / 314159) is the anchor; TypeScript pnpm monorepo at `stamper` (Expo mobile, Next.js web, small TypeScript services on one Docker Compose VPS, Python only for watermark/PDQ).

Every mechanism is tagged **[MVP]**, **[v1]** or **[v2]**. The registry is immutable, so every **[v1]/[v2]** mechanism that touches the chain is implemented and tested in the **[MVP]** contract, and only switched on in clients later.

## 0. How the critiques were resolved

| Must-fix (critic) | Resolution | Section |
|---|---|---|
| No permissionless write may feed an exact-match or level verdict (security) | `attachDerivative` requires a governed registrar signature (or, [v2], the stamp's own device key); codes are derived on chain; `level ≥ 1` requires a governed registrar's enrolment endorsement *and* either a per-capture registrar countersignature or an on-chain P-256 signature | §4.2–4.4 |
| Deferred PieceCID poisoning (security, feasibility) | The claim always carries a validated, device-signed PieceCID; for video the API computes it before the device signs; `bindStorage` never writes `pieceCid` | §3.1, §7.5 |
| Remove `_noNeighbour`; derive code on chain with re-draw (security, feasibility) | 40-bit code = `keccak(stampId, attempt)` with re-draw on check ≥ 32 or collision; no neighbour rule; app predicts, shows only after receipt | §3.5, §4.5 |
| Used-nonce bitmap (security, feasibility) | `usedNonce[keyId][word]` bitmap for all key types; App Attest counter must *equal* the nonce, strict ordering checked off chain only | §4.3 |
| Governance asymmetry (security) | Registrar/binder additions wait 48 h; removals and self-removal are immediate; retroactive revocation only by governor with reason event | §4.6 |
| L1+ only with on-chain assertion or governed countersignature (security) | `stamp.level = countersigned ? cs.level (required ≤ key.level) : (P-256 key ? key.level : 0)` | §4.3 |
| Tier-distinct badge families; no mark by default on L0 web uploads (security) | Three badge families F0/F1/F2; L0 web uploads [v1] get no mark unless opted in | §6.1 |
| Single verdict ladder (all) | ORIGINAL → STAMPER MARKED COPY → RELATED TO `<code>` — COMPARE → NOT REGISTERED; "same"/"matches" never used | §8.1 |
| FOC commit only after pre-publication checks (all) | `registerStamp` (hash only) immediate; `store/commit` and FilBeam exposure after the `ingest` checks | §2.2, §5.2 |
| No signing keys in media-parsing processes (security) | `api` = custodian (relayer, registrar, FOC session key; no media decoding); `worker`/`ml` = media, no secrets; six containers | §9.5 |
| Raw attestation bundles not public (security) | `attestationHash` on chain; bundle encrypted at rest, released on request; [v1] encrypted piece | §7.2 |
| Sealed mode salted/ciphertext hash (security) | [v1] `contentHash = sha256(ciphertext)`, salted plaintext commitment in the record; key wrapped to device key | §11.4 |
| Binding slots cap/reserve/replace; FWSS listener in-contract (security) | 8 slots: 4 for governed binders, 4 third-party; dead bindings replaceable; `getDataSetListener == FWSS` required | §4.4 |
| Enrolment signature covers whole key struct; proof of possession (security) | `KeyEnrolment` covers every field; `KeyPossession` self-signature required for every key | §4.2 |
| Storage panel leads with retrieval re-hash; mirror off-box at ingest (security) | `retrieval-probe` job; panel line 1 = last retrieval + hash check; S3-compatible bucket written at ingest | §5.4, §8.2 |
| Gate sharing on chain inclusion (security, product) | Share sheet enabled only after receipt *and* marked file | §8.4 |
| C2PA `digitalCapture` only for level ≥ 1 (security) | [v1] rule in §6.3 | §6.3 |
| `nonReentrant` around ERC-1271 (security) | `ReentrancyGuardTransient` + checks-effects-interactions | §4.3 |
| Never `findPieceIdsByCid(…, 0, …)` on chain (feasibility) | `pieceLive` + `getPieceCid` equality; `findPieceIdsByCid(setId, cid, pieceId, 1)` only as optional cross-check | §4.4 |
| No StateView immutable in a write path (feasibility) | `bindStorage` reads PDPVerifier only; views resolve `IFWSS(FWSS).viewContractAddress()` at call time inside try/catch | §4.4, §4.7 |
| Session key: AddPieces-only, pinned data sets, typed permissions (feasibility) | `requiredPermissions: [AddPiecesPermission]`, data sets created once from the cold payer, `dataSetIds` pinned | §5.1 |
| Budget with live price list (feasibility) | 0.12 USDFC/data set/month, 0.008 + 0.003/piece, 0.025 creation, 0.5 reserve | §5.5 |
| PieceCID bytes + sig + authData in state (feasibility) | `Stamp` stores all three | §4.1 |
| Guard getters with `dataSetLive` (feasibility) | `bindingStatus` short-circuits per binding | §4.7 |
| `synapse-core/piece` on Hermes is a spike (feasibility, product) | Week-1 spike; fallback = pure-JS fr32 tree over `@noble/hashes` / `react-native-quick-crypto`; video = server-computed, device-confirmed | §7.5, §13 |
| MVP scope cut; engineer-weeks; mainnet in MVP; six containers; no native modules; derivative not on FOC; 8+1 code; TS ~6.0.3; core on synapse-core; first-three-minutes UX; L1 wording (product) | All adopted | §6, §8.4, §9, §12 |

Where the critics conflicted (issuer-chosen CSPRNG code vs on-chain derivation; 24 h session keys vs no-KMS MVP) the trade-off and the choice are recorded in `ADRS.md` (ADR-004, ADR-012).

---

## 1. Trust model

### 1.1 What a stamp proves

A stamp `S` for bytes `B`, resolvable from any Filecoin RPC plus the public FOC provider endpoints, proves:

1. **Identity of bytes.** `sha256(B)` and `PieceCIDv2(B)` are fixed in `StampRegistry` state. Anyone holding a bit-identical copy proves it with `sha256sum`; anyone downloading the piece re-derives both.
2. **Device signature.** An enrolled device key signed the EIP-712 `CaptureClaim` over those identifiers; the registry verified the signature on chain (`ecrecover` for secp256k1 **[MVP]**, `P256VERIFY` at `0x0100` for Secure Enclave / Keystore keys **[v1 clients, MVP contract]**) and stored `sig` and `authData`, so the check can be re-run forever from `eth_call` alone.
3. **Time (upper bound).** The claim was included at epoch `E`; `block.timestamp = genesis + 30·E` exactly (mainnet genesis 1598306400, Calibration 1667326380). `B` existed no later than that instant. The device's `capturedAt` is a claim, shown separately.
4. **Storage.** `B` is a piece of one or more live FWSS-managed PDP data sets (`getDataSetListener == FWSS`, `dataSetLive`, `pieceLive`, `getPieceCid == pieceCid`), challenged 5× per proving period (mainnet 2880 epochs), with per-copy proof state readable on chain and a Stamper retrieval probe that actually downloads and re-hashes.
5. **Assurance level.** `S.level` is set by the chain from (a) the key's enrolment endorsement by a governed registrar and (b) either a per-capture registrar countersignature (the registrar checked App Attest / Play Integrity bound to this claim) or an on-chain hardware (P-256) signature. Nothing else can raise a level.

### 1.2 What it does not prove (printed on every verify page)

Not that the scene was real (screens, prints, staging — the analog hole); not that the phone was uncompromised (root exploits defeat attestation; Pixel 10 CVE-2026-43499 "won't fix"); not that the clock or location was honest; not that the stamper consented or is who an account says; not that the earliest stamp is the creator's; not that an unstamped or non-matching file is fake.

Fixed footer: *"Stamper shows when this file was registered, by what kind of device, and whether the copy you have matches the stored original. It does not judge what the picture shows."* The words "verified", "authentic", "real", "same" and "matches" never appear in the UI.

### 1.3 Assurance levels

| Level | UI sentence | How the chain gets it | Residual (disclosed) | When |
|---|---|---|---|---|
| **L0** | "Registered upload — device not attested" | Key enrolled without registrar endorsement, or stamp registered without countersignature from a software key (self-submit path) | anything | [MVP] contract; [v1] web uploads |
| **L1** | "Captured in the Stamper app — attestation checked by Stamper at upload" | Key endorsed at L1 by a governed registrar (App Attest attestation validated: x5c to Apple root, nonce, `apple_validation_category_01 ∈ {4, 2-in-TestFlight}`; or Play Integrity `PLAY_RECOGNIZED + LICENSED + MEETS_DEVICE_INTEGRITY` with `requestHash` bound to the key) **and** every capture countersigned by the registrar after checking a fresh assertion / token bound to `sha256(claimDigest ‖ serverChallenge)` | modified OS, leaked keybox, camera injection, analog hole; the chain verified the device signature and the countersignature, Stamper verified the attestation | [MVP] |
| **L2** | "Hardware-attested capture" | Key type `P256_APPATTEST` or `P256_RAW` endorsed at L2 (iOS: receipt exchanged, risk metric ≤ 5, key age ≤ 12 months; Android: Key Attestation chain to Google root, `origin == GENERATED`, TEE/StrongBox, `verifiedBootState ∈ {Verified, GrapheneOS-known}`, `MEETS_STRONG_INTEGRITY` where Play exists, CRL clean, `osPatchLevel ≤ 12 months`); every capture signed by that key and verified by `0x0100` on chain; CRL re-checked per capture by the registrar | unrevoked leaked keybox, private root exploit, analog hole | [v1] |
| **L3** | reserved | sensor evidence / C2PA Level-2 ingestion | analog hole scored, not excluded | [v2] |

The level is never printed in the code or badge text (it changes on revocation and would be read as "true"); the badge *family* differs by tier (§6.1) so Stamper never lends an identical mark to an L0 upload and an L2 capture. `effectiveLevel(stampId)` returns 0 when the key was revoked with `effectiveEpoch ≤ registeredEpoch`.

---

## 2. System architecture

### 2.1 Components

```
┌─────────────── Phone: Expo SDK 57 (Hermes) ───────────────┐   ┌──────────── Browser: Next.js 16.3 ────────────┐
│ expo-camera in-app capture · EXIF minimiser (no re-encode)│   │ /v/<code>: eth_call via Multicall3 (2 RPCs)   │
│ sha256 + PieceCID (synapse-core/piece | noble fr32 tree)  │   │ fetch original → re-hash (hash-wasm + piece)  │
│ EIP-712 CaptureClaim → secp256k1 sign [MVP] / P-256 [v1] │   │ compare slider · pixelmatch diff · evidence   │
│ App Attest / Play Integrity bound to the digest           │   │ upload-a-copy → api job → ladder verdict      │
│ resumable upload · offline queue (mmkv)                   │   │ QR scan (barcode-detector) · failure screens  │
└──────────────┬────────────────────────────────────────────┘   └──────────────┬────────────────────────────────┘
               │ HTTPS                                                          │ HTTPS / eth_call
┌──────────────▼───────────────────── VPS · Docker Compose (6 services) ───────▼────────────────────────────────┐
│ caddy ─ TLS, HSTS, /.well-known/{apple-app-site-association,assetlinks.json}                                   │
│ web   ─ Next.js (verify, share card, status)                                                                   │
│ api   ─ Hono: challenges · enrolment · uploads · claims · verify API · CUSTODIAN: relayer key, registrar key,  │
│         FOC session key (tx outbox + commit); never decodes media                                              │
│ worker─ same image, ROLE=worker: ingest checks (sharp/ffprobe/exif) · badge · PDQ · FOC store() · mirror ·     │
│         retrieval probe · NO SECRETS                                                                            │
│ ml    ─ FastAPI: TrustMark Q encode/decode, PDQ, SSIM · NO SECRETS                                             │
│ postgres (pgvector/pgvector:pg17) ─ data + BullMQ 6 queues                                                     │
│ [sidecar] offen/docker-volume-backup → S3-compatible bucket (also the off-box mirror)                          │
└──────────────┬──────────────────────────────────────────────┬─────────────────────────────────────────────────┘
               │ store() HTTP (worker) · commit() EIP-712 (api)│ eth_sendRawTransaction / eth_call (api)
┌──────────────▼───────────────────────┐          ┌────────────▼──────────────────────────────────────────────┐
│ Filecoin Onchain Cloud               │          │ Filecoin EVM 314 / 314159                                  │
│ FWSS data sets A (withCDN) + B       │◄─ reads ─│ StampRegistry (immutable) · StampResolver (owned, advisory)│
│ PDPVerifier proofs · FilBeam CDN     │          │ PDPVerifier 0xBADd…557F · FWSS 0x8408…1A9f · FilecoinPay   │
└──────────────────────────────────────┘          └────────────────────────────────────────────────────────────┘
```

### 2.2 Capture to shareable (photo, L1, MVP)

```mermaid
sequenceDiagram
  autonumber
  participant D as Phone (Expo)
  participant A as api (custodian)
  participant W as worker + ml
  participant R as StampRegistry
  participant F as FOC providers
  D->>A: POST /v1/captures {keyId} → {captureId, uploadId, challenge32 (5 min, single use)}
  D->>D: takePictureAsync → minimise EXIF → B; sha256(B); PieceCID(B); CaptureRecord (DAG-CBOR) → recordHash
  D->>D: claim = CaptureClaim{…}; digest = hashTypedData; sig = sign(digest)
  D->>D: assertion / Play token bound to sha256(digest ‖ challenge)
  D->>A: PUT /v1/uploads/{uploadId} (Content-Range; api tees sha256 + PieceCID while writing to staging)
  D->>A: POST /v1/captures/{id}/claim {claim, sig, attestation, record}
  A->>A: re-hash == claim; verify sig; verify attestation binding; predictCode(stampId) for the UI
  A->>A: registrar countersign CaptureCountersignature(stampId, 1)
  A->>R: registerStamp(claim, sig, "", countersig)  [relayer]
  A-->>D: 202 {stampId, predictedCode, status: "registering"}
  R-->>A: receipt (next tipset, 30–90 s) → StampRegistered(code)
  A-->>D: push "Registered · code K3Q9-XA2M-7" (code shown only now)
  A->>W: enqueue ingest(stampId)
  W->>W: decode check · EXIF check · dedupe/near-dup hint · abuse score → pass
  W->>W: badge (sharp) → TrustMark(code) → marked JPEG D; PDQ(B), PDQ(D); mirror B → bucket
  W->>A: enqueue attach(stampId, sha256(D), paramsHash) → attachDerivative [registrar sig, relayer]
  A-->>D: push "Share-ready" (share sheet unlocked: receipt ∧ D exists)
  W->>F: store(B, {pieceCid}) on provider A and provider B (plain HTTP, no key)
  W->>A: enqueue commit(stampId) → commit() with the session key ×2 → pieceIds
  A->>R: bindStorage(stampId, [{0, setA, pieceIdA}, {0, setB, pieceIdB}])
  W->>W: retrieval probe: GET /piece/{cid} from both providers → re-hash → last_ok_at
```

### 2.3 Verify by code

```mermaid
sequenceDiagram
  participant V as Browser
  participant N as Filecoin RPC (Glif ∥ Ankr)
  participant S as Provider /piece ∥ FilBeam ∥ mirror
  participant A as api (presentation only)
  V->>V: normalise code; check symbol; 40-bit value
  V->>N: Multicall3: stampByCode → getStamp, getKey, getBindings, getDerivatives, effectiveLevel
  V->>N: per binding: bindingStatus(stampId, i) (dataSetLive-guarded)
  V->>V: re-verify device signature from state (viem verifyTypedData / noble P-256)
  V->>S: GET piece (HEAD race; FilBeam first for data set A; mirror last) → stream → sha256 + PieceCID
  V->>A: GET /v1/stamps/{code} (renditions, flags, probe times, finality) — never needed for the verdict
  V-->>V: header: match outcome × tier sentence; compare; record; chain; storage; footer
```

### 2.4 Verify by uploaded copy

`sha256(copy)` → `firstStampOf` / `stampByDerivativeHash` on chain (exact) → else TrustMark decode (server, `ml`) → candidate stamp → else PDQ k-NN (pgvector) → candidates. Every non-exact path ends in "RELATED TO `<code>` — COMPARE" with the diff map in the header (§8.1).

---

## 3. Identifiers and data model

### 3.1 Content identifiers

| Identifier | Definition | Computed by | Stored |
|---|---|---|---|
| `contentHash` | `sha256(B)` of the exact stored bytes (EXIF-minimised capture; ciphertext in sealed mode [v1]) | device; api re-checks on upload | chain, DB |
| `pieceCid` | PieceCID v2 raw CID bytes `0x01 0x55 0x91 0x20 ‖ uvarint(mhLen) ‖ uvarint(padding) ‖ uint8(height) ‖ root32` (FRC-0069 Draft; text `bafkzcib…`). Validated on chain by a copy of PDPVerifier's `Cids.validateCommPv2` (prefix, minimal uvarints, `mhLen ≥ 34`, trailing 32-byte root) | photos: device (`@filoz/synapse-core/piece` `hasher()`; fallback pure-JS fr32 tree); video [MVP]: api computes while staging, device confirms `sha256` equality and signs | chain (bytes, ≈ 36–40 B), DB |
| `contentLength` | byte length of `B`; cross-checked against `rawPieceSize(padding, height)` bounds off chain | device | chain |
| `recordHash` | `sha256(DAG-CBOR CaptureRecord)` | device | chain |
| `derivedHash` | `sha256(D)` of each Stamper-rendered derivative | worker | chain via `attachDerivative` |
| `pdq`, `pdqQuality` | 256-bit PDQ + quality (`pdqhash` 0.2.8, one implementation for index and query) | ml | DB only (`bit(256)` HNSW) |

Rejected: IPFS/UnixFS CIDs (Hermes WebCrypto gap, no retrieval benefit; `sha256` already gives `sha256sum` interop); keccak-only PieceCID (saves nothing on FEVM, loses self-description).

### 3.2 Stamp id and key id

- `stampId = keccak256("\x19\x01" ‖ domainSeparator ‖ hashStruct(CaptureClaim))` — the EIP-712 digest itself. Domain `{ name: "Stamper", version: "1", chainId: 314 | 314159, verifyingContract: <registry> }`. Replay of a claim is "stampId already registered"; signature malleability is irrelevant because the id derives from the claim.
- `keyId`: P-256 keys `sha256(0x04 ‖ x ‖ y)` (= Apple's App Attest keyId); secp256k1 and ERC-1271 keys `bytes32(uint256(uint160(addr)))`.

### 3.3 Capture claim (EIP-712, signed by the device key)

```
CaptureClaim(bytes32 contentHash,bytes pieceCid,uint64 contentLength,uint8 mediaKind,uint64 capturedAt,
             bytes32 recordHash,bytes32 keyId,uint64 nonce,uint8 flags,uint64 deadline)
CLAIM_TYPEHASH = 0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d
```

- `mediaKind`: 1 image, 2 video. `capturedAt`: device wall clock, ms. `nonce`: per key; iOS App Attest keys use the assertion counter [v1], others a local counter. `flags`: bit0 `SEALED` [v1], bit1 `OFFLINE` (claim signed before any server challenge), bit2 `PIECECID_SERVER_COMPUTED` (video path), bits 3–7 reserved. `deadline`: unix seconds, `capturedAt/1000 + 72 h` (offline) or `+ 1 h` (online).
- `pieceCid` is **never empty**. EIP-712 hashes `bytes` members as `keccak256(pieceCid)`.

```ts
// packages/core/src/claim.ts — shared by mobile, web, api (abitype `TypedData`)
export const stamperDomain = (chainId: 314 | 314159, verifyingContract: Address) =>
  ({ name: 'Stamper', version: '1', chainId, verifyingContract }) as const
export const captureClaimTypes = { CaptureClaim: [
  { name: 'contentHash', type: 'bytes32' }, { name: 'pieceCid', type: 'bytes' },
  { name: 'contentLength', type: 'uint64' }, { name: 'mediaKind', type: 'uint8' },
  { name: 'capturedAt', type: 'uint64' }, { name: 'recordHash', type: 'bytes32' },
  { name: 'keyId', type: 'bytes32' }, { name: 'nonce', type: 'uint64' },
  { name: 'flags', type: 'uint8' }, { name: 'deadline', type: 'uint64' } ] } as const satisfies TypedData
```

### 3.4 Capture record (DAG-CBOR, codec 0x71, RFC 8949 §4.2.1 ordering, no floats)

```
{ v: 1, stampDomain: {chainId, registry}, contentHash, pieceCid, contentLength, mediaType, dims: {w, h[, durationMs, fps]},
  capturedAt, monotonicNs, platform: "ios"|"android"|"web", app: {id, version, build},
  capture: { source: "in-app-camera", facing, lensId, physicalCameraIds: [...], physicalOnly: true },
  serverChallenge: bytes32 | null, offline: bool,
  sanitised: { removed: ["GPS*", "Serial*", "Owner*", "MakerNote", "udta/©xyz"], kept: ["Orientation", "PixelXDimension", "PixelYDimension"] },
  publicExif: { make, model, exposure, iso, focalLength },
  attestation: { kind: "appattest"|"playintegrity"|"none", bundleHash: bytes32 },
  privateHash: bytes32 | null,            // sha256(dag-cbor(PrivateRecord)); PrivateRecord = { v: 1, salt: bytes32, location?: { latE7, lonE7, accuracyM, altitudeM?, fixAt } }
  sealed?: { plaintextCommitment: sha256(salt32 ‖ plaintext), cipher: "AES-256-GCM" },  // [v1]
  location?: { latE2, lonE2, source: "gps"|"network"|"fused"|"unknown" }  // opt-in; public 0.01° cell, requires privateHash
}
```

The private sub-record is encrypted **on device** to a per-stamp key wrapped to the device key (ECDH on a second Keystore/Secure-Enclave key [v1]; in the MVP, wrapped to a key derived from the secp256k1 device key via HKDF) and to Stamper's custodian key; only `privateHash` is public, so withholding it never breaks the signature.

### 3.5 Short verification code **[MVP]**

- 40-bit payload, 8 Crockford Base32 symbols (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I/L/O/U) + 1 mod-37 check symbol, displayed `XXXX-XXXX-C`. Decoding: case-insensitive, `I/L→1`, `O→0`, separators and spaces ignored, non-ASCII rejected (UTS #39 ASCII-only) before decoding.
- Derived **on chain, deterministically** from `stampId`: `code = uint40(uint256(keccak256(abi.encode(stampId, uint32 attempt))))`, incrementing `attempt` while `code % 37 ≥ 32` (would need a `*~$=U` check symbol) or `stampByCode[code] != 0` (collision). Reference outputs of this exact formula: `stampId = 0x11…11` → `5VEB-TVRA-F` (attempt 0); `0xab…ab` → `MR58-TTN8-D` (attempt 1); `0x07…07` → `6NJ9-RNXC-P`; `0xc3…c3` → `W0SB-9TAX-B`.
- The app predicts the code locally (attempt 0 in 86.5 % of cases) but **displays it only after the registration receipt**; the only chain-dependent event is a collision (≈ N/2^40, 10⁻⁵ at 10⁷ stamps).
- Properties: the check symbol guarantees any two valid codes differ in ≥ 2 symbols (a single substitution or adjacent transposition can never resolve to another live code: `k·32ⁱ ≢ 0 (mod 37)`). Nobody chooses codes (no hijack, no squatting, no vanity). Deliberate distance-2 look-alikes remain grindable by anyone (≈ 27k targets in 2^40) and are defended in the UI only: the page always shows the original and never confirms by code presence.
- Same 40 bits are the TrustMark `BCH_SUPER` payload (§6.2). Spoken form: NATO alphabet, in-app. Codes whose first symbol is `Z` are never emitted (`attempt++`), reserving a version marker.

### 3.6 Verify URL and QR

- Canonical URL: `https://stamper.media/v/K3Q9-XA2M-7` (domain `stamper.media`, the owner's probable choice of 2026-10-01; it is one config constant — `PUBLIC_ORIGIN` in services, `NEXT_PUBLIC_ORIGIN` in web, `extra.publicOrigin` in the Expo config — never hard-coded twice; path handler case- and hyphen-insensitive). Served as Apple Universal Link (`/.well-known/apple-app-site-association`, `components: [{"/": "/v/*"}]`) and Android App Link (`assetlinks.json`, `autoVerify`); HSTS preload.
- QR payload: `HTTPS://STAMPER.MEDIA/V/K3Q9XA2M7` — 33 characters, QR alphanumeric mode → **Version 2, ECC M (capacity 38), 25×25 modules**; ≥ 4 px/module + 4-module quiet zone ⇒ ≥ 132 px. Forensic QR (evidence export) appends the PieceCID as a **path segment** `/C/<PieceCID, base32 upper, multibase B>` (≈ 100–103 characters → Version 6-Q, capacity 108); a query string is not used because `?` and `=` are outside the QR alphanumeric set and would force byte mode. The web router accepts `/v/<code>/c/<cid>` case-insensitively.
- The QR lives on the share card and the verify page, never in the default badge (§6.1).

### 3.7 Piece metadata (FOC) **[MVP]**

Per piece (SDK limits: 3 keys, key ≤ 32 B, value ≤ 96 B): `stamp = K3Q9XA2M7` (9 symbols), `role = original`, `sha256 = <64 hex>`. Data set metadata (≤ 10 keys): `source = stamper` (`Synapse.create({ source: 'stamper' })`), `stamper.env = mainnet-v1 | calibration-v1`, `withCDN` on data set A only. Metadata is only emitted in the FWSS `PieceAdded` event since 1.4.0 — an indexer convenience, never a trust input.

### 3.8 Derivative ↔ original linkage

`Derivative { bytes32 contentHash; bytes pieceCid; uint8 kind; bytes32 paramsHash }` appended to `derivatives[stampId]` and indexed by `stampByDerivativeHash[contentHash] = stampId` — written **only** under a governed registrar's `DerivativeAttachment` signature ([v2]: or the stamp's device key). `kind`: 1 marked image, 2 marked video, 3 share card, 4 preview, 5 C2PA sidecar [v1], 6 record [v1]. `paramsHash = sha256(DAG-CBOR render params)` (badge family and geometry, font hash, JPEG quality, sharp/libvips/mozjpeg versions and image digest, TrustMark variant/schema/strength) so a third party can regenerate `D` from `B`. `pieceCid` is empty in the MVP (derivative bytes live on disk and in the mirror, not on FOC — ADR-011).

---

## 4. Smart contracts

Foundry, `solc 0.8.30`, `evm_version = "cancun"` (FEVM supports PUSH0, MCOPY, TLOAD/TSTORE; no blobs), `via_ir = true`, optimizer 200, OpenZeppelin Contracts 5.6.1 (`EIP712`, `ECDSA`, `Ownable2Step`, `ReentrancyGuardTransient`, `IERC1271`), forge-std 1.17 (vendored). Two contracts:

- **`StampRegistry`** — immutable, no proxy, no pause, no upgrade. The only privileged function set is registrar/binder membership under `governor` (a Safe via the singleton factory `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7`; a hardware-wallet EOA at MVP launch, transferred to the Safe with `transferOwnership` — ADR-018). The governor can never create, alter, re-point or delete a stamp.
- **`StampResolver`** — `Ownable2Step`, replaceable, advisory: moderation flags with reason URIs, verifier release hashes. The registry does not reference it.

### 4.1 Interface **[MVP contract, all paths]**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

struct Cid { bytes data; }                                      // == PDPVerifier Cids.Cid

interface IPDPVerifier {                                        // mainnet 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F / calib 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C
    function dataSetLive(uint256 setId) external view returns (bool);                                 // 0xca759f27
    function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool);                  // 0x1a271225  (reverts if !dataSetLive)
    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cid memory);          // 0x25bbbedf  (reverts if !dataSetLive)
    function findPieceIdsByCid(uint256 setId, Cid calldata cid, uint256 startPieceId, uint256 limit) external view returns (uint256[] memory); // 0x6a4991a1 — O(N) from 0; only ever (setId, cid, pieceId, 1)
    function getDataSetListener(uint256 setId) external view returns (address);                       // 0x2b3129bb
    function getDataSetStorageProvider(uint256 setId) external view returns (address, address);       // 0x21b7cd1c
    function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256);                // 0x04595c1a  (reverts if !dataSetLive)
    function getNextChallengeEpoch(uint256 setId) external view returns (uint256);                    // 0x6ba4608f
}
interface IFWSS { function viewContractAddress() external view returns (address); }                   // 0x7a9ebc15 — FWSS proxy 0x8408502033C418E1bbC97cE9ac48E5528F371A9f / 0x02925630df557F957f70E112bA06e50965417CA0
interface IFWSSStateView {                                                                            // resolved at call time, never pinned
    struct DataSetInfoView { uint256 pdpRailId; uint256 cacheMissRailId; uint256 cdnRailId; address payer; address payee; address serviceProvider;
        uint256 commissionBps; uint256 clientDataSetId; uint256 pdpEndEpoch; uint256 providerId; uint96 pendingOneTimePayments; uint96 lifecycleReserveBalance; uint256 dataSetId; }
    function getDataSet(uint256 id) external view returns (DataSetInfoView memory);                   // 0xbdaac056
    function provenThisPeriod(uint256 id) external view returns (bool);                               // 0x7598a1cd
    function provingDeadline(uint256 id) external view returns (uint256);                             // 0x149ac5cc
}

contract StampRegistry is EIP712("Stamper", "1"), Ownable2Step, ReentrancyGuardTransient {
    // ---- constants
    address constant P256VERIFY   = 0x0000000000000000000000000000000000000100;   // FIP-0113, EIP-7951 semantics
    uint256 constant P256_N_HALF  = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;
    bytes32 constant CLAIM_TYPEHASH   = 0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d; // CaptureClaim(...)            §3.3
    bytes32 constant ENROL_TYPEHASH   = 0x7cb29957345ff6dd94fc3cb78ee4044ae8619ff8786f86bb6c77f22c441843e7; // KeyEnrolment(bytes32 keyId,uint8 keyType,uint8 platform,uint8 level,bytes32 x,bytes32 y,address addr,bytes32 rpIdHash,bytes32 attestationHash,uint64 expiresAt)
    bytes32 constant POP_TYPEHASH     = 0xfc0478f5a3dfeff23ec3fb1779f37df3143b281d435c0e0de41764917e479cd8; // KeyPossession(bytes32 keyId,uint8 keyType,uint8 platform,bytes32 x,bytes32 y,address addr)
    bytes32 constant COUNTER_TYPEHASH = 0xf7fb5b96fbc4c59566fcca7f60f35138b0af22e784946255d4442bf44c788168; // CaptureCountersignature(bytes32 stampId,uint8 level)
    bytes32 constant REVOKE_TYPEHASH  = 0x169060174d2edeac658ea958ad9e96c24d210e733ea82d4211aa7de1653292da; // KeyRevocation(bytes32 keyId,uint64 effectiveEpoch,uint8 reason)
    bytes32 constant DERIV_TYPEHASH   = 0xa07110a54c833a87d3b59fba0bff52f23466711b8ae0691c319c8db808e704a8; // DerivativeAttachment(bytes32 stampId,bytes32 contentHash,bytes pieceCid,uint8 kind,bytes32 paramsHash)
    uint8 constant KT_SECP256K1 = 0; uint8 constant KT_P256_RAW = 1; uint8 constant KT_P256_APPATTEST = 2; uint8 constant KT_ERC1271 = 3;
    uint8 constant PF_WEB = 0; uint8 constant PF_IOS = 1; uint8 constant PF_ANDROID = 2;
    uint8 constant MAX_TRUSTED_BINDINGS = 4; uint8 constant MAX_THIRD_PARTY_BINDINGS = 4;
    uint64 constant ROLE_DELAY = 48 hours;

    IPDPVerifier public immutable PDP;      // proxy, stable address
    address      public immutable FWSS;     // proxy, stable address (StateView resolved via viewContractAddress())

    // ---- types
    struct CaptureClaim { bytes32 contentHash; bytes pieceCid; uint64 contentLength; uint8 mediaKind; uint64 capturedAt;
                          bytes32 recordHash; bytes32 keyId; uint64 nonce; uint8 flags; uint64 deadline; }
    struct KeyEnrolment { bytes32 keyId; uint8 keyType; uint8 platform; uint8 level; bytes32 x; bytes32 y; address addr;
                          bytes32 rpIdHash; bytes32 attestationHash; uint64 expiresAt; }
    struct DeviceKey    { uint8 keyType; uint8 platform; uint8 level; bytes32 x; bytes32 y; address addr; bytes32 rpIdHash;
                          bytes32 attestationHash; address registrar; uint64 enrolledEpoch; uint64 expiresAt; uint64 revokedEpoch; uint8 revokeReason; }
    struct Stamp        { bytes32 contentHash; bytes pieceCid; uint64 contentLength; uint8 mediaKind; uint64 capturedAt; bytes32 recordHash;
                          bytes32 keyId; uint64 nonce; uint8 flags; uint8 level; address countersigner; uint64 registeredEpoch; uint40 code;
                          bytes sig; bytes authData; }                       // sig/authData in STATE: re-verifiable from eth_call forever
    struct Binding      { uint8 asset; uint256 setId; uint256 pieceId; }     // asset 0 = original, n = derivatives[n-1]
    struct StoredBinding{ uint8 asset; uint256 setId; uint256 pieceId; address provider; address boundBy; uint64 boundEpoch; bool trusted; }
    struct Derivative   { bytes32 contentHash; bytes pieceCid; uint8 kind; bytes32 paramsHash; }
    struct KeyRevocation{ bytes32 keyId; uint64 effectiveEpoch; uint8 reason; }
    struct BindingStatus{ bool dataSetLive; bool pieceLive; bool cidMatches; bool listenerIsFWSS; uint256 lastProvenEpoch; uint256 nextChallengeEpoch;
                          bool viewOk; bool provenThisPeriod; uint256 provingDeadline; uint256 pdpEndEpoch; address payer; uint256 providerId; }

    // ---- storage
    mapping(bytes32 keyId   => DeviceKey) internal keys;
    mapping(bytes32 stampId => Stamp)     internal stamps;
    mapping(uint40 code     => bytes32)   public  stampByCode;              // 0x06315c72
    mapping(bytes32 hash    => bytes32)   public  firstStampOf;             // 0xba9ee7dd   contentHash → earliest stampId
    mapping(bytes32 hash    => bytes32)   public  stampByDerivativeHash;    // 0xd2b5ef39   governed writers only
    mapping(bytes32 keyId   => mapping(uint256 word => uint256)) public usedNonce;   // bitmap, order-independent
    mapping(bytes32 stampId => StoredBinding[]) internal bindings;
    mapping(bytes32 stampId => Derivative[])    internal derivatives;
    mapping(address => uint64) public registrarActiveFrom;   // 0 = not a registrar; else activation timestamp (announce + 48 h)
    mapping(address => uint64) public binderActiveFrom;      // trusted binders (relayer EOAs) — reserve binding slots only

    // ---- events
    event KeyRegistered(bytes32 indexed keyId, uint8 keyType, uint8 platform, uint8 level, address indexed registrar, bytes32 attestationHash, uint64 expiresAt);
    event KeyRevoked(bytes32 indexed keyId, uint64 effectiveEpoch, uint8 reason, address by, bool retroactive);
    event StampRegistered(bytes32 indexed stampId, uint40 indexed code, bytes32 indexed contentHash, bytes32 keyId, uint8 level, address countersigner,
                          bytes pieceCid, uint64 contentLength, uint8 mediaKind, uint64 capturedAt, bytes32 recordHash, uint64 nonce, uint8 flags, address submitter);
    event DerivativeAttached(bytes32 indexed stampId, bytes32 indexed contentHash, uint8 kind, bytes pieceCid, bytes32 paramsHash, address by);
    event StorageBound(bytes32 indexed stampId, uint8 asset, uint256 indexed setId, uint256 pieceId, address provider, address boundBy, bool trusted, uint8 slot);
    event StorageUnbound(bytes32 indexed stampId, uint8 slot, uint256 setId, uint256 pieceId, string reason);   // dead binding replaced
    event RoleAnnounced(address indexed who, bytes32 role, uint64 activeFrom);
    event RoleRemoved(address indexed who, bytes32 role, address by);
    event Commit(address indexed recorder, string indexed assetCid, string commitData);   // ERC-7053 interop; assetCid = multibase "f" + hex(pieceCid)

    // ---- governance (only membership; asymmetric)
    function addRegistrar(address r) external onlyOwner;        // 0xaf92a693  activeFrom = now + 48 h (event)
    function removeRegistrar(address r) external;               // 0xba904eed  owner OR r itself; immediate
    function addBinder(address b) external onlyOwner;           //            same delay
    function removeBinder(address b) external;                  //            owner OR b itself; immediate

    // ---- keys
    /// popSig: by the key itself over KeyPossession (same scheme as captures; authData for App Attest).
    /// endorsement: registrar signature over KeyEnrolment (whole struct) — empty ⇒ level 0, registrar = 0.
    /// An existing level-0 key may be upgraded in place by a later call carrying an endorsement.
    function registerKey(KeyEnrolment calldata e, bytes calldata popSig, bytes calldata endorsement) external;      // 0x1398790b
    /// sig by the key (any scheme) with effectiveEpoch >= block.number, or by the key's registrar (effectiveEpoch >= block.number),
    /// or msg.sender == owner (any effectiveEpoch; emits retroactive = true).
    function revokeKey(KeyRevocation calldata r, bytes calldata sig, bytes calldata authData) external;             // 0xa2ef6acc

    // ---- stamps (permissionless submission)
    function registerStamp(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData, bytes calldata countersig)
        external nonReentrant returns (bytes32 stampId, uint40 code);                                                 // 0x2f6b5cda
    function attachDerivative(bytes32 stampId, Derivative calldata d, bytes calldata registrarSig) external;        // 0x0ccc0cbe
    function bindStorage(bytes32 stampId, Binding[] calldata bs) external;                                          // 0x7fbbe178

    // ---- views (all usable from eth_call alone)
    function hashClaim(CaptureClaim calldata c) external view returns (bytes32);                                     // 0x262816bb == stampId
    function predictCode(bytes32 stampId) external view returns (uint40 code, uint32 attempt);                       // 0xb0a42028
    function verifyClaim(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData) external view returns (bool); // 0xee87517c
    function getStamp(bytes32 stampId) external view returns (Stamp memory);                                         // 0xd0eca23d
    function getKey(bytes32 keyId) external view returns (DeviceKey memory);                                         // 0x12aaac70
    function getBindings(bytes32 stampId) external view returns (StoredBinding[] memory);                            // 0x0d1fcab4
    function getDerivatives(bytes32 stampId) external view returns (Derivative[] memory);                            // 0xe519a798
    function bindingStatus(bytes32 stampId, uint8 slot) external view returns (BindingStatus memory);                // 0x10a4b0be
    function effectiveLevel(bytes32 stampId) external view returns (uint8);                                          // 0x1b020b5f
}
```

### 4.2 Key enrolment

`registerKey` requires a proof of possession for every key type (`KeyPossession` signed by the key: `ecrecover` for secp256k1, `0x0100` for P-256, `isValidSignature` for ERC-1271) — no key squatting. The endorsement (if present) must recover to an address with `registrarActiveFrom != 0 && registrarActiveFrom ≤ block.timestamp`, covers the **entire** `KeyEnrolment` struct (so an L2 endorsement cannot be replayed with a different `keyType`, `rpIdHash` or public key), and sets `level`, `registrar`, `attestationHash`, `rpIdHash`, `expiresAt`. Without an endorsement the key registers at level 0 with `registrar = 0` and can be upgraded in place later. `expiresAt` is 12 months by policy; expired keys cannot register stamps.

### 4.3 Stamp registration (normative)

```solidity
function registerStamp(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData, bytes calldata countersig)
    external nonReentrant returns (bytes32 stampId, uint40 code)
{
    DeviceKey storage k = keys[c.keyId];
    require(k.enrolledEpoch != 0, "NoKey");
    require(k.revokedEpoch == 0 || block.number < k.revokedEpoch, "KeyRevoked");
    require(block.timestamp < k.expiresAt, "KeyExpired");
    require(block.timestamp <= c.deadline, "Expired");
    require(c.mediaKind == 1 || c.mediaKind == 2, "Kind");
    _validateCommPv2(c.pieceCid);                                                   // copy of Cids.validateCommPv2 (prefix, minimal uvarints, mhLen >= 34, root)
    (uint256 w, uint256 bit) = (c.nonce >> 8, 1 << (c.nonce & 255));
    require(usedNonce[c.keyId][w] & bit == 0, "NonceUsed");
    stampId = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, c.contentHash, keccak256(c.pieceCid), c.contentLength, c.mediaKind,
                                                    c.capturedAt, c.recordHash, c.keyId, c.nonce, c.flags, c.deadline)));
    require(stamps[stampId].registeredEpoch == 0, "Dup");
    // ---- effects first (checks-effects-interactions; the ERC-1271 path makes an external call)
    usedNonce[c.keyId][w] |= bit;
    (code, ) = _deriveCode(stampId);
    uint8 level = 0; address cs;
    if (countersig.length != 0) {                               // countersig = uint8 level ‖ 65-byte ECDSA signature (66 bytes)
        require(countersig.length == 66, "CsLen");
        uint8 csLevel = uint8(countersig[0]);
        require(csLevel <= k.level, "CsLevel");                 // a registrar may vouch below the enrolment level, never above
        cs = ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(COUNTER_TYPEHASH, stampId, csLevel))), countersig[1:]);
        require(_isActiveRegistrar(cs), "NotRegistrar");
        level = csLevel;                                        // registrar vouched for THIS capture's attestation
    } else if (k.keyType == KT_P256_RAW || k.keyType == KT_P256_APPATTEST) {
        level = k.level;                                        // chain verifies the hardware key itself
    }                                                           // software key without countersignature ⇒ 0
    stamps[stampId] = Stamp(c.contentHash, c.pieceCid, c.contentLength, c.mediaKind, c.capturedAt, c.recordHash, c.keyId, c.nonce, c.flags,
                            level, cs, uint64(block.number), code, sig, authData);
    stampByCode[code] = stampId;
    if (firstStampOf[c.contentHash] == 0) firstStampOf[c.contentHash] = stampId;
    // ---- interaction last; a failure reverts every effect above
    require(_verifyDevice(k, stampId, sig, authData, c.nonce), "BadSig");
    emit StampRegistered(stampId, code, c.contentHash, c.keyId, level, cs, c.pieceCid, c.contentLength, c.mediaKind, c.capturedAt, c.recordHash, c.nonce, c.flags, msg.sender);
    emit Commit(msg.sender, string.concat("f", _hex(c.pieceCid)), "");
}

function _verifyDevice(DeviceKey storage k, bytes32 digest, bytes calldata sig, bytes calldata authData, uint64 nonce) internal view returns (bool) {
    if (k.keyType == KT_SECP256K1) return sig.length == 65 && ECDSA.recover(digest, sig) == k.addr;          // OZ enforces low-s
    if (k.keyType == KT_ERC1271)   return IERC1271(k.addr).isValidSignature(digest, sig) == 0x1626ba7e;        // [v2] Safe-owned stamps
    bytes32 h;
    if (k.keyType == KT_P256_RAW) {                                   // Android Keystore SHA256withECDSA / WebCrypto ECDSA-SHA256 over the 32-byte digest
        h = sha256(abi.encodePacked(digest));
    } else {                                                          // App Attest assertion: clientData := digest ⇒ clientDataHash = sha256(digest)
        require(authData.length == 37 && bytes32(authData[0:32]) == k.rpIdHash, "RpId");
        require(uint32(bytes4(authData[33:37])) == uint32(nonce), "Counter");   // nonce == assertion counter; monotonicity enforced by the registrar off chain
        h = sha256(abi.encodePacked(authData, sha256(abi.encodePacked(digest))));
    }
    require(sig.length == 64, "SigLen");
    (bytes32 r, bytes32 s) = (bytes32(sig[0:32]), bytes32(sig[32:64]));
    if (uint256(s) > P256_N_HALF) return false;                       // precompile does not reject high-s
    (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(h, r, s, k.x, k.y));   // 160-byte input; empty output == invalid; never reverts
    return ok && out.length == 32 && out[31] == 0x01;
}
```

Level rule, stated once: **a software secp256k1 signature alone never yields level ≥ 1.** The MVP relayer always carries the registrar countersignature (Stamper checked the per-capture App Attest assertion / Play Integrity token bound to `sha256(digest ‖ challenge)`); a self-submitted claim from the same key lands at L0 — correct, since nothing attested that capture. Hardware keys [v1] carry their enrolment level because the chain itself verified the hardware signature.

### 4.4 Storage binding (normative)

```solidity
function bindStorage(bytes32 stampId, Binding[] calldata bs) external {
    Stamp storage s = stamps[stampId]; require(s.registeredEpoch != 0, "NoStamp");
    bool trusted = _isActiveBinder(msg.sender);
    for (uint i; i < bs.length; i++) {
        Binding calldata b = bs[i];
        bytes memory want = b.asset == 0 ? s.pieceCid : derivatives[stampId][b.asset - 1].pieceCid;
        require(want.length != 0, "NoCid");
        require(PDP.getDataSetListener(b.setId) == FWSS, "NotFWSS");            // only Warm-Storage-managed sets carry proof→payment semantics
        require(PDP.dataSetLive(b.setId), "SetDead");
        require(PDP.pieceLive(b.setId, b.pieceId), "PieceDead");               // O(1); never findPieceIdsByCid from 0
        require(keccak256(PDP.getPieceCid(b.setId, b.pieceId).data) == keccak256(want), "CidMismatch");
        (address sp,) = PDP.getDataSetStorageProvider(b.setId);
        uint8 slot = _allocateSlot(stampId, b, trusted);                      // dedupe (setId, pieceId); reuse a dead slot first (emits StorageUnbound);
                                                                               // else append within the trusted/third-party caps
        bindings[stampId][slot] = StoredBinding(b.asset, b.setId, b.pieceId, sp, msg.sender, uint64(block.number), trusted);
        emit StorageBound(stampId, b.asset, b.setId, b.pieceId, sp, msg.sender, trusted, slot);
    }
}
```

`_allocateSlot` rules: a slot is *dead* when `!PDP.dataSetLive(setId)` or `!PDP.pieceLive(setId, pieceId)` (PDPVerifier reads only — payment termination is reported by the view, not used in the write path, so no StateView replacement can ever brick binding); dead slots are reusable by anyone; otherwise trusted binders use slots 0–3 and third parties slots 4–7 (`MAX_*_BINDINGS`). Griefing is bounded: a third party can fill at most four slots, and only with live FWSS pieces of the right CID; killing them frees them. Community re-pins remain first-class.

### 4.5 Code derivation

```solidity
function _deriveCode(bytes32 stampId) internal view returns (uint40 code, uint32 attempt) {
    for (;; attempt++) {
        code = uint40(uint256(keccak256(abi.encode(stampId, attempt))));
        if (code % 37 < 32 && stampByCode[code] == 0 && (code >> 35) != 31 /* first symbol 'Z' reserved */) return (code, attempt);
    }
}
```

`predictCode` exposes the same loop; the app runs it locally with `attempt` until the check passes and treats the result as provisional until the receipt.

### 4.6 Governance and revocation

- `addRegistrar/addBinder`: `activeFrom = block.timestamp + 48 h`, event; `removeRegistrar/removeBinder`: immediate, by owner or by the role holder itself (compromised key ⇒ any one of the two parties can cut it). Stamps and keys endorsed by a removed registrar keep their on-chain level; the verify page shows "registrar removed on <date>" and the resolver may flag.
- `revokeKey`: by the key (self-signed, same scheme as captures), by its registrar (ECDSA), or by the governor. Non-governor revocations must satisfy `effectiveEpoch ≥ block.number`; only the governor may set a retroactive `effectiveEpoch` and the event carries `retroactive = true` plus `reason`. `effectiveLevel(stampId)` returns 0 when `revokedEpoch != 0 && revokedEpoch ≤ registeredEpoch`.
- `attachDerivative`: `registrarSig` over `DerivativeAttachment` must recover to an active registrar; duplicates of `(stampId, contentHash)` revert; `stampByDerivativeHash` is first-writer-wins among governed writers only. [v2] adds a device-key path using `_verifyDevice`.

### 4.7 Views and gas

- `bindingStatus(stampId, slot)` is **per binding**: it checks `dataSetLive` first and returns zeros for the dependent fields when dead (every PDPVerifier getter reverts on dead sets); then `pieceLive`, CID equality, `getDataSetLastProvenEpoch`, `getNextChallengeEpoch`; then `try IFWSS(FWSS).viewContractAddress()` → `try view.getDataSet / provenThisPeriod / provingDeadline` with `viewOk = false` on any revert. Clients fan out with Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`, both networks); there is deliberately no monolithic aggregate view (FEVM external calls are expensive and public gateways cap `eth_call` gas).
- Gas: mainnet base fee at the 100 attoFIL floor, fee ≈ `gasLimit × premium (~2·10⁵ attoFIL)`. `registerStamp` ≈ 15 SSTOREs incl. dynamic `sig`/`pieceCid`, one `ecrecover` (+ one more for the countersignature), events ≈ 30–100 M Filecoin gas ≈ 6·10⁻⁶–2·10⁻⁵ FIL; `bindStorage` with two bindings ≈ 8 external views ≈ 20–60 M. Budget **$0.001 per stamp**. `P256VERIFY` gas is unmeasured (instrumented Wasm): week-1 wrapper measurement on Calibration, recorded, acted on only in v1.
- Receipts land next tipset: poll ≥ 120 s, re-check after 2 epochs for head reorgs; finality states **included → safe (≥ 30 epochs ≈ 15 min) → final** (`eth_getBlockByNumber("finalized")` ≥ epoch, or ≥ 900 epochs). Mainnet F3 has emitted no certificate since 2026-03-09; `finalized` is the FRC-0089 calculator (~20–30 epochs). The UI never promises seconds.
- Testing: `forge test --odyssey` (RIP-7212 `0x100` in revm) plus `vm.etch(0x100, daimo P256Verifier runtime)` as a second oracle, EIP-7951 vectors; Calibration fork tests for `PDPVerifier` reads (data set 1 is live) and for the exact `Cids.Cid.data` bytes `getPieceCid` returns (FRC-0069 is a Draft — pinned by vector before mainnet); an integration script that uploads a 200-byte piece with Synapse and binds it.
- Deployment: Calibration, then **mainnet inside the MVP**. `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --skip-simulation --slow --retries 10 --timeout 180`; verify on Blockscout (`--verifier blockscout --verifier-url https://filecoin.blockscout.com/api/`) and Filfox (`npx filfox-verifier`). ABIs and addresses via `@wagmi/cli` 2.10 foundry plugin into `packages/contracts-abi`.
- Indexing [v1]: Ponder in RPC mode (`ethGetLogsBlockRange: 360`; Lotus ≥ 1.36.3 caps ranges at 360 epochs) or a Goldsky subgraph. The verify page needs neither: all verdict inputs are in state.

### 4.8 `StampResolver` **[MVP]**

```solidity
contract StampResolver is Ownable2Step {
    enum Flag { None, WithdrawnByAuthor, TakedownLegal, Disputed, RejectedPrePublication, RegistrarRemoved }
    mapping(bytes32 stampId => Flag) public flag;
    mapping(string release => bytes32) public verifierHash;     // sha256 of published verifier bundles (web, CLI)
    event FlagSet(bytes32 indexed stampId, Flag flag, string reasonUri);
    event VerifierReleased(string release, bytes32 hash);
    function setFlag(bytes32 stampId, Flag f, string calldata reasonUri) external onlyOwner;
    function setVerifierHash(string calldata release, bytes32 h) external onlyOwner;
}
```

Flags never delete anything; the Stamper UI honours them, third parties may ignore them.

---

## 5. Storage on Filecoin Onchain Cloud

### 5.1 Ownership, payment, keys **[MVP]**

- **Payer** = one Stamper account held on a hardware wallet, never on the VPS. It deposits USDFC into Filecoin Pay and approves FWSS as operator once via `synapse.storage.prepare({ pieceSizes })` → `depositWithPermitAndApproveOperator`, with **capped** `rateAllowance` / `lockupAllowance` (90 days of projected rate + lockup; alert at 60 days, hard stop at 35 — the FOC lockup is 30 days).
- **Data sets** are created **once** from the payer: `A` (approved provider A, `withCDN: true`) and `B` (approved provider B, no CDN), chosen after a retrieval-latency test and confirmation that B supports SP-to-SP pull (unused in MVP). Their ids are pinned in config. New shards are opened by a payer ceremony, never implicitly.
- **Session key** (secp256k1, generated in the `api` container, Docker secret): `login(client, { address: sessionAddr, permissions: [AddPiecesPermission], expiresAt: now + 7 d, origin: 'stamper' })` on `SessionKeyRegistry` (`0x74FD50525A958aF5d484601E252271f9625231aB` / `0x518411c2062E119Aaf7A8B12A2eDf9a939347655`). The api runs `Synapse.create({ account: payerAddress, sessionKey: fromSecp256k1(pk), requiredPermissions: [AddPiecesPermission], chain, source: 'stamper' })` — typed `bytes32` permission constants from `@filoz/synapse-core/session-key`, not strings. 7-day expiry with a weekly hardware-wallet rotation and a documented `revoke()` runbook (ADR-012 records why not 24 h). The worker's Synapse instance is read-only (`account: payerAddress`, no signer).
- Blast radius of an api compromise: add pieces at Stamper's expense until `revoke()` or the allowance cap; never withdraw, create data sets, schedule removals or terminate.
- [v1] user-owned data sets and wallet self-custody via `createContext({ dataSetId })` under the user's own `SessionKeyRegistry` grant; the registry already treats every binding equally.

### 5.2 Upload path **[MVP]**

Order of operations is fixed by the moderation rule (§11.2): register first (hash only), commit to FOC after the `ingest` checks.

```ts
// worker (no secrets): upload bytes to both providers; SP verifies the PieceCID
const ro = await Synapse.create({ account: cfg.payerAddress, chain, source: 'stamper' })          // read-only instance
for (const ds of [cfg.ds.A, cfg.ds.B]) {
  const ctx = await ro.storage.createContext({ dataSetId: ds.id, providerId: ds.providerId })
  await ctx.store(stream, { pieceCid })                                                            // plain HTTP: POST pdp/piece → PUT …/upload/{uuid}
}
// api (custodian): commit with the AddPieces-only session key; pieceIds come back from the SP confirmation
const ctx = await synapse.storage.createContext({ dataSetId: ds.id, providerId: ds.providerId })
const { txHash, pieceIds, dataSetId } = await ctx.commit({ pieces: [{ pieceCid, pieceMetadata: { stamp: code, role: 'original', sha256 } }] })
enqueue('bind', { stampId, bindings: [{ asset: 0, setId: dataSetId, pieceId: pieceIds[0] }] })
```

`commit` is retried without re-upload. `pieceBatching` stays enabled in the api so concurrent commits share one `addPieces` call (0.008 + 0.003/piece). The split (signer-less `store()` in the worker, `commit()` in the api on a context created with the same pinned `dataSetId`/`providerId`) is exercised end to end by the week-1 integration script on Calibration before any mobile work depends on it. The SDK's `upload({ copies: 2 })` one-shot is not used because the signer (api) and the uploader (worker) are different processes by design. Devices never run the SDK (no React Native support, no WebCrypto on Hermes); only `synapse-core/piece`'s hasher runs there.

### 5.3 Retrieval **[MVP]**

Verify-page order: (1) FilBeam `https://{payer}.filbeam.io/{pieceCid}` for data set A (402 = quota exhausted → skip); (2) provider `{serviceURL}/piece/{pieceCid}` for every binding, resolved on chain (`bindingStatus.providerId` → `ServiceProviderRegistry` `0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB` / `0x839e5c9988e4e9977d40708d0094103c0839Ac9D` via `@filoz/synapse-sdk/sp-registry`), parallel `HEAD`, first 200 wins; (3) Stamper mirror `https://stamper.media/m/{pieceCid}` (bucket-backed, `ETag = sha256`). **Every path** streams through `Piece.transformStream()` + `hash-wasm` sha256 in the browser and compares with chain state before the word "original" is rendered; the page names the source that served the bytes. During the first minutes (registered, not yet bound) the page serves the mirror and says *"served by Stamper; Filecoin storage proof pending (usually < 5 min)"*. No public IPFS gateway is in the path.

### 5.4 Durability, monitoring, repair **[MVP]**

- PDP proves possession of a data set, not of each piece: a provider that lost one piece passes `pieceLive`, `provenThisPeriod` and `dataSetLive` for weeks (≈ 78 % detection in 30 days at 1 % loss). Therefore the **primary health signal is retrieval**: the `retrieval-probe` job downloads every new piece from each bound provider at bind time, then a weekly 2 % random sample per provider, re-hashes, and records `last_ok_at`; the panel's first line is *"Last retrieval check from provider A: 3 h ago — hash matched"*.
- Three copies from ingest: two FOC copies plus the **off-box mirror** — every original is written to an S3-compatible bucket (Hetzner Object Storage / Backblaze B2 / Cloudflare R2; not MinIO, archived 2026-04) by the worker *before* the FOC store, with a local disk cache for serving.
- `pdp-monitor` (every 10 min, Multicall3): per data set `getDataSetLastProvenEpoch`, `getNextChallengeEpoch`, view `provenThisPeriod`, `provingDeadline`, `getDataSet().pdpEndEpoch / lifecycleReserveBalance`; log subscriptions in 360-epoch windows for `FaultRecord`, `PiecesRemoved`, `DataSetDeleted`, `PDPPaymentTerminated`, `ServiceTerminated`; Filecoin Pay runway via `getAccountInfoIfSettled` → `fundedUntilEpoch`. Alerts via ntfy: proving overdue, two consecutive faults, `pdpEndEpoch != 0`, runway < 60 days, FilBeam 402, probe failure.
- Repair: a provider failing probes for 3 days ⇒ re-upload from the mirror into a third data set at another approved provider and `bindStorage` again; the dead slot is reused (`StorageUnbound` keeps history). Nothing in the registry is edited.
- Calibration storage is not persistent; demos run on mainnet.

### 5.5 Cost per stamp (live `getPriceList()`, 2026-10-01)

| Item | Photo 4 MiB (original only on FOC, 2 copies) | Video 100 MB |
|---|---|---|
| Add-pieces: 2 pieces × 0.003 + batch share of 0.008 | ≈ 0.007 USDFC | ≈ 0.007 USDFC |
| Storage 2.5 USDFC/TiB/month × 2 copies | ≈ 0.00002 USDFC/month | ≈ 0.0005 USDFC/month |
| Gas: `registerStamp` + `attachDerivative` + one batched `bindStorage` | ≈ $0.0001 budgeted (≈ $0.00003 actual) | same |
| FilBeam egress (originals on explicit click; 7 USDFC/TiB cache miss) | ≈ 0.03 USDFC per 1,000 full-size views | previews from Stamper |
| **Year one, all-in** | **≈ $0.008** | **≈ $0.015 + egress** |

Fixed: 2 data sets × 0.12 USDFC/month + 0.5 USDFC lifecycle reserve each + 0.025 creation; VPS ≈ $40–60/month; EAS Starter $19; Apple $99/yr. At 10k stamps/month the bill is ≈ $150, of which Filecoin ≈ $80. The per-piece fee is the lever; batching is the tuning. Abuse, not Filecoin, sets the free-tier limits.

---

## 6. Marking pipeline

| Layer | Image | Video | Runs on | When |
|---|---|---|---|---|
| Hard binding | sha256 + PieceCID of the EXIF-minimised capture; device signature | same | device (video PieceCID: api computes, device confirms) | [MVP] |
| Visible badge | `sharp` 0.35.5 `composite()` SVG pill; family by tier (§6.1); mozjpeg q92 4:4:4 | ffmpeg 7 (static, in container): pre-rendered badge PNG `overlay`, libx264 `-crf 20 -preset medium -movflags +faststart -c:a copy` | worker | [MVP] |
| Invisible watermark | TrustMark Q `BCH_SUPER`, payload = 40-bit code, strength 1.0 (`trustmark` 0.9.2 in `ml`; weights mirrored into the image) | none [MVP]; PixelSeal/Video Seal GPU worker [v2] | ml | [MVP] images |
| Perceptual index | PDQ + quality for original and every rendition, 8 dihedral + 2 centre crops as extra rows; pgvector HNSW `bit_hamming_ops` | vPDQ 1 fps + scene changes [v1] | ml | [MVP] images |
| C2PA | sidecar `.c2pa` for the original (bytes untouched), embedded in derivatives; `@contentauth/c2pa-node` 0.9.9 | MP4/MOV | api-side `CallbackSigner` [v1] | [v1] |

Device vs server: what decides a verdict (hash, signature) runs on device; what is derived and re-verifiable (badge, watermark, derivative hash, C2PA) runs on the server and is bound on chain under `paramsHash`. A dishonest server can only produce a derivative that fails to match the original. The on-device Skia preview badge is never shared; the share sheet waits for the canonical bytes.

### 6.1 Badge families **[MVP]**

Geometry relative to the short side `S`: pill height `0.05·S`, radius `h/2`, margin `0.03·S`, bottom-right, inset to survive a central 4:5 crop; code cap height ≥ `0.016·S` (≥ 17 px at 1080) in JetBrains Mono Bold (slashed zero, tabular figures), font file hashed into `paramsHash`. No QR in the badge (a scannable QR needs ≈ 12 % of the short side after a 1080 px downscale). No checkmarks, no green, survives greyscale (WCAG 1.4.3/1.4.11).

| Family | Tier | Content | Default |
|---|---|---|---|
| **F0** | L0 | plain grey pill, text `REGISTERED UPLOAD · K3Q9-XA2M-7`, no glyph, no wordmark | **off** for web uploads [v1] (opt-in); on for L0 app captures |
| **F1** | L1 | dark pill `rgba(0,0,0,.62)`, Stamper glyph, `K3Q9-XA2M-7`, `stamper.media` at 60 % | on |
| **F2** | L2 [v1] | F1 plus a hardware-key mark (`HW`) after the glyph | on |

All three are forgeable with any image editor; the verify page is the authority. What the families buy is that Stamper never issues a pixel-identical mark for an L0 upload and an L2 capture.

**Share card** (`share-card.png`, 1080×1350): large QR (V2-M at ≥ 8 px/module), code, tier sentence, "verify at stamper.media". Rendered by the worker on demand.

### 6.2 Invisible watermark **[MVP images]**

TrustMark Q, `MODE='binary'`, schema `BCH_SUPER` (40 data bits, corrects 8 flips, false-accept ≈ 2·10⁻⁶), strength 1.0 (≈ 43 dB), tuned on the platform push-through harness (WhatsApp/Instagram/X/Telegram) in week 6. Decode on verify: server (`ml`); browser decoder (`onnxruntime-web` 1.30) [v1]. A decoded code is a **lookup key**: it selects a candidate stamp whose original is then shown for comparison; it never produces a verdict on its own (public encoder ⇒ transplantable).

### 6.3 C2PA **[v1]**

Original: external manifest (sidecar `.c2pa`, own derivative `kind = 5`), `c2pa.created` + `digitalSourceType = …/digitalCapture` **only when `effectiveLevel ≥ 1`**; L0 assets get `c2pa.published` and no source type. Derivative: embedded manifest, ingredient `parentOf` = original, actions `c2pa.opened`, `c2pa.watermarked.unbound` (badge), `c2pa.watermarked.bound` with `c2pa.soft-binding { alg: "com.adobe.trustmark.Q", blocks: [{ scope: {}, value: "0*<100-bit string>" }] }`, custom assertion `media.stamper.anchor { stampId, code, contentHash, pieceCid, derivedHash, registry: { chainId, address, txHash, epoch }, level }`. Signer: self-issued ES256 (validators say "unknown source", stated on our page) → Conformance Program L1 + SSL.com cert when listed. `c2pa.repository-receipt` update manifests and the Soft Binding Resolution API are [v2].

---

## 7. Capture and keys

### 7.1 Common **[MVP]**

- Live capture only: `expo-camera` 57.0.6 `takePictureAsync({ exif: true })` / `recordAsync({ maxDuration: 180, maxFileSize: 500 MB })`; no picker, no share-sheet import, no `ACTION_IMAGE_CAPTURE`; physical camera ids recorded; external/virtual devices refused.
- EXIF/MP4 minimiser in `packages/core` (pure TS, no pixel re-encode; `exifr` parse + own APP1 rewriter; MP4 `udta`/`©xyz` atom removal): keeps Orientation and pixel dimensions, drops GPS, serials, owner, MakerNote. Golden tests on both platforms (a wrong minimiser silently rotates or leaks GPS).
- Hashing: photos via `@noble/hashes` sha256 + `synapse-core/piece` hasher over `file.bytes()`; videos via `react-native-quick-crypto` 1.1.7 streaming `createHash` over `FileHandle.readBytes(1 MiB)`; PieceCID of video is computed by the api while staging and returned with its sha256 — the device checks the sha256 equals its own and only then signs the complete claim (`flags.PIECECID_SERVER_COMPUTED`). A wrong server PieceCID can only make the stamp unbindable (visible on the page), never bind foreign bytes.
- Claim signing: viem `hashTypedData` on Hermes; `react-native-get-random-values` first import.
- **No custom native modules in the MVP.** `@expo/app-integrity` 57.0.2 behind a `DeviceAttestation` interface; EAS development builds (attestation is meaningless in Expo Go / simulators).

### 7.2 Keys **[MVP: software secp256k1; v1: hardware P-256]**

- MVP device key: `viem/accounts` `generatePrivateKey()` in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, backup off, `requireAuthentication` optional); one key per device per account; `keyId = bytes32(uint160(addr))`; enrolled via `registerKey` with `KeyPossession` self-signature and the registrar's `KeyEnrolment` endorsement at L1 when the attestation below passes.
- iOS enrolment: `generateKeyAsync()` → `GET /v1/attest/challenge` (32 B, 5 min, single use) → `attestKeyAsync(appAttestKeyId, sha256(addr ‖ challenge))` → `POST /v1/devices/ios`. Server (`node-app-attest` 1.0.1 extended for `apple_validation_category_01` / `apple_bundle_version_01`): x5c to the Apple App Attestation Root CA, nonce, `keyId == sha256(pubkey)`, rpIdHash, counter 0, production AAGUID, category 4 (App Store) / 2 (TestFlight, non-prod); receipt exchanged at `data.appattest.apple.com` for the risk metric. Per capture: `generateAssertionAsync(appAttestKeyId, sha256(digest ‖ challenge))` → server verifies signature, counter strictly increasing, rpIdHash → countersigns.
- Android enrolment: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)` at app start; `requestIntegrityCheckAsync(base64url(sha256(addr ‖ challenge)))`; `generateHardwareAttestedKeyAsync('stamper-capture-v1', challenge)` + `getAttestationCertificateChainAsync` collected and **stored** (chain verification is v1). Server decodes the token via `playintegrity.googleapis.com/v1/{pkg}:decodeIntegrityToken` (service account; 10k/day default quota, increase requested before launch): `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`, fresh `timestampMillis`, `requestHash` match. Per capture: standard token with `requestHash = base64url(sha256(digest ‖ challenge))` → countersign. Devices without Play services: L0 with the sentence "Google-free device" until the Key Attestation verifier ships [v1].
- Attestation bundles (`attestationObject`, receipt, token verdict, chain) are hashed (`attestationHash` on chain) and stored **encrypted at rest** in Postgres and the bucket; released to auditors/courts on request. [v1] encrypted piece on FOC with a documented release flow. Never published raw (keybox certificates are a cross-service device fingerprint).
- [v1] hardware signing: iOS — the App Attest key *is* the signer (`KT_P256_APPATTEST`, `clientData := digest`, assertion `authenticatorData` travels with the claim, `nonce = counter`); Android — a ~150-line local Expo module `stamper-keys` (`KeyGenParameterSpec` secp256r1, `setAttestationChallenge`, StrongBox with TEE fallback, `setUserAuthenticationParameters(300 s, BIOMETRIC_STRONG | DEVICE_CREDENTIAL)`, `SHA256withECDSA`, DER→raw r‖s); Key Attestation verified by a small JVM service around `android/keyattestation` (roots `attestation/root`, CRL `attestation/status`, `attestationApplicationId`), CRL re-checked at every L2 capture. Switching needs no redeploy: the key types exist in the immutable registry from day one.
- Rotation and revocation: keys expire after 12 months; rotation = `registerKey` of the new key with a continuity signature by the old key inside the attestation bundle; revocation by the key, by the registrar (CRL hit, risk-metric spike), or retroactively by the governor. [v2] monthly re-keying for unlinkability.

### 7.3 Web **[v1]**

Passkey login (identity) → non-extractable WebCrypto P-256 key (`KT_P256_RAW`, L0, `registerKey` with popSig, no endorsement) → `getUserMedia` capture or plain upload (treated identically) → hash in a Web Worker (`hash-wasm` 4.12 + `synapse-core/piece`) → `signTypedData`. Label "Registered upload — device not attested"; badge family F0 off by default; strictest quotas.

### 7.4 What the server verifies before relaying **[MVP]**

Re-computed `sha256` and PieceCID of the staged bytes equal the claim (mismatch ⇒ reject); `contentLength`; `pieceCid` passes `validateCommPv2` and its `rawPieceSize` bounds contain `contentLength`; EIP-712 signature against the enrolled key; nonce unused; deadline in the future; attestation bound to `sha256(digest ‖ challenge)` and fresh (challenge single-use, 5-min TTL); counter progression (iOS); `capturedAt` within ±10 min of receipt (else flagged `OFFLINE`, not rejected); record hashes to `recordHash`. The api does not decode media; decodability, EXIF sanitisation and `mediaKind` are checked by the worker's `ingest` job after registration — a stamp whose bytes fail those checks is flagged `RejectedPrePublication` in the resolver and never gets a marked copy or a FOC commit (its hash remains registered, which is harmless).

### 7.5 Offline capture **[MVP]**

Photo claims are signed at capture (full PieceCID on device) with `deadline = capturedAt + 72 h`, `flags.OFFLINE`, `serverChallenge = null`; queued in `react-native-mmkv` 4.3 (encrypted) with the file in the cache; uploaded when online (`File.createUploadTask`, iOS background session; Android foreground with an explicit "keep the app open while uploading" notice). Video claims without an on-device PieceCID are signed at upload time (the device still signs; `capturedAt` is the device clock). Attestation is requested at upload and the page says *"captured offline; device attested on upload"*. [v1] L2 offline claims are limited to 24 h.

---

## 8. Verification flows

### 8.1 Decision procedure and verdict ladder **[MVP]**

```
0  normalise: sniff type; image decoded once (EXIF-rotated); video → ffprobe (worker/ml, never api)
1  EXACT     sha256(copy) == stamps[firstStampOf[h]].contentHash                → ORIGINAL
             sha256(copy) ∈ stampByDerivativeHash (governed writer by construction) → STAMPER MARKED COPY of <code>
             (PieceCID recomputed too; a PieceCID hit without a sha256 hit is a bug → alert, no verdict)
2  CODE      typed / scanned / OCR'd code → that stamp → RELATED TO <code> — COMPARE
3  WATERMARK TrustMark decode (BCH_SUPER valid) → stampByCode → RELATED TO <code> — COMPARE
4  PERCEPT   PDQ (quality ≥ 50) + 8 dihedral + 2 crops → pgvector k-NN (k = 20) → keep ≤ 31 bits → SSIM re-rank
             → RELATED TO <code> — COMPARE (all candidates within 5 bits shown; never an auto-pick)
5  NONE      NOT REGISTERED ("no registered original found" — never "fake")
```

One ladder, four words: **ORIGINAL** (byte-exact; links the chain record), **STAMPER MARKED COPY** (byte-exact to a derivative attached under a governed signature), **RELATED TO `<code>` — COMPARE** (everything else, with the diff map and PDQ distance in the header, not below the fold), **NOT REGISTERED**. Only the first may say "original"; the words "same", "matches", "identical" are banned for non-exact outcomes. Verdicts come from `eth_call` state and the browser's own re-hash; the api supplies presentation only.

### 8.2 Verify page layout **[MVP]**

1. **Header**: two lines — match outcome × capture-tier sentence ("Captured in the Stamper app — attestation checked by Stamper at upload; the chain verified the device's signature and Stamper's countersignature") — over the permanent footer (§1.2).
2. **Compare**: original streamed from FOC/FilBeam/mirror and re-hashed ("hash matches chain ✓" or "fetching…"), `react-compare-slider` 4 against the share copy or the viewer's upload, `pixelmatch` 7 diff overlay, SSIM; video: side-by-side players.
3. **Record**: code, stampId, sha256, PieceCID (copyable), size, three times (device `capturedAt`, Stamper `receivedAt`, chain epoch → UTC), level with "means / does not mean", key id, registrar, revocation if any.
4. **Chain**: tx hash, epoch, state (included / safe / final), Blockscout and Filfox links, the signed claim and the device signature re-verified in the browser from `getStamp` state (`verifyTypedData` / noble P-256), the countersigner.
5. **Storage**: per binding — line 1 *"last retrieval check: <time>, hash matched"*; then provider, data set, piece id, live, proven this period, next deadline, faults, payment active, source that served the bytes; PDP explorer link.
6. **Evidence**: JSON bundle (claim, sig, authData, countersig, txs, epochs, PieceCIDs, bindings, attestationHash, paramsHash, probe log). PDF, OTS and RFC 3161 are [v1]/[v2].

Designed failure screens (not toasts): *Registering* ("stamped 40 s ago; the code appears when the chain confirms, usually < 2 min"); *Filecoin proof pending* (original served by Stamper); *Original temporarily unavailable* (hash-only comparison offered); *Rejected before publication*; *Withdrawn / takedown* (record shown, bytes not served, reason URI); *Device key revoked after this stamp* (date; stamp stays valid); *Registrar removed*; *Several candidates*; *Mismatch* (diff map); *Invalid code* (check symbol failed); *Not registered*.

### 8.3 Independent verification (chain + Filecoin only) **[MVP docs; CLI v1]**

Published as `docs/verify-independently.md`:

```
RPC=https://api.node.glif.io/rpc/v1 ; REG=<StampRegistry, published per chain>
1. ID=$(cast call $REG "stampByCode(uint40)(bytes32)" <40-bit value> --rpc-url $RPC)
2. cast call $REG "getStamp(bytes32)" $ID       → contentHash, pieceCid, keyId, level, countersigner, registeredEpoch, sig, authData
   cast call $REG "getKey(bytes32)" <keyId>     → keyType, x/y or addr, level, registrar, revokedEpoch
   cast call $REG "getBindings(bytes32)" $ID    → [(asset, setId, pieceId, provider, boundBy, trusted)]
3. Recompute the EIP-712 digest from the claim fields; verify sig against the key (viem verifyTypedData / noble P-256 with sha256(digest) or sha256(authData ‖ sha256(digest)))
4. Per binding (mainnet PDPVerifier 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F):
   cast call $PDP "dataSetLive(uint256)(bool)" $SET ; "pieceLive(uint256,uint256)(bool)" $SET $PIECE
   cast call $PDP "getPieceCid(uint256,uint256)((bytes))" $SET $PIECE   == pieceCid
   cast call $PDP "getDataSetListener(uint256)(address)" $SET          == 0x8408502033C418E1bbC97cE9ac48E5528F371A9f
   VIEW=$(cast call 0x8408502033C418E1bbC97cE9ac48E5528F371A9f "viewContractAddress()(address)")
   cast call $VIEW "provenThisPeriod(uint256)(bool)" $SET ; "provingDeadline(uint256)(uint256)" $SET ; "getDataSet(uint256)" $SET
5. Provider URL from ServiceProviderRegistry 0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB (providerId → serviceURL)
   curl -o original.bin "{serviceURL}/piece/<pieceCid>"   or   https://<payer>.filbeam.io/<pieceCid>
6. sha256sum original.bin == contentHash ; node -e 'Piece.calculate(bytes)' == pieceCid
7. date -u -d @$((1598306400 + 30*registeredEpoch)) ; eth_getBlockByNumber("finalized") for finality
```

Two RPC providers (Glif + Ankr) are queried and compared by the web page and, in v1, by `packages/verify-cli`, whose release hash is published through `StampResolver.setVerifierHash`.

### 8.4 The first three minutes **[MVP]**

(a) After `202` the app shows *"Registering on Filecoin… do not share yet"* with the predicted code greyed out; the code becomes definitive and copyable at the receipt. (b) The share sheet is enabled only when the receipt exists **and** the marked file has been downloaded; until then the Skia preview is clearly watermarked "preview". (c) If the relayer transaction reverts (e.g. the key was revoked meanwhile), the app receives a push, the claim is re-signed with a new nonce, and the superseded prediction never resolves — the UI explains the re-issue. (d) The verify page for a registered-but-unbound stamp serves the mirror with the *Filecoin proof pending* line rather than an empty storage panel. (e) Android shows the foreground-upload notice; iOS uses background sessions.

---

## 9. Apps and services

### 9.1 Monorepo (`stamper`)

```
packages/core            @stamper/core: code codec (encode/decode/normalise, predictCode), EIP-712 types + hashing, DAG-CBOR record (@ipld/dag-cbor),
                         PieceCID helpers (imports ONLY '@filoz/synapse-core/piece'; pure-JS fr32 fallback), EXIF/MP4 minimiser. Zero Node built-ins.
packages/contracts-abi   @wagmi/cli 2.10 foundry plugin output (ABIs, addresses per chain, viem actions)
packages/verify-cli      [v1] stamper-verify (viem + synapse-core only)
contracts/               Foundry: StampRegistry.sol, StampResolver.sol, lib Cids (copied validator), test/ (odyssey + daimo etch + Calibration fork), script/Deploy.s.sol
apps/mobile              Expo 57.0.26 (RN 0.86.3), expo-router, expo-camera 57.0.6, expo-file-system 57.0.7, expo-secure-store, @expo/app-integrity 57.0.2,
                         react-native-quick-crypto 1.1.7 (+nitro-modules, quick-base64), react-native-get-random-values 2, react-native-mmkv 4.3,
                         @shopify/react-native-skia 2.13 (preview badge only), viem 2.57, @tanstack/react-query 5, zod 4 — EAS development builds, TestFlight + Play internal track
apps/web                 Next.js 16.3.8, React 19.2, viem 2.57 (read-only; wagmi 3.7 only on the [v1] self-submit page), hash-wasm 4.12, barcode-detector 3.2,
                         react-compare-slider 4, pixelmatch 7, ssim.js 3.5 (worker)
services/api             Hono 4.13 + @hono/node-server 2.1 on node:24-bookworm, drizzle-orm 0.45 + pg 8.23, zod 4, pino 10, bullmq 6.3 (Postgres backend),
                         node-app-attest 1.0.1, googleapis 182, @filoz/synapse-sdk 2.0.2 (session key), viem relayer; ROLE=api | ROLE=worker entrypoints
services/worker          same image, ROLE=worker: sharp 0.35.5, ffmpeg 7 static, exifr, pdq via ml, synapse-sdk read-only (store()), S3 client for the mirror
services/ml              Python 3.12: fastapi 0.142 + uvicorn 0.54, trustmark 0.9.2 (torch CPU), pdqhash 0.2.8, scikit-image 0.26; endpoints /watermark/{encode,decode}, /pdq, /ssim on the shared volume
tooling/                 docker-compose.yml, Caddyfile, .maestro/, .github/workflows/
```

Repo corrections applied by this design: pin **`typescript ~6.0.3` workspace-wide** (7.0.2 ships no programmatic API until 7.1; breaks `jest-expo`/typescript-eslint; Expo 57 pins ~6.0.3); `packages/core` depends on **`@filoz/synapse-core`** (import only `/piece`), **not** `@filoz/synapse-sdk`, so the mobile bundle never pulls the SDK; `contracts/foundry.toml` gains `solc = "0.8.30"`, `evm_version = "cancun"`, `via_ir = true`, `optimizer_runs = 200`, `[profile.default.fuzz] runs = 256`, and `[rpc_endpoints] calibration/mainnet`. Biome 2.5 for lint; vitest 5 (packages, web, api), jest-expo 57, Maestro for mobile E2E, Playwright 1.63 for the verify flow.

### 9.2 API surface (`services/api`, prefix `/v1`)

```
GET  /attest/challenge                       → {challengeId, challenge (32 B b64), expiresAt}
POST /devices/{ios,android}                  → {keyId, level, txHash}                     (enrolment; web [v1])
POST /captures                               → {captureId, uploadId, challengeId, challenge}
PUT  /uploads/{uploadId}                     Content-Range resumable; 409 on gaps; 201 {sha256, pieceCid} when complete
POST /captures/{id}/claim                    {claim, sig, attestation, record} → 202 {stampId, predictedCode, status}
GET  /stamps/{code}                          presentation record: status, finality, renditions, bindings + probe times, flags, level sentence
GET  /stamps/{code}/{share.jpg|share.mp4|share-card.png|preview.jpg|thumb.webp}
GET  /stamps/{code}/original                 302 → FilBeam / provider; streamed mirror proxy with hash check as fallback (ETag = sha256)
GET  /stamps/{code}/evidence.json
POST /verify/upload                          multipart → {jobId}; GET /verify/jobs/{jobId} → ladder result + candidates (parsed in worker/ml)
POST /stamps/{code}/withdraw                 owner session → resolver flag + stop-serve
POST /reports                                takedown intake
GET  /health/storage                         public per-data-set proof + probe status
GET  /.well-known/apple-app-site-association · /.well-known/assetlinks.json · GET /v/{code} (web)
```

### 9.3 Database (Postgres 17 + pgvector 0.8.6, drizzle migrations)

```sql
create extension if not exists vector;
create table users (id uuid primary key, handle text unique, tier text default 'free', created_at timestamptz default now());
create table device_keys (key_id bytea primary key, user_id uuid references users, platform text check (platform in ('ios','android','web')),
  key_type smallint, level smallint, addr bytea, pub_x bytea, pub_y bytea, rp_id_hash bytea, attestation_hash bytea,
  attestation_enc bytea, app_attest_key_id text, assertion_counter bigint default 0, risk_metric int, play_verdict jsonb,
  registered_tx bytea, registered_epoch bigint, expires_at timestamptz, revoked_epoch bigint, revoke_reason smallint, next_nonce bigint default 1);
create table challenges (id uuid primary key, kind text, value bytea, key_id bytea, expires_at timestamptz, used_at timestamptz);
create table stamps (stamp_id bytea primary key, code bigint unique, user_id uuid, key_id bytea references device_keys,
  media_kind smallint, mime text, size bigint, width int, height int, duration_ms int,
  content_sha256 bytea unique, piece_cid bytea, record_cbor bytea, private_record_enc bytea, claim jsonb, sig bytea, auth_data bytea, countersig bytea,
  captured_at timestamptz, received_at timestamptz default now(), registered_epoch bigint, register_tx bytea,
  status text check (status in ('received','registering','registered','rejected','marked','stored','withdrawn','takedown')),
  finality text check (finality in ('pending','included','safe','final')), level smallint, flags smallint, ingest jsonb);
create table derivatives (id bigserial primary key, stamp_id bytea references stamps, kind smallint, sha256 bytea unique, piece_cid bytea,
  params jsonb, params_hash bytea, path text, attach_tx bytea);
create table renditions (id bigserial primary key, stamp_id bytea, derivative_id bigint, variant smallint, pdq bit(256), pdq_quality int);
create index on renditions using hnsw (pdq bit_hamming_ops);
create table bindings (stamp_id bytea, slot smallint, asset smallint, data_set_id bigint, piece_id bigint, provider_id bigint, service_url text,
  bind_tx bytea, bound_epoch bigint, last_probe_at timestamptz, last_ok_at timestamptz, probe_failures int default 0, primary key (stamp_id, slot));
create table data_sets (data_set_id bigint primary key, role text, provider_id bigint, with_cdn bool, last_proven_epoch bigint, proving_deadline bigint,
  faults int default 0, pdp_end_epoch bigint, reserve numeric, checked_at timestamptz);
create table chain_txs (hash bytea primary key, kind text, stamp_id bytea, nonce bigint, submitted_at timestamptz, included_epoch bigint,
  safe_at timestamptz, final_at timestamptz, status text, error text);          -- outbox consumed only by ROLE=api
create table verifications (id bigserial, stamp_id bytea, method text, distance int, verdict text, ip_hash bytea, at timestamptz default now());
create table moderation (stamp_id bytea primary key, checks jsonb, decision text, decided_by text, decided_at timestamptz, reason_uri text);
create table reports (id uuid primary key, stamp_id bytea, kind text, reporter text, status text, legal_hold bool default false, created_at timestamptz, resolved_at timestamptz);
```

### 9.4 Queues (BullMQ 6, Postgres backend — no Redis)

Consumed by **api** (keys): `register` (relayer: `registerStamp` with countersignature; nonce manager; receipt poll 180 s; 2-epoch reorg re-check), `attach` (`attachDerivative`), `commit` (FOC `commit()` with the session key), `bind` (`bindStorage`, batched per stamp). Consumed by **worker** (no keys): `ingest` (decode, EXIF check, exact/near-dup hint, abuse score; flags → `moderation`), `mark` (badge, TrustMark via ml, PDQ, share card, mirror write), `store` (FOC `store()` ×2), `probe` (retrieval + re-hash), `verify-upload`. Repeat jobs: `finality` (30 s: `eth_getBlockByNumber("finalized")`), `pdp-monitor` (10 min), `runway` (hourly: Filecoin Pay account, relayer FIL ≥ 0.5, session-key expiry ≤ 2 days), `probe-sample` (weekly), `mirror-gc` (daily). Dead-letter and alert webhooks via ntfy.

### 9.5 Docker Compose (one VPS, 8 vCPU / 32 GB NVMe) **[MVP]**

```yaml
services:
  caddy:    { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy:/data] }
  web:      { build: ./apps/web, env_file: .env }
  api:      { build: ./services/api, environment: { ROLE: api }, env_file: .env, volumes: [staging:/srv/staging],
              secrets: [relayer_pk, registrar_pk, foc_session_pk, play_sa, record_wrap_key] }        # no media decoding here
  worker:   { build: ./services/api, environment: { ROLE: worker }, env_file: .env, volumes: [staging:/srv/staging, cache:/srv/cache, models:/models],
              deploy: { replicas: 1 } }                                                              # no secrets; S3 write-only credentials via env
  ml:       { build: ./services/ml, volumes: [staging:/srv/staging, models:/models], deploy: { resources: { limits: { cpus: "4" } } } }
  postgres: { image: pgvector/pgvector:pg17, volumes: [pg:/var/lib/postgresql/data] }
  backup:   { image: offen/docker-volume-backup, volumes: [pg:/backup/pg:ro, staging:/backup/staging:ro] }   # nightly → S3-compatible bucket
volumes: { staging: {}, cache: {}, models: {}, pg: {}, caddy: {} }
```

Six services plus the backup sidecar. Secrets are Docker secrets mounted **only into `api`**; the FOC payer key and the governor key are never on the box. Observability: `/metrics` on api and worker (queue depth/age, tx latency, PDP status, probe failures, runway) scraped by a cron job that posts to ntfy; a public `/status` page. Prometheus/Grafana/Loki, Garage, a JVM attestation verifier, Ponder/Goldsky, KMS and a separate relayer container are **[v1]**.

"What breaks first", in order: public RPC rate limits (verify page falls back to the second provider), an SP missing its retrieval SLO (mirror serves; alert), Play Integrity quota (flag, not failure), USDFC runway (alerted 60 days out), App Attest key churn after reinstalls (re-enrolment), relayer receipt timeouts on busy tipsets (queue age alert), FilBeam 402 (provider/mirror). None can corrupt a stamp; all are visible on `/health/storage`.

---

## 10. Threat-model coverage

Full matrix with feasibility, residual risk and disclosure wording in `docs/THREAT-MODEL.md`; summary against the research numbering:

| # | Threat | Mitigation in this design | Residual (disclosed) |
|---|---|---|---|
| 1 | Analog hole | In-app live capture; physical lens ids; L3 sensor evidence reserved | "cannot tell a scene from a screen or print" |
| 2 | Root / confused-deputy signing | Per-capture attestation bound to the digest + countersignature (L1); hardware keys on chain (L2, v1); revocation with effective epoch; nonce bitmap; anomaly limits | "a compromised phone signs anything until revoked" |
| 3 | Camera injection | No picker/intents; physical camera enumeration; attestation tiers | same as 2 |
| 4 | Fake / transplanted badge | Badge is a pointer; check symbol; tier-distinct families; verdict only by comparison with the served original | "a mark proves nothing until looked up" |
| 5 | Filecoin copy loss | 2 FOC copies + off-box mirror at ingest; retrieval probe primary; re-replication with slot reuse; community re-pins | "if every copy vanishes, only a bit-exact holder can verify" |
| 6 | Relayer censorship / compromise | Device-signed claims verified on chain; relayer gas-only; self-submit lands at L0 (never forged L1); registrar key separate; both removable immediately | "relayer can delay, not forge" |
| 7 | Perceptual-hash collision / inversion | PDQ retrieval-only; verdict from exact hash or human comparison; PDQ off chain; never published for sealed | "similar-looking is not the same image" |
| 8 | Re-stamping / ordering | `firstStampOf`; chain epoch + device time + receipt time; near-duplicate hint at ingest (warn) | "earliest stamp ≠ original creator" |
| 9 | Watermark removal / forgery | Pointer semantics; ladder never says "matches" | — |
| 10 | Time / location spoofing | Three clocks shown; location opt-in, private record, "device-reported" | "cheap radios spoof GNSS" |
| 11 | Deanonymisation | EXIF minimised before hashing; private record encrypted on device; no PII on chain; attestation bundles never public; key rotation | "public originals can identify people and cameras" |
| 12 | Gateway censorship | Provider `/piece`, FilBeam, mirror; CID exposed; hash-only verification offline | "original may be unreachable via some paths" |
| 13 | Reorg before finality | included / safe / final policy; `finalized` tag; F3 stall acknowledged | — |
| 14 | Registry / admin abuse | Immutable registry; governor manages only membership; FOC proxies by stable address; StateView never pinned | "FOC contracts are third-party upgradeable" |
| 15 | Phishing verify sites / look-alike codes | One HSTS domain; Universal/App Links; in-app scanner; verifier hash on chain; distance-2 guarantee; original always shown | "only trust the registry" |
| 16 | Coerced stamping | Sealed stamps [v1]; withdrawal flag; dispute flag; duress mode after legal review [v2] | "a stamp does not prove consent" |
| 17 | Sybil / collusion | No aggregation into truth scores; attested enrolment; quotas | "many stamps ≠ truth" |
| 18 | "Verified" read as "true" | Fixed wording, neutral colours, permanent footer, ladder without "same/matches" | (this is the disclosure) |

Critic-added threats (derivative poisoning, code hijack, deferred-CID poisoning, software-key extraction + self-submit, parser RCE reaching keys, binding griefing, bundle fingerprinting, nonce-ordering loss, registrar compromise, StateView replacement, pre-publication moderation, egress drain) are closed by §0's table and detailed in the threat model.

---

## 11. Economics, abuse, privacy, legal

### 11.1 Who pays and tiers

Stamper pays FOC and gas (≈ $0.008 per photo, year one). **Free**: attested devices (L1+) only, 100 photos + 10 video-minutes per month per device, public originals, 2 FOC copies, 24-month retention guarantee ("renew or export" after). **Pro** (journalists, ≈ $8/month, [v1]): sealed mode, evidence bundle with OTS/RFC 3161, 10-year retention, API keys. **Newsroom/Org** [v2]: seats, legal hold, qualified EU / ICP-Brasil timestamps, dedicated data set under the organisation's own payer. Web L0 uploads [v1] require an account and are quota-limited (10/day) because they are the cheapest abuse vector. Self-custody users pay their own USDFC/FIL and get the same registry.

### 11.2 Abuse, moderation, takedown

- Rate limits: token buckets per device key, per account, per IP/ASN on `/captures`, `/uploads`, `/attest/*`, code lookups (60/min/IP) and `/verify/upload` (10/min/IP); enrolment ≤ 3 keys per account per 30 days; Apple risk metric and Play `recentDeviceActivity`/device recall feed a device score; exact-hash dedupe (same bytes ⇒ link, not re-store).
- **Pre-publication, before any FOC commit or FilBeam exposure** (`ingest`): decodability and EXIF sanitisation; exact/near-duplicate check; [v1] NSFW/violence classifier for *routing to review* (never auto-verdicts on journalism); CSAM hash matching under a vendor agreement — a prerequisite for public launch, listed in §13. Registration of the hash is immediate regardless; the bytes stay in staging until the checks pass.
- Takedown on "immutable" storage: (1) `StampResolver.setFlag` with a reason URI (the hash stays; it is not reversible to content), (2) stop serving from api/mirror/FilBeam, (3) `deletePieces` on Stamper's data sets (0.007 USDFC per scheduling call; providers GC), (4) legal hold or deletion of the mirror object, (5) [v1] sealed stamps: destroy the wrapped key (crypto-shredding). Third-party re-pins cannot be removed and the page says so. Legal plumbing: DMCA/DSA notice-and-action, Marco Civil Art. 19 flow, transparency report.

### 11.3 EXIF, location, originals

Minimised on device before hashing; make/model/exposure remain public (shown in the record); location only if the user enables "record location" per capture (off by default); then the public record carries only the 0.01° grid cell that holds the fix (about 1.1 km north–south, named by its south-west corner, `CaptureRecord.location`) and the exact fix goes into the private record with a 32-byte random salt, committed by `privateHash` (so the fix cannot be brute-forced from the hash and the cell). The api accepts a cell only together with that private record, checks that it hashes to `privateHash` and that the fix lies inside the cell, and seals it at rest; the verify page shows the cell on a coordinate grid after checking the record against the on-chain `recordHash`, and links to OpenStreetMap without loading any map service itself (decision 2026-10-30); a capture-time bystander prompt ("people may be identifiable — publish / keep private"). Nothing personal on chain: hashes, PieceCID, code, key id, level, epochs. DPIA before public launch; GDPR Art. 85 / LGPD Art. 4 II(a) journalistic handling behind a declaration; erasure = delist + stop-serve + piece removal + key destruction with Art. 17(3)(a)/(e) exceptions documented (EDPB 02/2025 treats hashes as personal data).

### 11.4 Sealed (encrypted-original) mode **[v1; contract-ready in MVP]**

Per-stamp AES-256-GCM key on device; ciphertext (32-byte random salt prepended) is the stored piece and `contentHash = sha256(ciphertext)` (so `firstStampOf` never leaks a plaintext hash); the record carries `plaintextCommitment = sha256(salt ‖ plaintext)`; `flags.SEALED`. Key wrapped to the device key and to Stamper's custodian key; **export flow ships with the feature** so a Stamper failure never strands originals. Reveal = publish key + salt (the verify page decrypts in the browser and recomputes the commitment); "publish forever" writes the key into the resolver, irreversible with a warning. Public assets stay plaintext on purpose.

### 11.5 Evidentiary

Evidence bundle = claim, signatures, public key, countersigner, `attestationHash`, tx hashes, epochs and UTC times, bindings, probe log, `paramsHash`; [v1] adds `.ots` (hourly Merkle root of stamp ids) and RFC 3161 tokens, a FRE 902(13)/(14) certification template and an ISO 27037-style custody log. Verdicts stay reproducible (hash equality, signature validity, chain time); similarity scores are labelled advisory. Capture→chain latency is logged.

---

## 12. Roadmap

**MVP — 15–19 engineer-weeks, two engineers for 8–10 weeks, demoable end to end on mainnet.** Critical chain: contract (2.5 ew secp256k1 + 1.5 ew P-256 paths and fork tests) → mobile capture/hash/sign/upload/enrolment/status/share (5–7 ew) → api (3–4 ew) and worker (3–4 ew) in parallel with the verify page (4–5 ew); core (1 ew), EXIF minimiser (1–1.5 ew), TrustMark sidecar + harness (1.5 ew), ops (2 ew). Contents: `StampRegistry` + `StampResolver` on Calibration **and mainnet**; Expo dev builds iOS (TestFlight) + Android (Play internal) with photo and ≤ 3 min / 500 MB video capture, software secp256k1 keys, App Attest / Play Integrity enrolment and per-capture binding → L1 via countersignature, offline queue; api custodian (relayer, registrar, session key, commit) and key-free worker; FOC originals with 2 copies on pinned data sets; badge families, TrustMark, PDQ index, share card; verify page by code / QR / upload with the ladder, compare, chain and storage panels, failure screens, evidence JSON; independent-verification docs; six-container Compose; PDP/runway/probe monitoring; residual-risk wording.
**Out of the MVP**: hardware P-256 client signing and L2, custom native modules, web capture / passkeys, C2PA, CLI, indexer, sealed mode, OTS/RFC 3161, evidence PDF, takedown tooling beyond resolver flag + runbook, > 500 MB or chunked video, vPDQ/ISCC, self-custody UI, Prometheus/Grafana, Garage, KMS, JVM verifier, per-user data sets (never).

**v1 (weeks 11–20)**: L2 (App Attest assertion as signer; Android `stamper-keys` module; JVM Key Attestation verifier; CRL re-checks; `0x0100` gas number applied); web L0 uploads (F0 badge opt-in); C2PA (sidecar originals, embedded derivatives, `digitalCapture` gating, Conformance application); sealed mode with export; `stamper-verify` CLI with resolver-published hash; Ponder indexer or Goldsky; encrypted attestation pieces on FOC; OTS + RFC 3161 batch anchoring; evidence PDF; vPDQ; moderation pipeline (classifier routing, CSAM vendor); signer service / KMS and 24-h session keys; self-submit page for wallet users; takedown tooling; DPIA; App Store / Play distribution.

**v2**: PixelSeal/Video Seal GPU worker; L3 sensor evidence; chunked > 1 GiB video; device-key `attachDerivative` and withdrawal; user-owned data sets and EIP-1271 Safe-owned stamps; community re-pin UI; `c2pa.repository-receipt` + Soft Binding Resolution API; qualified timestamps per jurisdiction; monthly re-keying; duress mode after legal review; third-party verifier mirrors; sealed PoRep cold copies when FOC ships them.

---

## 13. Risks and open questions

1. **`P256VERIFY` gas on FEVM is unmeasured** (instrumented Wasm). Week-1 wrapper on Calibration; result recorded; if > ~500 M gas the v1 fallback is a self-deployed Daimo `P256Verifier` chosen by constructor at the *next* registry version (the MVP registry calls `0x0100`).
2. **`@filoz/synapse-core/piece` on Hermes**: the `./piece` barrel re-exports download/resolve code that imports the warm-storage read layer, viem actions and the full ABI; `package.json#exports` forbids deep imports. Week-1 Metro spike; fallback = pure-JS fr32 tree (127-byte quads → 128 B → sha256 pairs) over `@noble/hashes` / `react-native-quick-crypto`, pinned against the on-chain `Cids.sol` encoding.
3. **Mainnet F3 stall** (no certificate since 2026-03-09): finality UX stays policy-based; ask FilOz before promising "final in minutes".
4. **FRC-0069 is a Draft**: pin the exact `Cids.Cid.data` bytes `getPieceCid` returns for FWSS 1.4.0 pieces with a fork-test vector before freezing the comparison.
5. **FOC proxies are upgradeable beta contracts**: subscribe to `UpgradeAnnounced`, re-run fork tests on every FWSS/PDPVerifier upgrade; the registry depends only on the PDPVerifier proxy in write paths.
6. **Public RPC limits**: 360-epoch log windows, ~2,000 blocks of state, undocumented rate limits — state-resident design keeps verification working; budget a dedicated Lotus node or paid tier when the indexer matters.
7. **`@expo/app-integrity` is alpha-grade**: confirm `generateAssertionAsync` hashes exactly the bytes passed; wrap behind an interface; App Attest needs App Store/TestFlight builds, Play Integrity an internal-track build — dev-device allowlist for local work; Apple ≈ 100 attestations/s global, Play 10k decodes/day — request increases early.
8. **Software secp256k1 keys are extractable** on compromised phones; the countersignature rule makes extraction worth only L0 stamps, and per-capture attestation plus revocation bound the damage; L2 removes the software key entirely.
9. **Registrar key compromise** is the most damaging MVP key: Docker secret in the custodian container only, enrolment-rate and countersignature-rate anomaly alerts, immediate self/owner removal, public `attestationHash` trail; [v1] signer service / KMS.
10. **Badge geometry vs PDQ drift** and TrustMark survival through real platforms: harness in week 6; tune strength 0.8–1.5 and pill size on measured data.
11. **EXIF/MP4 minimiser correctness** on both platforms (orientation kept, location atoms dropped) — golden tests before the first mainnet stamp.
12. **TrustMark weight redistribution** terms (package MIT; Adobe CDN 403 to anonymous clients) — confirm mirroring; otherwise export ONNX graphs from the MIT weights.
13. **Legal**: CSAM hash-list vendor access, DMCA/DSA/Marco Civil flows, DPIA, counsel review of any evidentiary claim in product copy; takedown duties versus third-party re-pins.
14. **Deterministic derivatives**: libvips/mozjpeg bit-stability across image rebuilds — pin image digests inside `paramsHash`; regeneration by third parties is best-effort and stated as such.
15. **Operational single points**: one VPS, one payer, one relayer, one registrar — mitigated by backups, self-submit (L0), community bindings, immediate role removal; an outage delays, never destroys, anchoring.

**Open questions for the product owner (assumptions taken; nothing blocks on them):** canonical domain (`stamper.media`, owner's probable choice, 2026-10-01); whether originals are public by default (assumed yes; sealed mode is v1 Pro); free-tier quotas (assumed 100 photos + 10 min video/month per attested device); video in the MVP (assumed yes, ≤ 3 min / 500 MB, visible badge only); whether L0 web uploads should exist at all (assumed v1, opt-in badge, no Stamper mark by default); Apple Team ID / bundle id and Google Cloud project (placeholders `media.stamper.app`); initial provider pair and jurisdictions for the mirror bucket (assumed EU-hosted); Pro pricing (assumed ≈ $8/month); launch gate on a CSAM-matching vendor (assumed required before public, not before TestFlight).
