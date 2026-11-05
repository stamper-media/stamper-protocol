# Stamper — Architecture proposal (lens: TRUSTLESS-FIRST)

Date: 2026-10-01. Inputs: `VERIFIED-SDK-FACTS.md` (ground truth) and the nine research reports (`filecoin-storage`, `fevm-contracts` — read last, it was complete when read — `c2pa-prior-art`, `watermarking`, `trusted-capture`, `perceptual-hashing`, `app-stack`, `codes-ux-legal`, `threat-model`). No new web research was done; selectors and typehashes below were computed locally with `cast sig` / `cast keccak` (forge 1.3.5).

Design principle of this lens: **the Filecoin chain plus Filecoin storage must be sufficient to verify a stamp.** Every byte that decides a verdict is either on chain (registry state), reproducible from on-chain data (hashes, signatures, PieceCIDs), or retrievable from a PDP-proven data set. Stamper's servers are conveniences — gas sponsor, attestation verifier, renderer, search index — and every one of them has a documented bypass.

---

## 1. Trust model

### 1.1 What a stamp proves

A Stamper stamp is an on-chain record proving, for anyone with a Filecoin RPC endpoint:

1. **Bytes.** A specific file exists whose `sha256` and PieceCID v2 are fixed in the registry. If you hold a bit-identical copy, you can prove it is *the* registered file with `sha256sum` alone.
2. **Signature.** A device key (P-256 in a Secure Enclave / Android Keystore, a WebCrypto key, or a wallet) signed an EIP-712 claim over those identifiers, and the registry contract verified that signature on chain (FIP-0113 `P256VERIFY` precompile at `0x0100`, or `ecrecover`). The signature and public key are stored, so the verification can be re-run by anyone forever, independent of certificate expiry.
3. **Time (upper bound).** The claim was included at Filecoin epoch `E`; `block.timestamp == genesis + 30·E` is deterministic, so "existed no later than `genesis + 30·E`" is exact. The device-reported `capturedAt` is a *claim*, displayed separately.
4. **Storage.** The file is a piece in one or more PDP data sets whose provider answers 5 random challenges per 24 h (mainnet `maxProvingPeriod = 2880`, `challengeWindowSize = 60`, `challengesPerProof = 5`). `PDPVerifier.getPieceCid(setId, pieceId)` equals the registered PieceCID, and `FWSSStateView.provenThisPeriod / provingDeadline` plus `PDPVerifier.getDataSetLastProvenEpoch` say whether proving is current.
5. **Assurance level.** Which kind of key signed, who vouched for the key's attestation evidence, and where that evidence is stored (its own PieceCID), so the vouching can be audited.

### 1.2 What a stamp does not prove (disclosed on every verify page)

- That the scene was real (analog hole: screens, prints; staged scenes).
- That the phone was uncompromised (root exploits defeat hardware attestation — Pixel 10 / CVE-2026-43499; Google: "won't fix").
- That `capturedAt` or any location is honest (user clock; $200 GNSS spoofing).
- That the person stamping consented or is who the account says.
- That the first stamp of a scene is the original creator's.
- That an unstamped or non-matching image is fake.

Wording rule: never "verified", "authentic", "real". The UI says *"Unaltered since it was registered at epoch E (date) from a key at level Lx. Stamper cannot see what was in front of the lens."*

### 1.3 Assurance levels

| Level | Who signs | Enrollment evidence (verified off chain, stored on FOC, vouched on chain) | On-chain representation | UI label |
|---|---|---|---|---|
| **L0** | WebCrypto non-extractable P-256 key in the browser (keyType `P256_RAW`), or any secp256k1 wallet / EIP-1271 account | none; self-registered | `DeviceKey.level = 0`, `registrar = address(0)` | "Registered upload — device not attested" |
| **L1** | iOS App Attest key (`P256_APPATTEST`) or Android Keystore key (`P256_RAW`) | iOS: attestation object validated (12 steps), `apple_validation_category_01 == 4` (App Store) or `2` (TestFlight, non-prod). Android: Play Integrity standard token `PLAY_RECOGNIZED` + `MEETS_DEVICE_INTEGRITY` + `LICENSED` with `requestHash` bound to the key; attestation chain stored (verified in v1) | `level = 1`, `registrar = Stamper registrar address`, `attestationCid = PieceCID of bundle` | "Captured in the Stamper app" |
| **L2** | same keys | L1 plus — iOS: production `aaguid`, Apple receipt exchanged, risk metric ≤ 5, key age ≤ 12 months. Android: Key Attestation chain to a Google root, `origin == GENERATED`, TEE or StrongBox, `verifiedBootState == Verified` (or GrapheneOS SelfSigned with known key), `deviceLocked`, `osPatchLevel` ≤ 12 months, serials absent from `android.googleapis.com/attestation/status`, `MEETS_STRONG_INTEGRITY` where Play exists | `level = 2` | "Hardware-attested capture" |
| **L3** (v2) | same | L2 + StrongBox-only/RKP chain + sensor evidence (Live Photo / depth map / burst) hashed into the record and scored | `level = 3` | "Secure-element capture with sensor evidence" |

Rules: a capture inherits its key's level at registration time (`Stamp.level`); `DeviceKey.revokedEpoch` lets any viewer downgrade captures registered after revocation; an unknown registrar is displayed as level 0 by the Stamper UI, but third-party verifiers may trust other registrars. The level is **not** encoded in the visible code (it can change after revocation and would invite "L2 = true" misreadings); it is shown by the verify page.

---

## 2. System architecture

### 2.1 Components

```
                        ┌──────────────────────────── Filecoin (314 / 314159) ─────────────────────────────┐
                        │  StamperRegistry (immutable)   PDPVerifier 0xBADd…557F   FWSS 0x8408…1A9f (+StateView 0xcf18…8172)
                        │  StamperResolver (owned, flags)  FilecoinPay 0x23b1…4DAa   USDFC 0x80B9…F045   SessionKeyRegistry 0x74FD…31aB
                        └──────────▲────────────────────────▲──────────────────────────────▲────────────────┘
                                   │ eth_call / eth_sendRawTransaction                     │ addPieces (SP-relayed, EIP-712 by session key)
┌──────────────┐  claim+sig  ┌─────┴──────┐   jobs   ┌───────────────┐   store/commit   ┌───┴──────────────┐   /piece/{cid}   ┌──────────────┐
│ Expo app     │────────────▶│ api (Hono) │─────────▶│ worker        │─────────────────▶│ FOC providers    │◀────────────────│ Verify page  │
│ iOS/Android  │  bytes      │ relayer    │  PG queue│ (BullMQ 6/PG) │  synapse-sdk 2.0.2│ (2 data sets)    │  FilBeam CDN    │ Next.js 16   │
│ web capture  │────────────▶│ verifier   │          │ sharp/ffmpeg  │                   │ + Stamper mirror │                 │ + CLI        │
└──────────────┘             └─────┬──────┘          └──────┬────────┘                   └──────────────────┘                 └──────┬───────┘
                                   │                        │ HTTP                                                                    │ eth_call
                             ┌─────▼──────┐          ┌──────▼────────┐          ┌──────────────┐                                      │ (direct RPC,
                             │ Postgres 17│          │ ml (FastAPI)  │          │ indexer      │◀─────────────────────────────────────┘  no Stamper
                             │ + pgvector │          │ TrustMark/PDQ │          │ (Ponder/RPC) │   search & history only                 server needed)
                             └────────────┘          └───────────────┘          └──────────────┘
```

### 2.2 End-to-end flow (photo, L1/L2 device)

```mermaid
sequenceDiagram
  participant D as Device (Expo app)
  participant A as api + relayer
  participant F as FOC provider(s)
  participant C as StamperRegistry (FEVM)
  participant W as worker + ml
  D->>D: capture (expo-camera, in-app only) → EXIF-minimize (keep Orientation) → bytes
  D->>D: sha256 (react-native-quick-crypto) + PieceCID (synapse-core/piece hasher) in one pass
  D->>D: build capture record (DAG-CBOR) → recordHash; build CaptureClaim (EIP-712) → digest = stampId
  D->>D: sign digest: App Attest assertion (iOS) / Keystore SHA256withECDSA (Android) / WebCrypto (web)
  D->>D: predict code = f(stampId) (deterministic; final after receipt)
  D->>A: PUT /v1/uploads/{id} (resumable, Content-Range) bytes ; POST /v1/captures {claim, sig, authData, integrityToken}
  A->>A: recompute sha256/PieceCID, verify sig off chain, decode Play Integrity token (requestHash == sha256(digest)), check key not revoked
  A->>C: registerCapture(claim, sig, authData)  [relayer wallet pays gas]
  C-->>A: CaptureRegistered(stampId, code, ...) in next tipset (30–90 s)
  A-->>D: {stampId, code, txHash, state: included}
  W->>F: StorageContext.store(bytes,{pieceCid}) → commit({pieces:[{pieceCid, pieceMetadata}]}) on 2 providers
  F-->>C: FWSS addPieces → PDPVerifier PiecesAddedV2 (pieceId known)
  W->>C: bindStorage(stampId, setId, pieceId) ×2  (contract re-checks getPieceCid == claim.pieceCid)
  W->>W: render marked JPEG (sharp) → TrustMark(BCH_SUPER, 40-bit code prefix) → C2PA manifest (c2pa-node) → sha256/PieceCID
  W->>F: store+commit marked derivative (2 copies)
  W->>C: registerDerivative(stampId, {contentHash, pieceCid, kind=MARKED, paramsHash}, rendererSig) ; bindStorage for it
  W->>W: PDQ/ISCC of original + marked → DB index ; emit IndexPublished(stampId, pdqOriginal, pdqMarked) via resolver
  W-->>D: marked derivative ready (push) → user shares it
```

### 2.3 Verify flow (by code)

```mermaid
sequenceDiagram
  participant V as Verifier (browser or CLI)
  participant C as StamperRegistry
  participant P as PDPVerifier + FWSS StateView
  participant S as Storage provider / FilBeam
  V->>V: normalize code (case, I/L→1, O→0, drop '-'), check symbol (mod 37)
  V->>C: stampByCode(code) → stampId ; getStamp(stampId) ; getKey(keyId) ; getBindings(stampId) ; getDerivatives(stampId)
  V->>V: re-verify device signature (WebCrypto / noble) from stored sig + pubkey
  V->>P: dataSetLive / pieceLive / getPieceCid / getDataSetLastProvenEpoch / getDataSetListener ; provenThisPeriod / provingDeadline / getDataSet (multicall3)
  V->>S: GET {serviceURL}/piece/{pieceCid} (parallel over bindings) or https://{payer}.filbeam.io/{pieceCid}
  V->>V: recompute sha256 + PieceCID of the bytes; compare with chain → "ORIGINAL" ; render side-by-side with the copy in hand
```

### 2.4 Verify flow (by uploaded copy)

exact hash → `stampByContentHash` / `stampByDerivativeHash` (on chain) → else TrustMark decode in browser (onnxruntime-web) → code prefix → candidates → else perceptual nearest (server) → always end in the by-code flow and a visual comparison (Section 8).

---

## 3. Identifiers and data model

### 3.1 Original bytes

- `contentHash = sha256(bytes)` (32 B). The portable identity (courts, `sha256sum`).
- `pieceCid` = PieceCID v2 (FRC-0069) bytes: `0x01 0x55 0x91 0x20 | len | uvarint(padding) | uint8(height) | 32-byte root` (prefix `0x01559120`; text form `bafkzcib…`). Computed on device with `import { hasher } from '@filoz/synapse-core/piece'` (streaming `write/finalize`; pure JS, Hermes-safe) and recomputed by the server and by the SP (`store(data, { pieceCid })` makes the SP reject mismatches). Stored on chain **as full bytes** (≈ 40 B), not a keccak of them, so the chain stays self-describing and `findPieceIdsByCid(setId, Cid{data}, 0, 1)` can be called with it. Alternative (keccak only, as in fevm-contracts §6.1) rejected: saves one slot at $0.000001 and loses self-description.
- `contentLength` (uint64). Piece bounds: 127 B ≤ size ≤ 1,065,353,216 B (MVP caps video via `recordAsync({ maxFileSize })`; chunking is v2).
- The "original" is the file *as produced by the Stamper app*: camera JPEG/MP4 with EXIF/XMP/MPF minimized on device **before** hashing (keep `Orientation`, `PixelXDimension/YDimension`; drop GPS, serials, maker notes). Full metadata lives in the capture record. No pixel re-encode on device.

### 3.2 Stamp id

`stampId = keccak256("\x19\x01" ‖ domainSeparator ‖ hashStruct(CaptureClaim))` — the EIP-712 digest itself. Domain: `{ name: "Stamper", version: "1", chainId: 314 | 314159, verifyingContract: <registry> }`. Anyone can recompute it from the claim; replay is "stampId already registered".

### 3.3 Capture claim (EIP-712, signed by the device key)

```
CaptureClaim(bytes32 contentHash,bytes pieceCid,uint64 contentLength,string mediaType,uint64 capturedAt,bytes32 keyId,uint64 nonce,bytes32 recordHash,uint8 flags,uint64 deadline)
typehash = 0x84d8359dd2ad611c028ca0ea3ffd75e0022505fbab828819c69ac38045d1e0c1
```
- `capturedAt`: device wall clock, ms. `nonce`: per-key monotonic (iOS: equals the App Attest counter; Android/web: local counter). `deadline`: unix seconds (offline captures: `capturedAt/1000 + 7 days`). `flags`: bit0 `SEALED` (ciphertext stored), bit1 `VIDEO`, bit2 `CHUNKED` (v2), bit3 `RECORD_PUBLIC`.
- `recordHash = sha256(DAG-CBOR capture record)`.

Why EIP-712 for the claim and DAG-CBOR for the record: the contract must hash the claim in Solidity and index its fields (`contentHash`, `keyId`); EIP-712 struct hashing is standard, cheap, wallet-native (web self-submit) and viem-native on Hermes (`hashTypedData`). A pure COSE_Sign1/DAG-CBOR claim (trusted-capture §4.2) would force a CBOR parser into the contract or reduce the chain to an opaque hash. The rich, optional, privacy-sensitive data goes in the CBOR record, committed by `recordHash`.

### 3.4 Capture record (DAG-CBOR, codec 0x71; stored as a piece, public or encrypted)

```
{ v: 1, stampId, contentHash, pieceCid, mediaType, dims: {w,h} | {w,h,durationMs,fps},
  capturedAt, monotonicNs, platform: "ios"|"android"|"web", app: {id, version, build},
  capture: { source: "in-app-camera"|"web-getUserMedia", facing, lensId, physicalCameraIds[], frameTimestamps[] },
  exif: { ...full original EXIF/XMP as captured... },                 // never on chain
  location?: { lat, lon, hAccM, ts, source },                           // opt-in; omitted by default
  locationHash?: bytes32,                                               // sha256 of the location sub-object when withheld
  sensorEvidence?: { depthMapCid?, livePhotoCid?, burstCids?[] },       // v2
  attest: { integrityRequestHash?, appAttestCounter? },
  sealed?: { plaintextSha256, saltedCommitment: sha256(salt‖plaintext), cipher: "AES-256-GCM", keyWrap: [...] }
}
```
Redaction works by withholding sub-objects and publishing their hashes (same idea as C2PA redactable assertions).

### 3.5 Short verification code

- Alphabet: Crockford Base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U). Decode is case-insensitive, maps `I/L→1`, `O→0`, ignores `-` and spaces; reject non-ASCII (UTS #39 ASCII-only).
- Length: **11 payload symbols (55 bits) + 1 check symbol = 12**, displayed `XXXX-XXXX-XXXX`. Check = `payload mod 37` (Crockford I-D); detects 100 % of single substitutions and adjacent transpositions. The 5 "extra" check values (`*~$=U`) are never emitted: the derivation re-draws when `payload % 37 ≥ 32`.
- Derivation is **on chain and deterministic** from `stampId`: `payload = uint64(uint256(keccak256(abi.encode(stampId, attempt)))) & 0x7FFFFFFFFFFFFF`, incrementing `attempt` while `payload % 37 ≥ 32` or `stampByCode[payload] != 0`. The app predicts the code before the receipt (the only chain-dependent event, a collision, has probability ≈ N/2^55 ≈ 3·10⁻⁹ at 10⁸ stamps). Codes are non-enumerable (hash-derived) and need no Stamper database to resolve.
- Examples generated with the reference implementation: `FMJA-AENF-CGW5`, `DJBS-VZFD-VC69`, `H5JA-4S9H-Z2PH` (third needed 3 re-draws). Spoken form: NATO alphabet, in-app only.
- Alternative rejected: 8+1 symbols (40 bits, watermarking §6.1) — enumerable at scale and weak against guessing (10⁻⁴ hit rate at 10⁸ stamps); the 40-bit TrustMark payload instead carries the **first 8 symbols** of the code (a prefix; collisions among prefixes at 10⁸ stamps ≈ 10⁻⁴ and are resolved by the perceptual check).

### 3.6 Verify URL / QR payload

- URL: `https://<domain>/v/<12 symbols>` (handler case-insensitive, hyphen-tolerant; AASA + assetlinks for `/v/*`; HSTS preload).
- QR: uppercase alphanumeric, no hyphens: `HTTPS://STAMPER.APP/V/H5JA4S9HZ2PH` = 34 chars → **QR Version 2, ECC M (capacity 38), 25×25 modules**; 33 modules with quiet zone ≥ 132 px at a 1080 px share size. Forensic export appends `?C=<base32-upper CIDv1>` (V5–V6). The QR is a convenience; the text code is the primary human channel.

### 3.7 Key id

- P-256 keys: `keyId = sha256(0x04 ‖ x ‖ y)` — identical to Apple's App Attest `keyId` (base64 of the same hash), so one scheme covers iOS, Android and web.
- secp256k1 / EIP-1271: `keyId = bytes32(uint256(uint160(addr)))`.

### 3.8 Piece metadata and data-set metadata (FOC)

- Data set (≤ 10 keys, key ≤ 32, value ≤ 128): `source = stamper` (required by `Synapse.create({ source })`), `stamper.tier = public | sealed`, `withCDN` on the CDN data set only.
- Piece (emitted in the FWSS `PieceAdded` event only since 1.4.0; the fevm report's limits are ≤ 3 keys, key ≤ 32 B, value ≤ 96 B — use these, confirm on the deployed contract): `stamp = <12-char code>`, `role = original | marked | record | attestation`, `sha256 = <64 hex>`. These make every piece self-labelling in the FWSS event log, independent of Stamper's DB.

### 3.9 Derivative ↔ original linkage

`Derivative { contentHash, pieceCid, kind (1=MARKED_IMAGE, 2=MARKED_VIDEO, 3=THUMBNAIL, 4=C2PA_SIDECAR, 5=RECORD), paramsHash, registeredBy, epoch }` appended to `derivatives[stampId]`; `stampByDerivativeHash[contentHash] = stampId`. `paramsHash = sha256(DAG-CBOR render params)` (badge geometry, font hash, JPEG quality, sharp/libvips version, TrustMark variant/strength, C2PA manifest id) so the derivative is reproducible. The C2PA manifest embedded in the derivative carries the same stampId/PieceCIDs (Section 6).

---

## 4. Smart contracts

Two contracts, Foundry, `solc 0.8.30`, `evm_version = "cancun"`, `via_ir = true`, OpenZeppelin Contracts 5.6.1 (`EIP712`, `ECDSA`, `IERC1271`), forge-std 1.17.

- **`StamperRegistry`** — immutable, no owner, no proxy, no pausability. Constructor pins `PDPVerifier` and `FWSSStateView` addresses (themselves stable proxies). If FilOz redeploys at new addresses, a `StamperRegistry` v2 is deployed and v1 records stay valid forever.
- **`StamperResolver`** — owned by the Stamper Safe (deployable via the singleton factory `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7`), upgradeable: moderation flags (`withdrawn`, `takedown`, `disputed`), display metadata, registrar names, `IndexPublished` events. Third parties may ignore it entirely; the Stamper UI honours it.

### 4.1 Registry interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library Cids { struct Cid { bytes data; } }

interface IPDPVerifier {
    function dataSetLive(uint256 setId) external view returns (bool);                               // 0xca759f27
    function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool);                // 0x1a271225
    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cids.Cid memory);   // 0x25bbbedf
    function findPieceIdsByCid(uint256 setId, Cids.Cid calldata pieceCid, uint256 startPieceId, uint256 limit)
        external view returns (uint256[] memory);                                                   // 0x6a4991a1
    function getDataSetListener(uint256 setId) external view returns (address);                     // 0x2b3129bb
    function getDataSetStorageProvider(uint256 setId) external view returns (address, address);     // 0x21b7cd1c
    function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256);              // 0x04595c1a
    function getNextChallengeEpoch(uint256 setId) external view returns (uint256);                  // 0x6ba4608f
}
interface IFWSSStateView {
    function getDataSetStatus(uint256 dataSetId) external view returns (uint8);                     // 0x617285ad  0 Inactive, 1 Active
    function provenThisPeriod(uint256 dataSetId) external view returns (bool);                      // 0x7598a1cd
    function provingDeadline(uint256 setId) external view returns (uint256);                        // 0x149ac5cc
    function getDataSet(uint256 dataSetId) external view returns (DataSetInfoView memory);          // 0xbdaac056
}
struct DataSetInfoView { uint256 pdpRailId; uint256 cacheMissRailId; uint256 cdnRailId; address payer; address payee;
    address serviceProvider; uint256 commissionBps; uint256 clientDataSetId; uint256 pdpEndEpoch; uint256 providerId;
    uint96 pendingOneTimePayments; uint96 lifecycleReserveBalance; uint256 dataSetId; }

contract StamperRegistry is EIP712("Stamper", "1") {
    uint8 constant KT_SECP256K1 = 0; uint8 constant KT_P256_RAW = 1; uint8 constant KT_P256_APPATTEST = 2; uint8 constant KT_ERC1271 = 3;
    uint8 constant PF_WEB = 0;       uint8 constant PF_IOS = 1;      uint8 constant PF_ANDROID = 2;        uint8 constant PF_OTHER = 3;
    address constant P256VERIFY = 0x0000000000000000000000000000000000000100;   // FIP-0113, EIP-7951 semantics
    uint256 constant P256_N_HALF = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;

    struct DeviceKey {            // storage layout: 8 slots + dynamic
        bytes32 x; bytes32 y;     // P-256 affine coordinates (zero for secp256k1 / 1271)
        address addr;             // secp256k1 or ERC-1271 account (zero for P-256)
        uint8 keyType; uint8 platform; uint8 level;          // packed with addr
        bytes32 rpIdHash;         // App Attest: sha256("<TEAMID>.<bundleId>")
        bytes attestationCid;     // PieceCID of the attestation bundle (empty for L0)
        address registrar;        // who signed the KeyEndorsement (address(0) for L0)
        uint64 registeredEpoch; uint64 expiresAt; uint64 revokedEpoch; uint64 lastCounter;   // packed
    }
    struct CaptureClaim { bytes32 contentHash; bytes pieceCid; uint64 contentLength; string mediaType; uint64 capturedAt;
        bytes32 keyId; uint64 nonce; bytes32 recordHash; uint8 flags; uint64 deadline; }
    struct Stamp {
        bytes32 contentHash; bytes pieceCid; uint64 contentLength; uint64 capturedAt; uint64 registeredEpoch;
        bytes32 keyId; uint8 level; uint8 flags; uint64 code; bytes32 recordHash; bytes32 mediaTypeHash;
        bytes sig; bytes authData;           // stored so the device signature can be re-verified from state alone
    }
    struct StorageBinding { uint256 setId; uint256 pieceId; address listener; address provider; uint64 boundEpoch; address boundBy; }
    struct Derivative { bytes32 contentHash; bytes pieceCid; uint8 kind; bytes32 paramsHash; address registeredBy; uint64 epoch; }
    struct BindingStatus { uint256 setId; uint256 pieceId; bool dataSetLive; bool pieceLive; bool cidMatches; uint256 lastProvenEpoch;
        uint256 nextChallengeEpoch; bool listenerIsFWSS; bool provenThisPeriod; uint256 provingDeadline; uint256 pdpEndEpoch; address payer; }

    IPDPVerifier  public immutable PDP;        // 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F (314) / 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C (314159)
    IFWSSStateView public immutable FWSS_VIEW; // 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 / 0x1B68d64f01bAa42014B9774605867BF4eDC0320f
    address public immutable FWSS;             // 0x8408502033C418E1bbC97cE9ac48E5528F371A9f / 0x02925630df557F957f70E112bA06e50965417CA0

    mapping(bytes32 keyId => DeviceKey) internal keys;
    mapping(bytes32 stampId => Stamp) internal stamps;
    mapping(uint64 code => bytes32 stampId) public stampByCode;                 // 0x9dab7739
    mapping(bytes32 contentHash => bytes32 stampId) public stampByContentHash;  // 0xeb1674f7  first stamp of these bytes
    mapping(bytes32 derivHash => bytes32 stampId) public stampByDerivativeHash; // 0xd2b5ef39
    mapping(bytes32 stampId => StorageBinding[]) internal bindings;
    mapping(bytes32 stampId => Derivative[]) internal derivatives;
    mapping(bytes32 keyId => uint64) public revocationNonce;

    event KeyRegistered(bytes32 indexed keyId, uint8 keyType, uint8 platform, uint8 level, address indexed registrar, bytes attestationCid, uint64 expiresAt);
    event KeyRevoked(bytes32 indexed keyId, uint64 epoch, address by);
    event CaptureRegistered(bytes32 indexed stampId, bytes32 indexed contentHash, bytes32 indexed keyId, uint64 code, bytes pieceCid,
        uint8 level, string mediaType, CaptureClaim claim, bytes sig, bytes authData);
    event StorageBound(bytes32 indexed stampId, uint256 indexed setId, uint256 pieceId, address listener, address provider, address boundBy);
    event DerivativeRegistered(bytes32 indexed stampId, bytes32 indexed contentHash, uint8 kind, bytes pieceCid, bytes32 paramsHash, address registeredBy);
    event Commit(address indexed recorder, string indexed assetCid, string commitData);   // ERC-7053 interop (v1; emitted alongside CaptureRegistered)

    // --- keys -------------------------------------------------------------------------------------------------------
    /// popSig: signature by the key itself over KeyRegistration(keyId,keyType,platform) (typehash 0x2f9854da…);
    /// endorsement: EIP-712 KeyEndorsement(bytes32 keyId,uint8 level,bytes attestationCid,uint64 expiresAt) (typehash 0x9d6589f6…)
    /// signed by a registrar (secp256k1). Empty endorsement => level 0, registrar = address(0). Anyone may call.
    function registerKey(DeviceKey calldata k, bytes calldata popSig, bytes calldata endorsement) external returns (bytes32 keyId); // 0xa32de744
    /// sig by the key (KeyRevocation(keyId,nonce), typehash 0xa9ae9e98…) OR msg.sender == keys[keyId].registrar.
    function revokeKey(bytes32 keyId, bytes calldata sig) external;                                                                 // 0xd2bca838

    // --- captures ---------------------------------------------------------------------------------------------------
    /// Anyone may call (relayer, user wallet, third party). Verifies the device signature on chain, derives the code, stores the claim.
    function registerCapture(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData) external returns (bytes32 stampId, uint64 code); // 0x4d2147a0
    /// Anyone may call. pieceIdHint == type(uint256).max => findPieceIdsByCid(setId, cid, 0, 1). Re-checks CID equality on chain.
    function bindStorage(bytes32 stampId, uint256 setId, uint256 pieceIdHint) external;                                             // 0x4cdae20e
    /// sig: EIP-712 DerivativeClaim(bytes32 stampId,bytes32 contentHash,bytes pieceCid,uint8 kind,bytes32 paramsHash) (typehash 0xfe11a745…)
    /// by any secp256k1 key; registeredBy is recorded (Stamper's renderer key in MVP). The stamp's own device key may also sign.
    function registerDerivative(bytes32 stampId, Derivative calldata d, bytes calldata sig) external;                                // 0xb56379b3

    // --- views ------------------------------------------------------------------------------------------------------
    function hashClaim(CaptureClaim calldata c) external view returns (bytes32 digest);              // 0x2a331bbd  == stampId
    function predictCode(bytes32 stampId) external view returns (uint64 code, uint32 attempt);
    function getStamp(bytes32 stampId) external view returns (Stamp memory);                         // 0xd0eca23d
    function getKey(bytes32 keyId) external view returns (DeviceKey memory);                         // 0x12aaac70
    function getBindings(bytes32 stampId) external view returns (StorageBinding[] memory);           // 0x0d1fcab4
    function getDerivatives(bytes32 stampId) external view returns (Derivative[] memory);            // 0xe519a798
    function storageStatus(bytes32 stampId) external view returns (BindingStatus[] memory);          // 0x439c1783
}
```

### 4.2 Signature scheme (inside `registerCapture`)

```solidity
bytes32 digest = _hashTypedDataV4(_hashClaim(c));            // = stampId
require(stamps[digest].registeredEpoch == 0, "dup");          // replay == same stampId
require(block.timestamp <= c.deadline, "late");
DeviceKey storage k = keys[c.keyId];
require(k.registeredEpoch != 0 && k.revokedEpoch == 0 && block.timestamp < k.expiresAt, "key");
require(c.nonce > k.lastCounter, "nonce"); k.lastCounter = uint64(c.nonce);   // per-key monotonic (iOS: App Attest counter)
if (k.keyType == KT_SECP256K1)      require(ECDSA.recover(digest, sig) == k.addr);                       // precompile 0x01
else if (k.keyType == KT_ERC1271)   require(IERC1271(k.addr).isValidSignature(digest, sig) == 0x1626ba7e);
else {
    (bytes32 r, bytes32 s) = (bytes32(sig[0:32]), bytes32(sig[32:64]));  require(uint256(s) <= P256_N_HALF, "low-s");
    bytes32 h;
    if (k.keyType == KT_P256_RAW) {                     // Android Keystore SHA256withECDSA(digest) / WebCrypto ECDSA-SHA256(digest)
        h = sha256(abi.encodePacked(digest));
    } else {                                            // App Attest assertion with clientDataHash := digest
        require(authData.length == 37 && bytes32(authData[0:32]) == k.rpIdHash, "rpid");
        require(uint32(bytes4(authData[33:37])) == c.nonce, "counter");       // nonce doubles as the assertion counter
        h = sha256(abi.encodePacked(authData, digest));                      // nonce = SHA256(authenticatorData ‖ clientDataHash)
    }
    (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(h, r, s, k.x, k.y));
    require(ok && out.length == 32 && out[31] == 0x01, "p256");             // empty output == invalid (never reverts)
}
```
- The device signs the **EIP-712 digest bytes** as the message; the contract reconstructs the platform's hash input (`sha256(digest)` or Apple's nonce) and calls `0x0100`. `sha256` is precompile `0x02`. Precompiles are not callable at top level on FEVM (`eth_call` to `0x0100` returns `0x`); they work from bytecode, which is what we do.
- Low-s is enforced in contract (the precompile does not).
- Why P-256 on chain instead of a software secp256k1 key: the whole point of L1/L2 is that the signing key never leaves the Secure Enclave / StrongBox; a software secp256k1 "device key" (app-stack §1.8) would be extractable and the on-chain signature would prove nothing about hardware. `P256VERIFY` is live on mainnet since nv28 (2026-05-27). Risk: its gas is instrumented, not fixed — measured on Calibration before freezing (§13). If it were prohibitive, the fallback is to keep `KT_P256_*` for L2 only and batch.
- Relayer / gasless: no ERC-4337 on Filecoin (no EntryPoint code on 314/314159; Pimlico lists none). `registerCapture` is caller-agnostic, so the relayer is a pure gas sponsor: it cannot alter the claim (signed), cannot forge (key verified on chain), can only delay. Self-submit: the app exports `{claim, sig, authData}` as JSON/QR; the web app's "Submit with my wallet" page (wagmi 3.7 + viem 2.57, chains `filecoin`/`filecoinCalibration`) or `cast send $REG "registerCapture(...)"` with any FIL-funded key lands it. A wallet-owning user can also sign claims directly with `KT_SECP256K1` and skip Stamper altogether.
- EIP-1271 and `SessionKeyRegistry`: a Safe can own stamps; a FilOz session key signing on behalf of a wallet is accepted when `SessionKeyRegistry.authorizationExpiry(owner, signer, keccak256("stamper.capture")) > block.timestamp` (v2; it is secp256k1 software-held, so L0 only).

### 4.3 Storage check (inside `bindStorage` / `storageStatus`)

```solidity
function bindStorage(bytes32 stampId, uint256 setId, uint256 pieceIdHint) external {
    Stamp storage s = stamps[stampId]; require(s.registeredEpoch != 0, "nostamp");
    uint256 pieceId = pieceIdHint;
    if (pieceIdHint == type(uint256).max) { uint256[] memory ids = PDP.findPieceIdsByCid(setId, Cids.Cid(s.pieceCid), 0, 1); require(ids.length == 1, "notfound"); pieceId = ids[0]; }
    require(PDP.dataSetLive(setId) && PDP.pieceLive(setId, pieceId), "dead");
    require(keccak256(PDP.getPieceCid(setId, pieceId).data) == keccak256(s.pieceCid), "cid");
    for (uint i; i < bindings[stampId].length; i++) require(bindings[stampId][i].setId != setId, "bound");
    (address sp,) = PDP.getDataSetStorageProvider(setId);
    bindings[stampId].push(StorageBinding(setId, pieceId, PDP.getDataSetListener(setId), sp, uint64(block.number), msg.sender));
    emit StorageBound(stampId, setId, pieceId, PDP.getDataSetListener(setId), sp, msg.sender);
}
```
`storageStatus` re-reads live state for every binding (`dataSetLive`, `pieceLive`, CID equality, `getDataSetLastProvenEpoch`, `getNextChallengeEpoch`) and, when `listener == FWSS`, the StateView (`provenThisPeriod`, `provingDeadline`, `getDataSet(...).pdpEndEpoch/payer`; `pdpEndEpoch != 0` = payment terminated = treat as not stored). `hasBeenProvenRecently` is avoided (it reverted on the deployed 1.4.0 view). The registry never trusts who bound: anyone (Stamper, the user with their own data set, a third-party archivist) may bind an additional copy — this is the "community re-pin" feature and the bypass for Stamper's storage role.

### 4.4 Code derivation

```solidity
function _deriveCode(bytes32 stampId) internal view returns (uint64 code, uint32 attempt) {
    for (;; attempt++) { code = uint64(uint256(keccak256(abi.encode(stampId, attempt)))) & 0x7FFFFFFFFFFFFF;
        if (code % 37 < 32 && stampByCode[code] == bytes32(0)) return (code, attempt); }
}
```

### 4.5 Access control, upgradeability, gas, deployment, indexing

- Registry: no privileged roles at all. Resolver: `Ownable2Step`, Stamper Safe; all flag changes emit events; a `withdraw(stampId)` path is also callable by the stamp's own device key (signature over `Withdraw(stampId,nonce)`).
- Gas (Filecoin instrumented units; base fee at the 100 attoFIL floor, premium ≈ 2·10⁵ attoFIL): `registerCapture` ≈ 12 SSTOREs + one `0x0100` call + event ≈ 30–100 M gas ≈ 6·10⁻⁶–2·10⁻⁵ FIL ≈ $0.00001–0.00002; `bindStorage` ≈ 10–30 M; `registerDerivative` ≈ 20–40 M. Budget $0.001 per stamp to absorb base-fee spikes. Receipts land in the next tipset: poll ≥ 120 s, re-check after 2 epochs for head reorgs.
- Finality policy (mainnet F3 has produced no certificate since 2026-03-09; `finalized` currently comes from the FRC-0089 calculator ≈ 20–30 epochs): states `included` (receipt) → `safe` (≥ 30 epochs ≈ 15 min) → `final` (`eth_getBlockByNumber("finalized")` ≥ stamp epoch, or ≥ 900 epochs). The verify page prints the epoch, age and state; never "final in seconds".
- Testing: `forge test --odyssey` (forge 1.3.5 has the flag; it enables the RIP-7212 precompile at `0x100` in revm — interface-compatible with FIP-0113) plus `vm.etch(0x100, <daimo p256-verifier runtime>)` as a second oracle (its fallback accepts the 160-byte RIP-7212 calldata layout); EIP-7951 test vectors; Calibration fork tests for `PDPVerifier` reads (data set 1 is live); an integration script that uploads a 200-byte piece with Synapse and binds it.
- Deployment: Calibration first (tFIL + tUSDFC faucets), then mainnet. `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --skip-simulation --slow --retries 10 --timeout 180`; verify on Blockscout (`--verifier blockscout --verifier-url https://filecoin.blockscout.com/api/`) and Filfox; ABIs + addresses published through `@wagmi/cli` foundry plugin into `packages/contracts-abi`.
- Indexing: the verify page uses `eth_call` only (Multicall3 `0xcA11…CA11`). History/search uses a self-hosted **Ponder** indexer (RPC mode, `ethGetLogsBlockRange: 360` — Lotus ≥ 1.36.3 caps ranges at 360 epochs; mainnet Glif still allows 2880 but will tighten) over `CaptureRegistered`, `StorageBound`, `DerivativeRegistered`, `KeyRegistered/Revoked`, PDPVerifier `PiecesRemoved/DataSetDeleted`, FWSS `FaultRecord/PDPPaymentTerminated`, and the resolver's `IndexPublished`. Goldsky subgraphs (`filecoin`, `filecoin-testnet`) are the hosted alternative (v1).

---

## 5. Storage on Filecoin Onchain Cloud

### 5.1 Ownership and payment

- **Default: Stamper-operated data sets, two approved providers**, one data set per provider (data sets are per payer per provider): `A` = originals + records + attestation bundles (no CDN), `B` = marked derivatives with `withCDN` (FilBeam serves the hot, shareable copies). Each piece is uploaded with `copies: 2`, so every original lives in two providers' data sets, each with its own PDP stream.
- Funds: a cold hardware wallet is the FOC payer (USDFC deposited into Filecoin Pay, FWSS approved as operator via `synapse.storage.prepare({ pieceSizes })` → one `depositWithPermitAndApproveOperator` tx). The backend holds only a **session key** (`@filoz/synapse-core/session-key`: `login(signer, expiry, [AddPiecesPermission, CreateDataSetPermission], origin)`, expiry 30 days, rotated by a scripted cold-wallet ceremony) passed as `Synapse.create({ account, sessionKey, chain, source: 'stamper', withCDN })`. Compromise of the VPS can add pieces (and spend Stamper's USDFC) but cannot drain the deposit or terminate service.
- **Bypass / self-custody (v1):** the web app lets a wallet user create their own context (`synapse.storage.createContext({ providerId, metadata: { 'stamper.tier': 'self' } })`), `store` + `commit` with their own USDFC, and call `bindStorage` themselves; the registry treats all bindings equally. Mobile self-custody arrives with session keys on device (v2).
- Alternative rejected: per-user data sets by default — 0.024–0.12 USDFC/month flat fee per data set and a wallet onboarding step per user; most users never want to hold USDFC.
- `setDataSetAuthorizer` (FWSS 1.4.0) could make the registry the sole authorizer of Stamper's data sets; deferred until its audit status is known (v2 candidate).

### 5.2 Upload path

- **MVP:** device → `PUT /v1/uploads/{id}` (expo-file-system `File.createUploadTask`, `sessionType: 'background'` on iOS, resumable with `Content-Range`) → api recomputes `sha256` + PieceCID (`Piece.transformStream()` teeing the staged stream) and refuses on mismatch → worker `const ctx = await synapse.storage.createContext({ providerId })`; `await ctx.store(stream, { pieceCid })`; `await ctx.commit({ pieces: [{ pieceCid, pieceMetadata: { stamp, role, sha256 } }] })` → `{ txHash, pieceIds, dataSetId }` → `bindStorage`. `commit` is retried without re-upload on failure. `store`/`commit` are used instead of `upload()` so that the on-chain registration (device signature) can precede the storage commit and so `pieceIds` are known deterministically for `bindStorage`.
- **v1 (push upload to the client):** the SP upload protocol is plain HTTP (`POST {serviceURL}/pdp/piece {pieceCid}` → `Location` → `PUT …/pdp/piece/upload/{uuid}` octet-stream → poll `GET /pdp/piece?pieceCid=`), signed by nobody; the backend only needs to `commit` with its session key. The phone uploads straight to both providers (`File.upload`) and Stamper never has custody of the bytes before they are at an SP. Needs a spike: SP-side auth/CORS/GC of uncommitted pieces (§13). The Synapse SDK itself stays off the phone (no RN support claimed; Hermes lacks WebCrypto, `multiformats` sha2 throws) — only `synapse-core/piece` (pure JS) runs there.
- Web (L0) capture uploads through the api like mobile; wallet users may upload with the SDK in-browser (supported runtime).

### 5.3 Retrieval

Order on the verify page: (1) provider endpoints resolved on chain — `getBindings` → `setId` → `FWSSStateView.getDataSet(setId).providerId` → `ServiceProviderRegistry` (`@filoz/synapse-sdk/sp-registry` `SPRegistryService`) → `{serviceURL}/piece/{pieceCid}` with parallel `HEAD`, first `200` wins; (2) FilBeam `https://{payer}.filbeam.io/{pieceCid}` (SDK builder; the docs' `/piece/{cid}` form is also probed) only for data set `B` (CDN rails, 402 on quota exhaustion); (3) Stamper mirror `https://<domain>/m/{pieceCid}` (disk, keyed by PieceCID, populated at upload). Every path ends with the browser recomputing `sha256` (`hash-wasm` 4.12) and PieceCID (`synapse-core/piece`) before the word "original" appears. IPFS public gateways are not in the path (winding down; raw pieces are not IPFS-retrievable anyway).

### 5.4 Data-loss handling

- PDP proves possession of the data set with 5 challenges/day; a specific missing piece is detected with ≈ 78 % confidence in 30 days at 1 % loss (99.95 % at 5 %). Hence ≥ 3 copies: 2 FOC + the mirror, plus community re-pins (anyone can `bindStorage` a new copy).
- Monitor per bound data set every 10 min: `getDataSetLastProvenEpoch`, `provingDeadline − head`, `provenThisPeriod`, `FaultRecord` events (paged in 360-epoch windows), `getDataSet().pdpEndEpoch`; FilecoinPay runway via `synapse.payments` (`getAccountInfoIfSettled` → `fundedUntilEpoch`); alert < 60 days.
- Repair: on a faulted/terminated data set, re-upload from the other copy or the mirror into a new provider's data set and `bindStorage` again (old bindings remain as history; `storageStatus` shows them dead). Sealed PoRep cold copies when FOC ships them (v2+).
- Verify page shows a storage panel per copy (live, last proven epoch, next challenge, faults in the last 30 periods via `provenPeriods`), not a single boolean.

### 5.5 Cost per stamp (per `VERIFIED-SDK-FACTS.md`; the docs/CHANGELOG in the storage report quote higher fees — 0.12 USDFC/data-set/month, 0.008 + 0.003/piece — so budget with the higher figures and read `getPriceList()` at integration)

| Item | 4 MiB photo (original + 4 MiB marked, 2 copies each) | 100 MB video (original + marked) |
|---|---|---|
| Storage 2.5 USDFC/TiB/month per copy | 16 MiB → 3.8·10⁻⁵/month → **0.0046 USDFC / 10 yr** | 400 MB → 9.5·10⁻⁴/month → **0.11 USDFC / 10 yr** |
| Add-pieces one-time (4 piece-adds) | 0.0012 (verified) … 0.012 (docs) | same |
| Data set flat fee | 0.024 (verified) … 0.12 (docs) /month per data set, 2–4 data sets, amortized | — |
| Gas: 3–5 registry txs | ≈ $0.00005 | ≈ $0.00005 |
| FilBeam egress (marked copy, 1,000 views) | ≈ $0.05 at 14 USDFC/TiB cache-miss, half on hit | — |

Cost is not the constraint; abuse is (Section 11).

---

## 6. Marking pipeline

| Layer | Image | Video | Runs on | Why there |
|---|---|---|---|---|
| Hard binding | `sha256` + PieceCID of the EXIF-minimized original; device signature | same (metadata left as captured) | **Device** | Everything the verdict depends on must be fixed before bytes leave the phone. |
| Visible mark | sharp 0.35.5 `composite()`: dark pill (62 % black), code in a monospaced slashed-zero font, QR V2-M, domain text; height 5 % of the short side, bottom-right, margin 3 %, kept inside the central 4:5 crop; JPEG q92 4:4:4 mozjpeg | ffmpeg ≥ 6 in Docker: `overlay` + `drawtext`, libx264 CRF 20, `-movflags +faststart`, audio copy | **Server** (device Skia preview optional, never hashed) | Deterministic, reproducible from `paramsHash`; `expo-image-manipulator` cannot composite; on-device video overlay is impractical (FFmpegKit retired). |
| Invisible watermark | **TrustMark Q, `BCH_SUPER`**, 40-bit payload = first 8 code symbols, strength 1.0; Python sidecar `trustmark==0.9.2` | none in MVP; Video Seal / PixelSeal GPU worker in v2 (payload `4×[ver8‖code40‖crc16]`) | **Server** (Python sidecar — no Rust toolchain for the `trustmark` crate) | Survives platform re-encode/resize/screenshot; it is a lookup key only — forgeable with public tools, so never a verdict. |
| C2PA manifest | `@contentauth/c2pa-node` 0.9.9 (Node 22 OK): embedded in the marked derivative; **sidecar** `.c2pa` (`application/c2pa`) for the original so its device-hashed bytes stay untouched | same for MP4/MOV | **Server** | Interop with every C2PA validator; signing key stays off phones. |
| Perceptual index | PDQ + quality (`pdqhash==0.2.8` in the sidecar — one implementation for index and query), ISCC Image-Code (`iscc-sdk==0.9.5`), of original **and** every rendition; 8 dihedral variants + 2 centre crops as extra entries | vPDQ (`vpdq==0.2.5`, 1 fps + scene changes, quality ≥ 50, dedupe ≤ 8 bits) + ISCC Video-Code | **Server** | Candidate retrieval; published for public stamps as `IndexPublished(stampId, pdqOriginal, pdqMarked)` so third parties can rebuild the index. |

C2PA manifest content (derivative): `claim_generator_info [{name:"Stamper", version}]`; `c2pa.actions.v2` = `c2pa.opened` (ingredient `parentOf` = the original, via `Ingredient.from_stream_info` with the original's `.c2pa` sidecar), `c2pa.watermarked.unbound` (visible mark), `c2pa.watermarked.bound` with `relatedAssertions → c2pa.soft-binding`; `c2pa.soft-binding { alg: "com.adobe.trustmark.Q", blocks: [{ scope: {}, value: "0*<100-bit string>" }] }` and a second block `io.iscc.v0`; custom assertion `computer.paradox.stamper.anchor { stampId, code, contentHash, pieceCid, derivativeContentHash, derivativePieceCid, registry: { chainId, contract, txHash, epoch }, keyId, level, recordHash }`; `digitalSourceType = http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture` on the original's sidecar manifest. Once `safe`, an **update manifest** adds `c2pa.repository-receipt` (2.4) with `repository.uri = https://<domain>/c2pa`, `manifestId`, `anchor.proof = { chainId, contract, stampId, txHash, epoch }`. Signing: MVP self-issued ES256 cert (validators show "unknown source"); v1 applies to the Conformance Program (L1) and uses SSL.com's free L1 claim-signing cert + TSA. Manifest ≈ 10–20 KB without thumbnail.

Device vs server rationale: what decides a verdict (hash, signature) runs on device; what is *derived and re-verifiable* (marks, derivative hashes, C2PA) runs on server because it is bound on chain afterwards and reproducible from `paramsHash` — a dishonest server cannot change what the original is, only produce a derivative that fails to match it. Video: MVP = visible mark + vPDQ; no invisible watermark; cap ≤ 1,065,353,216 B per file.

---

## 7. Capture and keys

### 7.1 Common

- Live capture only: `expo-camera` 57.0.6 in-app (`takePictureAsync({ exif: true })`, `recordAsync({ maxFileSize })`); no `PHPicker`/`ACTION_IMAGE_CAPTURE`/share-sheet import into the signed flow; physical camera ids recorded in the capture record; external/virtual devices refused.
- One pass over the file: `react-native-quick-crypto` 1.1.7 `createHash('sha256')` + `synapse-core/piece` `hasher().write()` over `FileHandle.readBytes(1 MiB)` chunks (`install()` at app entry also provides `getRandomValues`/`crypto.subtle` for viem). Photos ≈ ms; a 1 GB video ≈ seconds native for SHA-256, slower for the pure-JS PieceCID tree (benchmark in week 1; if too slow, the api computes PieceCID and the device signs after confirming equality of the sha256 — with `store(…, { pieceCid })` the SP still enforces it).
- Claim signing uses viem's `hashTypedData` on Hermes; the device signs the 32-byte digest.
- A tiny local Expo module (`modules/stamper-keys`, Swift ≈ 100 lines, Kotlin ≈ 150 lines) adds what `@expo/app-integrity` 57.0.2 lacks: iOS `assert(keyId, clientDataHash: bytes)` (passes the digest as `clientDataHash` directly), Android `generateAttestedKey(alias, challenge, strongBox)` + `sign(alias, bytes)` (`SHA256withECDSA`, `setUserAuthenticationRequired` with biometric binding), DER→raw `r‖s` conversion, public key export. `@expo/app-integrity` provides `generateKeyAsync/attestKeyAsync`, `prepareIntegrityTokenProviderAsync/requestIntegrityCheckAsync`, `getAttestationCertificateChainAsync`. Dev builds only (attestation is meaningless in Expo Go/simulators).

### 7.2 iOS (App Attest key = device key; no second key)

Enroll: `generateKeyAsync()` → `GET /v1/enroll/challenge` (≥ 16 B, 5-min TTL, single use) → `attestKeyAsync(keyId, challenge)` → `POST /v1/enroll/ios`. Server (`node-app-attest` 1.0.1, extended for `apple_validation_category_01` / `apple_bundle_version_01`): x5c chain to the Apple App Attestation Root CA, `nonce = SHA256(authData ‖ SHA256(challenge))`, OID `1.2.840.113635.100.8.2`, `keyId == SHA256(pubkey)`, `rpIdHash`, counter 0, production `aaguid`, receipt exchange at `data.appattest.apple.com` for the risk metric. Bundle `{attestationObject, challenge, receipt, verdict}` → piece (`role=attestation`) → registrar signs `KeyEndorsement` → relayer `registerKey`. Capture: `assert(keyId, digest)` → `{signature (DER→raw), authenticatorData (37 B)}`; `claim.nonce = counter`.

### 7.3 Android (Keystore key + Play Integrity)

Enroll: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)` → challenge → `generateAttestedKey("stamper-capture-v1", challenge, strongBox=true, fallback TEE)` → chain → `requestIntegrityCheckAsync(base64url(sha256(keyId ‖ challenge)))` → `POST /v1/enroll/android`. Server: decode token (`googleapis` 182 `playintegrity.decodeIntegrityToken`), check `requestHash`, package, `timestampMillis`, verdicts; store the chain. MVP = L1 (Play Integrity); v1 adds chain verification (roots `android.googleapis.com/attestation/root`, CRL `/attestation/status`, attestation extension `1.3.6.1.4.1.11129.2.1.17`, `attestationApplicationId`) through a small JVM service around Google's `android/keyattestation` library (no JS port exists) → L2. Capture: `requestIntegrityCheckAsync(base64url(sha256(digest)))` per capture (standard token, cheap, 10k/day default quota) + `sign(alias, digest)`.

### 7.4 Web (L0)

Passkey login (identity) → `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])` stored in IndexedDB → `POST /v1/enroll/web {spki}` → `registerKey` at level 0 (registrar `address(0)`; or the user's own wallet as a `KT_SECP256K1` key). Capture via `getUserMedia`/`MediaRecorder` (feature-detect MP4 vs WebM; WebM is normalized to MP4 server-side **before** the claim is built — the web client is told the normalized hash and signs it, since WebM is unsupported by c2pa-rs). Marked `L0` everywhere.

### 7.5 Offline capture

The claim is signed at capture (assertion counter / local nonce), queued in `react-native-mmkv` 4.3 (encrypted), and submitted when online; `deadline = capturedAt + 7 d`; the Play Integrity token is requested at submission. The verify page shows `capturedAt` vs `registeredEpoch` and flags gaps > 10 min.

### 7.6 Rotation and revocation

Keys expire (`expiresAt`, 12 months); rotation = `registerKey` of the new key with `popSig` plus a continuity signature by the old key in the bundle. Revocation by the key (user) or by the registrar (CRL hit, risk-metric spike, device recall); `revokedEpoch` lets viewers downgrade later captures. One key per user per device (Apple guidance); monthly optional re-keying for unlinkability is a v2 privacy option (Apple's risk metric counts keys per device, so not per capture).

---

## 8. Verification flows

### 8.1 Decision procedure (upload-a-copy)

```
0  normalize: sniff type; images decoded once (EXIF-rotated); video probed (ffprobe)
1  EXACT      sha256(B) → stampByContentHash / stampByDerivativeHash (eth_call) → "ORIGINAL" | "STAMPER MARKED COPY of <code>"
              (also recompute PieceCID; mismatch between the two is a bug, refuse)
2  CODE       typed/scanned code → confirmation mode against that single stamp (thresholds relaxed to PDQ ≤ 40)
3  WATERMARK  TrustMark decode in browser (onnxruntime-web 1.30 + Adobe tm_watermark.js; server fallback) → 40-bit prefix →
              candidates (index) → fetch original → PDQ + SSIM vs original → "DERIVED FROM <code>: d bits, SSIM s" (+ diff heat-map)
4  PERCEPT    PDQ (quality ≥ 50) + 8 dihedral + 2 crops → pgvector HNSW k=20 → keep ≤ 31 bits; video: per-frame → vPDQ match % →
              re-rank by SSIM → "LOOKS LIKE <code> (d=7, SSIM 0.93) — similarity is not proof"; show all candidates within 5 bits (bursts)
5  NONE       "no registered original found" (never "fake")
```
Verdict ladder: `ORIGINAL` (byte-exact) → `STAMPER MARKED COPY` (exact derivative hash) → `MATCHES <code>` (watermark ∧ PDQ ≤ 31) → `RELATED — ALTERED` (watermark or code but perceptual mismatch, or perceptual-only) → `UNKNOWN`.

### 8.2 What the verify page shows (C2PA-style L1–L4 disclosure)

Side-by-side slider (`react-compare-slider` 4.0) of the copy in hand vs the original streamed from Filecoin and hashed in the browser; PDQ distance / SSIM / `pixelmatch` 7.2 heat-map; match outcome; capture tier with its "means / does not mean" sentence and the registrar; three times (`capturedAt`, `registeredEpoch` → UTC, finality state); chain proof (registry address, `stampId`, tx, epoch, re-verified device signature with key type and public key); storage proof per copy (provider, data set, piece id, `dataSetLive`, last proven epoch, next challenge, proven-this-period, faults in last 30 periods, payment status); derivatives and C2PA validation state (`c2pa-web` 0.15.3: valid / trusted / unknown source); resolver flags (withdrawn/disputed) with dates; the permanent footer: *"Stamper shows when this file was registered and whether your copy matches the registered original. It does not judge whether what the picture shows is true."* Colour-neutral, words never colour-only, WCAG 2.2 AA.

### 8.3 Independent verification (only the chain + Filecoin)

Published in `docs/verify-independently.md` and implemented by `packages/verify-cli` (`npx stamper-verify <code|file> --rpc <url>`), which has no Stamper dependency:

```
RPC=https://api.node.glif.io/rpc/v1 ; REG=<StamperRegistry address, published per chain>
1. ID=$(cast call $REG "stampByCode(uint64)(bytes32)" <55-bit payload> --rpc-url $RPC)
2. cast call $REG "getStamp(bytes32)" $ID          → contentHash, pieceCid, keyId, level, registeredEpoch, sig, authData
   cast call $REG "getKey(bytes32)" <keyId>         → x, y / addr, keyType, level, registrar, attestationCid, revokedEpoch
   cast call $REG "getBindings(bytes32)" $ID        → [(setId, pieceId, listener, provider)]
3. Re-verify the signature: recompute the EIP-712 digest from the claim (CaptureRegistered event or getStamp fields);
   WebCrypto/noble P-256 verify of (sha256(digest) | sha256(authData‖digest)) against (x,y); ecrecover for wallets.
4. Storage, per binding (PDPVerifier 0xBADd…557F / FWSS view 0xcf18…8172 on mainnet):
   cast call 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F "dataSetLive(uint256)(bool)" $SET
   cast call 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F "pieceLive(uint256,uint256)(bool)" $SET $PIECE
   cast call 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F "getPieceCid(uint256,uint256)((bytes))" $SET $PIECE   == pieceCid
   cast call 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F "getDataSetListener(uint256)(address)" $SET          == 0x8408502033C418E1bbC97cE9ac48E5528F371A9f
   cast call 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F "getDataSetLastProvenEpoch(uint256)(uint256)" $SET
   cast call 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 "provenThisPeriod(uint256)(bool)" $SET
   cast call 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 "provingDeadline(uint256)(uint256)" $SET
   cast call 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 "getDataSet(uint256)" $SET   → payer, providerId, pdpEndEpoch (0 = active)
5. Provider URL: ServiceProviderRegistry 0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB via @filoz/synapse-sdk/sp-registry (providerId → serviceURL)
   curl -o original.bin "{serviceURL}/piece/<pieceCid>"   (or https://<payer>.filbeam.io/<pieceCid>)
6. sha256sum original.bin == contentHash ; node -e 'Piece.calculate(bytes)' == pieceCid   → it is the registered original
7. Time: date -u -d @$((1598306400 + 30*registeredEpoch))  (Calibration genesis 1667326380); finality: eth_getBlockByNumber("finalized")
```
Everything above is `eth_call`/HTTP against public endpoints; two RPC providers (Glif + Ankr) are queried and compared by the CLI.

---

## 9. Apps and services

### 9.1 Monorepo (`stamper`)

```
apps/mobile      Expo SDK 57 (expo 57.0.26, RN 0.86.3), expo-router, expo-camera, expo-file-system, expo-secure-store, expo-local-authentication,
                 @expo/app-integrity 57.0.2, modules/stamper-keys (local Expo module), react-native-quick-crypto 1.1.7 (+nitro-modules, quick-base64),
                 react-native-get-random-values 2, react-native-mmkv 4.3, viem 2.57, @tanstack/react-query 5, zod 4, optional @shopify/react-native-skia 2.13 (preview badge)
apps/web         Next.js 16.3.8 (App Router), React 19.2, wagmi 3.7.7 + viem 2.57 (filecoin / filecoinCalibration), barcode-detector 3.2.2, react-compare-slider 4,
                 pixelmatch 7.2, hash-wasm 4.12, pdq-wasm 0.3.9 (client compare only), onnxruntime-web 1.30 + TrustMark JS decoder, @contentauth/c2pa-web 0.15.3
services/api     Hono 4.13 + @hono/node-server 2.1 on Node 22 (24 LTS in Docker), drizzle-orm 0.45 + pg 8.23, zod 4, pino 10, node-app-attest 1.0.1, googleapis 182,
                 @filoz/synapse-sdk 2.0.2 (session key), sharp 0.35.5, qrcode 1.5.4, @contentauth/c2pa-node 0.9.9
services/worker  same image, BullMQ 6.3 (PostgreSQL backend — no Redis), ffmpeg 7 (container), relayer (viem wallet; optional OpenZeppelin Relayer later)
services/ml      Python 3.12, FastAPI 0.142 + uvicorn 0.54, trustmark 0.9.2 (torch 2.14), pdqhash 0.2.8, vpdq 0.2.5, iscc-sdk 0.9.5, pillow 12.3, opencv-python-headless 5.0
services/indexer Ponder (RPC mode, ethGetLogsBlockRange 360) → Postgres
services/attest-jvm (v1)  Kotlin microservice wrapping android/keyattestation
packages/core    @stamper/core: code encode/decode, claim types (EIP-712 `as const satisfies TypedData`), stampId, DAG-CBOR record, PieceCID helpers (synapse-core/piece), EXIF minimizer
packages/contracts-abi   @wagmi/cli foundry plugin → generated.ts (+ react hooks)
packages/verify-cli      independent verifier (viem + synapse-core only)
contracts/       Foundry: StamperRegistry.sol, StamperResolver.sol, test/ (odyssey + daimo etch), script/Deploy.s.sol
```
TypeScript 7.0.2 (installed) for `tsc` build/typecheck; Biome for lint (no tsc API needed); `typescript ~6.0.3` pinned only inside `apps/mobile` if Expo tooling requires it. vitest 5 for packages/web/api; jest-expo 57; Maestro for mobile E2E; Playwright for the verify flow.

### 9.2 API endpoints (Hono)

`GET /v1/enroll/challenge` · `POST /v1/enroll/{ios|android|web}` · `POST /v1/captures/intent` (upload slot, predicted code) · `PUT /v1/uploads/{id}` (resumable) · `POST /v1/captures` (claim + sig + authData + integrity token → relayed) · `POST /v1/captures/{stampId}/self-submitted` (tx hash from a wallet user) · `GET /v1/stamps/{code}` · `GET /v1/stamps/{code}/status` · `GET /v1/stamps/{code}/original` and `/marked` (302 to provider/FilBeam; mirror fallback; `ETag = sha256`) · `GET /v1/stamps/{code}/evidence` (bundle) · `POST /v1/verify/upload` · `POST /v1/reports` (takedown) · `GET /v1/health/storage` · `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` · v1: C2PA Soft Binding Resolution API `GET /c2pa/matches/byBinding`, `POST /c2pa/matches/byContent`, `GET /c2pa/manifests/{id}`, `GET /c2pa/services/supportedAlgorithms`.

### 9.3 Queues (BullMQ 6, PostgreSQL backend)

`ingest` (hash check, PDQ/ISCC, render marked, TrustMark, C2PA) → `foc-store` (store+commit per provider, retries without re-upload) → `chain-bind` (bindStorage ×N, registerDerivative) → `pdp-monitor` (job scheduler, 10 min) → `finality-watch` (included → safe → final) → v1: `ots-anchor` (OpenTimestamps per-hour Merkle root), `c2pa-receipt` (update manifest).

### 9.4 Database (Postgres 17 + pgvector 0.8.6)

```sql
create extension if not exists vector;
create table users (id uuid primary key, handle text unique, created_at timestamptz default now());
create table device_keys (key_id bytea primary key, user_id uuid references users, platform text, key_type smallint, level smallint,
  pubkey bytea, rp_id_hash bytea, attestation_piece_cid text, registrar bytea, chain_registered_epoch bigint, expires_at timestamptz,
  revoked_epoch bigint, last_counter bigint default 0, apple_risk_metric int, play_verdict jsonb, created_at timestamptz default now());
create table stamps (stamp_id bytea primary key, code text unique, key_id bytea references device_keys, kind text check (kind in ('photo','video')),
  media_type text, content_sha256 bytea unique, piece_cid text, content_length bigint, captured_at timestamptz, record_hash bytea, flags smallint,
  claim jsonb, sig bytea, auth_data bytea, tx_hash bytea, registered_epoch bigint, finality text check (finality in ('pending','included','safe','final')),
  level smallint, status text, created_at timestamptz default now());
create table derivatives (id bigserial primary key, stamp_id bytea references stamps, kind smallint, content_sha256 bytea unique, piece_cid text,
  params_hash bytea, params jsonb, c2pa_manifest_id text, tx_hash bytea, epoch bigint);
create table storage_bindings (id bigserial primary key, stamp_id bytea, derivative_id bigint, provider_id bigint, data_set_id bigint, piece_id bigint,
  retrieval_url text, bound_tx bytea, bound_epoch bigint, last_proven_epoch bigint, proven_this_period bool, faults int default 0, checked_at timestamptz);
create table capture_records (stamp_id bytea primary key references stamps, piece_cid text, public bool, ciphertext bool, key_wrap jsonb);
create table perceptual (id bigserial primary key, stamp_id bytea, rendition text, variant smallint, pdq bit(256), pdq_quality int, iscc text, frame_ts_ms int);
create index on perceptual using hnsw (pdq bit_hamming_ops);
create table chain_cursor (name text primary key, last_epoch bigint);
create table verifications (id bigserial primary key, method text, stamp_id bytea, distance int, verdict text, at timestamptz default now());
create table moderation (stamp_id bytea primary key, state text, reason text, resolver_tx bytea, at timestamptz);
```

### 9.5 Docker Compose (one VPS)

```yaml
services:
  caddy:    { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy:/data] }
  web:      { build: apps/web,        env_file: .env }                                   # next start (standalone)
  api:      { build: services/api,    env_file: .env, volumes: [staging:/srv/staging, mirror:/srv/mirror], secrets: [session_key, registrar_key] }
  worker:   { build: services/api,    command: node dist/worker.js, env_file: .env, volumes: [staging:/srv/staging, mirror:/srv/mirror], secrets: [session_key, relayer_key, renderer_key, c2pa_key] }
  ml:       { build: services/ml,     volumes: [staging:/srv/staging, models:/root/.cache] }   # FastAPI: /watermark/encode|decode, /pdq, /vpdq, /iscc
  indexer:  { build: services/indexer, env_file: .env }                                 # Ponder, RPC mode
  postgres: { image: pgvector/pgvector:pg17, volumes: [pg:/var/lib/postgresql/data] }
volumes: { staging: {}, mirror: {}, models: {}, pg: {}, caddy: {} }
```
Secrets as Docker secrets; the FOC payer wallet and the registrar key for L2 endorsements are kept off-box where possible (registrar signing can run on the api with a short-lived key endorsed by the cold registrar — v1). Nightly `pg_dump` + rsync of `mirror` off-box. Monitoring: pino → Loki/Grafana (or plain Prometheus endpoint) with alerts for PDP proving (per data set: `provingDeadline − head < 120 epochs` unproven, any `FaultRecord`, `pdpEndEpoch != 0`), USDFC runway < 60 days, relayer FIL < 0.5 FIL, session-key expiry < 7 days, `finalized` lag > 60 epochs, SP `/piece` HEAD failures, mirror disk.

---

## 10. Threat-model coverage

| # (threat-model.md) | Threat | Mitigation in this design | Residual (disclosed) |
|---|---|---|---|
| 1 | Analog hole | Live in-app capture; multi-frame/burst and depth where exposed recorded in the record (v2 scoring); level never implies scene truth | "Cannot tell a real scene from a screen/print" |
| 2 | Root + confused-deputy signing | Hardware keys with on-chain enrollment, level, registrar and `revokedEpoch`; per-key monotonic counter; Play Integrity bound to the claim digest; CRL re-check per capture (v1); anomaly limits per key | "A compromised phone can sign anything until revoked" |
| 3 | Camera injection | Physical camera enumeration, no imports, pipeline evidence in the record, attestation; `appAccessRiskVerdict` (v1) | same as 2 |
| 4 | Fake/transplanted badge | Badge is a pointer; checksummed non-enumerable code; verify = comparison with the Filecoin-served original + diff; no green check from a mark | "A mark proves nothing until looked up" |
| 5 | Filecoin copy loss | 2 FOC copies + mirror + community re-pin via permissionless `bindStorage`; PDP/fault/runway monitoring; hash-only verification still works for bit-exact holders | "If all copies vanish, only a bit-exact holder can verify" |
| 6 | Relayer censorship/compromise | Claims signed by device keys and verified on chain; relayer caller-agnostic; self-submit path shipped in MVP | "Relayer can delay, not forge" |
| 7 | Perceptual-hash second preimage / inversion | PDQ for retrieval only; verdicts from exact hash or visual comparison; PDQ published only for public stamps, after publication | "Similar-looking is not the same image" |
| 8 | Re-stamping / ordering | Deterministic epoch time + signed `capturedAt` + per-key nonce; `stampByContentHash` = earliest; near-duplicate hint at ingest (warn, never block) | "Earliest stamp ≠ original creator" |
| 9 | Watermark removal/forgery | Watermark is a lookup key; registry + perceptual gate decide | — |
| 10 | Time/location spoofing | Three times shown; location opt-in, hashed when withheld, labelled "device-reported" | "Location can be spoofed with a cheap radio" |
| 11 | Deanonymization | EXIF minimized on device before hashing; location opt-in; sealed mode; nothing personal on chain; key rotation option; DPIA | "Public originals can identify people and cameras" |
| 12 | Gateway censorship | Provider endpoints resolved on chain, FilBeam, mirror; CID exposed; no IPFS gateway dependency | "Original may be unreachable through some paths" |
| 13 | Reorg before finality | included/safe/final policy; FRC-0089 `finalized` tag; F3 stall acknowledged | — |
| 14 | Registry/admin upgrade abuse | Registry immutable with no roles; resolver flags are advisory; FilOz proxies referenced by stable addresses; `UpgradeAnnounced` watched | "Storage contracts are third-party upgradeable" |
| 15 | Phishing verify sites | Canonical domain, HSTS, Universal/App Links, in-app scanner, CLI verifier whose hash is published on chain (resolver) | "Only trust the registry" |
| 16 | Coerced stamping | Sealed (commit-now, reveal-later) stamps; `withdraw` by the device key; dispute flag; duress mode after legal review (v2) | "A stamp does not prove consent" |
| 17 | Sybil / collusion | No aggregation into truth scores; enrollment friction; quotas per key | "Many stamps ≠ truth" |
| 18 | "Verified" read as "true" | Fixed wording, neutral colours, residual-risk footer on every result, no "verified/authentic" strings in the UI | (this is the disclosure) |

Residual trusted components and their bypass: **attestation registrar** (levels ≥ 1 — bypass: L0 self-registration, third-party registrars, public evidence bundle); **relayer** (self-submit with own FIL); **storage payer** (own data set with own USDFC; re-pin + bind); **renderer** (re-render from the original with `paramsHash` params; the original decides); **perceptual index** (public `IndexPublished` events; exact/code paths need no index); **verify website** (CLI + documented RPC); **resolver flags** (ignorable). Upstream trust that cannot be bypassed: FilOz UUPS proxies (multisig), Apple/Google attestation roots, FEVM precompile semantics, RPC providers (mitigated by querying two).

---

## 11. Economics, abuse, privacy, legal

- **Who pays:** Stamper pays storage (session-key account) and gas (relayer) for the free tier: 100 photos + 10 min video per month per attested key, 2 FOC copies, public originals, 2-year retention guarantee (then "renew or export"). Pro ($/month): higher quotas, sealed/encrypted originals, 10-year retention, evidence bundles with OpenTimestamps (v1) and RFC 3161 qualified / ICP-Brasil timestamps (v2), API. Org: seats, legal hold, SLA. Self-custody users pay their own USDFC/FIL and get the same registry.
- **Rate limits:** per key, per account, per IP/ASN token buckets on `/captures`, `/enroll` (Apple risk metric, Play `recentDeviceActivity`, device recall for abusers), on `/verify/upload`; originals served through the mirror are rate-limited; FilBeam quotas monitored (402 handling). Exact-hash dedupe (same bytes → link, do not re-store). Pre-publication: NSFW/violence classifiers route to review (v1); CSAM hash matching requires a vendor agreement (v1 open item).
- **Takedown on immutable storage:** (1) resolver `takedown(stampId)` event (the hash is never deleted; it is not reversible to content); (2) stop serving from mirror/FilBeam; (3) `ctx.deletePieces` (schedule removal) in Stamper's data sets — pieces are GC'd by providers; (4) Bad Bits report if ever mirrored to IPFS; (5) third-party re-pins cannot be removed — documented. Legal plumbing: DMCA/DSA notice-and-action, Marco Civil Art. 19 handling, transparency report.
- **EXIF/location:** minimized on device before hashing; full EXIF in the capture record (public only if the user opts in; otherwise encrypted, hash-committed); location opt-in with a capture-time bystander prompt ("publish / publish without location / keep sealed").
- **Encrypted-original (sealed) mode (v1):** AES-256-GCM per asset on device; ciphertext is the stored piece (`contentHash` = sha256(ciphertext), `flags.SEALED`); the record commits `sha256(plaintext)` and a salted commitment; key wrapped to the device key and to Stamper's KMS; reveal = publish key + record. Takedown of a sealed asset = key destruction (crypto-shredding), which also makes GDPR/LGPD erasure tractable (EDPB 02/2025: hashes stay personal data; design erasure as delist + key destruction). Public assets stay plaintext on purpose: a key custodian would be one more trusted party.
- **Evidentiary:** the evidence bundle (JSON + PDF) = claim, signature, public key, attestation bundle PieceCID, tx hashes, epochs and UTC times, storage status snapshot, `provenPeriods` bitmap, PDQ/ISCC, C2PA manifests, `.ots` (v1), RFC 3161 token (v2), plus a FRE 902(13)/(14) certification template and an ISO 27037-style custody log. Filecoin alone yields non-discrimination (eIDAS 41(1), MP 2.200-2 Art. 10 §2, FRE 901), presumptions come from qualified timestamps over hourly Merkle roots (v2). Capture→chain latency is logged (Chinese-court style review).

---

## 12. Roadmap

**MVP (demoable end to end on Calibration, then mainnet):** `StamperRegistry` + `StamperResolver` (Foundry, tests with `--odyssey`); Expo app (iOS + Android dev builds): in-app photo and ≤ 1 GiB video capture, EXIF minimization, device hashing (sha256 + PieceCID), EIP-712 claim, App Attest / Keystore signing, Play Integrity + App Attest enrollment at L1, offline queue, share of the marked copy; api/worker: resumable upload, relayer, FOC `store/commit` with session key on two providers, `bindStorage`, sharp badge + QR, TrustMark via the Python sidecar, PDQ/vPDQ/ISCC index, mirror; Next.js verify page (by code, QR, upload: exact → watermark → perceptual) with in-browser re-hashing and signature re-verification, storage panel from live `eth_call`s; `stamper-verify` CLI; self-submit page for wallet users; Ponder indexer; Compose deployment; PDP monitoring. Out of MVP: C2PA, L2, video invisible watermark, sealed mode, direct-to-SP upload, OTS.

**v1:** mainnet launch; direct-to-SP uploads from the device; Android Key Attestation verification (JVM service) → L2, iOS receipt/risk metric → L2; C2PA manifests (sidecar for originals, embedded for derivatives, repository receipts, Soft Binding Resolution API) with a self-issued cert and a Conformance Program application; FilBeam for marked copies; sealed/encrypted mode; OpenTimestamps hourly roots; evidence bundles; Goldsky subgraph; self-custody data sets for wallet users; community re-pin UI; ERC-7053 `Commit` events; moderation pipeline (classifier routing, CSAM vendor).

**v2:** SSL.com L1 claim-signing cert (after conformance); Video Seal/PixelSeal GPU worker; SSCD descriptors for crops/screenshots; chunked > 1 GiB video (`flags.CHUNKED`, per-chunk pieces); RFC 3161 qualified + ICP-Brasil timestamps; L3 sensor evidence (depth/Live Photo/burst scoring); WebAuthn/passkey keys on chain (daimo `WebAuthn.sol`); session keys on mobile for per-user data sets; `setDataSetAuthorizer` with the registry as authorizer; duress mode (after legal review); third-party verifier mirrors with the CLI hash published on chain; sealed PoRep cold copies when FOC ships them.

---

## 13. Risks and open questions

1. **`P256VERIFY` gas on FEVM is unmeasured** (instrumented Wasm accounting). Measure on Calibration via a wrapper before freezing key types; fallback = L2-only P-256 with batching, L0/L1 on secp256k1.
2. **Mainnet F3 stall** (no certificate since 2026-03-09): finality UX relies on FRC-0089 `finalized` (≈ 20–30 epochs) and our own thresholds; ask FilOz about a re-bootstrap.
3. **FRC-0069 is a Draft**: pin the exact PieceCID v2 byte encoding `getPieceCid` returns for pieces added via FWSS 1.4.0 with a fork-test vector before freezing the on-chain `pieceCid` comparison.
4. **Direct-to-SP uploads**: unverified whether SP `/pdp/piece` endpoints accept unauthenticated uploads from phones (CORS, rate limits, GC of uncommitted pieces) — spike before v1.
5. **Synapse SDK on React Native** is unsupported; only `synapse-core/piece` runs on device. Benchmark the pure-JS PieceCID tree on a 1 GB video on mid-range Android; fall back to server-side PieceCID with sha256 pre-commitment if needed.
6. **Piece-metadata limits** (3 vs 5 keys; 96 vs 128 B values) and **pricing** (0.024 vs 0.12 USDFC/data-set/month; 0.0003 vs 0.003 per piece) differ between the verified README and the docs/CHANGELOG — read `getPriceList()` and the deployed FWSS constants at integration.
7. **`hasBeenProvenRecently`** reverted on the deployed StateView; `provenThisPeriod`/`provingDeadline` are used instead — confirm semantics around period boundaries.
8. **Apple/Google quotas**: App Attest ≈ 100 attestations/s global, Play Integrity 10k decodes/day default — request increases before launch; Expo `@expo/app-integrity` is young (alpha label dropped in SDK 58) — wrap behind an interface.
9. **Leaked keyboxes / root exploits** make L2 "best available", not proof; registrar revocation and `revokedEpoch` are the only remedy; Buchanan-style attacks remain.
10. **TrustMark model redistribution** from `cai-watermark.adobe.net` (403 to anonymous clients) — confirm mirroring terms; PyPI package downloads weights at first use.
11. **`eth_getLogs` range caps** (2880 → 360) and undocumented RPC rate limits — budget a dedicated Lotus node or paid plan when the indexer matters.
12. **Legal**: EU qualified timestamps and ICP-Brasil pricing at volume; EDPB 02/2025 v2 text; takedown duties vs third-party re-pins; CSAM scanning vendor access.
13. **C2PA**: conformance timeline (1 week–3 months), HEIC write support in c2pa-rs, update-manifest semantics for repository receipts; until listed, validators show "unknown source" — Stamper's verify page is the canonical UX.
14. **Code UX**: 12 symbols is long for a visible badge at 1080 px; measure legibility and PDQ drift of the badge at 4–6 % of the short side on a 1k-photo corpus before freezing geometry.
15. **Privacy**: stable `keyId` links a device's stamps on chain; monthly re-keying and anonymity-set designs are v2 research.
