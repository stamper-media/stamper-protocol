# Stamper — Exact & perceptual hashing, near-duplicate matching, canonical content identifiers

Research date: 2026-09-30 / 2026-10-01. Package versions were read from the npm / PyPI registries on that date; everything else from the primary sources listed at the end. "Verified" = read in a primary source; "Inferred" = my derivation from verified facts; "Measured" = run on this machine (AMD Ryzen 7 PRO 7840U, numpy 2.2.6, single core).

---

## 0. TL;DR — recommended scheme

| Purpose | Identifier | How it is computed | Where it lives |
|---|---|---|---|
| Byte-exact identity, portable to anyone with `sha256sum` | `sha256(file)` (32 bytes) | streaming SHA-256 on device | on-chain record + DB |
| IPFS/Storacha retrieval identity | CIDv1, codec `raw` for files ≤ 1 MiB, `dag-pb` root otherwise, **`unixfs-v1-2025` profile** (sha2-256, 1 MiB chunks, 1024-wide balanced DAG, raw leaves) | `ipfs-unixfs-importer@17.1.1` with `profile: 'unixfs-v1-2025'` (device or server); identical to what `@storacha/upload-client` computes | on-chain record + DB |
| Filecoin storage-proof identity (if using Synapse / Filecoin Onchain Cloud) | PieceCID v2 (`bafkzcib…`, FRC-0069, multihash 0x1011) | `@filoz/synapse-core/piece` `calculate()` / `hasher()` (streaming), or the `fr32-sha2-256-trunc254-padded-binary-tree-multihash` WASM hasher | on-chain record (what PDP proves) |
| Standards-based similarity-preserving identifier | ISCC-CODE (ISO 24138:2024) — Content-Code Image/Video + Data-Code + Instance-Code (BLAKE3) | `iscc-sdk` 0.9.5 (Python, server) or `@iscc/lib` 0.6.0 (Node NAPI) / `@iscc/wasm` 0.6.0 | DB; optionally in the on-chain metadata; it is the only *fingerprint* algorithm registered in the C2PA soft-binding list (`io.iscc.v0`) |
| Near-duplicate matching, images | **PDQ** (Meta, 256-bit + quality 0–100) | server-side, one implementation only (`pdq-wasm` 0.3.9 in Node with `sharp`, or `pdqhash` 0.2.8 in Python) on **both** the original and every rendition Stamper distributes (the badged copy!) | Postgres `bit(256)` + pgvector `bit_hamming_ops` HNSW |
| Near-duplicate matching, video | **vPDQ** (per-frame PDQ at 1 fps + quality + timestamp, consecutive duplicates dropped) | server-side, `vpdq` 0.2.5 (C++/ffmpeg) or your own ffmpeg→PDQ loop | frames table (`stamp_id, t, pdq bit(256), quality`) in the same index |
| Diff / explanation to the viewer | SSIM map | `@blazediff/ssim` 1.7.1 (Node) or `skimage.metrics.structural_similarity(full=True)` (Python 0.26) | computed on demand for top-K candidates |
| Upgrade path for crops / screenshots / heavy edits | SSCD descriptors (512-d, MIT) | PyTorch TorchScript model server-side | pgvector `halfvec(512)` or FAISS |

Decision procedure (section 5): exact match (sha256 / CID) ⇒ "byte-identical"; invisible watermark decode ⇒ stamp id ⇒ fetch original ⇒ verify + diff; else PDQ Hamming ≤ 31 (plus dihedral variants) ⇒ ranked **candidates** re-scored with SSIM ⇒ "looks like stamp #X — not proof". Perceptual matches are never a proof of authenticity; only the exact hash (and, with caveats, the watermark payload) is.

---

## 1. Exact identity

### 1.1 SHA-256 vs BLAKE3 vs CID

* Both identifiers the Filecoin side will report are SHA-256-based: IPFS CIDs under every profile use `sha2-256`; PieceCID (CommP) is a SHA-256 binary tree over fr32-padded data (FRC-0069: multihash `fr32-sha256-trunc254-padbintree`, code 0x1011). **Verified.** So SHA-256 is the mandatory primitive; BLAKE3 is optional and buys nothing for on-chain verifiability.
* BLAKE3 becomes relevant only if you adopt ISCC: the ISCC Instance-Code is the BLAKE3 digest of the file (`iscc_core/code_instance.py` imports `from blake3 import blake3`). **Verified.** If you emit an ISCC-CODE you get a BLAKE3 identity "for free" inside it.
* Speed: `hash-wasm` 4.12.0 benchmarks SHA-256 at ~426 MB/s on 1 MB inputs (vs 110 MB/s for noble-hashes); BLAKE3 is in the library but not benchmarked in the README. **Verified.** On-device hashing of a 1 GB video is therefore seconds, not minutes, when a WASM or native implementation is available.
* Practical recommendation: record **both** `sha256(file)` and the CID. For files ≤ 1 MiB the raw CID *is* `sha256(file)` wrapped in a CID (`bafkrei…`), but for anything larger the CID's digest is the hash of a dag-pb root node, which nobody can check with `sha256sum`. A plain 32-byte SHA-256 next to the CID lets non-IPFS verifiers (journalists, courts) check byte-for-byte with standard tools. **Inferred** from the profile rules below.

### 1.2 Computing the same CID on device that Storacha reports — the chunking defaults

IPIP-0499 "UnixFS CID Profiles" (merged; spec dated 2026-03-05; announcement 2026-03-09) defines two profiles. **Verified** (specs.ipfs.tech):

| Parameter | `unixfs-v1-2025` | `unixfs-v0-2015` (legacy Kubo) |
|---|---|---|
| CID version | 1 | 0 |
| Hash | sha2-256 | sha2-256 |
| Max chunk | **1 MiB** | 256 KiB |
| Layout | balanced | balanced |
| DAG width (links/node) | **1024** | 174 |
| Leaves | **raw** | dag-pb |
| HAMT threshold | 256 KiB (block-bytes) | 256 KiB (links-bytes) |

Implementations: Kubo 0.40 (released 2026-02-25 per GitHub API — the `ipfs config profile apply unixfs-v1-2025` profile; `Import.*` settings), Boxo 0.37, Helia/unixfs 7.0.3, ipfs-unixfs-importer ≥ 16.1.1. **Verified** (IPFS Foundation post, Kubo release notes). Kubo's *default* for `ipfs add` is still the legacy CIDv0 behaviour unless the profile is applied — so never compare against a vanilla `ipfs add` CID. **Verified** (release notes do not change the default).

What Storacha actually does (`packages/upload-client/src/unixfs.js`, read from `main`). **Verified**:

```js
const defaultSettings = UnixFS.configure({
  fileChunkEncoder: raw,
  smallFileEncoder: raw,
  chunker: withMaxChunkSize(1024 * 1024),
  fileLayout: withWidth(1024),
})
const SHARD_THRESHOLD = 1000 // shard directory after > 1,000 items
```

`@ipld/unixfs` (3.0.0) defaults are `hasher: sha256`, `linker: { createLink: CID.createV1 }`, `fileLayout: Balanced.withWidth(174)`, dag-pb leaves — Storacha overrides chunk size, width and leaf encoding. **Verified** (`src/file.js`). Net effect: for a *single file*, Storacha's parameters are exactly the `unixfs-v1-2025` profile (CIDv1, sha2-256, 1 MiB fixed chunks, balanced width 1024, raw leaves, single-chunk files collapse to a raw CID). The directory sharding rule differs (Storacha shards at > 1000 entries by count; the profile uses a 256 KiB block-bytes estimate), so **register the file CID, not a wrapping-directory CID**, if you want third-party reproducibility. **Inferred.**

`ipfs-unixfs-importer` 17.1.1 (2026-09-07) has an explicit profile switch (`src/index.ts`). **Verified**:

```ts
} else if (options.profile === 'unixfs-v1-2025') {
  options.shardSplitStrategy = options.shardSplitStrategy ?? 'block-bytes'
  options.cidVersion = options.cidVersion ?? 1
  options.rawLeaves = options.rawLeaves ?? true
  chunkSize = DEFAULT_CHUNK_SIZE_1MIB      // 1_048_576
  maxChildrenPerNode = 1_024
  options.fieldOrder = 'links-first'
}
```
Its no-profile defaults are `DEFAULT_CID_VERSION = 1`, `DEFAULT_RAW_LEAVES = true`, `DEFAULT_REDUCE_SINGLE_LEAF_TO_SELF = true`, but note that *without* `profile` the chunk size / width variables are left undefined by that branch — always pass `profile: 'unixfs-v1-2025'` explicitly. **Verified** (constants.ts + index.ts).

Device-side CID computation sketch (browser or RN; the importer only needs a `Blockstore.put`, so use a no-op store to avoid buffering a 1 GB video):

```ts
import { importer } from 'ipfs-unixfs-importer'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import { balanced } from 'ipfs-unixfs-importer/layout'

const nullStore = { put: async (cid, _bytes) => cid, get: async () => { throw new Error('n/a') }, has: async () => false } as any
let root
for await (const entry of importer([{ content: fileStream }], nullStore, {
  profile: 'unixfs-v1-2025',            // CIDv1 + sha2-256 + raw leaves + 1 MiB + width 1024
  chunker: fixedSize({ chunkSize: 1_048_576 }),
  layout: balanced({ maxChildrenPerNode: 1024 }),
})) root = entry.cid
// root.toString() -> 'bafkrei…' (≤ 1 MiB) or 'bafybei…' (dag-pb root)
```
For a ≤ 1 MiB file you can skip the importer entirely: `CID.create(1, raw.code, await sha256.digest(bytes))` with `multiformats` 14.0.5 (`multiformats/cid`, `multiformats/hashes/sha2`, `multiformats/codecs/raw`; `toString()` defaults to base32 for v1). **Verified** (js-multiformats README).

Caveat worth a CI test: two independent encoders (`@ipld/unixfs` inside Storacha vs `ipfs-unixfs-importer` on device) should agree bit-for-bit under equal parameters, but IPIP-0499 only *enables* reproducibility; the IPFS Foundation post explicitly does not claim it was cross-tested against Storacha. Add a fixture test: upload N files of 0.5/1.5/50/600 MB with Storacha, assert the returned root equals the on-device CID. **Inferred / flagged.**

### 1.3 PieceCID v2 (Synapse / Filecoin Onchain Cloud)

* Format (FRC-0069). **Verified**: CIDv1, codec `raw` (0x55), multihash `fr32-sha256-trunc254-padbintree` (0x1011); digest = `uvarint padding | uint8 height | 32-byte root`; base32 strings start with `bafkzcib`; min representable payload 127 bytes; v1 `baga6ea4seaq…` + size ⇄ v2 conversion is lossless.
* SDK: `@filoz/synapse-sdk` 2.0.2 and `@filoz/synapse-core` 0.10.0 (both 2026-09-25, Apache-2.0 OR MIT; `viem` 2.x peer dep). **Verified** (npm registry, GitHub releases). The piece module (`@filoz/synapse-core/piece`) exports, per its `.d.ts`:

```ts
export type CalculateInput = Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
export declare function calculate(input: CalculateInput): Promise<PieceCID>;
export interface PieceHasher { write(chunk: Uint8Array): PieceHasher; count(): bigint; finalize(): PieceCID; reset(): PieceHasher; }
export declare function hasher(): PieceHasher;
export declare function transformStream(): PieceCIDTransform;   // TransformStream + result: Promise<PieceCID>
export { equals, from, is, tryFrom } ; export { MIN_SIZE, MAX_SIZE, heightFor, paddedSizeFor, paddedSizeAtHeight }
export { CODEC_CODE /* 85 */, MULTIHASH_CODE /* 4113 = 0x1011 */, MULTIHASH_NAME }
```
  It is pure JS (derived from `@web3-storage/data-segment`; the README acknowledges this), so it runs in React Native too — streaming via `hasher().write()`. **Verified.**
* Size limits. **Verified** (`dist/src/utils/constants.js`): `SIZE_CONSTANTS.MIN_UPLOAD_SIZE = 127` bytes, **`MAX_UPLOAD_SIZE = 1_065_353_216` bytes** (= 1 GiB × 254/256 ≈ 1016 MiB). This is a hard constraint for videos: a single Synapse upload (one PieceCID, one PDP-proven piece) is ≤ ~1.016 GB. Internally `MIN_PAYLOAD_SIZE = 2*NODE_SIZE+1 = 65` bytes for the hasher, but the upload path enforces 127.
* Browser-grade alternative hasher: `fr32-sha2-256-trunc254-padded-binary-tree-multihash` 3.3.0 (Rust→WASM, Storacha; `Hasher.create().write(chunk)…digestInto(buf, 0, true)`, manual `free()`). **Verified** (registry readme). Note it is from Feb 2024 and not needed if you already depend on `synapse-core`.
* Storacha vs Synapse semantics. **Verified** (upload-client `index.js`): Storacha computes a PieceCID **per CAR shard** (`PieceHasher` from `@web3-storage/data-segment/multihash`, `Link.create(raw.code, digest)`; default `SHARD_SIZE = 133_169_152` bytes = 127 MiB) and offers it via `Storefront.filecoinOffer()`. So with Storacha the on-chain-provable piece is the shard, and your file is located inside it by inclusion proof — the file's own identity is the UnixFS CID. With Synapse the piece **is** your bytes, so `PieceCID(file)` is both the storage proof and a content identity you can compute on device before uploading. **Inferred** from both code bases. For a "trustless" record this favours Synapse for the piece-level identity, with the UnixFS CID kept for IPFS-style retrieval/interop.

### 1.4 Streaming hashes of large videos on device

| Runtime | Streaming SHA-256? | Notes (**Verified** unless marked) |
|---|---|---|
| Browser WebCrypto `crypto.subtle.digest` | **No** — one-shot over an ArrayBuffer | Streaming is a WinterCG → WICG proposal; Cloudflare Workers ship a non-standard `DigestStream`. For browsers, read `file.stream()` and feed `hash-wasm` |
| `hash-wasm` 4.12.0 (MIT, 2024-11-19) | Yes: `createSHA256()` / `createBLAKE3()` → `init/update/digest`, `save/load` for resumable | ~7 kB (SHA-256) / 9 kB (BLAKE3) gzipped; Node 8+, Chrome 57+, Safari 11+; needs WebAssembly |
| React Native (Hermes) | `hash-wasm` is **not usable** — Hermes has no WebAssembly (RN docs describe Hermes/JSC only; no WASM) | **Inferred** from RN "JavaScript Environment" docs + hash-wasm's platform table |
| `expo-crypto` 57.0.3 | **No streaming**: `digest(algorithm, BufferSource): Promise<ArrayBuffer>`; SHA-1/256/384/512 (MD5 iOS only) | OK for ≤ ~100 MB in memory, not for 1 GB video |
| `expo-file-system` 57.0.7 (SDK 57) | `File.bytes()`, `File.readableStream()` (1024-byte chunks by default), `FileHandle.readBytes(length)` for chunked reads; no digest | Chunk via `FileHandle` + a native hasher |
| `expo-file-system` **58.0.0 (2026-09-10)** | **`File.digest('SHA-256'): Promise<string>`** (MD5/SHA-1/256/384/512); `FileHandle.readBytes()` now async | Shown only in the *unversioned/next* docs; verify which SDK you ship |
| `react-native-quick-crypto` 1.1.7 (MIT, 2026-08-15) | Yes: Node-compatible `createHash('sha256').update(chunk)…digest()`, native (Nitro) backend; SHA-2/SHA-3/BLAKE2b; **no BLAKE3** | Guide hashes files in 1 MB chunks via RNFS; combine with expo `FileHandle.readBytes` |
| Python server | `hashlib.sha256` streaming; `blake3` 1.0.10 (CC0/Apache) streaming | For re-verification of what the device claimed |

Recommendation: on device compute, in one pass over the file, (a) SHA-256 (native: `File.digest` on SDK 58, else RNQC), (b) the UnixFS CID (importer with the no-op blockstore; it hashes each 1 MiB chunk with `multiformats`' JS sha256 — on Hermes that will be slow; measure, and consider plugging RNQC's SHA-256 in as the importer's `hasher`), (c) the PieceCID (`synapse-core` `hasher()`), then upload and **assert** the service-reported CID/PieceCID equal the local ones before you sign the on-chain record. Anything that does not match is a bug or a hostile relay, so refuse to register.

### 1.5 What to put on chain

`sha256` (32 B), the UnixFS CID (36 B as bytes: version+codec+multihash; store as `bytes`, render as base32), the PieceCID v2 (variable, ≤ ~45 B incl. padding/height), plus the perceptual hash of the *original* (PDQ 32 B) if you want third parties to replicate perceptual lookups without trusting your DB. Keep ISCC off-chain or in an event/metadata field (an ISCC-CODE string is ~55–60 base32 chars). **Inferred.**

---

## 2. Perceptual hashing for images

### 2.1 Algorithm landscape (2026)

| Algorithm | Bits | Core idea | Open? | Status / notes |
|---|---|---|---|---|
| aHash / dHash / pHash | 64 (default `hash_size=8`) | mean / gradient / 32×32-DCT low frequencies | yes | `ImageHash` 4.3.2 (BSD-2, 2025-02-01) Python; `sharp-phash` 2.2.0 (MIT) Node |
| blockhash | 256 (16×16 blocks) | block mean value hashing (Yang/Gu/Niu) | MIT | `blockhash-core` 0.1.0 is from 2019; `image-hash` 7.0.1 (2025-11-13) wraps it |
| **PDQ** (Meta) | 256 + quality 0–100 | luminance → 64×64 → 16×16 DCT, median threshold | BSD-3 (ThreatExchange LICENSE) | reference C++, Python, Java, PHP, WASM, Rust in-repo; `pdqhash` 0.2.8 (PyPI, 2025-05-28), `pdq-wasm` 0.3.9 (npm, 2025-11-08) |
| NeuralHash (Apple) | 96 | CNN + LSH | **no** (leaked model) | reverse-engineered and collided within hours in Aug 2021; Apple dropped the CSAM plan; USENIX Sec '26 shows face collisions after 2^16 evaluations. Do not use |
| PhotoDNA (Microsoft) | 1152 (144 B) | edge/gradient histogram | **restricted** (CSAM-only terms; Tech Coalition sublicensing) | USENIX Sec '26 found near-collisions at 2^14.6–2^17 evaluations; licence excludes Stamper's purpose |
| **ISCC Content-Code Image** (ISO 24138:2024) | 64 default, up to 256 | EXIF-transpose → fill transparency → trim border → grayscale → 32×32 bicubic → 2-D DCT → median bits | Apache-2.0 | `iscc-core` 1.4.0 (2026-09-24), `iscc-sdk` 0.9.5, `iscc-lib` 0.6.0 Rust with `@iscc/lib` NAPI + `@iscc/wasm` + PyPI `iscc-lib` (all 2026-07-30) |
| SSCD (Meta FAIR) | 512-d float (1024 for ResNeXt101) | self-supervised copy-detection descriptor | MIT | TorchScript models; "cosine > 0.75 ⇒ copy with 90 % precision" on DISC2021; the crop/overlay-robust upgrade |

All of the DCT family (pHash, PDQ, ISCC Image-Code) share the same failure modes: fine on recompression/resize/mild overlays, weak on crops/borders, and flips/rotations must be handled by hashing dihedral variants (PDQ ships `compute_dihedral` → 8 hashes; the README warns PDQ "does not guarantee exact rotational invariance"). **Verified.**

Cross-implementation caveat (**load-bearing**): the PDQ README's correctness bar is that an implementation should produce hashes within **Hamming ≤ 10** of the C++ reference for images with quality ≥ 80 — i.e. different PDQ implementations are *not* bit-identical. Index and query with the **same** implementation, or shrink your threshold by ~10 bits when they differ. **Verified.**

### 2.2 Measured robustness (million-image study, DFRWS EU 2023, Flickr 1M; normalised Hamming distance, 0 = identical)

Original vs its own modification (Table 5), with my conversion to bits in parentheses:

| Modification | PDQ (256 b) | pHash (64 b) | blockhash (256 b) | NeuralHash (96 b) |
|---|---|---|---|---|
| JPEG q30 recompression | 0.0094 (2.4 b) | 0.0053 (0.3 b) | 0.0095 | 0.0082 |
| Scale 150 % | 0.0237 (6.1 b) | 0.0020 | 0.0013 | 0.0036 |
| 96-px thumbnail | 0.0721 (18.5 b) | 0.0245 | 0.0254 | 0.0809 |
| **Watermark/logo, 10 % of height, bottom-right** | **0.1029 ± 0.0489 (26.3 ± 12.5 b), max 0.55** | 0.1227 ± 0.0824 (7.9 ± 5.3 b) | 0.0504 | 0.0551 |
| **Crop 5 %** | **0.3255 (83 b) — fails** | 0.1686 (10.8 b) | 0.1668 | 0.0605 |
| Border added | 0.3949 — fails | 0.2656 | 0.2783 | 0.0763 |
| Mirror | 0.4975 (random) | 0.4904 | 0.4450 | 0.2823 |

Unrelated-image distances (Table 3): PDQ mean 0.5000, **σ 0.0321** (128 ± 8.2 bits), min observed **0.0391 (10 bits)** over ~50 M random pairs; pHash mean 0.4904, σ 0.0649, min 0.0938 (6 bits); NeuralHash σ 0.0600, min 0.0521. The paper's reading: PDQ's inter-image distribution is "very tight, likely by design … to greatly reduce false positives", and collisions it did see came from structurally trivial images (black backgrounds). **Verified** (pdftotext of the paper).

Consequences for Stamper (**Inferred**):
1. **Your own visible badge changes the hash.** With a 10 %-height mark, ~35 % of badged copies would fall *outside* PDQ's 31-bit threshold relative to the unbadged original (26.3 ± 12.5 bits, Gaussian assumption). Therefore index the PDQ of **every rendition you distribute** (badged JPEG, badged WebP, thumbnail…) under the same stamp id, and keep the mark small (a 3–5 % corner badge flips far fewer coefficients than a 10 % one — measure on your own badge).
2. **Screenshots and crops are not caught by PDQ/pHash/ISCC** (crop 5 % → 83 bits). A screenshot of a phone screen adds UI chrome (= border) and crops; expect PDQ to miss it. The invisible-watermark layer and, later, SSCD are what catch those. Hashing a few deterministic crops of the original (centre 90 %, 80 %) as extra index entries helps a bit but cannot cover arbitrary crops.
3. **Burst photos / same scene**: distances between consecutive burst frames will typically sit inside the recompression band (a few bits), i.e. PDQ cannot tell two originals of the same scene apart. Treat perceptual matches as a *candidate set*, never as identification (section 5).
4. **False-candidate rate scales with index size.** With σ ≈ 8 bits the Gaussian tail at 31 bits is negligible, but the empirical tail is heavier (a 10-bit pair among 5×10^7). If the per-pair rate of ≤ 31-bit accidental matches is ~10^-7–10^-8 (order of magnitude, inferred from "min 10 bits in 5×10^7 pairs"), a query against 10 k stamps yields ~10^-3 false candidates, against 100 M it yields 1–10. At scale, re-ranking (SSIM / SSCD) and the watermark are mandatory; at MVP scale they are nice-to-have.

Second independent study (arXiv 2406.00918, 2024, PhotoDNA vs PDQ vs NeuralHash, ImageNet, normalised threshold 0.3): all three are robust to compression and resizing (attack success 0 %), PDQ is broken by rotation (100 %) and by "filtering" (44 %); NeuralHash was the most robust overall — and is unusable. **Verified.**

### 2.3 Thresholds

* PDQ: Meta's README and `python-threatexchange` (`PDQ_CONFIDENT_MATCH_THRESHOLD = 31`, `BITS_IN_PDQ = 256`) use **≤ 31 bits**; discard hashes with **quality ≤ 49** (README). vPDQ examples use distance 31 and quality 50. **Verified.** For Stamper I would use two bands: ≤ 15 bits "same image, re-encoded" (candidates shown as strong), 16–31 "edited copy" (shown as weak, requires SSIM confirmation), and widen to ≤ 40 only when the watermark already identified the stamp (then the hash is confirmation, not search). **Inferred.**
* pHash (64-bit): the literature commonly uses ≤ 5–10 bits; `sharp-phash`'s example shows < 5 for near-identical. With σ ≈ 4.2 bits and an observed 6-bit unrelated pair in 50 M, 64-bit pHash is too small for a 1 M+ index; use it only as a cheap tie-breaker. **Inferred** from Table 3.
* ISCC Image-Code: default 64 bits (configurable up to 256 via `bits`); ISO 24138 does not fix a matching threshold; `iscc_compare` returns per-unit distances. Use 256-bit if you want it as a matcher; otherwise keep it as an identifier. **Verified** (iscc-core source) / **Inferred** (threshold).

### 2.4 Libraries — concrete

Node/TypeScript (server):
```ts
import sharp from 'sharp'                 // 0.35.5 (Apache-2.0)
import { PDQ } from 'pdq-wasm'            // 0.3.9 (BSD-3-Clause), 26 kB wasm
await PDQ.init()
const { data, info } = await sharp(buf).rotate() /* EXIF */.removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { hash, quality } = PDQ.hash({ data, width: info.width, height: info.height, channels: 3 })
// hash: Uint8Array(32) → store as bit(256); quality: number (discard < 50)
const d = PDQ.hammingDistance(h1, h2); PDQ.areSimilar(h1, h2, 31)
```
`pdq-wasm` also works in browsers (canvas `getImageData` → RGB). `sharp-phash` 2.2.0 (`phash(buffer)` → 64-char bit string, `distance()`), `image-hash` 7.0.1 (blockhash wrapper), `@stabilityprotocol.com/phash` 1.0.0 (2026-01-26, MIT) exist but add little over PDQ. `@iscc/lib` 0.6.0 (NAPI) / `@iscc/wasm` 0.6.0 expose `gen_image_code_v0(pixels)` (you feed the 1024 normalised grey pixels — replicate `iscc-sdk`'s `image_normalize`: EXIF transpose → fill transparency → trim border → `convert("L")` → `resize((32,32), BICUBIC)`), `gen_data_code_v0`, `gen_instance_code_v0`, `gen_video_code_v0(frame_sigs)`, `gen_iscc_code_v0`, with `conformance_selftest()`; requires WASM SIMD (Chrome 91+, Safari 16.4+, Node 16.4+). **Verified.**

Python (server / batch):
```python
import pdqhash, numpy as np, PIL.Image as Image        # pdqhash 0.2.8 (MIT bindings; PDQ BSD-3)
img = np.asarray(Image.open(p).convert('RGB'))         # RGB, not BGR
bits, quality = pdqhash.compute(img)                   # bits: 256-length array; quality 0-100
hashes8, quality = pdqhash.compute_dihedral(img)       # 8 variants for rotation/flip-tolerant queries
import iscc_sdk as idk                                 # iscc-sdk 0.9.5 (Apache-2.0, Python ≥ 3.11)
meta = idk.code_iscc(p)                                # full ISCC-CODE (Meta+Content+Data+Instance)
```
`ImageHash` 4.3.2 (`phash`, `dhash`, `whash`, `colorhash`, `crop_resistant_hash`), `imagededup` 0.3.3 (2025-08-15) are fine for experiments. `threatexchange` 1.2.16 (BSD, 2026-06-03) bundles PDQ + vPDQ signal types and `PDQIndex2` (FAISS-backed: `faiss.IndexFlatL2(256)` by default). **Verified.**

Android/iOS on-device PDQ: no WASM on Hermes; either call native (the ThreatExchange repo has C++ and Java; the Rust crate `pdqhash` could be wrapped with UniFFI/Nitro) or compute server-side after upload. For the MVP, hash server-side: the server must re-derive every hash from the bytes anyway, because device-reported perceptual hashes are unverifiable claims. **Inferred.**

### 2.5 ISCC as the canonical identifier

* ISO 24138:2024 (ISCC) standardises the code syntax and the v0 algorithms; `iscc-core` is the reference, `iscc-lib` the Rust port with conformance vectors. **Verified.**
* An ISCC-CODE composes Meta-Code, Content-Code (Image: 32×32 DCT; Video: MPEG-7 frame signatures via `ffmpeg -vf fps=5,signature=…`, WTA-hashed; Audio: Chromaprint), Data-Code (content-defined chunking, xxh32 chunk features → MinHash), Instance-Code (BLAKE3). **Verified** (sources). It is therefore a layered identifier: Instance = byte identity, Data = near-byte identity (same file re-muxed), Content = perceptual identity.
* The C2PA soft-binding registry (53 entries) lists exactly one *fingerprint* class entry from the open-standards world: **`io.iscc.v0`**; the rest are watermarks (Adobe TrustMark Q/C/P, Digimarc, Microsoft invismark/wavmark, Meta videoseal/pixelseal/audioseal under `com.aiwatermark.*`, IMATAG, etc.). PDQ is not registered. **Verified** (JSON). If Stamper ever emits C2PA manifests or wants its records resolvable by C2PA-aware tools, ISCC is the interoperable fingerprint to expose, and the invisible-watermark choice should ideally be one of those registered algorithms.
* ISCC-IDs (v1, timestamp-based) require a registry/hub; not needed — Stamper's registry is the Filecoin-EVM contract. **Inferred.**

---

## 3. Perceptual hashing for video

| System | Representation | Size per second of video | Hash time per second of video | Best-F1 on VCDB (P / R) | Licence | Status |
|---|---|---|---|---|---|---|
| **vPDQ** (Meta) | per-frame PDQ at 1 fps + quality + timestamp; "bag of hashes", consecutive duplicates dropped | **0.04–0.05 KB** | **4–7 ms** | **0.98 / 0.41** | BSD-3 (+ffmpeg LGPL) | maintained in ThreatExchange; `vpdq` 0.2.5 on PyPI (2026-02-02), C++/Cython, needs ffmpeg + cmake, no Windows wheels |
| TMK+PDQF (Meta/FAIR) | fixed-length Fourier-weighted PDQF features (level-1 avg, level-2 temporal kernel, thresholds 0.7 / 0.7) | 1.36–2.38 KB | 6–18 ms | 0.88 / 0.24 | BSD-3 | still in repo but "weak at matching clips"; Meta points to vPDQ |
| PhotoDNA for Video | PhotoDNA per frame at 1 fps | 0.86–1.37 KB | 9–17 ms | 0.99 / 0.70 | restricted | not licensable for this use |
| ISCC Video-Code | MPEG-7 frame signatures (ffmpeg `signature` filter, 5 fps) → WTA hash, 64–256 bits per video (or per scene) | tiny (one code) | ffmpeg decode-bound | n/a (not in benchmark) | Apache-2.0 | ISO identifier; coarse matcher |
| videohash 3.0.1 (2022) / videohash2 3.2.2 (2024) / vidhash 0.3.2 (2026) | 64-bit collage hash / frame hashes at 5 fps | tiny | ffmpeg-bound | n/a | MIT | hobby-grade, no benchmark |

Numbers are from the Tech Coalition PHVSpec benchmark (2024; VCDB, FIVR-200k and an adult-content set) and the ThreatExchange READMEs. **Verified** (pdftotext). PHVSpec's summary: vPDQ matching time 0.0026 s per second of queried video; vPDQ complexity is O(n · Fc · Fq) linear scan, so candidates must first be found by per-frame Hamming lookups.

Server-side feasibility: decoding dominates. ffmpeg can downscale to e.g. 64 px on the decode path (`-vf fps=1,scale=64:64`) and PDQ a frame in well under a millisecond; a 10-minute 1080p clip ⇒ 600 frames ⇒ a few seconds of CPU, ~30 KB of index. **Inferred** from the benchmark rates. Sampling strategy recommendation:
1. Decode at 1 fps (vPDQ default in the benchmark), plus the first and last frame, plus scene-change frames (`select='gt(scene,0.4)'`) so short clips still get ≥ 3 hashes.
2. Drop frames with PDQ quality < 50 and drop consecutive frames within ≤ 8 bits of the previous kept frame (what "duplicate vectors dropped" means in practice).
3. Store `(stamp_id, t_seconds, pdq bit(256), quality)`; keep the full per-frame list in object storage if you want exact vPDQ match percentages later.
4. Also compute one ISCC Video-Code per stamp for the identifier layer (`iscc-sdk` `code_video` runs the ffmpeg signature filter at `sdk_opts.video_fps`).

Query by uploaded video: sample the same way, look up each query frame (≤ 31 bits) in the frame index → candidate stamps; for each candidate compute the vPDQ match percentages (query-side Pq, candidate-side Pc; Meta's example thresholds Pc = 80 %, Pq = 0 % for "contains") and rank. For a *still image* query (a screenshot of a video frame), the same frame index answers it. **Inferred** from the vPDQ README.

Constraint from section 1.3: a Synapse piece is ≤ 1,065,353,216 bytes; long/high-bitrate recordings must be split into several pieces (each with its own PieceCID, all listed in one on-chain record) while the UnixFS root CID still identifies the whole file. **Inferred** from `MAX_UPLOAD_SIZE`.

---

## 4. Indexing and search

### 4.1 Brute force (**Measured**, numpy 2.2 `bitwise_count`, 256-bit, one core, one query)

| Entries | Full-scan latency | Throughput | RAM for hashes |
|---|---|---|---|
| 10 k | 0.40 ms | ~25 M hashes/s | 0.3 MB |
| 1 M | 31 ms | ~32 M hashes/s (~1 GB/s) | 32 MB |
| 10 M | 345 ms | ~29 M hashes/s | 320 MB |
| 100 M (extrapolated) | ~3.5 s single-core; ~0.3 s on 12 cores or with FAISS's popcount kernels | — | 3.2 GB |

A naive loop in Node/Postgres is slower; FAISS `IndexBinaryFlat` is "carefully optimized … for 256-bit vectors" with popcount instructions (**Verified**). So: brute force is trivially fine to ~1 M (tens of ms), still acceptable at 10 M for a human-facing "verify" endpoint (sub-second), and needs an index at 100 M.

### 4.2 Postgres options

* Plain SQL (no extension): `pdq bit(256)`; `bit_count(pdq # $1) <= 31` (`bit_count(bit) → bigint`, popcount; `#` is XOR). Sequential scan, parallelisable; adequate to low millions. **Verified** (PG docs).
* **pgvector 0.8.6**: `bit` type up to 64,000 dims; Hamming operator `<~>` and `hamming_distance(bit,bit)`; **HNSW and IVFFlat indexes on bit columns** via `bit_hamming_ops`:
  ```sql
  CREATE TABLE renditions (id bigserial PRIMARY KEY, stamp_id bigint, kind text, sha256 bytea UNIQUE, cid text UNIQUE, pdq bit(256), pdq_quality int);
  CREATE INDEX ON renditions USING hnsw (pdq bit_hamming_ops);
  SELECT stamp_id, pdq <~> $1 AS d FROM renditions WHERE pdq_quality >= 50 ORDER BY pdq <~> $1 LIMIT 20;  -- then filter d <= 31
  ```
  Same table serves the vPDQ frame index. **Verified** (pgvector README). Expression-indexed `binary_quantize()` is for float embeddings (SSCD later), not needed for PDQ.
* Multi-index hashing trick (if you refuse extensions): split the 256 bits into 4 × 64-bit `bigint` columns; any pair within 31 bits has at least one 64-bit word within ⌊31/4⌋ = 7 bits — still a scan per word, so pgvector is simpler. **Inferred** (pigeonhole).

### 4.3 Dedicated engines

* **FAISS** (`faiss-cpu` 1.15.1, 2026-09-16): `IndexBinaryFlat`, `IndexBinaryIVF`, `IndexBinaryHNSW`, `IndexBinaryHash`, `IndexBinaryMultiHash`; d/8 bytes per vector; `range_search` supported (≥ 1.6.3). Meta's 50 M × 256-bit benchmark: for radius < ~30 `IndexBinaryHash` wins, for radius > 32 `IndexBinaryIVF` wins; the breaking point is "around a radius 30" — i.e. exactly PDQ's threshold. `python-threatexchange`'s `PDQIndex2` is a ready-made FAISS wrapper. **Verified.**
* **Milvus**: `BINARY_VECTOR` with `HAMMING` metric, `BIN_FLAT` / `BIN_IVF_FLAT`. **Verified** (docs via search).
* **Elasticsearch**: `dense_vector` with `element_type: bit` (dims = bits, multiple of 8, bytes or hex), scored as `(bits − hamming)/bits`, HNSW supported, only `l2_norm` allowed. **Verified.**
* **Vespa**: `tensor<int8>` cells + `distance-metric: hamming` with `nearestNeighbor` (HNSW), 256 bits = 32 int8 cells. **Verified** (docs via search).
* **Qdrant**: datatypes float32/float16/uint8 (+ binary/1.5/2-bit quantization of float vectors); **no native bit vector type or Hamming metric** in the current docs — not a fit for PDQ. **Verified.**

### 4.4 Recommendation

MVP: Postgres + pgvector `bit(256)` with `bit_hamming_ops` HNSW from day one (same SQL from 10 k to 100 M rows; the HNSW index on 32-byte vectors is small). Exact lookups are unique indexes on `sha256` and `cid`. Upgrade path when p95 latency or write amplification bites (> ~50 M renditions+frames): a FAISS `IndexBinaryIVF`/`IndexBinaryHash` sidecar (Python, `threatexchange`'s `PDQIndex2` or your own), or Elasticsearch/Milvus if you already run one. Add an SSCD `halfvec(512)` column + HNSW cosine index when you add the crop/screenshot layer.

---

## 5. The verification-by-upload decision procedure

```
input bytes B (image or video), optional user hint (stamp code typed from the badge)
0. normalise: detect type; for images decode once (sharp/PIL, EXIF-rotate); for video probe with ffprobe
1. EXACT     sha256(B) ∈ renditions.sha256  → "byte-identical copy of stamp #X (original | badged rendition | thumbnail)"
             (also recompute CID; a CID hit without a sha256 hit means a bug)
2. CODE      if the visible code was typed/OCR'd: fetch stamp, then run steps 3–4 against that single stamp only (confirmation mode, thresholds relaxed to ≤ 40)
3. WATERMARK decode invisible watermark → stamp id (+ CRC/ECC ok?) → fetch original → PDQ distance + SSIM map vs original
             → "derivative of stamp #X: distance d bits, SSIM s, heat-map" (strong, but a watermark payload can be copied into another image: still show the diff)
4. PERCEPT   PDQ(B) with quality ≥ 50 (+ 8 dihedral variants, + 2 centre crops) → pgvector k-NN (k = 20) → keep d ≤ 31
             for video: per-frame lookups → candidate stamps → vPDQ match % → rank
             re-rank top-K by SSIM against each candidate's original (same size, aligned by resize) and by |Δ capture time| if the query carries EXIF
             → "looks like stamp #X (d = 7, SSIM 0.93) — similarity is not proof"; if several candidates tie within ~5 bits, show all (burst case)
5. NONE      → "no registered original found" (never "fake": absence of evidence)
```

Failure modes and mitigations (**Inferred** unless noted):

| Failure | Why | Mitigation |
|---|---|---|
| Two originals of the same scene (burst, bracketing, two phones) | PDQ/pHash/ISCC distances between burst frames are within the recompression band; perceptual hashing cannot order them | never auto-pick: show all candidates within ~5 bits of the best; use exact hash / watermark id / typed code to resolve; SSIM between query and each candidate *does* separate burst frames when the query is a faithful re-encode (motion differences ≫ compression noise), so rank by SSIM, not by Hamming, when distances tie |
| Badged copy does not match the original's PDQ | overlay moves ~26 ± 12 bits at 10 % height (**Verified**) | index every distributed rendition; small badge; also store the *un-badged* original's hash |
| Screenshot / crop / phone-photo-of-a-screen | crop 5 % → 83 bits, border → 101 bits (**Verified**) | watermark layer (choose a registered C2PA soft-binding watermark); later SSCD; the typed visible code is the fallback the user always has |
| Rotation / mirror | PDQ not rotation-invariant (**Verified**) | query with 8 dihedral variants (`compute_dihedral`); for video, frames too |
| Low-detail images (sky, documents, dark frames) collide | PDQ collisions cluster on structurally trivial images (**Verified**); quality metric exists for this | drop/flag quality < 50; require SSIM confirmation; the exact hash still works |
| Adversarial collision / evasion | black-box collisions demonstrated for NeuralHash/PhotoDNA (USENIX Sec '26); PDQ is DCT-based and equally not collision-resistant (**Verified** for the former; inferred for PDQ) | perceptual match is a *lead*, never a verdict; the only authoritative statements are byte-identity (sha256/CID) and the signed on-chain record; make the UI wording reflect this |
| Different PDQ implementation on device vs server | up to 10 bits of implementation slack (**Verified**) | one implementation server-side for index and query |
| Video re-encode / speed change / clip | vPDQ is a bag of frame hashes (order-free) with sub-sequence support (**Verified**) | tune Pq/Pc; show matched time ranges |
| Very long videos | 1 PieceCID ≤ 1,065,353,216 bytes (**Verified**) | split pieces; one UnixFS CID for the file |
| HEIC/HEIF originals | server decoders (sharp needs libheif build; PIL needs pillow-heif) | transcode on device to JPEG for the *distributed* rendition, but register the hash of the original bytes you actually store |

Why this layering is right: the three layers answer different questions — exact = "is this the file?", watermark = "which stamp did this come from, even after edits?", perceptual = "what might this be a copy of?" — and their error profiles are complementary (exact: zero FP, zero tolerance; watermark: tolerant, but payload can be forged/transplanted; perceptual: tolerant, no secret, collisions possible). The UI should expose which layer produced the verdict.

---

## 6. Concrete pipeline (MVP)

**Capture (device)**: write original bytes → one streaming pass computing `sha256`, UnixFS CID (`unixfs-v1-2025`), PieceCID v2 (`synapse-core` hasher) → sign `{sha256, cid, pieceCid, size, mime, capturedAt}` → upload (Synapse `storage.upload` or Storacha `uploadFile`) → **assert** returned ids equal local ids → submit on-chain registration.

**Ingest (server, after the chain event)**: fetch bytes by CID/PieceCID, re-verify sha256/CID/PieceCID; decode; PDQ + quality for original; render the badged distribution copy (+ thumbnails) and PDQ each; ISCC-CODE via `iscc-sdk`; for video: vPDQ frames (1 fps + scene changes, quality ≥ 50, dedupe), ISCC Video-Code; write `stamps`, `renditions`, `video_frames` rows; HNSW index on `pdq`.

**Verify (server)**: steps 0–5 above; SSIM map via `@blazediff/ssim` (`ssim(a, b, w, h, { windowSize: 11 })` with the optional map output, RGBA input) or `skimage.metrics.structural_similarity(a, b, channel_axis=-1, full=True)`; return verdict, layer, candidates with `distance`, `ssim`, `heatmap_url`, and the original's CID for the viewer to fetch independently.

Packages to pin (2026-10-01): `ipfs-unixfs-importer@17.1.1`, `multiformats@14.0.5`, `@filoz/synapse-sdk@2.0.2` / `@filoz/synapse-core@0.10.0`, `@storacha/client@2.1.4` / `@storacha/upload-client@1.4.2`, `hash-wasm@4.12.0` (web), `react-native-quick-crypto@1.1.7` + `expo-file-system@57.0.7` (or 58.x for `File.digest`), `sharp@0.35.5`, `pdq-wasm@0.3.9`, `@blazediff/ssim@1.7.1`, `@iscc/lib@0.6.0`; Python: `pdqhash==0.2.8`, `vpdq==0.2.5`, `threatexchange==1.2.16`, `iscc-sdk==0.9.5`, `iscc-core==1.4.0`, `faiss-cpu==1.15.1`, `scikit-image==0.26.0`, `pgvector==0.5.0`; Postgres extension pgvector 0.8.6.

Stale / deprecated flags: `blockhash-core` (2019) and `ssim.js` 3.5.0 (2020) are unmaintained — prefer `image-hash`/`@blazediff/ssim`; `videohash` (2022) is abandoned; `fr32-…-multihash` WASM (Feb 2024) is superseded by `synapse-core/piece` for Synapse users; `@ipld/unixfs` 3.0.0 (Jan 2024) is what Storacha still uses internally — fine, but its *defaults* (174-wide, dag-pb leaves) are not the 2025 profile; TMK+PDQF is de-emphasised by Meta in favour of vPDQ; NeuralHash and PhotoDNA are out; Kubo's `test-cid-v1` profiles were removed in 0.40.

---

## 7. Open questions

1. Hermes performance of pure-JS SHA-256 inside `ipfs-unixfs-importer` / `synapse-core` on a 1 GB video — needs a device benchmark; if too slow, feed RNQC's native SHA-256 to the importer (`hasher` option) and port the fr32 tree hasher to native.
2. Does Storacha's `@ipld/unixfs` output equal `ipfs-unixfs-importer`'s `unixfs-v1-2025` output for all file sizes (link ordering, `Tsize`, `blocksizes`)? Expected yes; needs the fixture test.
3. Which invisible watermark? The C2PA soft-binding registry has TrustMark (Adobe, open source), Meta VideoSeal/PixelSeal (`com.aiwatermark.*`), Microsoft invismark; robustness to screenshots/crops is the deciding criterion and is outside this dimension.
4. Badge geometry vs PDQ drift: measure the distance distribution for *your* badge at 3 %, 5 %, 10 % of height on ~1 k sample photos before fixing the design.
5. Whether to also index SSCD at MVP (model serving cost) or defer until crop/screenshot complaints appear.
6. On-chain encoding of PieceCID v2 (variable-length multihash) and whether the registry should store the CID as bytes (36 B) or the 32-byte digest only (saves gas, loses self-description).

---

## Sources

IPFS / CIDs
- https://specs.ipfs.tech/ipips/ipip-0499/
- https://ipfsfoundation.org/ipip-0499-updating-ipfs-standards-for-consistent-reproducible-cids/
- https://github.com/ipfs/kubo/releases/tag/v0.40.0 (published 2026-02-25 per GitHub API; latest Kubo v0.43.1, 2026-09-15)
- https://raw.githubusercontent.com/storacha/upload-service/main/packages/upload-client/src/unixfs.js
- https://raw.githubusercontent.com/storacha/upload-service/main/packages/upload-client/src/sharding.js
- https://raw.githubusercontent.com/storacha/upload-service/main/packages/upload-client/src/index.js
- https://github.com/storacha/upload-service/blob/main/packages/upload-client/README.md
- https://raw.githubusercontent.com/ipfs/js-ipfs-unixfs/main/packages/ipfs-unixfs-importer/src/index.ts
- https://raw.githubusercontent.com/ipfs/js-ipfs-unixfs/main/packages/ipfs-unixfs-importer/src/constants.ts
- https://raw.githubusercontent.com/ipld/js-unixfs/main/src/file.js
- https://raw.githubusercontent.com/multiformats/js-multiformats/master/README.md

Filecoin / PieceCID / Synapse
- https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
- https://docs.filecoin.cloud/developer-guides/synapse/
- https://github.com/FilOzone/synapse-sdk (README; releases synapse-sdk-v2.0.2 / synapse-core-v0.10.0, 2026-09-25)
- https://unpkg.com/@filoz/synapse-core@0.10.0/dist/src/piece/index.d.ts
- https://unpkg.com/@filoz/synapse-core@0.10.0/dist/src/piece/calculate.d.ts
- https://unpkg.com/@filoz/synapse-core@0.10.0/dist/src/utils/constants.js
- https://unpkg.com/@filoz/synapse-core@0.10.0/dist/src/piece/internal/constants.js
- https://github.com/web3-storage/fr32-sha2-256-trunc254-padded-binary-tree-multihash (readme via npm registry)

Hashing on device / in browsers
- https://raw.githubusercontent.com/Daninet/hash-wasm/master/README.md
- https://docs.expo.dev/versions/latest/sdk/filesystem/
- https://docs.expo.dev/versions/unversioned/sdk/filesystem/
- https://raw.githubusercontent.com/expo/expo/main/packages/expo-file-system/CHANGELOG.md
- https://docs.expo.dev/versions/latest/sdk/crypto/
- https://crypto.margelo.com/docs/api/hash
- https://reactnative.dev/docs/javascript-environment
- https://github.com/wintercg/proposal-webcrypto-streams
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

PDQ / vPDQ / TMK / ThreatExchange
- https://github.com/facebook/ThreatExchange/blob/main/pdq/README.md
- https://raw.githubusercontent.com/facebook/ThreatExchange/main/LICENSE
- https://github.com/facebook/ThreatExchange/blob/main/vpdq/README.md
- https://raw.githubusercontent.com/facebook/ThreatExchange/main/vpdq/python/README.md
- https://github.com/facebook/ThreatExchange/blob/main/tmk/README.md
- https://raw.githubusercontent.com/facebook/ThreatExchange/main/python-threatexchange/threatexchange/signal_type/pdq/pdq_index2.py
- https://raw.githubusercontent.com/facebook/ThreatExchange/main/python-threatexchange/threatexchange/signal_type/pdq/pdq_utils.py
- https://pypi.org/project/pdqhash/ , https://pypi.org/project/vpdq/ , https://pypi.org/project/threatexchange/
- https://www.npmjs.com/package/pdq-wasm (readme via npm registry; repo https://github.com/Raudbjorn/pdq-wasm)

Other image hashes
- https://pypi.org/project/ImageHash/
- https://github.com/btd/sharp-phash
- https://github.com/commonsmachinery/blockhash-js , https://www.npmjs.com/package/blockhash-core , https://www.npmjs.com/package/image-hash
- https://github.com/facebookresearch/sscd-copy-detection
- https://en.wikipedia.org/wiki/PhotoDNA ; https://www.microsoft.com/en-us/photodna/termsofuse ; https://technologycoalition.org/news/the-tech-coalition-empowers-industry-to-combat-online-child-sexual-abuse-with-expanded-photodna-licensing/
- https://blog.roboflow.com/apples-csam-neuralhash-collision/ ; https://techcrunch.com/2021/08/18/apples-csam-detection-tech-is-under-fire-again

ISCC / C2PA
- https://www.iso.org/standard/77899.html (ISO 24138:2024)
- https://pypi.org/project/iscc-core/ , https://pypi.org/project/iscc-sdk/ , https://pypi.org/project/iscc-lib/
- https://docs.rs/iscc-lib ; https://cdn.jsdelivr.net/npm/@iscc/wasm@0.6.0/README.md ; npm `@iscc/lib`
- https://raw.githubusercontent.com/iscc/iscc-core/main/iscc_core/code_content_image.py
- https://raw.githubusercontent.com/iscc/iscc-core/main/iscc_core/code_content_video.py
- https://raw.githubusercontent.com/iscc/iscc-core/main/iscc_core/code_instance.py
- https://raw.githubusercontent.com/iscc/iscc-core/main/iscc_core/code_data.py
- https://raw.githubusercontent.com/iscc/iscc-sdk/main/iscc_sdk/image.py
- https://raw.githubusercontent.com/iscc/iscc-sdk/main/iscc_sdk/video.py
- https://github.com/c2pa-org/softbinding-algorithm-list ; https://raw.githubusercontent.com/c2pa-org/softbinding-algorithm-list/main/softbinding-algorithm-list.json

Evaluations
- McKeown & Buchanan, "Hamming distributions of popular perceptual hashing techniques", DFRWS EU 2023 — https://arxiv.org/abs/2212.08035 ; https://dfrws.org/wp-content/uploads/2023/03/Hamming_distributions_of_popular_perceptual_hashing_techniques-1.pdf
- "Assessing the Adversarial Security of Practical Perceptual Hashing Algorithms" (2024) — https://arxiv.org/html/2406.00918v1
- Leblanc-Albarel & Preneel, "Breaking Widely Deployed Perceptual Hash Functions: Black-Box Collisions in Apple NeuralHash and Microsoft PhotoDNA", USENIX Security 2026 — https://www.usenix.org/conference/usenixsecurity26/presentation/leblanc-albarel
- Tech Coalition, "PHVSpec: A Benchmark-based Analysis of Perceptual Hash Systems for Videos" (2024) — https://technologycoalition.org/wp-content/uploads/Tech-Coalition-Video-Hash-Benchmark-Paper.pdf
- Dalins et al., "PDQ & TMK+PDQF – A Test Drive" — https://arxiv.org/abs/1912.07745

Indexing
- https://github.com/pgvector/pgvector (README, 0.8.6)
- https://www.postgresql.org/docs/current/functions-bitstring.html
- https://github.com/facebookresearch/faiss/wiki/Binary-indexes ; https://github.com/facebookresearch/faiss/wiki/Binary-hashing-index-benchmark ; https://pypi.org/project/faiss-cpu/
- https://qdrant.tech/documentation/concepts/vectors/
- https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dense-vector
- https://milvus.io/docs/bin-ivf-flat.md
- https://docs.vespa.ai/en/querying/nearest-neighbor-search

Diff / SSIM
- https://cdn.jsdelivr.net/npm/@blazediff/ssim@1.7.1/README.md
- https://scikit-image.org/docs/stable/api/skimage.metrics.html

Video hash libraries
- https://pypi.org/project/videohash/ , https://pypi.org/project/videohash2/ , https://pypi.org/project/vidhash/

Registry data (versions/dates/licences): npm registry JSON (`registry.npmjs.org`) and PyPI JSON (`pypi.org/pypi/<pkg>/json`), queried 2026-09-30.
