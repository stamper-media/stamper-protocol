# Stamper — Architecture proposal (lens: product-first MVP)

Date: 2026-10-01. Author role: principal architect. Inputs: `VERIFIED-SDK-FACTS.md` (ground truth for the installed `@filoz/synapse-sdk@2.0.2` / `@filoz/synapse-core@0.10.0`) and the nine research reports in `../` (filecoin-storage, fevm-contracts, c2pa-prior-art, watermarking, trusted-capture, perceptual-hashing, app-stack, codes-ux-legal, threat-model). Where a report and the verified SDK facts disagreed, the SDK facts won. Placeholders: `stamper.app` is the canonical verify domain (not yet registered); `computer.paradox.stamper.*` is the reverse-domain label namespace.

**The product promise this design optimises for:** a journalist opens the app, takes a photo, and within ~10 seconds has a share-ready image with a visible code; within ~2 minutes that code resolves on `stamper.app/v/<code>` to a page that shows the registered original next to whatever copy the viewer holds, with the chain record and the Filecoin storage proof underneath. Everything that cannot be done in seconds (chain finality, FOC commit, PDP proving) catches up visibly and never blocks sharing.

**Pragmatic trusted components (disclosed, each with a decentralisation path):** (1) Stamper's attestation verifier/registrar sets device assurance levels; (2) Stamper's relayer pays gas and submits claims; (3) Stamper's worker renders the marked derivative and attaches its hash; (4) Stamper is the single FOC payer. None of these can forge a stamp: every stamp is signed by a device key and verified on chain, and every original is identified by a device-signed sha256 + PieceCID that anyone can re-hash.

---

## 1. Trust model

### 1.1 What a stamp proves

A Stamper stamp `S` for bytes `B` proves, to anyone with a Filecoin RPC and the public FOC provider endpoints:

1. **Integrity and identity**: `sha256(B)` and `PieceCID_v2(B)` were committed on the Filecoin EVM in a `StampRegistered` event at epoch `E` (`block.timestamp = genesis + 30·E`, deterministic; see fevm-contracts §1.6). A copy that re-hashes to the same values is byte-identical to what was stamped.
2. **Origin key**: the claim was signed by device key `K`, registered in the same contract at or before `E` with assurance level `L`, and not revoked at `E`. The signature is in the event, so the proof is re-checkable offline forever (no certificate expiry — the C2PA weakness in arXiv 2604.24890 does not apply).
3. **Existence-by time**: `B` existed no later than `E` (hard, chain time). The device-reported `capturedAt` is a *claim*, displayed separately.
4. **Storage**: `B` is a piece of a live, PDP-proven FOC data set (`PDPVerifier.findPieceIdsByCid` / `getPieceCid` + `dataSetLive`, `FWSSView.provenThisPeriod`), and the original can be fetched from the provider's `/piece/{PieceCID}` endpoint and re-hashed.
5. **Derivation**: the public share copy `D` (visible mark, invisible mark, C2PA manifest) was derived by Stamper from `B` under a published, versioned mark spec; `sha256(D)` is attached on chain so a byte-identical shared copy resolves without perceptual guessing.

### 1.2 What it does not prove (shown verbatim on every verify page)

- That the scene in front of the camera was real, unstaged, or not a screen/print (analog hole).
- That the phone was not compromised at capture time (root exploits defeat attestation; Google rated the Pixel 10 case "won't fix").
- That the device clock or location was honest.
- That the person stamping consented or is who the account says; that the *first* stamp of a scene is the original creator's.
- That an image *without* a stamp is fake.

Wording rule (codes-ux-legal §2.3, threat-model §4.4): never "verified", "authentic", "real". Verdicts are a *match outcome* ("Identical to the stamped original", "Same picture, re-encoded", "Related, altered", "Not registered") × a *capture tier* × *time anchors*.

### 1.3 Assurance levels

| Level | Label in UI | Requirements (enforced by the registrar at enrolment and per capture) | On chain | MVP? |
|---|---|---|---|---|
| **L0** | "Uploaded via web — device not attested" | Passkey/magic-link session; browser-generated secp256k1 key registered in that session; server-witnessed receipt time | `DeviceKey.level = 0`, `keyType = 0` | yes |
| **L1** | "Captured in the Stamper app" | iOS: App Attest attestation of an App Attest key that *binds* the app signing key (clientDataHash = sha256(appKeyAddress ‖ challenge)), `apple_validation_category_01 == 4` (App Store) or 2 (TestFlight, non-prod), per-capture assertion with increasing counter over the claim digest. Android: Play Integrity standard token per capture with `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`, `requestHash = base64url(sha256(claimDigest ‖ challenge))`; Key Attestation chain collected at enrolment (stored, not yet required) | `level = 1`, `keyType = 0` (secp256k1 app key), `attestationHash` | yes |
| **L2** | "Hardware-attested capture" | L1 plus the *signing* key itself is P-256 in Secure Enclave / StrongBox: iOS App Attest assertion as the claim signature (`keyType = 2`); Android attested key (`keyType = 1`) with `MEETS_STRONG_INTEGRITY`, `verifiedBootState == Verified` (or GrapheneOS self-signed with known key), `osPatchLevel ≤ 12 months`, chain serials absent from `android.googleapis.com/attestation/status` re-checked per capture; Apple risk metric ≤ 5 | `level = 2`, signature verified on chain via `P256VERIFY` (0x0100) | v1 |
| **L3** | reserved: "secure-element + sensor evidence" | L2 + RKP-provisioned StrongBox chain, depth/Live-Photo evidence scored, or ingested C2PA Level-2 manifest | `level = 3` | v2 |

The level is **not** printed in the visible badge (alternative considered and rejected: trusted-capture §6.1 suggests `L2-…` prefixes; anything drawn into pixels is forgeable in seconds and would be read as "trusted" without a lookup — threat-model §2.2). The level lives in the chain record and on the verify page, with the registrar's identity and the attestation bundle hash so it can be re-audited.

---

## 2. System architecture

### 2.1 Components

```
┌──────────────────────────── clients ─────────────────────────────┐
│  apps/mobile (Expo 57)        apps/web (Next.js 16.3)             │
│  capture · hash · sign ·      verify page · web capture (L0) ·    │
│  attest · upload · share      compare slider · evidence view      │
└───────────┬───────────────────────────┬───────────────────────────┘
            │ HTTPS (resumable PUT, JSON)│
┌───────────▼───────────────────────────▼───────────────────────────┐
│  services/api (Hono 4, Node 24)                                   │
│  auth · device enrolment · capture sessions · claims · verify API │
│  · code resolution · evidence bundles · AASA/assetlinks           │
└──────┬──────────────┬───────────────────────┬─────────────────────┘
       │ BullMQ 6 (Postgres backend)          │ reads
┌──────▼──────┐ ┌──────▼───────┐ ┌────────────▼──────────┐
│ services/   │ │ services/ml  │ │ Postgres 17 + pgvector │
│ worker      │ │ (FastAPI,    │ │ stamps · keys · assets │
│ verify hash │ │  Py 3.12)    │ │ bindings · pdq bit(256)│
│ mark (sharp,│ │ trustmark    │ │ frames · txs · flags   │
│ ffmpeg)     │ │ pdqhash/vpdq │ └────────────────────────┘
│ c2pa-node   │ │ ssim         │
│ synapse-sdk │ └──────────────┘
│ relayer     │        staging volume /srv/staging (originals, renditions)
│ pdp-monitor │
└──┬──────┬───┘
   │      │ EIP-1559 txs (Glif → Ankr failover)
   │      ▼
   │  ┌───────────────────────── Filecoin EVM (314 / 314159) ──────────────┐
   │  │ StampRegistry (immutable)  StampResolver (owned)                    │
   │  │   ↕ eth_call                                                        │
   │  │ PDPVerifier 0xBADd…557F   FWSS StateView 0xcf18…8172  FilecoinPay   │
   │  └─────────────────────────────────────────────────────────────────────┘
   │ synapse.storage.upload (store → SP-to-SP pull → EIP-712 addPieces by session key)
   ▼
 ┌─────────────────────── Filecoin Onchain Cloud ────────────────────────┐
 │ data set A (provider 1)  data set B (provider 2)   FilBeam CDN         │
 │ pieces: original, share  PDP proofs every 2880 epochs (mainnet)        │
 └────────────────────────────────────────────────────────────────────────┘
```

### 2.2 End-to-end data flow (photo, L1 Android; iOS differs only in the attestation call)

```mermaid
sequenceDiagram
  autonumber
  participant App as Expo app
  participant API as services/api
  participant W as worker (+ml)
  participant R as StampRegistry (FEVM)
  participant FOC as Synapse / FOC
  App->>API: POST /v1/captures {deviceKeyId} → {captureId, uploadId, challenge(32B, 5 min TTL)}
  App->>App: takePictureAsync → bytes B; sha256(B); PieceCID(B) (synapse-core/piece)
  App->>App: claim = CaptureClaim{contentHash, pieceCid, size, kind, capturedAt, metaHash, nonce, deadline}; sig = signTypedData(appKey)
  App->>App: integrityToken = requestIntegrityCheckAsync(base64url(sha256(digest ‖ challenge)))
  App->>API: PUT /v1/uploads/{uploadId} (Content-Range, iOS background session) ← bytes
  App->>API: POST /v1/captures/{id}/claim {claim, sig, integrityToken, captureRecord(CBOR)}
  API->>API: re-hash staged bytes == claim; verify sig; decode Play token; check level; reserve code (DB unique, dist≥2)
  API->>R: relayer: registerStamp(claim, sig, keyId, code)   (tx submitted <2 s; receipt 30–90 s)
  API-->>App: 202 {code "K3Q9-XA2M-7", stampId, status: "pending"}
  API->>W: enqueue mark(stampId)
  W->>W: sharp badge → TrustMark(code, BCH_SUPER) → JPEG q92 → C2PA manifest → D; sha256(D), PieceCID(D); PDQ(B), PDQ(D)
  W-->>App: push "Share-ready" (≈5–10 s after upload); GET /v1/stamps/{code}/share.jpg
  W->>FOC: synapse.storage.upload(B,{pieceCid, copies:2, pieceMetadata:{stampId,kind:'original'}}) and same for D
  FOC-->>W: onPiecesConfirmed(dataSetId, providerId, [{pieceId, pieceCid}]) per copy
  W->>R: relayer: attachDerivative(stampId, sha256(D), PieceCID(D), markSpecHash)
  W->>R: relayer: bindStorage(stampId, [{asset, setId, pieceId}...])  (contract re-checks getPieceCid/dataSetLive/listener)
  W-->>App: push "Anchored · Stored (2 copies)"
```

### 2.3 Verify by code / QR

```mermaid
sequenceDiagram
  participant V as Viewer (browser)
  participant Web as apps/web
  participant API as services/api
  participant R as StampRegistry
  participant SP as FOC provider / FilBeam
  V->>Web: GET /v/K3Q9-XA2M-7  (QR, Universal/App Link, or typed)
  Web->>Web: decodeCode(): normalise, check symbol, 40-bit code
  Web->>R: eth_call stampByCode(code) → stampId; stamps(stampId); bindings(stampId); keys(keyId)
  Web->>R: eth_call storageStatus(stampId) via Multicall3; eth_getBlockByNumber("finalized")
  Web->>SP: GET {serviceURL}/piece/{pieceCid}  (HEAD race across bindings; FilBeam first if withCDN)
  Web->>Web: stream through Piece.transformStream() + sha256 → compare with chain → render original
  V->>Web: (optional) drop the copy you were sent → sha256/PDQ compare client-side; slider + diff
  Web->>API: GET /v1/stamps/{code} (presentation data, flags, C2PA manifest, evidence) — never required for the verdict
```

### 2.4 Verify by uploaded copy (no code)

```mermaid
sequenceDiagram
  participant V as Viewer
  participant API as services/api
  participant ML as services/ml
  participant DB as Postgres/pgvector
  V->>API: POST /v1/verify/upload (file ≤ 50 MB image / ≤ 500 MB video)
  API->>API: sha256 → exact lookup (original, share, preview, thumb) → "Identical to …"
  API->>ML: decode TrustMark → 40-bit code? → fetch stamp → PDQ distance ≤ 40 confirms
  API->>ML: PDQ (+8 dihedral, +2 centre crops; quality ≥ 50) ; video: 1 fps vPDQ frames
  API->>DB: pdq <~> query ORDER BY LIMIT 20 → candidates ≤ 31 bits → SSIM re-rank vs originals
  API-->>V: verdict ladder + candidates (never a single auto-pick when ties ≤ 5 bits) + original CIDs
```

---

## 3. Identifiers and data model

### 3.1 Content identifiers

| Identifier | Definition | Computed by | Stored |
|---|---|---|---|
| `contentHash` | `sha256(B)`, 32 bytes, of the untouched capture file | device (noble/quick-crypto), re-checked by worker | chain (claim), DB |
| `pieceCid` | PieceCID v2 raw CID bytes: `0x01 0x55 0x91 0x20 <uvarint len> <uvarint padding><uint8 height><32-byte root>` (FRC-0069; prefix `0x01559120`; text `bafkzcib…`) | device via `calculate()` / `hasher()` from `@filoz/synapse-core/piece`; worker re-checks; SP must match on `store(data, { pieceCid })` | chain as `bytes` (≈36–40 B), DB |
| `size` | byte length of `B` (needed to interpret the PieceCID and for cost) | device | chain |
| `derivedHash`, `derivedPieceCid` | same pair for the share copy `D` | worker | chain (attached by registrar) |
| `ipfsRawCid` | `CID.createV1(raw, sha256)` — valid only for ≤ 1 MiB files; derived from `contentHash`, never stored | verify page | — |
| `pdq`, `pdqQuality` | 256-bit PDQ + quality, one implementation (`pdqhash` 0.2.8 in the sidecar) for index *and* query | worker | DB `bit(256)` (off chain: inversion risk, threat-model §2.5) |
| `isccCode` | ISCC-CODE (ISO 24138) of `B` via `iscc-sdk` | worker | DB; C2PA `c2pa.soft-binding` (`io.iscc.v0`) in v1 |

Alternative rejected: anchoring a UnixFS/IPFS CID instead of (or in addition to) the PieceCID. With Synapse the piece *is* the bytes, so the PieceCID is both the storage proof and a content id computable on device; the UnixFS CID would require the `unixfs-v1-2025` profile on Hermes (needs WebCrypto polyfills) and buys nothing until IPFS retrieval is a product requirement (filecoin-storage §5, §6). `sha256` already gives non-IPFS verifiers a `sha256sum`-checkable identity.

### 3.2 Stamp id and short verification code

- `stampId = keccak256(abi.encode(chainId, registry, keyId, contentHash, nonce))` — derived from the claim, never from the signature (malleability).
- **Code**: a 40-bit value `V` drawn uniformly at random by the issuer (CSPRNG), unique on chain, encoded as 8 Crockford Base32 symbols (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I/L/O/U) plus 1 Crockford mod-37 check symbol. The registry requires `V mod 37 < 32` (≈13.5 % of draws are re-drawn) so the check symbol is always in the clean 32-symbol alphabet. Display `XXXX-XXXX-C`, e.g. `K3Q9-XA2M-7`; decode is case-insensitive, maps `i/l→1`, `o→0`, ignores hyphens/spaces, applies UTS #39 ASCII-only rejection before decoding. Detects 100 % of single substitutions and adjacent transpositions (codes-ux-legal §1.1); the issuer additionally refuses candidates within symbol-Hamming distance 1 of an existing code.
- Why 40 bits and not the 55-bit code from codes-ux-legal §1.5: (a) the same 40 bits are the TrustMark `BCH_SUPER` payload (watermarking §2.4), so the invisible watermark and the visible code are literally the same number; (b) enumeration resistance is moot — every public stamp is already enumerable from `StampRegistered` events, and sealed stamps expose only hashes; (c) 9 symbols is what a person will actually type from a screenshot. Guessing an existing code succeeds with p ≈ 1e-6 at 1 M stamps, which only yields a public page. Reserve: codes whose first symbol is `Z` are never issued in v1 (future version marker).
- **Verify URL**: `https://stamper.app/v/K3Q9-XA2M-7` (handler case-insensitive, hyphen-insensitive); served as Apple Universal Link (`/.well-known/apple-app-site-association`, `components: [{"/": "/v/*"}]`) and Android App Link (`assetlinks.json`, `autoVerify`). **QR payload**: `HTTPS://STAMPER.APP/V/K3Q9XA2M7` (31 alphanumeric chars → QR Version 2, ECC M, 25×25). Forensic QR (evidence export only): `…?C=<PieceCID base32-upper>`.

### 3.3 Capture claim (EIP-712) and capture record (DAG-CBOR)

Two layers, deliberately: the on-chain claim is EIP-712 because the MVP signer is secp256k1/viem and the verifier is Solidity; the richer capture record is DAG-CBOR because it must be content-addressed, redactable, and later convertible to COSE/C2PA.

```ts
// packages/core/src/claim.ts (abitype, shared by mobile, web, api)
export const stamperDomain = (chainId: 314 | 314159, verifyingContract: Address) =>
  ({ name: 'Stamper', version: '1', chainId, verifyingContract }) as const
export const captureClaimTypes = {
  CaptureClaim: [
    { name: 'contentHash', type: 'bytes32' }, // sha256(B)
    { name: 'pieceCid',    type: 'bytes'   }, // PieceCID v2 bytes; may be empty for video (see §7.5)
    { name: 'size',        type: 'uint64'  },
    { name: 'mediaKind',   type: 'uint8'   }, // 1 image, 2 video
    { name: 'capturedAt',  type: 'uint64'  }, // ms, device clock (soft)
    { name: 'metaHash',    type: 'bytes32' }, // sha256(dag-cbor(CaptureRecord))
    { name: 'nonce',       type: 'uint64'  }, // per key, monotonic
    { name: 'deadline',    type: 'uint64'  }, // unix seconds; registry rejects after
  ],
} as const satisfies TypedData
```

`CaptureRecord` (DAG-CBOR, keys sorted per RFC 8949 §4.2.1, floats forbidden — coordinates as micro-degrees ints):

```
{ v:1, platform:"ios"|"android"|"web", app:{bundleId, version, build},
  deviceKeyId: bytes32, level: 0|1|2, challenge: bytes32,
  media:{ mime, width, height, durationMs?, fps?, orientation },
  capture:{ source:"in-app-camera"|"web-getUserMedia", cameraId, facing, lensId?, physical:true },
  times:{ capturedAt, monotonicNs, serverChallengeIssuedAt },
  attestation:{ kind:"appattest"|"playintegrity"|"none", bundleHash: bytes32 },
  publicExif:{ make, model, exposure…},                    // what we are willing to show
  privateHash: bytes32 | null                             // sha256(dag-cbor({location?, fullExif, sensorEvidence?}))
}
```

The private sub-record (location, full EXIF, depth/Live-Photo artefacts) is stored encrypted at rest and never published; its hash is committed in the public record, so withholding it never invalidates the signature.

### 3.4 Piece metadata keys (FOC)

Per piece (≤ 3–5 keys, key ≤ 32 B, value ≤ 96/128 B; carried in the FWSS `PieceAdded` event, not in state since 1.4.0): `stampId` (hex), `kind` (`original` | `share` | `record` | `chunk`), `sha256` (hex). Data-set metadata: `source = "stamper"` (`Synapse.create({ source: 'stamper' })`), `withCDN` on the primary data set only.

### 3.5 Derivative ↔ original linkage

- On chain: `Stamp.derivedHash`, `Stamp.derivedPieceCid`, `Stamp.markSpecHash` (sha256 of the versioned mark spec JSON: badge geometry, font file hash, sharp/libvips/mozjpeg versions, TrustMark variant/strength/schema, C2PA manifest template) attached once by the registrar. Anyone can regenerate `D` from `B` with the published spec and the pinned container image and check `derivedHash`.
- In the file: C2PA ingredient `parentOf` = the original's manifest; custom assertion `computer.paradox.stamper.anchor` `{stampId, code, contentHash, pieceCid, derivedHash, registry:{chainId, address, txHash, epoch}}`; `c2pa.soft-binding` with `alg: com.adobe.trustmark.Q`, `value: "<schema>*<40 bits>"`.
- In the DB: `renditions(stamp_id, kind, sha256, piece_cid, pdq)` for original, share, preview (1600 px), thumb.

---

## 4. Smart contracts

Two contracts, Solidity 0.8.30, `evm_version = "cancun"`, Foundry (forge-std 1.17 already vendored; add OpenZeppelin Contracts 5.6.1 for `ECDSA`, `EIP712`, `Ownable2Step`). Deployed to Calibration (314159) then mainnet (314).

### 4.1 `StampRegistry` — immutable, no proxy, no owner-upgradable logic

Trusted roles are limited to *registrars* (set levels, revoke keys, attach derivatives) managed by an `Ownable2Step` owner (Stamper Safe, deployed via the Safe singleton factory `0x914d7Fec…43d7` which exists on both networks) behind a 7-day timelock on `setRegistrar`. Registrars cannot create, alter, or delete stamps.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

struct Cid { bytes data; }                                     // mirrors PDPVerifier Cids.Cid
interface IPDPVerifier {
    function dataSetLive(uint256 setId) external view returns (bool);
    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cid memory);
    function findPieceIdsByCid(uint256 setId, Cid calldata pieceCid, uint256 startPieceId, uint256 limit) external view returns (uint256[] memory);
    function getDataSetListener(uint256 setId) external view returns (address);
    function getDataSetStorageProvider(uint256 setId) external view returns (address, address);
    function getNextChallengeEpoch(uint256 setId) external view returns (uint256);
}
interface IFWSSView {
    struct DataSetInfo { uint256 pdpRailId; uint256 cacheMissRailId; uint256 cdnRailId; address payer; address payee; address serviceProvider; uint256 commissionBps; uint256 clientDataSetId; uint256 pdpEndEpoch; uint256 providerId; uint96 pendingOneTimePayments; uint96 lifecycleReserveBalance; uint256 dataSetId; }
    function getDataSet(uint256 dataSetId) external view returns (DataSetInfo memory);
    function getDataSetStatus(uint256 dataSetId) external view returns (uint8);   // 0 Inactive, 1 Active
    function provenThisPeriod(uint256 dataSetId) external view returns (bool);
    function provingDeadline(uint256 setId) external view returns (uint256);
}

contract StampRegistry is EIP712("Stamper", "1"), Ownable2Step {
    // ---- constants
    address constant P256VERIFY = 0x0000000000000000000000000000000000000100;     // FIP-0113 (nv28)
    uint256 constant P256_N_HALF = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "CaptureClaim(bytes32 contentHash,bytes pieceCid,uint64 size,uint8 mediaKind,uint64 capturedAt,bytes32 metaHash,uint64 nonce,uint64 deadline)");
    uint8 constant KT_SECP256K1 = 0; uint8 constant KT_P256_RAW = 1; uint8 constant KT_APPATTEST = 2; // 3 = EIP-1271 (v2)
    uint8 constant ASSET_ORIGINAL = 0; uint8 constant ASSET_DERIVED = 1;
    uint8 constant MAX_BINDINGS = 8;

    IPDPVerifier public immutable pdp;        // 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F / 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C
    IFWSSView    public immutable fwssView;   // 0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172 / 0x1B68d64f01bAa42014B9774605867BF4eDC0320f
    address      public immutable fwss;       // 0x8408502033C418E1bbC97cE9ac48E5528F371A9f / 0x02925630df557F957f70E112bA06e50965417CA0
    bytes32      public immutable appAttestRpIdHash; // sha256("TEAMID.app.stamper.mobile")

    // ---- types
    struct CaptureClaim { bytes32 contentHash; bytes pieceCid; uint64 size; uint8 mediaKind; uint64 capturedAt; bytes32 metaHash; uint64 nonce; uint64 deadline; }
    struct DeviceKey { uint8 keyType; uint8 platform; uint8 level; uint64 validFrom; uint64 expiresAt; uint64 revokedAt;
                       address addr;            // secp256k1 (keyType 0)
                       bytes32 x; bytes32 y;    // P-256 (keyType 1/2)
                       bytes32 attestationHash; // sha256 of the attestation bundle (stored on FOC in v1)
                       uint32 lastCounter;      // App Attest assertion counter
                       address registrar; }
    struct Stamp { bytes32 contentHash; bytes pieceCid; uint64 size; uint8 mediaKind; uint64 capturedAt; bytes32 metaHash;
                   bytes32 keyId; uint8 level; uint64 registeredEpoch; uint40 code;
                   bytes32 derivedHash; bytes derivedPieceCid; bytes32 markSpecHash; }
    struct Binding { uint8 asset; uint256 setId; uint256 pieceId; }

    // ---- storage layout (all keyed by immutable ids; nothing is ever overwritten except key revocation/counter)
    mapping(bytes32 keyId  => DeviceKey) public keys;
    mapping(bytes32 stampId => Stamp)    public stamps;
    mapping(bytes32 stampId => Binding[]) internal _bindings;
    mapping(uint40 code    => bytes32)   public stampByCode;
    mapping(bytes32 contentHash => bytes32) public firstStampOf;
    mapping(bytes32 keyId => mapping(uint64 nonce => bool)) public usedNonce;
    mapping(address => bool) public registrars;          // changes take effect after a 7-day announce (timelock)

    // ---- events (the indexable record; `sig` is emitted so anyone can re-verify offline)
    event DeviceKeyRegistered(bytes32 indexed keyId, uint8 keyType, uint8 platform, uint8 level, bytes32 attestationHash, address registrar);
    event DeviceKeyRevoked(bytes32 indexed keyId, uint64 revokedAt, uint8 reason);
    event StampRegistered(bytes32 indexed stampId, uint40 indexed code, bytes32 indexed contentHash, bytes32 keyId, uint8 level,
                          bytes pieceCid, uint64 size, uint8 mediaKind, uint64 capturedAt, bytes32 metaHash, bytes sig, address submitter);
    event DerivativeAttached(bytes32 indexed stampId, bytes32 derivedHash, bytes derivedPieceCid, bytes32 markSpecHash);
    event StorageBound(bytes32 indexed stampId, uint8 asset, uint256 indexed setId, uint256 pieceId, address storageProvider);
    event Commit(address indexed recorder, string indexed assetCid, string commitData);   // ERC-7053 interop (Numbers indexers)

    // ---- registrar paths (trusted component, disclosed)
    function registerDeviceKey(bytes32 keyId, DeviceKey calldata k) external onlyRegistrar;   // keyId = keccak(x‖y) or bytes32(uint160(addr)); level ≤ 2 in v1
    function revokeDeviceKey(bytes32 keyId, uint8 reason) external onlyRegistrar;             // stamps registered before revokedAt stay valid; UI shows the date
    function attachDerivative(bytes32 stampId, bytes32 derivedHash, bytes calldata derivedPieceCid, bytes32 markSpecHash) external onlyRegistrar; // once

    // ---- permissionless paths
    function registerStamp(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData, bytes32 keyId, uint40 code)
        external returns (bytes32 stampId)
    {
        DeviceKey storage k = keys[keyId];
        require(k.validFrom != 0 && k.revokedAt == 0 && block.timestamp < k.expiresAt, "key");
        require(block.timestamp <= c.deadline && !usedNonce[keyId][c.nonce], "replay");
        require(code != 0 && code % 37 < 32 && stampByCode[code] == bytes32(0), "code");
        require(c.pieceCid.length == 0 || _isPieceCidV2(c.pieceCid), "cid");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, c.contentHash, keccak256(c.pieceCid), c.size, c.mediaKind, c.capturedAt, c.metaHash, c.nonce, c.deadline)));
        require(_verify(k, digest, sig, authData), "sig");
        usedNonce[keyId][c.nonce] = true;
        stampId = keccak256(abi.encode(block.chainid, address(this), keyId, c.contentHash, c.nonce));
        require(stamps[stampId].registeredEpoch == 0, "dup");
        stamps[stampId] = Stamp(c.contentHash, c.pieceCid, c.size, c.mediaKind, c.capturedAt, c.metaHash, keyId, k.level, uint64(block.number), code, 0, "", 0);
        stampByCode[code] = stampId;
        if (firstStampOf[c.contentHash] == 0) firstStampOf[c.contentHash] = stampId;
        emit StampRegistered(stampId, code, c.contentHash, keyId, k.level, c.pieceCid, c.size, c.mediaKind, c.capturedAt, c.metaHash, sig, msg.sender);
        emit Commit(msg.sender, _cidString(c.pieceCid), "");           // ERC-7053: assetCid = PieceCID text
    }

    /// Anyone may bind storage; the contract re-derives trust from PDPVerifier state, so a lying caller cannot bind the wrong bytes.
    function bindStorage(bytes32 stampId, Binding[] calldata bs) external {
        Stamp storage s = stamps[stampId];
        require(s.registeredEpoch != 0 && _bindings[stampId].length + bs.length <= MAX_BINDINGS, "state");
        for (uint i; i < bs.length; i++) {
            Binding calldata b = bs[i];
            require(pdp.getDataSetListener(b.setId) == fwss, "not-fwss");      // only Warm-Storage-managed sets carry proof→payment semantics
            require(pdp.dataSetLive(b.setId), "dead-set");
            bytes memory cid = pdp.getPieceCid(b.setId, b.pieceId).data;
            require(cid.length != 0, "no-piece");
            if (b.asset == ASSET_ORIGINAL) {
                if (s.pieceCid.length == 0) s.pieceCid = cid;                       // video path: first binding fixes the PieceCID
                else require(keccak256(cid) == keccak256(s.pieceCid), "cid-mismatch");
            } else { require(s.derivedHash != 0 && keccak256(cid) == keccak256(s.derivedPieceCid), "cid-mismatch"); }
            (address sp,) = pdp.getDataSetStorageProvider(b.setId);
            _bindings[stampId].push(b);
            emit StorageBound(stampId, b.asset, b.setId, b.pieceId, sp);
        }
    }

    // ---- views used by the verify page and the CLI (all trustless)
    function bindings(bytes32 stampId) external view returns (Binding[] memory);
    function storageStatus(bytes32 stampId) external view returns (
        uint8 asset, uint256 setId, uint256 pieceId, bool live, bool stillThere, bool provenThisPeriod, uint256 provingDeadline, uint256 nextChallengeEpoch, bool paymentActive)[] memory
    {   // per binding: live = dataSetLive; stillThere = findPieceIdsByCid(setId, cid, 0, 1).length > 0 (piece not removed);
        // paymentActive = fwssView.getDataSet(setId).pdpEndEpoch == 0 && getDataSetStatus == 1
    }
    function verifyClaim(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData, bytes32 keyId) external view returns (bool); // pure re-check of an event

    // ---- signature schemes
    function _verify(DeviceKey storage k, bytes32 digest, bytes calldata sig, bytes calldata authData) internal returns (bool) {
        if (k.keyType == KT_SECP256K1) return ECDSA.recover(digest, sig) == k.addr;                 // precompile 0x01; low-s enforced by OZ
        bytes32 h;
        if (k.keyType == KT_P256_RAW) {                                                             // Android Keystore SHA256withECDSA / Web Crypto over the 32-byte digest
            h = sha256(abi.encodePacked(digest));
        } else if (k.keyType == KT_APPATTEST) {                                                     // App Attest assertion: nonce = sha256(authData ‖ sha256(clientData)), clientData = digest
            require(authData.length == 37 && bytes32(authData[0:32]) == appAttestRpIdHash, "rpid");
            uint32 counter = uint32(bytes4(authData[33:37]));
            require(counter > k.lastCounter, "counter"); k.lastCounter = counter;
            h = sha256(abi.encodePacked(authData, sha256(abi.encodePacked(digest))));
        } else revert("keytype");
        (bytes32 r, bytes32 s) = abi.decode(sig, (bytes32, bytes32));                               // raw r‖s (DER converted client-side)
        if (uint256(s) > P256_N_HALF) return false;                                                 // precompile does not reject high-s
        (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(h, r, s, k.x, k.y));   // empty output == invalid, never reverts
        return ok && out.length == 32 && out[31] == 0x01;
    }
}
```

Design notes and alternatives:

- **Storage check at bind time, not at registration.** `registerStamp` is sent seconds after capture, before the SP has committed `addPieces` (1–3 min). Registering first gives the earliest hard time anchor; `bindStorage` later makes the record "stored and proven". The verify page distinguishes "registered, storing…" from "stored". Alternative rejected: one combined call after the FOC commit — costs the user 2–3 minutes of time-anchor and makes the code unavailable until then.
- **`findPieceIdsByCid` vs `getPieceCid`.** Binding uses `getPieceCid(setId, pieceId)` (exact, cheap, pieceId known from `onPiecesConfirmed`); `storageStatus` uses `findPieceIdsByCid(setId, cid, 0, 1)` so a verifier (or the contract) can detect later removal without trusting the stored pieceId. Both are in the verified ABI. `pieceLive` / `getDataSetLastProvenEpoch` exist in the PDPVerifier 3.5.0 source (fevm-contracts §2.1) but are not in the SDK-verified list; they are used only off-chain behind a fork-test gate.
- **Codes inside the immutable registry** (not in a mutable resolver): a code is a pointer; if Stamper could remap it, "look it up" would mean "trust Stamper". Alternative rejected: ENS-style mutable resolver for codes (fevm-contracts §5).
- **Who signs.** MVP devices sign with secp256k1 (`keyType 0`); the P-256 paths are implemented, fork-tested against Calibration (the Foundry local EVM lacks 0x0100 — mock with `vm.etch` of a stub in unit tests, run real vectors from EIP-7951 on `--fork-url https://api.calibration.node.glif.io/rpc/v1`), and switched on for L2 in v1 without redeploying.
- **Relayer/gasless path.** No ERC-4337 on Filecoin (no EntryPoint code, no Pimlico), so `registerStamp` is a plain meta-transaction: the device signature is the authorisation; `msg.sender` is irrelevant (`submitter` is only logged). Self-submission: the app exposes "Submit with my own wallet" (claim + sig as JSON/QR; any FIL wallet calls `registerStamp`) from day one — the relayer can delay, never forge or censor permanently.
- **Replay protection**: `(keyId, nonce)` bitmap, `deadline`, EIP-712 domain with `chainId` + `verifyingContract`; App Attest counter monotonicity; stampId includes chainId and contract.
- **Gas**: register ≈ 10–40 M Filecoin gas (≈ 2e-6–8e-6 FIL ≈ $0.00001 at $1.04/FIL; fevm-contracts §1.4); `bindStorage` adds 4 external views per binding (still single-digit USD per million); P256VERIFY cost is *unknown* (Wasm-instrumented) — measured on Calibration before v1. Relayer wallet: 2 FIL ≈ 100k+ stamps; alert at 0.5 FIL.
- **Deployment**: `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --skip-simulation --slow --retries 10 --timeout 180`; verify with `forge verify-contract --verifier blockscout --verifier-url https://filecoin-testnet.blockscout.com/api/` and `npx filfox-verifier forge …`; ABIs/addresses generated into `packages/contracts-abi` with `@wagmi/cli@2.10` foundry plugin; receipts polled ≥ 120 s (execution lands in the next tipset).
- **Indexing**: Goldsky subgraph (`filecoin`, `filecoin-testnet`) over `StampRegistered`, `StorageBound`, `DerivativeAttached`, `DeviceKey*`, plus PDPVerifier `PiecesRemoved`/`DataSetDeleted` and FWSS `FaultRecord`/`PDPPaymentTerminated` for bound sets; self-hosted Ponder fallback with `ethGetLogsBlockRange: 360` (Lotus ≥ 1.36.3 cap). The verify page never *needs* the indexer: verdicts come from `eth_call` via Multicall3 `0xcA11…CA11`.

### 4.2 `StampResolver` — owned, replaceable, presentation only

```solidity
contract StampResolver is Ownable2Step {
    enum Flag { None, WithdrawnByAuthor, TakedownLegal, Disputed, DeviceRevokedLater }
    mapping(bytes32 stampId => Flag) public flag;
    mapping(bytes32 stampId => bytes) public manifestPieceCid;   // C2PA manifest store (.c2pa) piece
    mapping(bytes32 stampId => bytes) public recordPieceCid;     // evidence bundle piece (v1)
    event FlagSet(bytes32 indexed stampId, Flag flag, string reasonUri);
    event ManifestSet(bytes32 indexed stampId, bytes pieceCid);
}
```

Flags never delete anything: a withdrawn stamp still resolves (hash, epoch, level) but the original is no longer served by Stamper and the page says so. A new resolver can be deployed and the clients repointed; the registry has no reference to it.

---

## 5. Storage on Filecoin Onchain Cloud

### 5.1 Ownership and payment (MVP: one Stamper payer)

- One Stamper-owned **payer account** (hardware-wallet-held key, funded with USDFC via `synapse.payments` / `depositWithPermitAndApproveOperator`; FWSS approved as operator). It signs nothing in the hot path.
- One **session key** (secp256k1, generated on the worker host, held in a Docker secret) authorised on `SessionKeyRegistry` (`0x74FD5…31aB` / `0x5184…7655`) with `AddPiecesPermission` only, 30-day expiry, rotated by cron: `Synapse.create({ account: payer, sessionKey: fromSecp256k1(...), requiredPermissions: ['AddPieces'] })`. If the worker is compromised, the attacker can add pieces at Stamper's cost, not withdraw funds or terminate service.
- Data sets: the SDK's `copies: 2` default creates/uses one data set per provider (primary on an endorsed provider, secondary pulled SP-to-SP by an approved provider). Stamper pins `providerIds` to two providers chosen after a retrieval-latency test, `withCDN: true` on the primary only (FilBeam egress is paid; the share copy is the hot asset).
- Path to decentralise: v2 lets a user bring a wallet, deposit USDFC, and have the worker upload into *their* data set (`createContext({ dataSetId })`) under a `SessionKeyRegistry` grant, or self-upload from the web app with `synapse-react`; the registry already allows anyone to `bindStorage` a stamp to any FWSS data set, so community replicas are first-class.

### 5.2 Upload call shape

`upload()` (store + commit in one) is used for the MVP with the SDK's automatic piece batching (`pieceBatching` default window; `limiter` mode + `storage.flush()` once volume exceeds a few pieces per minute, to amortise the 0.008 USDFC per `addPieces` call across many 0.003 pieces):

```ts
const res = await synapse.storage.upload(bytes, {
  pieceCid: piece,                                  // precomputed on device, re-verified by worker; SP must match
  copies: 2, providerIds: [PRIMARY, SECONDARY],
  pieceMetadata: { stampId, kind: 'original', sha256: hex },
  callbacks: { onStored, onPiecesAdded, onPiecesConfirmed: (dataSetId, providerId, pieces) => enqueueBind(...) },
})
if (!res.complete) retrySecondary(res.failedAttempts)
```

Alternative considered: the split `store → presignForCommit → commit` pipeline. It is the right tool when the signer is *not* the uploader (e.g. a future client-direct upload where the phone stores bytes to the SP and the worker commits with the session key, or vice versa), and it lets a failed commit be retried without re-upload. Not needed while one worker does both; adopt it in v2 for user-owned data sets.

### 5.3 Retrieval for the verify page

Order: (1) FilBeam `https://{payer}.filbeam.io/{pieceCid}` (SDK builder `createPieceUrlFilBeam`; both `/{cid}` and `/piece/{cid}` forms are probed at integration time, filecoin-storage §1.9); (2) provider `{serviceURL}/piece/{pieceCid}` resolved on chain from the binding's `setId → providerId → ServiceProviderRegistry` (parallel HEAD, first 200 wins); (3) Stamper mirror (staging volume / object store keyed by PieceCID, populated at upload time). **Every path re-hashes** (`Piece.transformStream()` + sha256 while streaming) and compares with the chain before the UI says "original". No public IPFS gateway is in the critical path (they are rate-limited and redirecting).

### 5.4 Data-loss and liveness handling

- PDP is possession, not durability: a provider that lost a piece is detected probabilistically (5 challenges/day; ≈ 78 % within 30 days for 1 % loss). The worker's `pdp-monitor` job polls per Stamper data set every 10 min: `FWSSView.provenThisPeriod`, `provingDeadline`, `PDPVerifier.getNextChallengeEpoch`, `getDataSet().pdpEndEpoch`, plus `FaultRecord` events; it also re-HEADs a random sample of pieces daily. Alerts: proof overdue, fault recorded, retrieval sample failing, USDFC runway < 60 days (`FilecoinPay.getAccountInfoIfSettled` → `fundedUntilEpoch`).
- Three copies in practice: two FOC copies + the Stamper mirror (originals are kept on the staging volume for 30 days, then in a cheap S3-compatible bucket — Hetzner/B2/R2; **not** MinIO, archived 2026-04). Re-replication on fault: the worker re-uploads from the mirror into a fresh data set and binds the new `(setId, pieceId)` (bindings are append-only, so the history shows the move).
- Public per-stamp storage health on the verify page: copies, last proof, next deadline, faults, payment active.

### 5.5 Cost per stamp (from the on-chain price list; re-read `getPriceList()` at integration)

| Item | Photo (4 MB) | Video (100 MB) |
|---|---|---|
| One-time add-pieces, 2 pieces (original + share) × 2 copies at 0.003 + batch share of 0.008 | ≈ 0.014 USDFC | ≈ 0.014 USDFC |
| Storage, 2 copies, 2.5 USDFC/TiB/month | ≈ 0.00002 USDFC/month | ≈ 0.0005 USDFC/month |
| Data-set proving fee (0.12 USDFC/month × 2 sets) amortised over 10k stamps/month | ≈ 0.00002 | same |
| Gas: register + attach + bind (3 txs) | ≈ $0.0001 | same |
| CDN egress (FilBeam up to 14 USDFC/TiB cache miss) for 1,000 views of the share copy | ≈ 0.05 USDFC | — (previews served from Stamper) |
| **Total first year** | **≈ $0.02** | **≈ $0.03 + egress** |

Cost is dominated by the per-piece fee, not by bytes; abuse control, not Filecoin, sets the free-tier limits.

---

## 6. Marking pipeline

### 6.1 Visible badge + code + QR

Rendered **server-side** with `sharp@0.35.5` (`composite()` with an SVG pill and text; fonts baked into the image: JetBrains Mono Bold, slashed zero, tabular figures) so the share copy is deterministic and reproducible from the original + mark spec. On device, the same badge is drawn with `@shopify/react-native-skia@2.13` on an offscreen surface *only for the instant preview* while the server copy is being produced (the preview is never shared; the share sheet waits for the canonical bytes, usually < 10 s).

Geometry (all relative to the short side `S` of the output; survives 1080 px platform downscales and 4:2:0 chroma): pill height `0.05·S`, corner radius `h/2`, fill `rgba(0,0,0,0.62)`, margin `0.03·S`, bottom-right; for portrait outputs the pill is inset so it stays inside the central 4:5 crop. Content: a 12-px-equivalent Stamper glyph + `K3Q9-XA2M-7` in white (cap height ≥ 0.016·S ⇒ ≥ 17 px at 1080) + the text `stamper.app` at 60 % opacity. **No QR in the default badge**: a scannable QR needs ≥ 4 px/module after downscale, i.e. ≈ 12 % of the short side (watermarking §1.3), which is a poster, not a badge. The QR lives in (a) the in-app share card (`share-card.png`, 1080×1350, large QR, code, "verify at stamper.app"), (b) the verify page, and (c) an optional "poster" badge variant (`?badge=qr`) that users can pick for prints. No checkmarks, no colour that reads as "verified"; the badge survives greyscale (WCAG 1.4.3/1.4.11).

### 6.2 Invisible watermark

- Images: **Adobe TrustMark, variant Q, schema `BCH_SUPER` (40 data bits, corrects 8 bit flips, false-accept ≈ 2e-6), strength 1.0**, payload = the 40-bit code. Runs in `services/ml` (`trustmark==0.9.2`, MIT, CPU torch; ≈ 0.1–0.3 s per 12 MP image). Decode on verify: server (`decode(img, MODE='binary')`), browser decoder (Adobe's `tm_watermark.js` + `onnxruntime-web@1.30`) in v1. The watermark is a *lookup key*, never a verdict (removable and forgeable with public tools, watermarking §5); a decoded code must be confirmed by PDQ ≤ 40 against that stamp's renditions.
- Video: **none in the MVP** (visible badge + vPDQ only). v1 adds Meta **PixelSeal/Video Seal** (256-bit payload = 4 × `[ver:8‖code:40‖crc:16]`, majority-vote) on a GPU worker (T4/L4 class; ≈ 25 s per minute of 1080p); the Python sidecar is the only place this can run.
- Alternatives rejected: DWT-DCT libraries (fail on resize), on-device TrustMark encode (no mobile export yet; defer).

### 6.3 C2PA manifest

Embedded with `@contentauth/c2pa-node@0.9.9` (Node ≥ 22) in **both** the original (sidecar `.c2pa`, so the stored original bytes stay untouched — the manifest for the original is kept as a separate file/piece) and the share copy (embedded JUMBF):

- Original manifest: `c2pa.actions.v2` → `c2pa.created`, `digitalSourceType = http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture`; custom assertion `computer.paradox.stamper.anchor` `{ stampId, code, contentHash, pieceCid, registry:{chainId, address, txHash, epoch}, deviceLevel, attestation:{kind, bundleHash} }`.
- Share-copy manifest: ingredient `parentOf` = original; actions `c2pa.opened`, `c2pa.watermarked.unbound` (badge), `c2pa.watermarked.bound` + `c2pa.soft-binding {alg:"com.adobe.trustmark.Q", blocks:[{scope:{}, value:"<schema>*<bits>"}]}`; `c2pa.soft-binding {alg:"io.iscc.v0"}` (v1); thumbnail; same anchor assertion plus `derivedHash`.
- After the stamp is "safe" (≥ 30 epochs) an **update manifest** adds `c2pa.repository-receipt` with `repository.uri = https://stamper.app/c2pa/manifests/{stampId}` and `anchor.proof = {chainId, txHash, epoch}`; Stamper serves manifest stores as `application/c2pa` and implements the Soft Binding Resolution API routes `/matches/byBinding`, `/matches/byContent`, `/manifests/{id}` (v1) — i.e. Stamper *is* a C2PA Manifest Repository backed by Filecoin.
- Signing: MVP uses a Stamper self-issued ES256 certificate (shows "unknown source" in Adobe Verify — stated on our page); apply to the C2PA Conformance Program at Level 1 immediately (SSL.com free tier: 1 L1 cert/yr + 2,500 timestamps) so v1 reads "Valid/Trusted" in third-party validators. Keys in a `CallbackSigner` backed by the host KMS (v1), never in the container image.

### 6.4 Perceptual hashes

Computed by the worker via the sidecar for every rendition Stamper distributes (original, share, preview, thumb — the badge alone moves PDQ by ≈ 26 ± 12 bits at 10 % height, perceptual-hashing §2.2, so the share copy must be indexed under the same stamp): PDQ 256-bit + quality (discard < 50), ISCC-CODE, SSIM maps on demand. Video: 1 fps + first/last + scene-change frames → PDQ per frame (consecutive duplicates ≤ 8 bits dropped), ISCC Video-Code. Indexed in Postgres with `pgvector 0.8.6` HNSW `bit_hamming_ops`.

### 6.5 Where each step runs and why

| Step | Device | Server | Reason |
|---|---|---|---|
| Capture, sha256, PieceCID, claim signing, attestation | ✔ | re-check | Only step that must happen before bytes leave the phone; `synapse-core/piece` is pure JS (works on Hermes); sha256 via `@noble/hashes` (photo) or `react-native-quick-crypto` streaming (video) |
| Visible badge | preview only | ✔ canonical | Determinism (`derivedHash` on chain), fonts, `expo-image-manipulator` cannot composite |
| TrustMark / Video Seal | — | ✔ | Python/torch only; GPU for video |
| C2PA signing | — | ✔ | No RN binding; keeps the claim-signing cert off phones (Buchanan) |
| PDQ / vPDQ / ISCC | — | ✔ | Device-reported perceptual hashes are unverifiable; one implementation for index + query |
| FOC upload | — | ✔ | Synapse SDK has no React Native support; the payer/session key stays server-side |

### 6.6 Video handling (MVP)

`expo-camera` `recordAsync({ maxDuration: 300, codec: 'avc1' })` → MP4/MOV ≤ 1 GB (iOS `hvc1` is transcoded to H.264 for the share copy; the original stays as recorded). Worker: `ffprobe` → `ffmpeg -i in.mp4 -i badge.png -filter_complex "[1:v]scale=-1:'ceil(min(W,H)*0.05)'[b];[0:v][b]overlay=x=W-w-round(min(W,H)*0.03):y=H-h-round(min(W,H)*0.03)" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart -c:a copy share.mp4` (badge is a pre-rendered PNG, so `drawtext`/freetype is not required; the container ships a static ffmpeg 7 build — the host's 4.4 is fine for dev). C2PA manifest via c2pa-node (MP4/MOV supported; no WebM). Originals > 1,065,353,216 bytes are split into ≤ 1 GB chunks, each a piece with `kind: chunk, index`, listed in the capture record; the claim's `contentHash` covers the whole file and `pieceCid` is empty (first `bindStorage` fixes the chunk-0 PieceCID; the chunk list is in `metaHash`) — rare in practice at 5-minute clips.

---

## 7. Capture and keys

### 7.1 Key generation and storage (MVP: secp256k1 app key, hardware-bound in v1)

- Mobile: at first launch, `viem/accounts` `generatePrivateKey()` → stored in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `configureAndroidBackup: false`, `requireAuthentication` optional); never leaves the device; one key per account per device; rotated yearly or on reinstall (new enrolment references the old `keyId`, signed by the old key if it still exists).
- Web (L0): `generatePrivateKey()` in the browser, kept in IndexedDB (optionally wrapped with a passkey PRF-derived AES key where supported); registered to the account inside a passkey-authenticated session.
- v1 (L2): iOS App Attest key *is* the signer (`keyType 2`; `generateAssertionAsync(keyId, digestBytes)` — the Expo module's hashing of the input is checked in source during the week-1 spike); Android: a ~150-line local Expo module adds `signWithAttestedKey(alias, bytes)` on a Keystore key created with `setAttestationChallenge` + StrongBox when available (`keyType 1`). DER → raw `r‖s` conversion on device.

### 7.2 iOS flow (L1 in MVP)

1. Enrol: `GET /v1/attest/challenge` → `generateKeyAsync()` → `attestKeyAsync(keyId, sha256(appKeyAddress ‖ challenge))` → `POST /v1/devices/ios {attestation, keyId, appKeyAddress, challengeId}`. Server (`node-app-attest@1.0.1`, extended for `apple_validation_category_01` / `apple_bundle_version_01`): x5c chain to the Apple App Attestation Root CA, nonce, keyId, rpIdHash, counter 0, production AAGUID, category 4 (App Store) / 2 (TestFlight, non-prod). Store the bundle, compute `attestationHash`, call `registerDeviceKey(keyId=bytes32(appKeyAddress), {keyType 0, platform 1, level 1, …})`.
2. Per capture: `generateAssertionAsync(keyId, claimDigest ‖ challenge)` is sent alongside the secp256k1 signature; the server checks the assertion (counter strictly increasing, rpIdHash) before relaying. The assertion is kept in the capture record (`attestation.bundleHash`), so the chain carries proof that an App-Attest-vouched app produced the claim, even though the chain itself only verifies the secp256k1 signature in the MVP.

### 7.3 Android flow (L1 in MVP)

1. App start: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)`.
2. Enrol: `generateHardwareAttestedKeyAsync('stamper-capture-v1', challenge)` + `getAttestationCertificateChainAsync` (stored for L2 later) + `requestIntegrityCheckAsync(base64url(sha256(appKeyAddress ‖ challenge)))` → `POST /v1/devices/android`. Server decodes via `playintegrity.googleapis.com/v1/{pkg}:decodeIntegrityToken` (service account; quota 10k/day, raise early), requires `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`, fresh `timestampMillis`; registers level 1.
3. Per capture: standard token with `requestHash = base64url(sha256(claimDigest ‖ challenge))`; decoded before relaying; verdict stored in the capture record.
4. Devices without Play services: enrol with the Key Attestation chain only (JVM verifier service around `android/keyattestation`, v1); until then they get L0 with the label "Google-free device".

### 7.4 Web flow (L0)

Passkey (WebAuthn L3, `residentKey: preferred`) or magic link → browser key → `getUserMedia` capture (or plain upload, treated identically) → hash in a Web Worker (`hash-wasm@4.12` sha256 + `synapse-core/piece`) → `signTypedData` → resumable upload. Label: "Uploaded through Stamper web; device not attested".

### 7.5 What the server verifies before relaying (all paths)

Re-computed `sha256` and `PieceCID` of the staged bytes equal the claim (any mismatch ⇒ reject: bug or hostile client); `size`; EIP-712 signature against the enrolled key; nonce unused, deadline in the future; attestation evidence bound to `claimDigest ‖ challenge` and fresh (challenge single-use, 5-min TTL); `capturedAt` within ±10 min of `receivedAt` (else flagged, not rejected); media decodes and matches `mediaKind`; capture record hashes to `metaHash`. For video the device signs `contentHash` + empty `pieceCid` (Hermes PieceCID speed for 500 MB files is an open spike); the worker computes the PieceCID and the first `bindStorage` fixes it on chain — honest because any verifier re-hashes the piece to the device-signed `sha256`.

### 7.6 Offline capture

The claim is signed and the capture record built offline (nonce from a local counter; `deadline = now + 7 days`; challenge = the last unexpired one or a locally generated placeholder flagged `offline: true`). Media and claims queue in `react-native-mmkv` (encrypted) and upload when online (`expo-background-task` retries ≥ 15 min). Attestation tokens are requested at upload time (they prove app/device integrity *then*, not at capture — the verify page shows "captured offline, attested on upload"). The chain anchor is the upload time; the device `capturedAt` is shown as a claim.

---

## 8. Verification flows

### 8.1 Decision procedure (by uploaded copy; code/QR enter at step 2)

```
0. normalise: sniff type; images decoded once (sharp, EXIF-rotate); video → ffprobe, 1 fps frames
1. EXACT     sha256(copy) ∈ renditions(original|share|preview|thumb) → "Identical to <rendition> of stamp K3Q9-XA2M-7"
             also recompute PieceCID; a PieceCID hit without a sha256 hit is a bug → alert
2. CODE      code typed/scanned/OCR'd → that single stamp in confirmation mode (PDQ ≤ 40 vs any rendition)
3. WATERMARK TrustMark decode → 40-bit code (BCH_SUPER valid) → confirmation mode as in 2
4. PERCEPT   PDQ (quality ≥ 50) + 8 dihedral + centre-90/80 crops → pgvector k-NN (k=20) → keep ≤ 31 bits
             video: per-frame → candidate stamps → vPDQ match % (Pc ≥ 80 %) → rank
             re-rank by SSIM against candidates' originals; ties within 5 bits are all shown (bursts)
5. NONE      "No registered original found" — never "fake"
```

Verdict ladder (words, icon shape, never colour alone): **IDENTICAL** (byte-exact; links the rendition and the chain record) → **SAME PICTURE, RE-ENCODED** (code/watermark identified *and* PDQ ≤ 15, or PDQ ≤ 15 alone with SSIM ≥ 0.9) → **RELATED, ALTERED** (code/watermark identified but PDQ 16–40, or PDQ 16–31 without id; diff heat-map shown) → **NOT REGISTERED**. Only IDENTICAL may say "original"; everything else says "compare for yourself".

### 8.2 What the verify page shows (progressive disclosure, C2PA L1–L4 style)

1. **Header**: match outcome + capture tier sentence ("Captured in the Stamper app on an attested device" / "Uploaded via web") + the always-on footer "Stamper shows when this file was registered and whether your copy matches the registered original. It does not judge whether what the picture shows is true."
2. **Compare**: original (streamed from FOC, re-hashed, "✓ hash matches chain" or "fetching…") beside the share copy or the viewer's upload; `react-compare-slider@4` slider; `pixelmatch@7` diff overlay after resizing the copy to the original's size; SSIM score; for video, side-by-side players with matched time ranges.
3. **Record**: code, stamp id, sha256, PieceCID (copyable), size, `capturedAt` (device) vs `registeredEpoch` (chain time) vs `receivedAt` (Stamper), device level with "what this means / does not mean", key id and registration date, revocation date if any.
4. **Chain proof**: tx hash, epoch, inclusion state (`included` → `safe` ≥ 30 epochs → `final` when the node's `finalized` tag passes it; mainnet F3 has not produced certificates since 2026-03-09, so "final" is FRC-0089 EC finality ≈ 20–30 epochs unless F3 resumes), Blockscout/Filfox links, the signed claim and signature (re-verified in the browser with `verifyTypedData`).
5. **Storage proof**: per binding — provider, data set id, `dataSetLive`, piece present (`findPieceIdsByCid`), `provenThisPeriod`, next deadline, faults, payment active, retrieval URL that was used; PDP explorer link (`pdp.filecoin.cloud`).
6. **Credentials**: C2PA manifest validation (`@contentauth/c2pa-web@0.15.3` in-browser; states Valid / Trusted / unknown source), ingredient tree original → share copy.
7. **Evidence**: download JSON bundle (claim, sig, tx, epoch, PieceCIDs, bindings, attestation hash, manifest, mark spec) and, in v1, `.ots` and RFC 3161 token.

Failure states (each a designed screen, not an error toast): *Pending* ("stamped 40 s ago; chain inclusion expected within 2 minutes; the code is reserved"); *Original temporarily unavailable* (all retrieval paths failed; hash-only verification still offered: "drop your copy and we compare hashes"); *Withdrawn / takedown* (record shown, original not served, reason URI); *Device revoked after this stamp* (date shown; stamp remains valid); *Several candidates* (burst case; thumbnails, pick one); *Mismatch* (diff map; "this copy differs from the stamped original in the highlighted areas"); *Invalid code* (check symbol failed; "re-type, or scan the QR"); *Not registered*.

### 8.3 Independent verification without Stamper

`packages/verify-cli` (`npx stamper-verify K3Q9-XA2M-7 --rpc https://api.node.glif.io/rpc/v1 [--copy ./file.jpg]`): decodes the code → `stampByCode`/`stamps`/`bindings`/`keys` via `eth_call` → resolves the provider `serviceURL` from `ServiceProviderRegistry` (`@filoz/synapse-core/sp-registry`) → `GET /piece/{PieceCID}` → recomputes PieceCID + sha256 → re-verifies the EIP-712 signature from the `StampRegistered` event → prints a report. Needs only an RPC URL and the public FOC endpoints; no Stamper server. The same code runs in the browser page, and its hash is published on chain in the resolver so mirrors can be checked.

---

## 9. Apps and services

### 9.1 Monorepo (extends the initialised layout: `packages/*`, `apps/*`, `services/*`)

```
packages/core            @stamper/core (exists): identifiers (sha256, PieceCID via synapse-core/piece), code encode/decode, EIP-712 types, claim hashing, CBOR capture record; zero Node built-ins (Hermes + browser + Node)
packages/contracts-abi   @wagmi/cli foundry plugin output (StampRegistry/StampResolver ABIs + addresses per chain)
packages/verify-cli      independent verifier (also bundled into apps/web)
contracts/               Foundry (forge-std 1.17 present; add openzeppelin-contracts 5.6.1), tests incl. Calibration fork tests
apps/mobile              Expo SDK 57 (expo 57.0.26, RN 0.86.3, expo-router 57, expo-camera 57.0.6, expo-file-system 57.0.7, expo-secure-store, @expo/app-integrity 57.0.2 behind a DeviceAttestation interface, react-native-quick-crypto 1.1.7, react-native-get-random-values 2, react-native-mmkv 4.3, @shopify/react-native-skia 2.13, viem 2.57, @tanstack/react-query 5, zod 4) — development builds + EAS (not Expo Go)
apps/web                 Next.js 16.3.8, React 19.2, viem 2.57 (+ wagmi 3.7 only on the publisher/admin pages), barcode-detector 3.2 (QR), react-compare-slider 4, pixelmatch 7, ssim.js 3.5 (worker), @contentauth/c2pa-web 0.15.3, hash-wasm 4.12
services/api             Hono 4.13 + @hono/node-server 2.1, drizzle-orm 0.45 + pg 8.23, zod 4, pino 10, node-app-attest 1.0.1, googleapis 182
services/worker          BullMQ 6.3 (createPostgresBackend), @filoz/synapse-sdk 2.0.2, viem relayer, sharp 0.35.5, @contentauth/c2pa-node 0.9.9, ffmpeg 7 (static), pdp-monitor
services/ml              FastAPI 0.142 + uvicorn (Python 3.12 image): trustmark 0.9.2, pdqhash 0.2.8, vpdq 0.2.5 (or ffmpeg→pdqhash loop), iscc-sdk 0.9.5, scikit-image 0.26 (SSIM); stateless: POST /watermark/encode, /watermark/decode, /pdq, /vpdq, /iscc, /ssim with paths on the shared volume
tooling/                 docker-compose.yml, Caddyfile, .maestro/, GitHub Actions
```

Tooling note: `packages/core` currently pins `typescript ^7.0.2`; TS 7 ships no programmatic API until 7.1, which breaks `jest-expo`/typescript-eslint and the Expo template pins `~6.0.3` — pin **`typescript ~6.0.3`** workspace-wide (keep `@typescript/native-preview` for `turbo typecheck` speed). Node: host 22 is fine for dev; containers use `node:24-bookworm` (c2pa-node needs ≥ 22, sharp ≥ 20.9). Python: host 3.10 is irrelevant; the sidecar image is 3.12 (numpy 2.5 / onnxruntime 1.30 constraints).

### 9.2 API surface (`services/api`)

```
POST /v1/auth/passkey/{options,verify}      POST /v1/auth/magic-link
GET  /v1/attest/challenge                   → {challengeId, challenge(32B b64), expiresAt}
POST /v1/devices/{ios,android,web}          → {keyId, level, txHash}
POST /v1/captures                           → {captureId, uploadId, challengeId, challenge}
PUT  /v1/uploads/{uploadId}                 Content-Range resumable binary; 409 on range gaps; 201 when complete
POST /v1/captures/{id}/claim                {claim, sig, attestation, record} → 202 {code, stampId, status}
GET  /v1/stamps/{code}                      presentation record (status, renditions, txs, bindings, flags, manifest, level)
GET  /v1/stamps/{code}/share.jpg|share.mp4|share-card.png|preview.jpg|thumb.webp
GET  /v1/stamps/{code}/original             302 → FilBeam/provider URL (or streamed proxy with hash check when direct fails)
GET  /v1/stamps/{code}/evidence.json        evidence bundle
POST /v1/verify/upload                      multipart → verdict ladder + candidates
POST /v1/stamps/{code}/withdraw             owner (session) → resolver flag + stop-serve
GET  /c2pa/manifests/{stampId}              application/c2pa ; POST /c2pa/matches/byBinding (v1)
GET  /.well-known/apple-app-site-association  GET /.well-known/assetlinks.json   GET /v/{code} (web)
```

### 9.3 Database (Postgres 17 + pgvector 0.8.6; drizzle migrations)

```sql
create table users    (id uuid primary key, handle text unique, tier text default 'free', created_at timestamptz default now());
create table device_keys (
  key_id bytea primary key, user_id uuid references users, platform text check (platform in ('ios','android','web')),
  key_type smallint, level smallint, addr bytea, pub_x bytea, pub_y bytea,
  attestation jsonb, attestation_hash bytea, attest_key_id text, assertion_counter bigint default 0,
  registered_tx bytea, registered_epoch bigint, revoked_at timestamptz, expires_at timestamptz);
create table stamps (
  stamp_id bytea primary key, code bigint unique check (code % 37 < 32), user_id uuid, key_id bytea references device_keys,
  media_kind smallint, mime text, size bigint, width int, height int, duration_ms int,
  content_sha256 bytea unique, piece_cid bytea, derived_sha256 bytea unique, derived_piece_cid bytea, mark_spec_hash bytea,
  captured_at timestamptz, received_at timestamptz default now(), registered_epoch bigint, status text,   -- pending|included|safe|final
  claim jsonb, sig bytea, record_cbor bytea, private_record_enc bytea, level smallint, flag smallint default 0);
create table renditions (id bigserial primary key, stamp_id bytea references stamps, kind text, sha256 bytea unique, piece_cid bytea,
  path text, pdq bit(256), pdq_quality int, iscc text);
create index on renditions using hnsw (pdq bit_hamming_ops);
create table video_frames (stamp_id bytea, t_ms int, pdq bit(256), quality int); create index on video_frames using hnsw (pdq bit_hamming_ops);
create table bindings (stamp_id bytea, asset smallint, data_set_id bigint, piece_id bigint, provider_id bigint, retrieval_url text,
  bound_tx bytea, confirmed_at timestamptz, removed_at timestamptz);
create table chain_txs (hash bytea primary key, kind text, stamp_id bytea, nonce bigint, submitted_at timestamptz, included_epoch bigint,
  safe_at timestamptz, final_at timestamptz, status text, error text);
create table data_sets (data_set_id bigint primary key, provider_id bigint, role text, with_cdn bool, last_proven_epoch bigint,
  proving_deadline bigint, faults int default 0, payment_end_epoch bigint, checked_at timestamptz);
create table verifications (id bigserial, stamp_id bytea, method text, distance int, verdict text, ip_hash bytea, at timestamptz default now());
create table moderation (stamp_id bytea primary key, hash_match text, classifier jsonb, decision text, decided_by text, decided_at timestamptz);
```

### 9.4 Queues (BullMQ 6, Postgres backend — no Redis)

`ingest` (re-hash, verify, moderation pre-checks) → `register` (relayer: `registerStamp`; nonce manager; receipt poll 180 s; re-check 2 epochs for reorgs) → `mark` (badge, TrustMark, C2PA, renditions, PDQ) → `store` (Synapse upload original + share; `onPiecesConfirmed` → `bind`) → `bind` (`attachDerivative` + `bindStorage`) → `index` (pgvector rows, ISCC). Repeat jobs: `finality-tracker` (every 30 s: `eth_getBlockByNumber("finalized")`, promote pending→included→safe→final), `pdp-monitor` (10 min), `runway` (hourly: FilecoinPay account, relayer FIL), `session-key-rotate` (daily), `mirror-gc` (daily). Dead-letter alerts via a webhook (ntfy/Slack).

### 9.5 Deployment (one Linux VPS, Docker Compose)

```yaml
services:
  caddy:    { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy:/data] }   # stamper.app, api.stamper.app, HSTS preload
  web:      { build: ./apps/web, env_file: .env }                                                                      # next start (standalone)
  api:      { build: ./services/api, env_file: .env, volumes: [staging:/srv/staging], secrets: [app_attest_key, play_sa] }
  worker:   { build: ./services/worker, env_file: .env, volumes: [staging:/srv/staging], secrets: [relayer_pk, session_pk, c2pa_key], deploy: { replicas: 2 } }
  ml:       { build: ./services/ml, volumes: [staging:/srv/staging, models:/root/.cache], deploy: { resources: { limits: { cpus: "4" } } } }
  postgres: { image: pgvector/pgvector:pg17, volumes: [pg:/var/lib/postgresql/data] }
  backup:   { image: offen/docker-volume-backup, volumes: [pg:/backup/pg:ro, staging:/backup/staging:ro] }               # nightly to S3-compatible bucket
volumes: { staging: {}, pg: {}, caddy: {}, models: {} }
```

Sizing for MVP: 8 vCPU / 32 GB (TrustMark on CPU ≈ 0.3 s/image; ffmpeg 1080p ≈ 1–3× realtime). Mobile builds/updates on EAS (free tier → Starter $19). CI: GitHub Actions `turbo run lint typecheck test` + `forge test` + a Calibration fork job; deploy = image build + `docker compose pull && up -d` over SSH. Observability: pino → Loki or plain files; Prometheus-style `/metrics` from api/worker (queue depth, tx latency, PDP status, runway); public `/status` page.

---

## 10. Threat-model coverage

| # (threat-model §6) | Threat | Mitigation in this design | Residual (disclosed) |
|---|---|---|---|
| 1 | Analog hole (screen/print recapture) | In-app live capture only; capture record flags single-shot; v2 depth/Live-Photo evidence as a *signal* | "Cannot tell a real scene from a photographed screen or print" |
| 2 | Root/exploit + confused-deputy signing | Attestation bound to the claim digest + challenge per capture; on-chain key registry with `revokedAt` epochs; per-key nonces; anomaly scoring (bursts, impossible cadence); L2 requires STRONG + CRL re-check per capture | "A compromised phone can sign anything until revoked" |
| 3 | Camera injection (virtual cameras, HAL hooks) | `expo-camera` in-app pipeline only (no `ACTION_IMAGE_CAPTURE`, no picker), physical camera ids recorded in the record, `appAccessRiskVerdict` (Android) in L2 | same as #2 |
| 4 | Fake/transplanted badge | Badge is a pointer with a check symbol; verify = comparison against the served original with diff; no verdict ever derived from a badge; unmatched = "not registered" | "A mark proves nothing until looked up" |
| 5 | Filecoin copy loss | 2 FOC copies + Stamper mirror; `pdp-monitor`, FaultRecord alerts, runway alerts; re-replication + append-only re-binding; public storage health | "If every copy vanishes, only a bit-exact holder can verify" |
| 6 | Relayer censorship/compromise | Device-signed EIP-712 claims verified on chain; relayer is gas-only; self-submit path shipped; nonces + deadlines | "Relayer can delay, not forge" |
| 7 | Perceptual-hash second-preimage/inversion | PDQ for retrieval only; verdict from exact hash or visual comparison; PDQ off chain; quality gate; SSIM re-rank | "Similar-looking is not the same image" |
| 8 | Re-stamping / ordering games | `firstStampOf[contentHash]`; chain epoch + device time + Stamper receipt time shown; near-duplicate warning at stamp time ("looks like K3Q9-… from 2 days earlier") | "Earliest stamp is not necessarily the original creator" |
| 9 | Watermark removal/forgery | Watermark = lookup key; PDQ ≤ 40 confirmation; always compare | — |
| 10 | Time/location spoofing | Three clocks displayed; location opt-in, private by default, "device-reported" label | "Location can be spoofed with a cheap radio" |
| 11 | Deanonymisation | No GPS/serial in public originals; location in the encrypted private record; per-device key rotation; no identity required; no PII on chain; DPIA | "Public originals can identify people and cameras" |
| 12 | Gateway/denylist censorship | Provider `/piece`, FilBeam, mirror; PieceCID exposed for any node; hash-only verification offline | "Original may be unreachable through some gateways" |
| 13 | Reorg before finality | included/safe/final policy from the node's `finalized` tag + ≥ 30-epoch threshold | — |
| 14 | Registry/admin upgrade abuse | `StampRegistry` immutable; registrar role limited and timelocked; FilOz proxies referenced only through PieceCIDs (storage can move) | "FOC contracts are third-party upgradeable" |
| 15 | Phishing verify sites / look-alike codes | One HSTS-preloaded domain, Universal/App Links, in-app scanner, Crockford alphabet + check symbol, UTS #39 ASCII-only, verifier bundle hash on chain | "Only trust the registry" |
| 16 | Coerced stamping | Sealed stamps (v2), withdraw flag, dispute flag | "A stamp does not prove consent" |
| 17 | Multi-device collusion | No aggregation into truth scores; enrolment friction; per-device quotas | "Many stamps ≠ truth" |
| 18 | "Verified" read as "true" | Fixed wording, shape-coded verdicts, neutral colours, residual-risk footer on every page | (this is the disclosure) |

---

## 11. Economics, abuse, privacy, legal

**Who pays.** Stamper pays FOC (one payer) and gas (relayer); ≈ $0.02 per photo first-year all-in (§5.5), ≈ $0.00001 per registration. Free tier: 30 photos + 5 minutes of video per month per *attested* device (L1), 10 photos per L0 web account; 2 copies, public originals, 24-month retention guaranteed (then "best effort" unless Pro). Pro (journalists, $8/month): 1,000 photos/100 min, encrypted-original mode, OpenTimestamps + RFC 3161 tokens, evidence bundle PDF, 10-year retention, API keys. Newsroom: seats, legal hold, custom retention, a dedicated data set under the organisation's own payer (v2).

**Rate limits and abuse.** Token buckets per device key, per account, per IP/ASN on uploads (burst 5, 30/day free) and on `/v1/verify/upload` (10/min/IP); Play Integrity `recentDeviceActivity` and Apple's risk metric feed a device score; `deviceRecall` / DeviceCheck bits mark banned devices across reinstalls; the `/original` endpoint is where egress costs live, so previews are served first and originals on explicit click (and from FilBeam only for the primary set).

**Moderation on immutable storage.** Pre-publication: exact and perceptual duplicate check against Stamper's own flagged set, NSFW/violence classifier for *routing to review* (no auto-block of journalism), industry CSAM hash matching once a vendor agreement exists (flagged as a prerequisite for public launch). Takedown = (1) resolver flag (`TakedownLegal`/`WithdrawnByAuthor`) with a reason URI, (2) stop serving the original and renditions from Stamper and FilBeam, (3) `deletePieces` on Stamper's data sets (schedule removal, 0.007 USDFC) and mirror deletion, (4) Bad Bits report for the PieceCID. The hash and the chain record persist (they are not reversible to content). Because any third party could have bound their own copy, the page says "withdrawn by Stamper; copies may exist elsewhere".

**EXIF and location.** The app never requests location unless the user enables "Record location" per capture; camera output therefore carries no GPS; make/model/exposure remain in the public original (shown in the record). If enabled, location goes only into the encrypted private record (hash-committed in `metaHash`); the user can later "reveal location" by publishing the sub-record. The share copy carries only a minimal EXIF (orientation, mime) plus the C2PA manifest.

**Encrypted-original mode (v1).** Per-asset AES-256-GCM key generated on device; ciphertext (plus a 32-byte random salt prepended) is what goes to FOC and is PieceCID-anchored; the claim commits `contentHash = sha256(plaintext)` and `metaHash` includes `sha256(ciphertext)`; the key is wrapped to the device key and to Stamper's KMS. Public assets: Stamper releases the key on the verify page (the browser decrypts and re-hashes to the device-signed plaintext hash); private assets: owner only; "publish forever" writes the key into the resolver (irreversible, with a warning). This also makes erasure tractable (crypto-shredding) and keeps providers from ever holding plaintext — the right default once it exists; MVP ships plaintext originals because the compare-to-original page must work on day one without key plumbing.

**Privacy and law.** Nothing personal on chain (hashes, PieceCIDs, code, key id, level, epochs). DPIA before public launch; GDPR Art. 85 / LGPD Art. 4 II(a) journalistic handling behind a "journalistic use" declaration; erasure = delist + stop-serve + piece removal + key destruction, with Art. 17(3)(a)/(e) exceptions documented; bystander report flow on every verify page. Evidentiary: every stamp exports an evidence bundle (claim, signature, tx, epoch, PieceCIDs, bindings, mark spec, attestation hash, manifest) with an FRE 902(13)/(14) certification template and the open-source verifier; v1 anchors a daily Merkle root of stamp ids to Bitcoin via OpenTimestamps and to an RFC 3161 TSA (qualified EU TSA and ICP-Brasil ACT as paid Pro options) so each stamp inherits an independent timestamp via its Merkle path.

---

## 12. Roadmap

**MVP (weeks 1–6, demoable end to end on mainnet):** iOS + Android Expo development builds (photo capture; video capture allowed, visible badge only); secp256k1 app keys; App Attest / Play Integrity enrolment and per-capture binding → L1; web capture/upload → L0; `StampRegistry` + `StampResolver` on Calibration then mainnet (P-256 paths implemented and fork-tested, unused by clients); relayer; FOC upload of original + share copy (2 copies, session key, piece batching); badge + code; TrustMark Q BCH_SUPER; C2PA manifests with a self-issued cert; PDQ/vPDQ index; verify page by code/QR/upload with side-by-side, diff, chain and storage proofs, failure states; evidence JSON; `stamper-verify` CLI; Docker Compose on one VPS; PDP/runway monitoring; residual-risk wording. **Out of scope**: hardware-key signatures, encrypted originals, video invisible watermark, conformance listing, per-user payment, sealed stamps.

**v1 (weeks 7–14):** L2 (App Attest assertions and Android attested keys as the on-chain signer; JVM Key Attestation verifier; CRL re-checks); encrypted-original mode; Video Seal/PixelSeal GPU worker; C2PA Conformance Program (L1) application + SSL.com cert, repository receipts and the Soft Binding Resolution API; OpenTimestamps + RFC 3161 batch anchoring; Goldsky subgraph + Ponder fallback; browser TrustMark decode; evidence PDF; near-duplicate "ingredient hint" at stamp time; HEIC originals; attestation bundles stored as FOC pieces.

**v2:** user-owned data sets and wallets (session keys, `createContext`, Safe ownership of stamps via EIP-1271); community bindings UI; sealed/commit-now-reveal-later stamps and duress mode (after legal review); SSCD descriptors for crop/screenshot recovery; depth/Live-Photo recapture signals (L3); Android C2PA Level 2; qualified timestamps; multiple registrars (newsroom-run verifiers); Stamper-operated PDP replica or sealed PoRep copies when FOC ships them.

---

## 13. Risks and open questions

1. **Mainnet F3 stall** (no certificate since 2026-03-09, fevm-contracts §1.5): finality UX must stay policy-based; confirm status with FilOz before promising "final in minutes".
2. **P256VERIFY gas on FEVM** is unmeasured; L2 timing depends on it (measure on Calibration in week 1 with a wrapper; precompiles are not top-level `eth_call` targets).
3. **Synapse SDK on React Native** is unsupported; the design avoids it by uploading via the backend, but `synapse-core/piece` on Hermes must be benchmarked (photos fine; 500 MB video PieceCID speed unknown → the empty-`pieceCid` video path).
4. **FilBeam URL path** (`/{cid}` vs `/piece/{cid}`), mainnet quota top-up UX, and the stale "254 MiB / Calibration" statements — settle during integration; Calibration storage is not persistent.
5. **FOC upgradeability and economics**: FWSS/PDPVerifier are beta UUPS proxies; prices changed in 1.3.0 and 1.4.0 — read `getPriceList()` at runtime, watch `UpgradeAnnounced`.
6. **PieceCID v2 encoding is a Draft (FRC-0069)**: pin the exact `Cids.Cid.data` bytes returned by `getPieceCid` with a fork-test vector before freezing `pieceCid` comparisons.
7. **TrustMark**: redistribution terms of the ONNX/PyTorch weights, the exact schema id string for `BCH_SUPER` in `c2pa.soft-binding`, and real-world bit accuracy through WhatsApp/Instagram/X/TikTok — build the platform harness early.
8. **Badge geometry vs PDQ drift**: measure on ~1k photos before freezing the 5 % pill; index every rendition regardless.
9. **`@expo/app-integrity` is alpha**: wrap behind an interface; confirm whether `generateAssertionAsync` hashes raw bytes; App Attest needs App Store/TestFlight builds, Play Integrity needs an internal-track build — dev-device allowlist for local work.
10. **C2PA listing lead time** (1 week–3 months) and HEIC write support in c2pa-rs; until listed, Adobe Verify shows "unknown source".
11. **Legal**: CSAM hash-list access, DMCA/DSA/Marco Civil flows, DPIA, and the primary-text confirmation of the eIDAS/MP 2.200-2/Vermont quotations before they appear in product copy.
12. **Deterministic derivatives**: libvips/mozjpeg output must be bit-stable across image rebuilds — pin image digests and keep the mark-spec version in the record; otherwise `derivedHash` regeneration by third parties fails.
13. **Operational single points**: one VPS, one payer, one relayer — mitigated by backups, self-submit, and community bindings, but a true outage still delays (never destroys) anchoring; Glif/Ankr rate limits are undocumented (budget a dedicated node by v1).
