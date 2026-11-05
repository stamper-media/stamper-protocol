# Stamper — Architecture proposal (lens: security and operations pragmatist)

Date: 2026-10-01. Inputs: VERIFIED-SDK-FACTS.md (ground truth), filecoin-storage.md, fevm-contracts.md, c2pa-prior-art.md, watermarking.md, trusted-capture.md, perceptual-hashing.md, app-stack.md, codes-ux-legal.md, threat-model.md. Fixed decisions (FOC via `@filoz/synapse-sdk` 2.0.2 / `@filoz/synapse-core` 0.10.0, Solidity registry on FEVM with Foundry, TypeScript pnpm monorepo at `stamper`, Expo + Next.js + Docker Compose on one VPS) are taken as given.

Design posture in one sentence: **the only thing a stamp proves is a signature over a hash by an enrolled key, anchored at an epoch, with bytes that are provably stored; everything else is a labelled signal.** Every mechanism below is chosen so that (a) a compromised Stamper server can delay or withhold but never forge, (b) a verifier needs only a Filecoin RPC and a storage provider, and (c) what breaks first is observable and recoverable.

Decisions at a glance (alternatives rejected in the relevant section):

| Topic | Decision |
|---|---|
| Device keys | P-256 hardware keys (App Attest key on iOS, Keystore/StrongBox attested key on Android, non-extractable WebCrypto key on web); verified on-chain with the FIP-0113 `P256VERIFY` precompile at `0x0100`. secp256k1 only for the relayer, verifier and wallet-linked users. |
| Signed artefact | EIP-712 `CaptureClaim` (Solidity-native hashing); the richer capture record is DAG-CBOR, content-addressed, referenced by digest in the claim. |
| Registry | One immutable `StampRegistry` (keys, stamps, codes, storage bindings, revocations) + a small governed `StampResolver` (display metadata, takedown flags). No proxies. |
| Storage | Stamper-operated FOC data sets (2 copies via `upload({copies: 2})`), paid from a cold root account through an `AddPieces`-only session key; a third Stamper-owned mirror copy. |
| Code | 40-bit stamp code derived on-chain from `stampId`; shown as 8 Crockford symbols + 1 check symbol (`XXXX-XXXX-C`); same 40 bits in TrustMark `BCH_SUPER`. |
| Marking | Server-side only (sharp / ffmpeg / TrustMark / C2PA); device never produces the canonical derivative. |
| Verification | Byte-exact → watermark → perceptual, with the verdict always coming from exact hash or human comparison against the original. |

---

## 1. Trust model

### 1.1 What a stamp proves

A verified stamp `S` for bytes `B` proves exactly:

1. **Binding.** `sha256(B)` (and, when device-computed, the PieceCID v2 of `B`) was signed by device key `K` under an EIP-712 domain bound to chain 314/314159 and the registry address, with a nonce that was unused and a deadline that had not passed.
2. **Enrolment.** `K` was enrolled on-chain at level `L` by a verifier address that the registry's governor listed at that time, together with the content digest of the raw attestation evidence (Apple attestation object + receipt, or Android certificate chain + decoded Play Integrity verdict) stored on Filecoin, so anyone can re-run the vendor checks later.
3. **Time.** The registration executed at Filecoin epoch `E` (`block.timestamp = genesis + 30·E`, deterministic), so `B` existed no later than `E`. The device-reported `capturedAt` is a claim.
4. **Storage.** At `bindStorage` time, `PDPVerifier.findPieceIdsByCid(setId, pieceCid, pieceId, 1)` returned `[pieceId]` in a live data set whose listener is the FWSS proxy; any later reader can re-check `dataSetLive`, `provenThisPeriod`, `provingDeadline` and `getDataSet(...).pdpEndEpoch`.
5. **Identity of bytes.** Whoever downloads the piece can recompute `sha256` and PieceCID and compare with the chain, without trusting Stamper.

### 1.2 What it does not prove (disclosed on every verify page)

Not that the scene was real (analog hole: screens, prints; staged events); not that the device was uncompromised (root + confused-deputy signing, CVE-2026-43499-class exploits, leaked Android keyboxes, `aaoracled`-style attestation oracles on old jailbroken iPads); not that the clock or location was honest ($200 GNSS spoofers); not that the stamper consented or is who they claim; not that the earliest stamp is the creator; not that an unstamped image is fake. The fixed footer reads: "Stamper shows when this file was registered, by which kind of device, and whether the copy you have matches the stored original. It does not judge what the picture shows."

### 1.3 Assurance levels

Levels are properties of the **device key** (set at enrolment, downgradable by revocation with an effective epoch) and are snapshotted into each stamp. The verify page shows the snapshot and the current state ("L2 at registration; key revoked at epoch 6,420,000 for KEY_COMPROMISE — stamps before that epoch unaffected").

| Level | On-chain `level` | Label in UI | Verifier requirements (all must hold) | Residual risks shown |
|---|---|---|---|---|
| L0 | 0 | "Registered (unattested)" | Web or any client; non-extractable WebCrypto P-256 key self-enrolled (`enrolSelf`), or upload with no key (relayer-signed, see §7.4). Server-witnessed hash and time only. | Anything |
| L1 | 1 | "Captured in the Stamper app" | iOS: App Attest attestation chain to Apple App Attestation Root CA, nonce check, `apple_validation_category_01 == 4` (App Store; 2 in TestFlight builds), production `aaguid`, counter increasing. Android: Play Integrity standard token bound by `requestHash`, `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`; Key Attestation chain to a Google root (`android.googleapis.com/attestation/root`), `origin == GENERATED`, TEE or StrongBox, `attestationApplicationId` = Stamper package + signing cert, serials absent from `attestation/status`. | Modified OS, leaked keybox, camera injection, analog hole |
| L2 | 2 | "Hardware-attested capture" | L1 plus: iOS receipt exchanged at `data.appattest.apple.com`, risk metric ≤ 5, key age ≤ 12 months. Android: `MEETS_STRONG_INTEGRITY`, `deviceLocked`, `verifiedBootState ∈ {Verified, SelfSigned-with-GrapheneOS-key}`, `osPatchLevel` ≤ 12 months old, StrongBox when available, key created with `setUserAuthenticationParameters(300 s, BIOMETRIC_STRONG | DEVICE_CREDENTIAL)`, CRL re-checked at every capture. | Unrevoked leaked keybox, private root exploit, analog hole |
| L3 | 3 | reserved | Sensor evidence (depth/Live Photo flatness, burst parallax) or ingested C2PA Assurance-Level-2 manifests. Not built before v2; the enum slot exists so old stamps never need migration. | Analog hole (scored, not excluded) |

Rejected alternative: encoding the level into the printed code (`L2-K3Q9…`). A printed level is forgeable and becomes stale after revocation; the level lives on chain and on the verify page only.

---

## 2. System architecture

### 2.1 Components and placement

```
┌────────────── Phone (Expo SDK 57, Hermes) ──────────────┐   ┌──────────── Browser (Next.js 16.3) ─────────────┐
│ expo-camera capture (in-app only, physical lenses only)  │   │ verify page: code / QR / upload-a-copy          │
│ sanitize EXIF (keep Orientation) → sha256 (quick-crypto) │   │ hash-wasm sha256 + synapse-core/piece calc      │
│ PieceCID (synapse-core/piece, photos) → EIP-712 digest   │   │ TrustMark JS decoder (onnxruntime-web)          │
│ App Attest assertion / Keystore P-256 signature          │   │ direct eth_call to registry (2 RPC providers)   │
│ resumable upload to API (File.upload, background on iOS) │   │ L0 web capture (getUserMedia) + WebCrypto key   │
└───────────────┬─────────────────────────────────────────┘   └───────────────┬─────────────────────────────────┘
                │ HTTPS (Caddy)                                                │
┌───────────────▼──────────────────────────────── VPS: Docker Compose ─────────▼─────────────────────────────────┐
│ api (Hono 4.13, Node 24): challenges, enrolment verification, upload intake, claim validation, verify API      │
│ worker (BullMQ 6 on Postgres): hash/PieceCID re-derivation, FOC upload via Synapse, marking, C2PA, indexing     │
│ relayer (viem + KMS signer): registerStamp / bindStorage / enrolDeviceKey txs; nonce + receipt management      │
│ ml (FastAPI, Python 3.12): TrustMark encode/decode, PDQ/vPDQ, ISCC, SSIM — stateless, shared staging volume    │
│ attest-android (JVM, android/keyattestation): Android chain verification only                                  │
│ indexer (Ponder, RPC mode, 360-block windows): StampRegistered/StorageBound/FaultRecord/PiecesRemoved           │
│ postgres (pgvector/pgvector:pg17) · mirror (Garage, S3 API) · prometheus + alertmanager · caddy                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                │ Synapse SDK (session key)          │ eth_sendRawTransaction / eth_call
┌───────────────▼────────────────────┐   ┌───────────▼──────────────────────────────────────────────────────────┐
│ Filecoin Onchain Cloud             │   │ Filecoin EVM (314 / 314159)                                         │
│ FWSS data sets (2 providers)       │   │ StampRegistry (immutable) · StampResolver (governed)                 │
│ PDPVerifier proofs · FilBeam CDN   │◄──│ reads PDPVerifier 0xBADd…557F / FWSS StateView 0xcf18…8172           │
└────────────────────────────────────┘   └──────────────────────────────────────────────────────────────────────┘
```

Why the SDK lives only on the server: `@filoz/synapse-sdk` is documented for Node and browsers; React Native is unmentioned, Hermes has no WebCrypto (`multiformats/hashes/sha2` throws), and `pieceBatching`, EIP-712 add-pieces authorisation and USDFC custody belong with the funded account anyway. The phone computes only what it must sign (sha256, and PieceCID for photos via the pure-JS `@filoz/synapse-core/piece` hasher, which depends on `sync-multihash-sha2`, not WebCrypto). This is validated by a week-1 Hermes spike; if `synapse-core/piece` fails to bundle under Metro's `exports` resolution, the fallback is a 150-line port of the fr32 tree hasher on top of `react-native-quick-crypto`.

### 2.2 End-to-end flow (photo, L1/L2)

```mermaid
sequenceDiagram
  participant D as Device (Expo)
  participant A as api
  participant W as worker
  participant R as relayer
  participant F as FOC (Synapse/SP)
  participant C as StampRegistry (FEVM)
  D->>A: GET /v1/capture/challenge (per session, 5-min TTL)
  A-->>D: {challengeId, challenge32}
  D->>D: capture → sanitize EXIF → bytes B → sha256(B), PieceCID(B)
  D->>D: build CaptureRecord (dag-cbor) → recordDigest; build CaptureClaim; EIP-712 digest
  D->>D: sign: App Attest assertion(clientData=digest) | Keystore SHA256withECDSA(digest)
  D->>A: PUT /v1/uploads/{id} (resumable, Content-Range) ; POST /v1/stamps {claim, sig, authData, record, integrityToken}
  A->>A: verify sig off-chain, verify Play Integrity token / App Attest counter, re-hash B, re-derive PieceCID
  A->>R: enqueue registerStamp(claim, sig, authData)
  R->>C: registerStamp → StampRegistered(stampId, code, …)
  A-->>D: {stampId, code, status: "registered·pending-storage"} + signed claim (self-submit bundle)
  W->>F: synapse.storage.upload(B, {pieceCid, copies: 2, pieceMetadata})
  F-->>W: onPiecesConfirmed(dataSetId, providerId, [{pieceId, pieceCid}]) ×2
  W->>R: enqueue bindStorage(stampId, setId, pieceId, pieceCidBytes) ×2
  R->>C: bindStorage → findPieceIdsByCid check → StorageBound
  W->>W: TrustMark(code) → badge+QR → JPEG → C2PA embed → sha256/PieceCID of marked → upload marked + record
  W->>C: resolver.setDerivation(stampId, derivationCid) (Stamper-signed)
  D->>A: GET /v1/stamps/{id} → marked derivative ready → share
```

Two-phase registration (claim first, storage binding minutes later) is deliberate: it gives the earliest honest time anchor and keeps the claim path independent of SP availability. Rejected alternative: a single `registerAndBind` after upload — simpler, but every SP hiccup would delay the time anchor, and the self-submit path would require the user to wait for Stamper's upload.

### 2.3 Verify flow (by code)

```mermaid
sequenceDiagram
  participant V as Browser
  participant N as Filecoin RPC (Glif + Ankr)
  participant S as SP / FilBeam / mirror
  V->>V: normalise code, check symbol
  V->>N: eth_call StampRegistry.stampByCode(code40) → stamp; deviceKeys[id]; bindings
  V->>N: Multicall3: PDPVerifier.dataSetLive, FWSSView.provenThisPeriod/provingDeadline/getDataSet
  V->>S: GET /piece/{pieceCid} (SP A ∥ SP B ∥ FilBeam ∥ mirror; first 200 wins)
  V->>V: recompute sha256 + PieceCID while streaming; compare with chain
  V->>V: re-verify device signature from StampRegistered event sig + registered key
  V-->>V: render original · copy side-by-side · chain proof · storage proof · level · residual-risk line
```

---

## 3. Identifiers and data model

### 3.1 Identifiers

| Identifier | Definition | Where |
|---|---|---|
| `contentHash` | `sha256(B)` of the exact original bytes (after on-device EXIF sanitisation, before anything else) | claim, chain, DB |
| `pieceCid` | PieceCID v2 of `B` (CIDv1, codec `raw` 0x55, multihash 0x1011, digest `uvarint(padding)‖uint8(height)‖root32`), computed with `calculate()`/`hasher()` from `@filoz/synapse-core/piece`; on chain as `pieceCidHash = keccak256(cidBytes)` plus the raw bytes in the `StorageBound` event | claim (photos), chain, DB |
| `recordDigest` | sha2-256 digest of the DAG-CBOR `CaptureRecord` (the CID is reconstructible: v1, codec 0x71, sha2-256) | claim, chain |
| `deviceKeyId` | `sha256(0x04‖x‖y)` — identical to Apple's App Attest `keyId` definition, used for all platforms | chain |
| `stampId` | `keccak256(abi.encode(chainId, registry, deviceKeyId, contentHash, nonce))` | chain |
| `code40` | `uint40(uint256(keccak256(abi.encodePacked("stamper.code.v1", stampId))))` | chain (`stampByCode`), badge, watermark |
| `derivationCid` | CID of the server-signed `DerivationRecord` (marked derivative hashes, watermark params, PDQs, manifest CIDs) | resolver event, piece metadata |

### 3.2 Short verification code

- Alphabet: Crockford Base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U). Decoding is case-insensitive, maps `i/l→1`, `o→0`, ignores `-` and spaces, rejects non-ASCII (UTS #39 ASCII-only).
- Payload: 8 symbols = 40 bits = `code40`. Check: 1 symbol = `code40 mod 37` rendered in the same alphabet (detects 100% of single substitutions and adjacent transpositions). The five check values 32–36 would need `*~$=U`; because `stampId` depends on the client-chosen `nonce`, the app grinds nonces until the check value is < 32 and until `stampByCode(code)` and all 248 Hamming-distance-1 neighbours are free (an `eth_call` to `codeIsFree(code)`), so emitted codes are always clean and never one symbol away from another live code. Expected extra signatures per capture: ~0.16 (13.5% check re-draws + rare collisions); signing is silent, so this costs nothing visible.
- Display: `XXXX-XXXX-C`, monospaced with slashed zero. Spoken form: NATO alphabet in-app.
- Space: 1.1e12. Guessing a live code at 1e7 stamps succeeds with p ≈ 1e-5 per try; lookups of non-existent codes are rate-limited (60/min/IP, 600/day) and private stamps never resolve, so enumeration is not a practical privacy leak.
- Rejected: 55-bit codes (11+1 symbols) as in codes-ux-legal.md. They do not fit TrustMark `BCH_SUPER` (40 data bits, corrects 8 flips, false-accept ≈ 2e-6); `BCH_5` would carry 61 bits but with ≈ 1/530 garbage decodes on unmarked images. A pointer needs robustness more than entropy, and the registry makes the code unenumerable enough.

### 3.3 Verify URL and QR

- Canonical: `https://stamper.app/v/<9 symbols>` (placeholder domain; one domain, HSTS-preloaded, AASA + `assetlinks.json` for `/v/*`, path case-insensitive). Custom scheme `stamper://v/<code>` fallback only.
- QR payload: `HTTPS://STAMPER.APP/V/K3Q9XA2M7` (30 chars, alphanumeric mode) → QR Version 2, ECC M (capacity 38). Forensic export QR adds `?c=<PieceCID base32upper>` → Version 6-Q.
- The URL is a pointer; the page compares, never confirms by presence.

### 3.4 Capture claim (EIP-712) and canonicalisation

```
domain = { name: "Stamper", version: "1", chainId: 314 | 314159, verifyingContract: <StampRegistry> }
CaptureClaim {
  uint8   version;        // 1
  bytes32 contentHash;    // sha256(B) or salted commitment (hashKind)
  uint8   hashKind;       // 0 = sha256(B); 1 = sha256(salt32 ‖ B) (sealed mode)
  bytes32 pieceCidHash;   // keccak256(PieceCID v2 bytes) or 0 when deferred to bindStorage (large video)
  uint64  size;           // byte length of B
  bytes32 recordDigest;   // sha2-256 of dag-cbor CaptureRecord
  uint64  capturedAt;     // device wall clock, ms
  uint8   mediaKind;      // 0 image, 1 video
  bytes32 deviceKeyId;
  uint64  nonce;          // strictly increasing per key; == App Attest counter on iOS
  uint64  deadline;       // unix seconds; relayer must land before this
}
```

Signature inputs by platform (all verified on-chain, see §4):
- Android / web: ECDSA P-256 over `sha256(digest)` (Keystore `SHA256withECDSA` / WebCrypto `{name:"ECDSA", hash:"SHA-256"}` with message = the 32-byte EIP-712 digest), DER converted to raw `r‖s` on device.
- iOS: App Attest assertion with `clientData = digest` → signature over `sha256(authenticatorData ‖ sha256(digest))`; the 37-byte `authenticatorData` travels with the claim.
- Wallet users (web, optional): `eth_signTypedData_v4`, `ecrecover`.

Why EIP-712 for the signed struct and not COSE/DAG-CBOR: `hashStruct` is one `keccak256(abi.encode(...))` in Solidity, `viem.hashTypedData` runs on Hermes, and the domain separator gives chain/contract replay protection for free. Why DAG-CBOR for the record: deterministic encoding, content-addressable, same codec family as the attestation bundles. COSE_Sign1 was rejected as the signed envelope because on-chain parsing buys nothing; a C2PA manifest is derived server-side anyway.

### 3.5 CaptureRecord (DAG-CBOR, device-built, public part)

```
{ v: 1, contentHash, size, mediaType: "image/jpeg"|"video/mp4", dims: {w,h[,durationMs,fps]},
  capturedAt, monotonicNs, platform: "ios"|"android"|"web", app: {id, version, build},
  claimedLevel, capture: { source: "in-app-camera", facing, lensId, physicalCameraOnly: true },
  cameraSettings?: {...},                      // no serials
  sanitised: { exifRemoved: ["GPS*", "Serial*", "Owner*", "MakerNote"], kept: ["Orientation"] },
  redacted: { locationHash?: bytes32, fullExifHash?: bytes32, sensorEvidenceHash?: bytes32 },
  serverChallenge: bytes32, accountId: bytes32 /* salted hash */ }
```
The private part (`location`, full EXIF, sensor artefacts) is a separate DAG-CBOR object encrypted with the per-stamp key (§11.4); only its hashes appear in the public record, so withholding it never breaks the signature.

### 3.6 Piece metadata (FOC)

Per piece (≤3 keys, key ≤32 B, value ≤96 B): `stamper.stamp` = `0x…` stampId (66 chars), `stamper.role` ∈ `original | marked | record | manifest | attestation`. Data-set metadata: `source = "stamper"`, `stamper.env = "mainnet-v1"` (`withCDN` on the primary data sets). Piece metadata is only emitted in FWSS `PieceAdded` (1.4.0 no longer stores it), so it is an indexer convenience, never a trust input.

### 3.7 Derivative ↔ original linkage

- On chain: `StorageBound` events per copy of the original; the resolver's `DerivationSet(stampId, derivationCid)` event names the marked derivative's `sha256`, PieceCID and its copies.
- In the derivative: TrustMark payload = `code40`; visible badge = code + QR; C2PA manifest with the original as `parentOf` ingredient (hashed URI of the pristine bytes) and custom assertion `computer.paradox.stamper.anchor { stampId, code, contentHash, pieceCid, chainId, registry, txHash }`.
- In the DB: `renditions(stamp_id, role, sha256, piece_cid, pdq, …)`.

---

## 4. Smart contracts

### 4.1 Shape and governance

- `StampRegistry` — **immutable, no proxy, no pause**. Holds device keys, stamps, code mapping, storage bindings, revocations and withdrawals. The only privileged function is verifier-set management by `governor` = a Safe (deployable through the Safe singleton factory `0x914d…43d7`, present on both networks) behind an OpenZeppelin `TimelockController` (48 h). Governor can never alter or remove a stamp.
- `StampResolver` — small, `Ownable2Step`, holds display/takedown state (`DerivationSet`, `Withheld`, `DisputeFlagged`) and may be redeployed; the registry never depends on it.
- FOC addresses (`PDPVerifier`, `FWSS` proxy, `FWSS StateView`) are constructor immutables. They are FilOz-upgradeable proxies with stable addresses; if FilOz ever moves to new proxies, Stamper deploys `StampRegistryV2` and the resolver maps both. Rejected: a timelocked setter for these addresses inside the registry — it reintroduces an admin who can redirect "storage proof" to a fake verifier.

### 4.2 Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;                       // evm_version = "cancun"

struct Cid { bytes data; }                    // == Cids.Cid in PDPVerifier

interface IPDPVerifier {
    function dataSetLive(uint256 setId) external view returns (bool);
    function findPieceIdsByCid(uint256 setId, Cid calldata pieceCid, uint256 startPieceId, uint256 limit)
        external view returns (uint256[] memory);
    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cid memory);
    function getDataSetListener(uint256 setId) external view returns (address);
    function getDataSetStorageProvider(uint256 setId) external view returns (address, address);
    function getNextChallengeEpoch(uint256 setId) external view returns (uint256);
    function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256);
}
interface IFWSSStateView {
    struct DataSetInfoView { uint256 pdpRailId; uint256 cacheMissRailId; uint256 cdnRailId; address payer; address payee;
        address serviceProvider; uint256 commissionBps; uint256 clientDataSetId; uint256 pdpEndEpoch; uint256 providerId;
        uint96 pendingOneTimePayments; uint96 lifecycleReserveBalance; uint256 dataSetId; }
    function getDataSet(uint256 dataSetId) external view returns (DataSetInfoView memory);
    function getDataSetStatus(uint256 dataSetId) external view returns (uint8);
    function provenThisPeriod(uint256 dataSetId) external view returns (bool);
    function provingDeadline(uint256 setId) external view returns (uint256);
}

contract StampRegistry {
    // ---------- constants / immutables
    address constant P256VERIFY = 0x0000000000000000000000000000000000000100;   // FIP-0113, EIP-7951 semantics
    bytes32 constant CLAIM_TYPEHASH  = keccak256("CaptureClaim(uint8 version,bytes32 contentHash,uint8 hashKind,bytes32 pieceCidHash,uint64 size,bytes32 recordDigest,uint64 capturedAt,uint8 mediaKind,bytes32 deviceKeyId,uint64 nonce,uint64 deadline)");
    bytes32 constant ENROL_TYPEHASH  = keccak256("DeviceKeyEnrolment(bytes32 x,bytes32 y,address signer,uint8 platform,uint8 sigScheme,uint8 level,bytes32 attestationCid,uint64 expiresAt,uint64 nonce)");
    bytes32 constant REVOKE_TYPEHASH = keccak256("DeviceKeyRevocation(bytes32 deviceKeyId,uint64 effectiveEpoch,uint8 reason,uint64 nonce)");
    bytes32 constant WITHDRAW_TYPEHASH = keccak256("StampWithdrawal(bytes32 stampId,uint8 reason,uint64 nonce)");
    IPDPVerifier   public immutable PDP;          // mainnet 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F / calib 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C
    IFWSSStateView public immutable FWSS_VIEW;    // mainnet 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 / calib 0x1B68d64f01bAa42014B9774605867BF4eDC0320f
    address        public immutable FWSS;         // mainnet 0x8408502033C418E1bbC97cE9ac48E5528F371A9f / calib 0x02925630df557F957f70E112bA06e50965417CA0
    bytes32        public immutable APPATTEST_RPID_HASH;   // sha256("TEAMID.computer.paradox.stamper")
    bytes32        public immutable DOMAIN_SEPARATOR;      // EIP-712 ("Stamper","1",chainid,this)

    // ---------- enums
    enum Platform  { Web, IOS, Android }
    enum SigScheme { P256Raw, AppAttest, Secp256k1 }      // P256Raw: sha256(digest); AppAttest: sha256(authData‖sha256(digest)); Secp256k1: digest
    enum HashKind  { Sha256, SaltedSha256 }
    enum MediaKind { Image, Video }

    // ---------- storage
    struct DeviceKey {           // 7 slots
        bytes32 x; bytes32 y;    // P-256 affine point; zero for Secp256k1 (then `signer`)
        address signer;          // secp256k1 address or 0
        uint8 platform; uint8 sigScheme; uint8 level;
        bytes32 attestationCid;  // sha2-256 digest of dag-cbor attestation bundle on Filecoin; 0 for L0
        uint64 enrolledEpoch; uint64 expiresAt; uint64 revokedEpoch; uint8 revokeReason;
        address verifier;        // 0 = self-enrolled (L0)
        uint64 lastNonce;        // strictly increasing per key
    }
    struct Stamp {               // 5 slots
        bytes32 contentHash; bytes32 pieceCidHash; bytes32 recordDigest; bytes32 deviceKeyId;
        uint64 size; uint64 capturedAt; uint64 registeredEpoch; uint64 withdrawnEpoch;
        uint40 code; uint8 hashKind; uint8 mediaKind; uint8 level; uint8 bindingCount;
    }
    struct Binding { uint256 setId; uint256 pieceId; address provider; uint64 boundEpoch; }

    address public governor;                                   // Safe + TimelockController
    mapping(address => bool)      public isVerifier;
    mapping(bytes32 => DeviceKey) public deviceKeys;           // deviceKeyId => key
    mapping(bytes32 => Stamp)     public stamps;               // stampId => stamp
    mapping(uint40  => bytes32)   public stampByCode;          // code40 => stampId
    mapping(bytes32 => bytes32)   public firstStampOf;         // contentHash => earliest stampId
    mapping(bytes32 => Binding[4]) internal bindings;          // stampId => up to 4 copies

    // ---------- events (everything a verifier needs is in the logs)
    event VerifierSet(address indexed verifier, bool enabled);
    event DeviceKeyEnrolled(bytes32 indexed deviceKeyId, address indexed verifier, uint8 platform, uint8 sigScheme, uint8 level, bytes32 attestationCid, uint64 expiresAt);
    event DeviceKeyRevoked(bytes32 indexed deviceKeyId, uint64 effectiveEpoch, uint8 reason, address by);
    event StampRegistered(bytes32 indexed stampId, uint40 indexed code, bytes32 indexed deviceKeyId,
        bytes32 contentHash, uint8 hashKind, bytes32 pieceCidHash, uint64 size, bytes32 recordDigest,
        uint64 capturedAt, uint8 mediaKind, uint8 level, uint64 nonce, bytes sig, bytes authData);
    event StorageBound(bytes32 indexed stampId, uint256 indexed setId, uint256 pieceId, bytes pieceCid, address provider);
    event StampWithdrawn(bytes32 indexed stampId, uint8 reason);
    event Commit(address indexed recorder, string indexed assetCid, string commitData);   // ERC-7053 compatibility (v1)

    // ---------- governance (only verifier management)
    function setVerifier(address v, bool enabled) external;        // onlyGovernor (timelocked)

    // ---------- enrolment
    /// Verifier-countersigned enrolment (L1–L3). `e.nonce` is the verifier's nonce.
    function enrolDeviceKey(DeviceKeyEnrolment calldata e, bytes calldata verifierSig) external;
    /// Self-enrolment at level 0 (web keys, wallet addresses). msg.sender pays gas.
    function enrolSelf(bytes32 x, bytes32 y, address signer, uint8 platform, uint8 sigScheme) external;
    /// Revocation signed by a verifier (secp256k1) or by the device key itself (P-256/App Attest).
    function revokeDeviceKey(DeviceKeyRevocation calldata r, bytes calldata sig, bytes calldata authData) external;

    // ---------- stamping
    /// Anyone may submit (relayer or the user with any FIL wallet). Reverts with CodeTaken / CodeNeighbour / NonceUsed / Expired / BadSig / KeyRevoked.
    function registerStamp(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData) external returns (bytes32 stampId, uint40 code);
    /// Anyone may bind; trust is re-derived from PDPVerifier state, never from msg.sender.
    function bindStorage(bytes32 stampId, uint256 setId, uint256 pieceId, bytes calldata pieceCid) external;
    /// Owner-signed withdrawal (hash stays; verify page shows "withdrawn by author").
    function withdrawStamp(StampWithdrawal calldata w, bytes calldata sig, bytes calldata authData) external;

    // ---------- views
    function codeIsFree(uint40 code) external view returns (bool);                     // code and 248 distance-1 neighbours unused
    function getBindings(bytes32 stampId) external view returns (Binding[] memory);
    function effectiveLevel(bytes32 stampId) external view returns (uint8);           // 0 if key revoked at/before registeredEpoch
    function storageStatus(bytes32 stampId) external view returns (
        uint8 copies, uint8 liveCopies, bool anyProvenThisPeriod, uint256 earliestProvingDeadline, uint256 lastProvenEpoch);
    function hashClaim(CaptureClaim calldata c) external view returns (bytes32 digest);  // for off-chain re-verification
}
```

### 4.3 Core logic (normative sketch)

```solidity
function registerStamp(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData) external returns (bytes32 stampId, uint40 code) {
    DeviceKey storage k = deviceKeys[c.deviceKeyId];
    require(k.enrolledEpoch != 0, "NoKey");
    require(k.revokedEpoch == 0 || block.number < k.revokedEpoch, "KeyRevoked");
    require(k.expiresAt == 0 || block.timestamp < k.expiresAt, "KeyExpired");
    require(block.timestamp <= c.deadline, "Expired");
    require(c.nonce > k.lastNonce, "NonceUsed");
    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(CLAIM_TYPEHASH, c))));
    _verifySig(k, digest, sig, authData, c.nonce);                   // see below
    k.lastNonce = c.nonce;
    stampId = keccak256(abi.encode(block.chainid, address(this), c.deviceKeyId, c.contentHash, c.nonce));
    require(stamps[stampId].registeredEpoch == 0, "Dup");
    code = uint40(uint256(keccak256(abi.encodePacked("stamper.code.v1", stampId))));
    require(stampByCode[code] == 0, "CodeTaken");
    require(_noNeighbour(code), "CodeNeighbour");                     // 248 SLOADs; cheap in FIL terms
    stamps[stampId] = Stamp(c.contentHash, c.pieceCidHash, c.recordDigest, c.deviceKeyId, c.size, c.capturedAt,
                            uint64(block.number), 0, code, c.hashKind, c.mediaKind, k.level, 0);
    stampByCode[code] = stampId;
    if (firstStampOf[c.contentHash] == 0) firstStampOf[c.contentHash] = stampId;
    emit StampRegistered(stampId, code, c.deviceKeyId, c.contentHash, c.hashKind, c.pieceCidHash, c.size, c.recordDigest,
                         c.capturedAt, c.mediaKind, k.level, c.nonce, sig, authData);
}

function _verifySig(DeviceKey storage k, bytes32 digest, bytes calldata sig, bytes calldata authData, uint64 nonce) internal view {
    if (k.sigScheme == uint8(SigScheme.Secp256k1)) {
        require(sig.length == 65 && ECDSA.recover(digest, sig) == k.signer, "BadSig");   // OZ 5.6.1 ECDSA (low-s enforced)
        return;
    }
    bytes32 h;
    if (k.sigScheme == uint8(SigScheme.AppAttest)) {
        require(authData.length == 37 && bytes32(authData[0:32]) == APPATTEST_RPID_HASH, "RpId");
        require(uint32(bytes4(authData[33:37])) == uint32(nonce), "Counter");          // nonce == App Attest counter
        h = sha256(abi.encodePacked(authData, sha256(abi.encodePacked(digest))));
    } else {
        h = sha256(abi.encodePacked(digest));                                             // Android Keystore / WebCrypto
    }
    require(sig.length == 64, "SigLen");
    (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(h, sig[0:32], sig[32:64], k.x, k.y));
    require(ok && out.length == 32 && out[31] == 0x01, "BadSig");                       // empty output == invalid
}

function bindStorage(bytes32 stampId, uint256 setId, uint256 pieceId, bytes calldata pieceCid) external {
    Stamp storage s = stamps[stampId];
    require(s.registeredEpoch != 0 && s.bindingCount < 4, "State");
    bytes32 h = keccak256(pieceCid);
    if (s.pieceCidHash == 0) s.pieceCidHash = h;                 // deferred (video); shown as "piece identity asserted by binder"
    else require(s.pieceCidHash == h, "CidMismatch");
    require(PDP.getDataSetListener(setId) == FWSS, "NotFWSS");
    require(PDP.dataSetLive(setId), "SetDead");
    uint256[] memory ids = PDP.findPieceIdsByCid(setId, Cid(pieceCid), pieceId, 1);
    require(ids.length == 1 && ids[0] == pieceId, "PieceMismatch");
    require(FWSS_VIEW.getDataSet(setId).pdpEndEpoch == 0, "Terminated");
    (address sp,) = PDP.getDataSetStorageProvider(setId);
    bindings[stampId][s.bindingCount++] = Binding(setId, pieceId, sp, uint64(block.number));
    emit StorageBound(stampId, setId, pieceId, pieceCid, sp);
}
```

Replay protection: EIP-712 domain (chain id + registry), per-key strictly increasing nonce (on iOS equal to the App Attest counter, so the assertion that signed the claim cannot be re-used), `deadline`, and `stampId` derived from the claim (not the signature, so P-256 malleability is irrelevant; OZ `ECDSA` enforces low-s for secp256k1). Cross-key replay is impossible because `deviceKeyId` is in the signed struct and the public key is read from storage, never from calldata.

### 4.4 Signature scheme decision

**P-256 on-chain, now.** FIP-0113's `P256VERIFY` is Final and live on mainnet since nv28 (2026-05-27) and on Calibration; input `hash‖r‖s‖x‖y` (160 B), output `…01` or empty (no revert). The hardware key that was attested is the key that signs every capture — no software key, no "bind a secp256k1 key at enrolment" (that key would live in the app sandbox and be extractable by exactly the rooted attacker we worry about).

Known costs and mitigations:
- Gas is unmeasured (Wasm-instrumented). Week-1 task: deploy a wrapper on Calibration and `eth_estimateGas` it. Precompiles are not callable as top-level `eth_call` targets on FEVM, and Foundry's local EVM has no `0x0100`: unit tests `vm.etch` a stub at `0x0100` that returns `…01` for a vectored input, and the real path runs as fork tests (`--fork-url https://api.calibration.node.glif.io/rpc/v1`) with the EIP-7951 vectors from `builtin-actors/actors/evm/tests/contracts/Secp256r1Precompile.sol`.
- Fallback if gas is absurd: Stamper deploys Daimo's `P256Verifier` (MIT, Veridise-audited; not present on Filecoin today) via the Safe singleton factory and switches `_verifySig` to it — a constructor parameter, decided before mainnet deployment, never a runtime switch.
- Relayer and verifier keys are secp256k1 (KMS-held); EIP-1271 support for Safe-owned stamps is a v1 addition.

### 4.5 Gas and throughput

Mainnet base fee sits at its 100 attoFIL floor; fees are `gasLimit × premium (~2e5 attoFIL)`. A `registerStamp` with ~10 SSTOREs, one `sha256` precompile call, one `P256VERIFY`, 249 SLOADs for the neighbour check and one event should land at 30–120 M Filecoin gas ≈ 6e-6–2.4e-5 FIL ≈ $0.00001–$0.00003. `bindStorage` makes 5 external view calls (~20–60 M). Budget $0.001 per stamp for both to absorb base-fee spikes. Throughput is bounded by 30-s epochs and next-tipset receipts, not by cost; the relayer batches nothing in MVP and gains a `registerBatch(CaptureClaim[] …)` in v1 only if the single-tx queue exceeds ~1,000 stamps/hour.

### 4.6 Deployment and indexing

- Foundry: `solc 0.8.30`, `evm_version = "cancun"`, `via_ir = true`, optimizer 200; OZ Contracts 5.6.1 (`ECDSA`, `Ownable2Step`, `TimelockController`), forge-std 1.17 (already vendored). `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --skip-simulation --slow --retries 10 --timeout 180`; verify with `forge verify-contract --verifier blockscout --verifier-url https://filecoin-testnet.blockscout.com/api/` and `npx filfox-verifier`.
- Calibration first (tFIL faucet `faucet.calibnet.chainsafe-fil.io`, tUSDFC `forest-explorer.chainsafe.dev/faucet/calibnet_usdfc`), then mainnet.
- ABIs/addresses flow into `packages/contracts-abi` via `@wagmi/cli` 2.10 foundry plugin (`deployments: { StampRegistry: { 314: …, 314159: … } }`).
- Indexing: Ponder (self-hosted, RPC mode, `ethGetLogsBlockRange: 360` because Lotus ≥ 1.36.3 caps `eth_getLogs` at 360 epochs) feeding Postgres; Goldsky subgraph (`filecoin`, `filecoin-testnet`) in v1 for public GraphQL. The verify page never trusts the indexer for verdicts: it `eth_call`s the registry via Glif and Ankr and compares.

---

## 5. Storage on FOC

### 5.1 Ownership and payment

- **Payer = Stamper's root account** (hardware wallet / KMS key that is never on the VPS). It deposits USDFC into Filecoin Pay and approves FWSS as operator in one tx via `synapse.storage.prepare({ pieceSizes })` → `prep.transaction.execute()` (`depositWithPermitAndApproveOperator`). Runway rule: deposit ≥ 90 days of current rate + lockup; alert at 60; hard stop at 35 (FOC lockup is 30 days; below it the SP may terminate and keep the lockup).
- **Daily operations use a session key**: `@filoz/synapse-core/session-key` `fromSecp256k1`, authorised by the root account with `login(signer, expiry, [AddPiecesPermission], origin)` on `SessionKeyRegistry` (`0x74FD…31aB` / `0x5184…7655`), expiry 7 days, rotated by runbook; the worker calls `Synapse.create({ account: rootAddress, sessionKey, chain, source: "stamper", withCDN })`. The session key cannot withdraw funds, create data sets, schedule removals or terminate (those are separate permissions; granted ad hoc from the root account for maintenance windows). A VPS compromise therefore leaks at most "add pieces at Stamper's expense until revoke()".
- Rejected: per-user data sets. Each data set costs 0.12 USDFC/month flat + 0.025 creation + ~0.5 USDFC lifecycle reserve and would require every user to hold a Filecoin account; it adds nothing to verifiability because the registry binds by PieceCID.

### 5.2 Data-set layout

Four data sets per environment, created once from the root account (`createContext({ providerId, withCDN, metadata })`): `orig-A` (endorsed provider A, `withCDN`), `orig-B` (approved provider B, no CDN), `pub-A` (marked derivatives, records, manifests; `withCDN`), `pub-B`. New shards (`orig-A-2026H2`) are opened when a data set passes ~200k pieces to keep leaf counts and challenge sampling reasonable; shard ids live in config, never in the contract.

### 5.3 Upload path

MVP uses the high-level call, which already does store → SP-to-SP pull → `addPieces` with batching:

```ts
const { pieceCid } = await Piece.calculate(bytes)                      // worker re-derives; must equal the device's
const res = await synapse.storage.upload(bytes, {
  pieceCid, copies: 2,
  dataSetIds: [cfg.ds.origA, cfg.ds.origB],
  pieceMetadata: { 'stamper.stamp': stampId, 'stamper.role': 'original' },
  callbacks: { onPiecesConfirmed: (dataSetId, providerId, pieces) => enqueueBind(stampId, dataSetId, pieces) },
})
if (!res.complete) scheduleRetry(res.failedAttempts)                   // secondary retried up to 5× by the SDK, then by us
```
`pieceBatching` stays on (zero-delay window) so concurrent uploads share one `addPieces` call (0.008 + 0.003/piece). v1 switches to explicit `createContext` + `store(data, { pieceCid })` + `commit({ pieces })` so a failed commit is retried without re-upload and so the two copies can be committed independently. `presignForCommit` is not needed: Stamper is the payer; it would only matter if devices owned pieces.

### 5.4 Retrieval

Order for the verify page and the API: (1) SP `/piece/{pieceCid}` of every bound copy in parallel (`getDataSetStorageProvider` → ServiceProviderRegistry service URL; the SDK's `download({ pieceCid })` does this race and re-hashes), (2) FilBeam `https://{payer}.filbeam.io/{pieceCid}` for `withCDN` sets (watch HTTP 402 = quota exhausted; stats at `stats.filbeam.io`), (3) Stamper mirror (Garage bucket keyed by PieceCID). Every path ends in the browser recomputing sha256 and PieceCID; a mismatch renders "bytes served do not match the registry — treat as unavailable", never a verdict.

### 5.5 Data-loss handling

- Monitoring (worker, every 10 min): for every data set id in config, Multicall3 batch of `PDPVerifier.getNextChallengeEpoch`, `getDataSetLastProvenEpoch`, `FWSSView.provenThisPeriod`, `provingDeadline`, `getDataSet` (watch `pdpEndEpoch`, `lifecycleReserveBalance`); log subscriptions for `FaultRecord`, `PiecesRemoved`, `DataSetDeleted`, `PDPPaymentTerminated`, `ServiceTerminated`. Alerts: proving overdue > 1 period, two consecutive faults, `pdpEndEpoch != 0`, runway < 60 days, FilBeam 402s.
- Per-piece spot checks: weekly sampled `HEAD`/range `GET` of 1% of pieces per provider; a provider failing retrieval SLO for 3 days triggers **re-replication**: the worker uploads from the mirror into a third data set at another approved provider and calls `bindStorage` again (the registry allows four bindings). Nothing in the registry is edited; the dead binding is simply shown as dead.
- Mirror: every original and derivative is written to the Garage bucket at ingest and kept for the stamp's lifetime (~$5/TB-month on commodity disk or Hetzner/B2 if the VPS fills). This is the third copy the threat model demands and the restore source for re-replication.
- Honest UI: "stored copies: 2 of 2 live, last proof 3 h ago, next deadline in 21 h" and proof history from `provenPeriods`/`FaultRecord` via the indexer.

### 5.6 Cost per stamp (photo, 4 MB original + 3 MB marked + 2 KB record, 2 copies)

One-time: 6 piece-adds × 0.003 + batch share ≈ 0.02 USDFC; chain gas ≈ $0.00005. Recurring: 14 MB × 2.5 USDFC/TiB-month ≈ 0.00003 USDFC/month per copy. Fixed: 4 data sets × 0.12 USDFC/month. A 100 MB video: ≈ 0.02 USDFC one-time + 0.0005 USDFC/month. Egress for originals: FilBeam ≤ 14 USDFC/TiB (1,000 views of a 4 MB original ≈ 0.056 USDFC) — thumbnails and marked derivatives are served from the Stamper cache, originals from FilBeam/SP on demand.

---

## 6. Marking pipeline

Order (images): original `B` (pristine, never modified) → decode → **TrustMark Q encode** (`BCH_SUPER`, payload = `code40`, strength 1.0) → **visible badge composite** → JPEG (`mozjpeg`, q92, 4:4:4) → **C2PA manifest embed** (hashes the final bytes) → `sha256`/PieceCID of the marked bytes → upload (`stamper.role = marked`) → PDQ of original and of every rendition → `DerivationRecord` → resolver. Runs entirely in `worker` + `ml`.

### 6.1 Visible badge

- `sharp` 0.35.5 `composite()` with an SVG pill: `rgba(0,0,0,0.62)` background, white monospaced code (`XXXX-XXXX-C`), wordmark, QR (`qrcode` 1.5.4, Version 2, ECC M, 4 px/module after a 1080 px downscale). Height 5% of the short side, bottom-right, 3% margin, inset so it survives a 4:5 centre crop. Fonts are baked into the container; all parameters (version, font hash, geometry) are written into the `DerivationRecord` so the marked bytes are reproducible from `B` + record with the same container image (reproducibility across libvips versions is best-effort and stated as such).
- Video: ffmpeg `overlay` + `drawtext` (libx264 `-crf 20 -preset medium -movflags +faststart`, audio copied). GPU encoders only if the VPS has one.
- Device preview: the app draws the badge in the UI (not baked) and shares the server-marked file once ready; v1 adds a Skia-rendered share copy registered as an extra rendition. Rejected for MVP: device-baked canonical marks — non-deterministic bytes and `expo-image-manipulator` cannot composite.

### 6.2 Invisible watermark

- Images: Adobe TrustMark Q (`trustmark` 0.9.2, MIT) in the `ml` sidecar, `MODE='binary'`, `BCH_SUPER` (40 data bits = `code40`; corrects 8 flips; ≈ 2e-6 false-accept). Model weights (`encoder_Q`, `decoder_Q`, ONNX for the browser) are mirrored into the `ml` image and the web bundle — the Adobe CDN is not a runtime dependency. Registered soft-binding alg: `com.adobe.trustmark.Q`, value `"0*<100-bit string>"`.
- Video: none in MVP/v1. Video Seal/PixelSeal is PyTorch-only, ~1.1 s CPU per video-second, forgeable at 83% bit accuracy (WmForger) — a GPU worker for a convenience feature is v2.
- The watermark is a **pointer**: decoding yields a code, the verifier resolves it and compares. Removal or forgery changes nothing about the verdict.

### 6.3 C2PA

- `@contentauth/c2pa-node` 0.9.9 with `CallbackSigner` backed by the KMS (ES256 cert from Stamper's own CA in MVP → SSL.com free-tier Level-1 cert after Conformance listing; TSA `https://api.c2patool.io/api/v1/timestamps/ecc`).
- Original: **external** manifest (`set_no_embed` / sidecar `.c2pa`, served as `application/c2pa`, stored as its own piece) because embedding would change the device-signed bytes. Marked derivative: embedded manifest with the original as `parentOf` ingredient, actions `c2pa.opened`, `c2pa.watermarked.bound` (+ `c2pa.soft-binding` TrustMark block), `c2pa.watermarked.unbound` (visible badge), custom assertion `computer.paradox.stamper.anchor { stampId, code, contentHash, pieceCid, chainId, registry, registerTx, bindTx[] }`, and `io.iscc.v0` soft binding (v1). `c2pa.repository-receipt` update manifests pointing at the Stamper registry: v2.
- Until Stamper is on the Conforming Products List, Adobe/CAI Verify shows "unknown source"; the Stamper verify page is the canonical UX and says so.

### 6.4 Perceptual hashes

One implementation for index and query: `pdqhash` 0.2.8 in `ml` (PDQ 256-bit + quality; 8 dihedral variants at query time; quality < 50 discarded), computed for the original and every distributed rendition (the badge alone moves PDQ by 26 ± 12 bits at 10% height, which is why every rendition is indexed and the badge is small). Video: vPDQ (`vpdq` 0.2.5) at 1 fps + scene changes, consecutive near-duplicates dropped; ISCC Video-Code (`iscc-sdk` 0.9.5) in v1. Stored in Postgres `bit(256)` with pgvector 0.8.6 HNSW `bit_hamming_ops`. PDQ of **public** originals is published inside the DAG-CBOR `DerivationRecord` on Filecoin so third parties can rebuild the index; never on-chain and never for sealed stamps (hash inversion leaks content).

### 6.5 Why server-side

Determinism (reproducible bytes), the SDK and watermark models are Node/Python only, Hermes has no WASM, and the device must do nothing that can later be disputed as "Stamper's software altered the bytes": the device signs `B`, the server derives from `B`, and the derivation is itself a signed, content-addressed record.

---

## 7. Capture and keys

### 7.1 iOS

1. First run: `@expo/app-integrity` `generateKeyAsync()` → `keyId` in Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, backup off). `GET /v1/attest/challenge` (32 random bytes, 5-min TTL, single use). `attestKeyAsync(keyId, challenge)` → `POST /v1/attest/ios`.
2. Server (`api`): `node-app-attest` 1.0.1 `verifyAttestation` extended with the 2026 checks (`apple_validation_category_01`, `apple_bundle_version_01`), Apple's validation-guide object as the regression vector; receipt exchanged at `data.appattest.apple.com/v1/attestationData` (sandbox host in dev) for the risk metric; bundle `{attestationObject, receipt, verdict}` → DAG-CBOR → Filecoin piece (`stamper.role = attestation`) → `enrolDeviceKey` via relayer with the verifier's EIP-712 countersignature; level per §1.3.
3. Each capture: `AVCapturePhotoOutput` via `expo-camera` (`takePictureAsync({ exif: true, shutterSound: true })`; `PHPicker`/gallery paths never exist in the signed flow); EXIF sanitised; claim built; `generateAssertionAsync(keyId, digestBytes)` (the module hashes what we pass — confirmed in week 1 by reading `expo-app-integrity` source; if it only accepts strings, we pass base64 and sign `sha256(base64(digest))` consistently on chain).
4. Keys die on reinstall/migration → re-enrol; Apple's risk metric catches key farms; `DCError.serverUnavailable` → retry same key, other errors → new key.

### 7.2 Android

1. App start: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)`.
2. Enrolment: local Expo module `stamper-keys` (Kotlin ≈150 lines): `KeyGenParameterSpec(alias "stamper-capture-v1", PURPOSE_SIGN, secp256r1, SHA-256, setAttestationChallenge(challenge), setIsStrongBoxBacked(true) with fallback, and for L2 `setUserAuthenticationParameters(300, BIOMETRIC_STRONG|DEVICE_CREDENTIAL)`); `getCertificateChain(alias)`; `requestIntegrityCheckAsync(base64url(sha256(spkiHash ‖ challenge)))`; `POST /v1/attest/android`.
3. Server: Play Integrity token decoded via `playintegrity.googleapis.com/v1/{pkg}:decodeIntegrityToken` (service account; default quota 10k/day — increase requested before launch); chain verified by `attest-android` (Google's `android/keyattestation` Kotlin verifier: roots from `attestation/root`, CRL from `attestation/status`, challenge, `attestationApplicationId`, security level, root of trust, patch levels, RKP validity). No maintained JS verifier exists; a 40 MB JVM container is the boring answer.
4. Each capture: `signWithAttestedKey(alias, digest)` (DER → raw r‖s), fresh standard Play Integrity token with `requestHash = base64url(sha256(digest ‖ serverChallenge))`; server re-checks CRL serials of the key's chain daily and at L2 captures.
5. GrapheneOS/no-Play devices: skip the token, accept `SelfSigned` boot state with a `verifiedBootKey` from `grapheneos.org/attestation.json`, cap at L2, label "Google-free device, hardware-attested".

### 7.3 Web (L0)

Passkey login (WebAuthn L3, identity only); `crypto.subtle.generateKey(ECDSA P-256, extractable=false, ["sign"])` stored in IndexedDB; `enrolSelf` at level 0 (relayer pays); capture via `getUserMedia` or plain upload — treated identically; `MediaRecorder` output normalised server-side before hashing? **No**: the browser hashes what it uploads, so the stored original is the browser's container (MP4 on Chrome 126+/Safari, WebM on Firefox); the marked derivative is always MP4. The verify page states "device not attested".

### 7.4 What the server verifies before relaying (and what it does not)

Verifies: signature off-chain (cheap pre-check; the chain is the authority), nonce monotonicity, challenge freshness and single use, Play Integrity verdicts, App Attest counter, `sha256(uploaded bytes) == claim.contentHash`, `PieceCID(uploaded) == claim.pieceCid` when present, record digest, EXIF sanitisation (rejects GPS/serial tags; rejects MP4 `udta`/`©xyz` location atoms), physical-camera flags, media type/size limits, quota and abuse scores. Does not and cannot verify: live capture, scene reality, clock, location.

### 7.5 Offline capture

Claims are signed at capture time with a 72-hour `deadline`; media and signed claims queue in `react-native-mmkv` (encrypted) + the file cache; uploads resume (`File.createUploadTask`, iOS background session) when online. The chain anchor is therefore "no later than upload + ~1 min", and the verify page shows the gap between `capturedAt` and `registeredEpoch`. Android key `setUserAuthenticationParameters` windows mean a biometric prompt per 5-minute capture session, not per shot.

---

## 8. Verification flows

### 8.1 Decision procedure (upload-a-copy)

```
0. normalise: decode once (EXIF-rotate); video → ffprobe
1. EXACT     sha256(copy) ∈ renditions.sha256 OR firstStampOf[sha256] on chain → "byte-identical to stamp #X (original|marked rendition)"
2. CODE      typed/scanned code → single-stamp confirmation mode (PDQ ≤ 40, SSIM shown)
3. WATERMARK TrustMark decode (browser onnxruntime-web; server fallback) → code40 → stampByCode → fetch original → PDQ ≤ 40 + SSIM
             → "derived from stamp #X — distance d, SSIM s, diff heat-map" (payload could be transplanted: always show the diff)
4. PERCEPT   PDQ(copy) quality ≥ 50 + 8 dihedral + 2 centre crops → pgvector k-NN (k=20) → d ≤ 31 → SSIM re-rank
             → "looks like stamp #X — similarity is not proof"; ties within 5 bits are all shown (bursts)
5. NONE      → "no registered original found" (never "fake")
```
Verdict ladder (wording fixed, colour-neutral): ORIGINAL (byte-exact) · SIGNED DERIVATIVE (valid C2PA hard binding to a Stamper-marked rendition) · MATCHES STAMP X (watermark/code + perceptual within tolerance) · RELATED TO STAMP X — ALTERED · UNKNOWN. Only byte-exact match may be called "original".

### 8.2 What the verify page shows

Side-by-side (and slider) of the stored original vs the viewer's copy, aligned by resize, `pixelmatch` heat-map, PDQ distance, SSIM; chain proof (stampId, code, epoch + exact timestamp, tx links to Blockscout/Filfox, device key id, level at registration, current key status with revocation epoch, signature re-verified in the browser from the event's `sig`); storage proof (copies, provider, data set, last proven, deadline, proof history); finality state per policy — included (receipt) → safe (≥ 30 epochs) → final (F3 certificate covers the epoch or ≥ 900 epochs). Mainnet F3 has produced no certificate since 2026-03-09 (instance 466453), so "final" is driven by the node's FRC-0089 `finalized` tag (~20–30 epochs) plus Stamper's own threshold; the UI never promises seconds. Three times are displayed: device `capturedAt`, Stamper `receivedAt`, chain `registeredEpoch`. The residual-risk footer is always present.

### 8.3 Independent verification

`stamper-verify` CLI (Node, in `packages/cli`): `stamper-verify code K3Q9-XA2M-7 --rpc https://api.node.glif.io/rpc/v1` or `stamper-verify file ./copy.jpg`. It needs only an RPC and SP/FilBeam reachability: reads `stampByCode`, `deviceKeys`, bindings and the `StampRegistered` log (archival RPC required for logs older than ~2,000 blocks on public endpoints — the CLI also accepts the signed claim JSON from the user's evidence bundle), recomputes the EIP-712 digest and verifies the P-256/secp256k1 signature locally (`@noble/curves`), downloads the piece, recomputes sha256/PieceCID, and prints storage status via the same view calls. Its release hash is published in the resolver so mirrors can be checked.

---

## 9. Apps and services

### 9.1 Monorepo (existing root at `stamper`)

```
apps/mobile      Expo SDK 57 (expo 57.0.26, RN 0.86.3), expo-router, expo-camera 57, expo-file-system 57, expo-secure-store,
                 @expo/app-integrity 57.0.2 (behind a DeviceAttestation interface), react-native-quick-crypto 1.1.7 (+nitro),
                 react-native-get-random-values, react-native-mmkv 4.3, viem 2.57 (hashTypedData only), zod 4;
                 local module modules/stamper-keys (Kotlin/Swift); dev builds only (no Expo Go)
apps/web         Next.js 16.3.8 (App Router), viem 2.57 (read-only; wagmi 3.7 only on the publisher/admin routes),
                 hash-wasm 4.12, @filoz/synapse-core/piece (browser), onnxruntime-web 1.30 + TrustMark decoder,
                 barcode-detector 3.2, react-compare-slider 4, pixelmatch 7, ssim.js (worker)
services/api     Hono 4.13 + @hono/node-server 2.1 on Node 24 LTS, drizzle-orm 0.45 + pg, zod, pino; node-app-attest 1.0.1, googleapis
services/worker  BullMQ 6.3 (createPostgresBackend), @filoz/synapse-sdk 2.0.2, sharp 0.35.5, qrcode 1.5.4, @contentauth/c2pa-node 0.9.9, ffmpeg (system)
services/relayer viem 2.57 wallet client with KMS signer (AWS KMS / GCP KMS; OpenZeppelin Relayer is the drop-in alternative)
services/ml      FastAPI 0.142 + uvicorn, Python 3.12: trustmark 0.9.2, pdqhash 0.2.8, vpdq 0.2.5, iscc-sdk 0.9.5, scikit-image 0.26
services/attest-android  Kotlin/JVM, android/keyattestation, one HTTP endpoint
services/indexer Ponder (RPC mode)
packages/core    @stamper/core (exists): EIP-712 types (abitype `TypedData`), claim/record codecs (dag-cbor), code alphabet + check,
                 EXIF sanitiser, CID/PieceCID helpers — zero Node built-ins, no multiformats/hashes/sha2 (noble hasher via hasher.from)
packages/contracts-abi  @wagmi/cli output
packages/cli     stamper-verify
contracts/       Foundry (exists): StampRegistry, StampResolver, tests, Deploy script
```
Tooling notes: pin `typescript ~6.0.3` for `apps/mobile`, `apps/web` and anything that needs typescript-eslint/jest; `packages/core` may keep 7.0.2 only for `tsc`/vitest, but one workspace version (6.0.3) is simpler — recommended. viem stays on 2.x (Synapse and wagmi peer on 2.x). Node 24 LTS in containers (host has 22; fine for dev).

### 9.2 API surface (prefix `/v1`)

`GET /attest/challenge` · `POST /attest/ios` · `POST /attest/android` · `POST /keys/web` · `GET /capture/challenge` · `PUT /uploads/{id}` (resumable `Content-Range`, 2 GiB cap) · `POST /stamps` (claim + sig + record + token) · `GET /stamps/{id}` (status, derivative URLs, self-submit bundle) · `POST /stamps/{id}/withdraw` · `GET /v/{code}` (resolver JSON) · `POST /verify/upload` · `GET /verify/{stampId}/storage` · `GET /health/storage` (public per-data-set proof status) · `POST /reports` (takedown intake) · `GET /.well-known/{apple-app-site-association,assetlinks.json}`.

### 9.3 Database (Postgres 17 + pgvector 0.8.6, Drizzle)

```sql
users(id uuid pk, account_salt bytea, created_at)
device_keys(id bytea pk /*deviceKeyId*/, user_id, platform, sig_scheme, level, x bytea, y bytea, signer bytea,
            attestation_cid bytea, attestation_json jsonb, risk_metric int, enrolled_epoch bigint, expires_at, revoked_epoch, revoke_reason, last_nonce bigint)
challenges(id uuid pk, kind, value bytea, device_key_id, expires_at, used_at)
stamps(id bytea pk, code bigint unique, device_key_id, user_id, content_hash bytea, hash_kind int, piece_cid bytea, size bigint,
       record_cid bytea, captured_at, media_kind, level_at_reg int, registered_epoch bigint, register_tx bytea,
       status text /* received|registered|stored|marked|withdrawn|withheld */, visibility text /* public|sealed */, created_at)
claims(stamp_id fk, typed_data jsonb, sig bytea, auth_data bytea, nonce bigint, deadline bigint)
renditions(id bigserial, stamp_id, role, sha256 bytea unique, piece_cid bytea, mime, width, height, duration_ms, params jsonb, pdq bit(256), pdq_quality int)
  index hnsw (pdq bit_hamming_ops)
video_frames(stamp_id, rendition_id, t_ms int, pdq bit(256), quality int)  index hnsw (pdq bit_hamming_ops)
storage_copies(stamp_id, rendition_id, data_set_id bigint, piece_id bigint, provider_id bigint, service_url, bound_epoch bigint, bind_tx bytea, last_ok_at, state)
data_sets(id bigint pk, role, provider_id, with_cdn bool, last_proven_epoch, next_deadline_epoch, faults int, pdp_end_epoch)
sealed_keys(stamp_id pk, wrapped_key_device bytea, wrapped_key_kms bytea, salt bytea, released_at)
verifications(id bigserial, stamp_id, method, distance int, client_ip inet, at)
reports(id, stamp_id, kind, reporter, status, legal_hold bool, created_at, resolved_at)
chain_cursor(name pk, block bigint)
```
BullMQ's Postgres backend adds its own tables; queues: `ingest`, `foc-upload`, `bind`, `mark`, `c2pa`, `index`, `monitor`, `relay`.

### 9.4 Docker Compose (one VPS; 8 vCPU / 32 GB / NVMe is the sizing to start)

```yaml
services:
  caddy:          { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy:/data] }
  web:            { build: apps/web, env_file: .env }
  api:            { build: services/api, env_file: .env, volumes: [staging:/srv/staging], depends_on: [postgres] }
  worker:         { build: services/worker, env_file: .env, volumes: [staging:/srv/staging, models:/models], deploy: { replicas: 2 } }
  relayer:        { build: services/relayer, env_file: .env, secrets: [kms_creds] }
  ml:             { build: services/ml, volumes: [staging:/srv/staging, models:/models], cpus: 4 }
  attest-android: { build: services/attest-android }
  indexer:        { build: services/indexer, env_file: .env }
  postgres:       { image: pgvector/pgvector:pg17, volumes: [pg:/var/lib/postgresql/data] }
  mirror:         { image: dxflrs/garage:v2.4.1, volumes: [garage:/var/lib/garage] }
  prometheus:     { image: prom/prometheus }
  alertmanager:   { image: prom/alertmanager }
volumes: { staging: {}, pg: {}, garage: {}, models: {}, caddy: {} }
```
No Redis (BullMQ 6 on Postgres), no MinIO (archived 2026-04). Secrets: KMS credentials for relayer/verifier/C2PA signer; the FOC session key as a Docker secret rotated weekly; the root account key never on the box. Backups: nightly `pg_dump` + Garage replication off-box. Monitoring targets: queue depth/age, relayer nonce gap and receipt latency (> 180 s alert), `finalized` lag (> 60 epochs alert), PDP status per data set (§5.5), USDFC runway, FilBeam quota, Play Integrity quota usage, App Attest error rates, enrolment rate anomalies, disk.

---

## 10. Threat-model coverage

| # (threat-model.md) | Threat | Mitigation in this design | Residual (disclosed) |
|---|---|---|---|
| 1 | Analog hole | In-app live capture only; physical-lens enumeration; `capture` flags signed; L3 reserved for depth/parallax evidence | Cannot tell a real scene from a screen or print |
| 2 | Root / confused-deputy signing | Hardware P-256 keys attested at enrolment; L2 requires STRONG + CRL re-check + biometric-gated Keystore window; on-chain revocation with effective epoch; per-key nonce/counter; enrolment-rate and stamp-burst anomaly scoring; device recall / Apple risk metric | A compromised phone signs anything until revoked |
| 3 | Camera injection | Physical camera ids only, no intents/share-sheet, `appAccessRiskVerdict` on Android, attestation tiers | Same as #2 |
| 4 | Fake / transplanted badge | Badge is a pointer; code checksum + distance-2 issuance; verification is a comparison with diff; no green check from badge presence | Viewers who do not click through |
| 5 | Filecoin copy loss | 2 FOC copies + Stamper mirror; PDP/fault monitoring; runway alerts; re-replication with additional bindings | If all copies vanish, only a bit-exact holder can verify |
| 6 | Relayer censorship/compromise | Relayer only pays gas; device signature verified on-chain; signed claim returned to user; self-submit documented; verifier key separate (KMS) and verifier set governed by timelocked Safe; attestation bundles public for re-audit | Relayer can delay, not forge; a compromised verifier can mint fake L1/L2 keys until removed (detectable from public bundles) |
| 7 | Perceptual-hash collisions/inversion | PDQ only for retrieval; verdict from exact hash or human comparison; PDQ of sealed stamps never published | Similar-looking is not the same image |
| 8 | Re-stamping / ordering | `firstStampOf[contentHash]`, epoch + signed device time; near-duplicate warning at ingest ("looks like stamp #X from 2 days earlier") | Earliest stamp ≠ original creator |
| 9 | Watermark removal/forgery | Pointer semantics; registry comparison | none beyond #4 |
| 10 | Time/location spoofing | Three clocks displayed; location opt-in, labelled "device-reported", kept in the sealed record | Cheap radios spoof GNSS |
| 11 | Deanonymisation | EXIF sanitised before hashing; sealed mode; no PII on chain; pseudonymous account id; per-stamp unlinkable codes; device key linkage visible only as a hash (key rotation every 12 months) | Public originals can identify people and cameras (PRNU) |
| 12 | Gateway/denylist censorship | Multi-source retrieval; CID exposed; hash-only verification works offline | Original may be unreachable via some paths |
| 13 | Reorg before finality | Finality policy (included/safe/final) from node tags + own threshold | none |
| 14 | Registry/admin abuse | Immutable registry; governor can only manage verifiers; FOC proxies referenced by immutable address | FOC contracts are third-party upgradeable |
| 15 | Phishing verify sites | One HSTS-preloaded domain; Universal/App Links; in-app scanner; CLI verifier with published hash | Only trust the registry |
| 16 | Coerced stamping | Sealed stamps, owner withdrawal, dispute flag; duress mode deferred pending legal review | A stamp does not prove consent |
| 17 | Sybil / collusion | No aggregation into truth scores; attested enrolment; quotas | Many stamps ≠ truth |
| 18 | "Verified" read as "true" | Fixed wording, neutral colours, residual-risk footer on every result | this is the disclosure |

Additional, from this lens: **Stamper VPS compromise** — attacker gains the FOC session key (add pieces, bounded by `revoke()` and runway), the relayer key (spend FIL, submit valid claims only), DB read (sealed originals are ciphertext; wrapped keys need the KMS), and could serve wrong bytes (caught by browser re-hashing). What it cannot do: alter any existing stamp, mint stamps for keys it does not hold, or change a code's resolution.

---

## 11. Economics, abuse, privacy, legal

### 11.1 Who pays

Stamper pays FOC storage (≈ 0.02 USDFC one-time + negligible monthly per photo; ≈ 0.5 USDFC fixed/month for data sets) and gas (budget $0.001/stamp). Tiers: **Free** (attested devices only, L1+: 100 photos + 10 video-minutes/month, public originals, 2 years retention), **Pro** (sealed mode, evidence bundle export with RFC 3161/OTS anchors, 10-year retention, API), **Newsroom/Org** (seats, legal hold, custom retention, qualified EU timestamps and ICP-Brasil carimbo on batch roots). Web L0 stamping requires an account and is quota-limited (10/day) because it is the cheapest abuse vector.

### 11.2 Abuse and rate limits

Per device key, per account, per IP/ASN token buckets on `/stamps`, `/uploads`, `/attest/*` and code lookups; enrolment limited to 3 keys per account per 30 days; Play Integrity `recentDeviceActivity` and device recall, Apple risk metric; near-duplicate scoring at ingest; pre-publication CSAM hash matching (vendor agreement; not in MVP) and NSFW/violence classifiers for routing to review, never automatic verdicts. The `/piece` egress path is the cost surface: originals served on demand behind a per-IP budget; thumbnails and marked derivatives from the cache.

### 11.3 Moderation and takedown on "immutable" storage

FOC pieces are deletable by the payer (`deletePieces`/`getScheduledRemovals`; fee 0.007 USDFC per scheduling call), so the pipeline is: (1) `StampResolver.setWithheld(stampId, reason)` (event; verify page shows "withheld by Stamper on <date>: <category>"), (2) stop serving from API/cache and remove from FilBeam-eligible data sets by scheduling removal in both copies, (3) move the mirror copy to legal hold or delete, (4) for sealed stamps destroy the KMS-wrapped key (crypto-shredding), (5) IPFS Bad Bits is irrelevant unless `withIPFSIndexing` is ever enabled (it is not). The chain keeps `contentHash` (irreversible, not content) — EDPB treats it as personal data, so erasure requests are answered with delist + deletion + key destruction and documented 17(3)(a)/(e) exceptions; a DPIA is a launch gate. Legal intake: DMCA/DSA notice-and-action, Marco Civil Art. 19 flow (counsel), transparency report.

### 11.4 Privacy of originals

- Default public mode: EXIF reduced on device to Orientation (plus optional DateTimeOriginal); GPS, serials, owner, MakerNote removed before hashing; MP4 `udta` location atoms stripped; full metadata encrypted into the sealed record. Faces are not analysed (no biometric processing). Capture-time prompt: "people may be identifiable — publish / keep private".
- **Sealed (encrypted-original) mode**: AES-256-GCM per-stamp key generated on device; ciphertext uploaded and stored (its PieceCID is what gets bound); claim carries `hashKind = 1`, `contentHash = sha256(salt ‖ plaintext)` with the 32-byte salt kept in the owner's bundle; key wrapped to the device key's ECDH-derivable secret (a second Keystore/Secure Enclave key) and to Stamper's KMS. Reveal = release salt + key (verify page then decrypts in the browser and recomputes the commitment). "Publish key permanently" is an explicit, irreversible action (v2).
- Nothing personal on chain: hashes, code, key id, level, epochs.

### 11.5 Evidentiary considerations

Evidence bundle (JSON + PDF): signed claim, record, attestation bundle CID, tx hashes/epochs, bindings, provider ids, retrieval URLs, OpenTimestamps `.ots` (v1) and RFC 3161 token over the daily Merkle root of stamp ids (qualified EU TSA / ICP-Brasil ACT for Pro/Org), plus an FRE 902(13)/(14)-style certification template describing how hashes, times and storage proofs are produced. Verdicts stay simple and reproducible (hash equality, signature validity, chain time); similarity scores are labelled as advisory. Capture→chain latency is logged for Chinese-court-style review.

---

## 12. Roadmap

### MVP (demoable end-to-end on Calibration, ~8 weeks)

In: Expo app (iOS + Android dev builds) with photo capture, L1 enrolment (App Attest; Play Integrity + Key Attestation chain), EXIF sanitiser, sha256 + PieceCID on device, EIP-712 claim signed by the hardware key; `services/api` + `worker` + `relayer` + `ml`; `StampRegistry` on Calibration with P-256 verification (`vm.etch` tests + fork tests; wrapper gas measurement); Synapse upload with 2 copies to Stamper data sets, `bindStorage`; server-side badge + TrustMark + PDQ index; Next.js verify by code/QR/upload with side-by-side, chain + storage proof, finality policy; `stamper-verify` CLI; mirror; basic monitoring (PDP status, runway, queue age). Video: capture, hash, store, register, ffmpeg badge, vPDQ index — no invisible watermark, no C2PA.
Out: mainnet, C2PA, sealed mode, web L0 capture, takedown tooling beyond a manual runbook, Goldsky, L2 policy enforcement (data collected, level capped at 1).

### v1 (mainnet launch)

Mainnet deployment (Safe + timelock governor; verifier key in KMS); L2 policy live; C2PA manifests (external for originals, embedded for derivatives) with Stamper CA, Conformance Program application, SSL.com cert when listed; sealed mode; web L0 capture; takedown pipeline (resolver flags, piece removals, legal hold); Goldsky subgraph + public storage-health page; evidence bundle with OTS and RFC 3161 batch roots; explicit `store/commit` upload path with retries; re-replication automation; ERC-7053 `Commit` events; Skia share copy as extra rendition; App Store / Play distribution; DPIA.

### v2

PixelSeal/Video Seal GPU worker for video soft bindings; L3 sensor evidence (depth/Live Photo flatness, burst parallax); CAWG identity assertions (opt-in, redactable); `c2pa.repository-receipt` and Soft Binding Resolution API endpoints (Stamper as a C2PA Manifest Repository); EIP-1271 Safe-owned stamps and wallet self-submission UI; Merkle-batched registration if volume demands; qualified-timestamp automation per jurisdiction; decentralised key custody for sealed stamps (Lighthouse Kavach if still Filecoin-aware); anonymity-set device keys; third-party verifier mirrors with on-chain release hashes.

---

## 13. Risks and open questions

1. **`P256VERIFY` gas on FEVM is unmeasured** and precompiles are not top-level callable; if a wrapper shows > ~500 M gas per verify, switch the constructor to a self-deployed Daimo verifier (still ≈ $0.0001/tx at today's prices).
2. **`@filoz/synapse-core/piece` under Hermes/Metro** (ESM `exports`, pure-JS SHA-256 speed on 12 MB photos and on video) — week-1 spike; fallback is a native fr32 hasher or server-computed PieceCID with the `pieceCidHash = 0` deferred path (already supported by the contract).
3. **`@expo/app-integrity` is alpha**: confirm `generateAssertionAsync` hashes raw bytes; confirm `generateHardwareAttestedKeyAsync` requests StrongBox; the local `stamper-keys` module exists to replace it if needed.
4. **Mainnet F3 stalled** (no certificate since 2026-03-09): finality UX relies on FRC-0089 `finalized` (~10–12 min) plus our threshold; confirm status with FilOz before mainnet launch.
5. **FOC contract upgradeability** (UUPS proxies, "beta"): subscribe to `UpgradeAnnounced`; re-run fork tests on every FWSS/PDP upgrade; `findPieceIdsByCid` semantics and `Cid.data` encoding (FRC-0069 Draft) are pinned by a fork test vector before mainnet.
6. **Public RPC limits**: `eth_getLogs` 360-epoch windows, ~2,000 blocks of state on public nodes — budget a dedicated Lotus node or paid Glif/Ankr tier before v1; the CLI accepts user-supplied claim JSON to avoid archival dependence.
7. **Play Integrity quota (10k/day)** and Apple attestation rate limits — request increases early; design degrades to "token unavailable" flags, never to blocking captures.
8. **Verifier key compromise** is the single most damaging key: KMS-only, dual control for the enrolment service, enrolment anomaly alerts, timelocked rotation, and public attestation bundles make it detectable and revocable, not impossible.
9. **Badge geometry vs PDQ drift** and TrustMark survival through real platforms (WhatsApp/Instagram/X/Telegram) — build the push-through harness in MVP week 6 and tune strength (0.8–1.5) and badge size on measured data.
10. **EXIF/MP4 sanitisation on device** must be exact (orientation kept, location atoms dropped) on both platforms; a wrong sanitiser silently makes stored originals rotate or leak GPS.
11. **TrustMark weights redistribution** terms (package MIT; CDN listing 403) — confirm mirroring is permitted; otherwise ship the ONNX graphs exported from the MIT weights.
12. **Legal texts quoted from memory** in codes-ux-legal.md (eIDAS, MP 2.200-2, CPC Art. 422, Vermont §1913) must be checked by counsel before any product copy claims evidentiary weight.
13. **Sealed-mode key custody** currently depends on Stamper's KMS as the second wrapper; a company failure strands sealed originals unless owners export their bundle — the export flow is therefore part of v1, not v2.
14. **Deferred `pieceCidHash` for video** weakens the device-signed storage identity (the binder asserts it); the UI must label it; measure on-device PieceCID speed before deciding whether to drop the deferral in v1.

What breaks first, in order: public RPC log limits and rate limits (indexer stalls), an SP missing retrieval SLO (verify page falls back to mirror), Play Integrity quota (flags, not failures), USDFC runway (alerted 60 days out), App Attest key churn after reinstalls (re-enrolment friction, risk metric), relayer receipt timeouts on busy tipsets (queue age alert), FilBeam 402s (SP/mirror fallback). None of these can corrupt a stamp; all are visible on the public storage-health page.
