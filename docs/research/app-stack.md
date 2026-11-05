# Stamper — Application stack research (Expo/RN mobile + Next.js verification site + light backend on Filecoin)

Research date: 2026-09-30 / 2026-10-01. Versions below were read from the npm/PyPI registries and GitHub on that date unless stated otherwise. "Verified" = read from a primary source (docs page, registry metadata, source file, release notes). "Inferred" = my conclusion from indirect evidence; treat as something to confirm during a spike.

---

## 0. Executive summary

- **Mobile:** Expo SDK 57 (`expo@57.0.26`, React Native 0.86.3, React 19.2.3, TypeScript ~6.0.3 in the official template). SDK 57 shipped 2026-06-30; `expo@57.0.17` (2026-08-27) fixed a Hermes V1 memory regression. SDK 58 entered beta on 2026-09-15 (RN 0.88 RC, iOS 27) and will be stable within weeks — target 57 now, plan the 58 upgrade as a routine bump.
- **Everything Stamper needs natively is available as official Expo modules** (`expo-camera`, `expo-file-system` File API with iOS background upload sessions, `expo-crypto`, `expo-secure-store`, `expo-local-authentication`, `@expo/app-integrity` for App Attest / Play Integrity). A **config-plugin-only (CNG) workflow suffices**; EAS Build even auto-syncs the App Attest entitlement. You need **development builds**, not Expo Go (attestation does not work in Expo Go/simulators). The one gap is **streaming SHA-256 of large videos** — `expo-crypto` has no streaming/file digest — solved with `react-native-quick-crypto` (native, Nitro) or a 30-line local Expo module.
- **Web3 in RN:** viem 2.57.1 is the stable line (viem 3 is still `3.0.0-next.12`); wagmi 3.7.7 requires viem 2.x. Hermes has BigInt, TextEncoder/TextDecoder, URL, web streams and `structuredClone` (Expo installs them), but **no WebCrypto (`crypto.subtle`)** — this is what breaks `multiformats` sha2 and any IPLD/UnixFS code on device. Fix: `react-native-quick-crypto` `install()` or `hasher.from()` + `@noble/hashes`.
- **Filecoin SDK:** `@filoz/synapse-sdk@2.0.2` (Filecoin Onchain Cloud; ESM-only; peer `viem@2.x`; `multiformats@14`). Upload accepts `Uint8Array | ReadableStream<Uint8Array>`, 127 B – 1,065,353,216 B per piece (≈1016 MiB), 2 copies by default, PieceCID computed client-side (`@filoz/synapse-core/piece`). No React Native support is claimed or tested anywhere. **Recommendation: do Filecoin uploads from the backend (Node), not from the phone**, at least for v1; use Synapse *session keys* later if you want client-direct uploads.
- **Storacha is a red flag:** `storacha.network` and `docs.storacha.network` now 301-redirect to **fil.one** ("S3 object storage built for the AI era", $4.99/TB/mo); `@storacha/client` was last published 2026-05-15 and the repo last pushed 2026-05-20. Treat the UCAN/w3up client as unmaintained and do not build Stamper's storage path on it.
- **Backend:** Hono 4.13 (or Fastify 5.12) on Node 24 LTS, Postgres 17 + pgvector 0.8.6 (bit vectors + Hamming distance + HNSW → perceptual-hash index), **BullMQ 6 with its new built-in PostgreSQL backend** (no Redis container needed), `sharp` for compositing the visible mark, ffmpeg for video, and a small **FastAPI sidecar** for TrustMark (`trustmark==0.9.2`, MIT) + PDQ (`pdqhash==0.2.8`). **Do not use MinIO for staging** — the repo was archived 2026-04-24; use a plain disk volume on the VPS (simplest), Garage v2.4.1, or a managed S3 (R2/B2/Hetzner).
- **DX:** pnpm 12.8 + Turborepo 2.11; TypeScript **6.0.3** (not 7.0 — the Go-native 7.0.2 has no programmatic API until 7.1, so typescript-eslint/ts-jest/Expo tooling can't consume it); Foundry v1.8.3 + `@wagmi/cli@2.10` foundry plugin for ABI/hook codegen; Vitest 5 for packages/web/api, `jest-expo@57` for RN unit tests, Maestro 2.11 (native `type: maestro` job in EAS Workflows) for mobile E2E, Playwright 1.63 for web.

---

## 1. Expo SDK — current state and module-by-module capabilities

### 1.1 Release train (verified from expo.dev changelogs + npm)

| SDK | Released | RN / React | Notes relevant to Stamper |
|---|---|---|---|
| 55 | 2026-02-25 | RN 0.83 / React 19.2 | Legacy Architecture dropped (New Arch only). All Expo packages now share the SDK major (e.g. `expo-camera@^55`). `expo-crypto` gained AES-GCM. `expo-camera` gained `videoStabilizationMode` and front-camera screen flash (Android). Hermes bytecode diffing → ~75% smaller EAS Update downloads. Expo Router v7. `expo-brownfield`. |
| 56 | 2026-05-21 | RN 0.85 / React 19.2 | iOS min **16.4**, Xcode 26.4. `expo/fetch` is now installed as `globalThis.fetch`. `expo-file-system`: task-based upload/download APIs, progress, `AbortSignal`, `File.watch()`. Expo Router no longer depends on React Navigation (codemod required). Precompiled community libs (~20% faster iOS builds). `@expo/vector-icons` deprecated → `@react-native-vector-icons/*`. |
| 57 | 2026-06-30 | RN 0.86 (template pins 0.86.3) / React 19.2.3 | "Minor-release-like" upgrade. `expo@57.0.17` (2026-08-27) fixes the Hermes V1 memory regression (apps importing reanimated/worklets). `expo prebuild` now cleans native dirs by default (`--no-clean` to keep). Current: `expo@57.0.26`. |
| 58 beta | 2026-09-15 (3–4 week beta) | RN 0.88 RC | iOS 27 support, `expo-app-intents`. Stable expected ~mid-October 2026. |

Current package versions (npm, 2026-09-30): `expo 57.0.26`, `expo-camera 57.0.6`, `expo-file-system 57.0.7`, `expo-crypto 57.0.3`, `expo-secure-store 57.0.4`, `expo-local-authentication 57.0.3`, `expo-background-task 57.0.21`, `expo-task-manager 57.0.21`, `expo-image-manipulator 57.0.20`, `expo-modules-core 57.0.20`, `@expo/app-integrity 57.0.2`, `expo-router 57.0.24`, `expo-updates 57.0.24`, `expo-dev-client 57.0.19`, `expo-image 57.0.5`, `expo-video 57.0.5`, `expo-media-library 57.0.5`, `eas-cli 24.8.0`, `jest-expo 57.0.5`.

### 1.2 `expo-camera` (verified: docs v57 + CHANGELOG)

- Photo: `takePictureAsync(options)` with
  ```ts
  type CameraPictureOptions = {
    quality?: number;              // 0–1, default 1
    base64?: boolean;
    exif?: boolean;                // include EXIF in result
    additionalExif?: Record<string, any>; // Android, iOS — write extra EXIF tags
    skipProcessing?: boolean;      // skip orientation fix (Android)
    imageType?: 'png' | 'jpg';     // web only
    shutterSound?: boolean;        // default true
    pictureRef?: boolean;          // return a native PictureRef instead of a file
  }
  ```
  `PictureRef` (`width`, `height`, `nativeRefType`) has `savePictureAsync(options)` → saves to cache dir. 57.0.3 (2026-07-16): iOS now preserves capture orientation as an EXIF tag instead of rotating pixels, processes full-res captures off the main thread, and removed a redundant JPEG re-encode. 57.0.1: responsive/fast capture prioritization on iOS; default iOS `pictureSize` is now `photo`.
  **`additionalExif` is the hook to embed the stamp code / claim id in EXIF at capture time** (e.g. `UserComment`, `ImageDescription`). EXIF is routinely stripped by messaging apps, so treat it as a convenience signal, not the durable one.
- Video: `recordAsync({ maxDuration, maxFileSize, codec })`. `codec` is **iOS-only** (`'avc1' | 'hvc1' | 'jpeg' | 'apcn' | 'ap4h'`; `getAvailableVideoCodecsAsync()` is iOS-only). Props: `videoQuality: '2160p'|'1080p'|'720p'|'480p'|'4:3'`, `videoBitrate` (bps), `videoStabilizationMode: 'off'|'standard'|'cinematic'|'auto'`, `mode: 'picture'|'video'`, `ratio` (Android), `pictureSize` (from `getAvailablePictureSizesAsync()`), `autofocus` (iOS), `zoom` 0–1, `active` (iOS pause without unmount). Wait for `onCameraReady` before capturing.
- **No RAW/DNG/ProRAW** support in `expo-camera`. If RAW ever matters, the alternative is `react-native-vision-camera@5.2.3` (new v5 API: `useVideoOutput({ fileType: 'mp4' })`, `capturePhotoToFile()`, persistent recorder). I could not render its v5 API pages in this session, so codec/bitrate/RAW specifics for v5 are **unverified** (v4 had `videoCodec: 'h264'|'h265'` and `videoBitRate`). Default for Stamper: `expo-camera`.
- Web: works in most browsers; image URIs are base64 on web. Config plugin: `cameraPermission`, `microphonePermission`, `recordAudioAndroid`, `barcodeScannerEnabled` (barcode scanning also works for the "scan a stamp" flow in-app; 57.0.6 fixed iOS scanner leaks).

### 1.3 `expo-file-system` — the new object API (verified: docs v57)

Stable since SDK 54 (old API under `expo-file-system/legacy`; calling the legacy functions from the main entry *throws at runtime*). Native only — no web.

- `File`: `text()/bytes()/arrayBuffer()/base64()` (+ `*Sync`), `readableStream(): ReadableStream<Uint8Array>`, `writableStream()`, `open(mode) → FileHandle` with `readBytes(length)`, `writeBytes`, `offset`, `size`, `close()` (random access / chunked reads); `copy/move` (async since SDK 56, `overwrite` option), `delete`, `write(string|Uint8Array)`, `info()`, `size`, `exists`, `uri`, `type` (MIME), `modificationTime`, `contentUri` (Android). `md5` is **deprecated**; **there is no SHA-256 or any digest API on `File`**.
- `Directory`: `create/list/delete/copy/move/createFile/createDirectory/watch()`. `Paths.cache`, `Paths.document`, `Paths.bundle`, `Paths.availableDiskSpace`, path helpers.
- Uploads:
  ```ts
  // immediate
  const res = await file.upload(url, options)            // Promise<UploadResult {status, headers, body}>
  // task-based
  const task = file.createUploadTask(url, options)        // UploadTask: uploadAsync(), cancel(), addListener(), state
  type UploadOptions = {
    headers?: Record<string,string>; mimeType?: string;
    uploadType?: UploadType.BINARY_CONTENT | UploadType.MULTIPART;   // default BINARY_CONTENT
    httpMethod?: 'POST'|'PUT'|'PATCH'; fieldName?: string; parameters?: Record<string,string>;
    onProgress?: (p: {bytesSent, totalBytes}) => void; signal?: AbortSignal;
    sessionType?: 'background' | 'foreground';            // iOS only, default 'background' (NSURLSession background session)
  }
  ```
  Also: `fetch(url, { method: 'POST', body: file })` and `FormData.append('data', file)` with `expo/fetch` stream the file without buffering into JS.
- Downloads: `File.downloadFileAsync(url, dest)` and `File.createDownloadTask(url, dest, { headers, onProgress, signal, sessionType })` with pause/resume.
- Limits: Android SAF `content://` can't open ReadWrite; ArrayBuffer max is 32-bit signed on Android; multipart `onProgress` counts framing overhead.

### 1.4 `expo-crypto` (verified)

`digestStringAsync(alg, string)`, `digest(alg, data: BufferSource): Promise<ArrayBuffer>` (SHA-1/256/384/512, MD5…), `getRandomValues()`, `randomUUID()`, AES-GCM (`aesEncryptAsync/aesDecryptAsync`, `AESEncryptionKey`, SDK 55+). **No streaming/incremental hashing, no file hashing, and it does not polyfill `globalThis.crypto`.** Fine for photos (read `file.bytes()` → `digest`), not for 500 MB videos (memory). See §2.4 for the streaming solution.

### 1.5 `expo-secure-store` / `expo-local-authentication` (verified)

- SecureStore: iOS Keychain (`kSecClassGenericPassword`), Android Keystore-encrypted SharedPreferences. "Historically, some iOS releases refused values above roughly 2048 bytes" → store **keys and short tokens only**, never large blobs (UCAN proofs, cached claims). Options: `keychainAccessible` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` etc.), `requireAuthentication` (biometric-gated reads; not usable in Expo Go). Config plugin: `configureAndroidBackup` (default true — set **false** for device-bound keys), `faceIDPermission`. No web.
- LocalAuthentication: `authenticateAsync({ promptMessage, disableDeviceFallback, biometricsSecurityLevel: 'strong' })`, `hasHardwareAsync`, `isEnrolledAsync`, `getEnrolledLevelAsync`, `supportedAuthenticationTypesAsync`. Plugin: `faceIDPermission`.

### 1.6 Background work (verified)

- `expo-background-task` = WorkManager (Android) / BGTaskScheduler (iOS). **Minimum interval 15 min, default 12 h, deferrable, system-scheduled, needs battery/network; not available on iOS simulators.** It is for "sync later", not for pushing a just-captured video.
- For actual background uploads use `File.upload`/`createUploadTask` with `sessionType: 'background'` (iOS continues the transfer after the app is backgrounded/suspended). Android has no equivalent in Expo: keep the upload in the foreground (progress UI) or write a WorkManager local module later. `expo-background-fetch` is not mentioned as deprecated in the SDK 57 docs, but `expo-background-task` is the recommended API.

### 1.7 `@expo/app-integrity` — App Attest + Play Integrity without custom native code (verified)

- Official Expo package, **status "Alpha (breaking changes expected)"**, `57.0.2` for SDK 57 (58.0.1 already published for SDK 58). Install: `npx expo install @expo/app-integrity`.
- iOS: `isSupported`, `generateKeyAsync(): Promise<keyId>` (Secure Enclave key), `attestKeyAsync(keyId, challenge): Promise<attestationObjectBase64>`, `generateAssertionAsync(keyId, challenge)`. Not supported on simulators; requires the App ID registered with App Attest. **EAS Build auto-syncs the `com.apple.developer.devicecheck.appattest-environment` entitlement** from `ios.entitlements` in app config (listed as supported in EAS "iOS capabilities"; disable with `EXPO_NO_CAPABILITY_SYNC=1`).
- Android: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)` once per launch, `requestIntegrityCheckAsync(requestHash)` per sensitive action (standard request), plus `generateHardwareAttestedKeyAsync(keyAlias, challenge)`, `getAttestationCertificateChainAsync(keyAlias)`, `isHardwareAttestationSupportedAsync()` (Android Keystore key attestation).
- Server side (verified from Google docs): `requestHash` ≤ 500 bytes, must be a digest of the request (SHA-256 of a stable serialization); decode with `POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken` using a service account with the `playintegrity` scope (`googleapis@182.0.0` has a client); verdict fields `requestDetails.requestHash`, `appIntegrity.appRecognitionVerdict == 'PLAY_RECOGNIZED'`, `deviceIntegrity.deviceRecognitionVerdict ∋ 'MEETS_DEVICE_INTEGRITY' | 'MEETS_STRONG_INTEGRITY'`; Google clears verdicts on token replay; **app must be distributed via Google Play** (internal testing track works). Apple: verify the attestation CBOR (cert chain to the App Attest root, nonce = SHA256(authData ‖ clientDataHash), keyId, App ID, counter, development vs production AAGUID) and assertions (signature over SHA256(authenticatorData ‖ SHA256(clientData)), increasing counter). `node-app-attest@1.0.1` (MIT, published 2026-02-20) exposes `verifyAttestation({attestation, challenge, keyId, bundleIdentifier, teamIdentifier, allowDevelopmentEnvironment}) → {keyId, publicKey}` and `verifyAssertion({assertion, payload, publicKey, bundleIdentifier, teamIdentifier, signCount}) → {signCount}`.
- Alternatives if the alpha bites: `@pagopa/io-react-native-integrity@0.3.2` (MIT, Italian gov app; Play Integrity + App Attest + Android hardware key attestation), `react-native-device-binding@1.0.1` (hardware-backed P-256 keys in SE/Keystore), `react-native-passkeys@0.4.2`.

### 1.8 Hardware keys and why they cannot sign your on-chain claims directly (verified facts, inferred conclusion)

Secure Enclave / Android Keystore (StrongBox) keys are **P-256 (ES256)**; App Attest assertions sign Apple's own structure, not an arbitrary EIP-712 digest; there is no secp256k1 in either hardware store. So the device cannot produce an `ecrecover`-compatible signature from hardware. Design consequence: use attestation to **bind a device identity to the backend**, and sign the EIP-712 `StampClaim` with (a) a software secp256k1 key generated on device and stored in SecureStore (biometric-gated, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Android backup off) and/or (b) the backend relayer key after it verified the attestation + assertion for that exact claim hash. P-256 verification on FEVM (RIP-7212-style precompile vs. a Solidity verifier at ~200–330k gas) is a contracts-dimension question; flagged in open questions.

### 1.9 `expo-modules-core` local modules and the CNG question (verified)

`npx create-expo-module@latest --local` scaffolds `modules/<name>/{android,ios,src,expo-module.config.json}` inside the app; `npx expo prebuild --clean` picks it up; it builds on EAS with no ejecting. Custom native code requires a **development build** (`expo-dev-client`), not Expo Go. SDK 56's Kotlin compiler plugin replaced runtime reflection in Expo Modules (≈40% faster Android cold start), and iOS got a direct JSI layer.
**Verdict:** a config-plugin-only workflow suffices for Stamper v1 (camera, file system, secure store, biometrics, app integrity are all first-party). The only candidates for a tiny local module are (1) a native streaming SHA-256 over a file path (CryptoKit `SHA256` / `MessageDigest`, ~30 lines each) if you prefer not to add `react-native-quick-crypto`, and (2) an Android WorkManager upload if background uploads on Android become a requirement.

### 1.10 `expo-image-manipulator` (verified)

Object API: `ImageManipulator.manipulate(uri).resize().crop().rotate().flip().extent()` → `renderAsync()` → `ImageRef.saveAsync({ format: SaveFormat.JPEG|PNG|WEBP, compress, base64 })`; `useImageManipulator()` hook. **It cannot composite/overlay another image** (no watermark drawing) and does not document EXIF preservation (assume stripped — inferred). Implication: render the **visible mark server-side** (sharp/ffmpeg) so the stamped asset is deterministic and reproducible; if you need an on-device preview, draw it in a `react-native-skia` offscreen surface (not evaluated here).

### 1.11 EAS Build / Update / Workflows (verified from expo.dev/pricing and docs)

- Free: 15 Android + 15 iOS builds/month, 1 concurrent build, low-priority queue; EAS Update 1,000 MAU free. Starter $19/mo, Production $199/mo, Enterprise custom. Overage: $1/Android build, $2/iOS build on medium workers (large = 2×). Workflows minutes: $0.018/min Linux medium, $0.075/min macOS medium.
- EAS Update: Hermes bytecode diffing on by default since SDK 56 ("diffed Hermes bundles… on average 58% smaller").
- EAS Workflows have a native Maestro job:
  ```yaml
  maestro_test:
    needs: [build_android_for_e2e]
    type: maestro
    params:
      build_id: ${{ needs.build_android_for_e2e.outputs.build_id }}
      flow_path: ['.maestro/capture.yml', '.maestro/verify.yml']
  ```
  Build profiles: `"simulator": true` (iOS `.app`), `"buildType": "apk"` (Android).

### 1.12 Monorepos with Expo (verified)

pnpm/yarn/npm/bun all supported. Since SDK 52 `expo/metro-config` configures Metro for monorepos automatically (remove `watchFolders`, `nodeModulesPaths`, `extraNodeModules`, `disableHierarchicalLookup` overrides). pnpm isolated `node_modules` is supported from SDK 54 (fallback `nodeLinker: hoisted` in `pnpm-workspace.yaml` if a native lib misbehaves); from SDK 55 autolinking resolution is automatic in monorepos. Hard rules: one `react-native` version per monorepo, one `react` per app.

---

## 2. Crypto / web3 in React Native (Hermes) in 2026

### 2.1 What the runtime actually provides (verified)

- React Native's documented polyfills: `fetch`, `XMLHttpRequest`, timers, console, a few ES2015–2017 helpers. **Nothing about `crypto`.** The claim circulating in some blog posts that "crypto.subtle is available on Hermes from RN 0.71+" is wrong — WebCrypto is not part of RN or Hermes.
- Expo SDK 57 installs globals on native: `TextEncoder`/`TextDecoder` (UTF-8 only on native), `TextEncoderStream`/`TextDecoderStream`, `ReadableStream`/`WritableStream`/`TransformStream`, `URL`/`URLSearchParams`, `structuredClone` (no ArrayBuffer transfer), and `expo/fetch` as the global `fetch` (WinterCG-style; **streaming response bodies via `resp.body.getReader()`** work; `EXPO_PUBLIC_USE_RN_FETCH=1` restores RN's fetch).
- Hermes stable release 260318099.0.0 (2026-06-05; the engine line in SDK 56/57): `TextDecoder` built-in, Set methods, iterator helpers, `Promise.withResolvers`, `WeakRef`/`FinalizationRegistry`, faster JSON/Map/Set, GC heaps >4 GB on 64-bit. BigInt is native (but `JSON.stringify` still throws on bigint — Synapse uses bigint ids everywhere; add a replacer).

### 2.2 viem / wagmi / ethers on RN (verified versions; polyfill list partly inferred)

- `viem@2.57.1` (2026-09-29) is the stable line. `viem@3.0.0-next.12` (2026-09-28) is a pre-release that reorganizes everything into namespaces (`Client.create`, `Account.fromPrivateKey`, `Chain.from`) backed by Ox; "run v2 and v3 together while dependencies migrate". **Stay on viem 2** — both `wagmi@3.7.7` and `@filoz/synapse-sdk@2.0.2` declare `peerDependencies: { viem: "2.x" }`.
- `wagmi@3.7.7` (`@wagmi/core@3.6.5`, `@wagmi/connectors@8.2.0`): peers `viem 2.x`, `react >=18`, `typescript >=5.9.3`, `@tanstack/react-query >=5`. v3 changes: connector deps are optional peers — install `@metamask/connect-evm@^2.1.0` (2.1.1), `@walletconnect/ethereum-provider@^2.21.1` (2.25.0), `@coinbase/wallet-sdk@^4.3.6` (4.4.0) only as needed; hooks renamed `useAccount→useConnection`, `useAccountEffect→useConnectionEffect`, `useSwitchAccount→useSwitchConnection`, mutate functions standardized to `mutate/mutateAsync`.
- `ethers@6.17.0` works on RN but is unnecessary if you standardize on viem; `@ethersproject/shims@5.8.0` is only for ethers v5.
- Polyfills on Expo 57 (minimal set): `import 'react-native-get-random-values'` (2.0.0) **first** in the entry file (viem's `secp256k1` via `@noble/curves` needs `crypto.getRandomValues`). On Expo 57 you no longer need `fast-text-encoding`, `react-native-url-polyfill` or `web-streams-polyfill` (Expo installs those globals); the older Callstack list (`fast-text-encoding`, `node-libs-expo/globals`, `react-native-url-polyfill/auto`, `react-native-get-random-values`, `@ethersproject/shims`) targets bare RN and is partly stale for Expo 57. If you install `react-native-quick-crypto` and call `install()`, it also provides `getRandomValues`, so the separate polyfill becomes redundant.
- EIP-712 in viem works unchanged on Hermes (`signTypedData`, `hashTypedData`, `verifyTypedData`); `abitype@1.3.0` gives `TypedData` typing for the shared package.

### 2.3 `@filoz/synapse-sdk` and `@storacha/client` on RN/Hermes

**Synapse** (verified from registry + source):
- `@filoz/synapse-sdk@2.0.2` (2026-09-25; 2.0.0 on 2026-09-03 with breaking cost/fee calculation changes), `@filoz/synapse-core@0.10.0`, `@filoz/synapse-react@0.5.0` (requires `wagmi@3.x`, `@tanstack/react-query@5.x`, `viem@2.x`). `"type": "module"` with subpath exports (`./storage`, `./payments`, `./session`, `./filbeam`, `./sp-registry`, `./warm-storage`) — Metro must resolve `package.json#exports` (Expo enables package-exports resolution by default in recent SDKs — inferred, verify on first build). Dependencies: `multiformats@14.0.5`; core: `ox@0.14.29`, `zod@4.4.3`, `dnum`, `p-some`, `p-locate`, `iso-web`, `sync-multihash-sha2@1.0.0`. README: "works in Node.js, browsers, and all major bundlers". **No React Native mention in README, docs, or issues** (GitHub issue search for "react native" in `FilOzone/synapse-sdk` returns only dependabot noise).
- Expected RN blockers (inferred from the dependency graph): `multiformats/hashes/sha2` browser build calls `crypto.subtle.digest('SHA-256', …)` (verified in `src/hashes/sha2-browser.ts`) → `TypeError` on Hermes unless `crypto.subtle` is polyfilled; PieceCID computation (fr32 + SHA-256 merkle over the whole file, `sync-multihash-sha2` is pure JS) on a 1 GB video would be very slow on a phone; `ReadableStream` is present but library `instanceof Blob/File` checks may not match RN's non-standard `Blob`.
- **Recommendation:** v1 uploads go **device → backend (streamed `File.upload`, resumable) → backend computes sha256 + PieceCID with native Node crypto → `synapse.storage.upload(stream, { pieceCid, … })`.** The backend already needs the funded wallet (USDFC deposits, WarmStorage operator approval, `addPieces` transactions). Revisit client-direct uploads with **session keys** (`@filoz/synapse-sdk/session`: `login/revoke/authorizationExpiry/fromSecp256k1`, time-boxed permissions) once an RN spike proves the crypto path.

**Storacha** (verified facts, inferred conclusion):
- `@storacha/client@2.1.4` last published **2026-05-15**; `storacha/upload-service` last push **2026-05-20** (not archived); README promises "modern browsers, Node 18+" only. `https://storacha.network/` and `https://docs.storacha.network/how-to/upload/` both **301 → `https://fil.one/`**, which markets "Fil One — S3 object storage built for the AI era", $4.99/TB/month ($4.99 minimum), 1 TB free for 30 days, no egress/API fees, and a boto3 example (`endpoint_url="https://eu-west-1.s3.filonecontent.com"`), docs at docs.fil.one. The UCAN delegation flow (`createDelegation(audience, ['space/blob/add','space/index/add','filecoin/offer','upload/add'], { expiration })` → client `addProof`/`setCurrentSpace` → `uploadFile(blob)`) is still what the npm README describes, and the upload client pulls `@ipld/unixfs`, `@ipld/car`, `multiformats@13`, i.e. the same WebCrypto dependency on device.
- **Conclusion: Storacha's w3up/UCAN product appears to have been superseded by Fil One (S3). Do not make it a dependency.** If an S3-compatible staging bucket on a Filecoin-aligned provider is attractive, Fil One is a candidate, but it is not the trustless Filecoin path — that is Synapse/Onchain Cloud (or raw deals), covered in the storage dimension.

### 2.4 Hashing large files on device (verified APIs; performance numbers inferred)

- `react-native-quick-crypto@1.1.7` (Nitro; needs `react-native-nitro-modules@0.37.1` + `react-native-quick-base64`; Expo: `npx expo install react-native-quick-crypto && npx expo prebuild`; RN ≥0.75). `install()` sets `global.Buffer` and `global.crypto` (incl. `subtle.digest`, `getRandomValues`). Streaming: `createHash('sha256').update(chunk)…digest('hex')`. Margelo claims "hundreds of times faster than all JS-based solutions"; "not all cryptographic algorithms are supported yet".
- Pattern: `const fh = file.open(); for (;;) { const chunk = fh.readBytes(1 << 20); if (!chunk.byteLength) break; hash.update(chunk); } fh.close();` (`FileHandle.readBytes(length)` reads from the current offset; confirm EOF behaviour in a spike — the docs don't state whether it returns an empty array or throws at EOF).
- Pure-JS fallback: `@noble/hashes@2.4.0` `sha256.create().update().digest()` works on Hermes but is JS-speed (expect tens of MB/s at best — inferred; fine for photos, painful for long videos).
- `multiformats` on RN: either `install()` quick-crypto before importing multiformats, or build your own hasher: `import { from } from 'multiformats/hashes/hasher'; const sha256 = from({ name: 'sha2-256', code: 0x12, encode: (d) => nobleSha256(d) })` (API verified as the standard multiformats hasher factory; the GitHub issue #183 "sha2 add React-Native support", closed 2022-05-25, is the canonical thread).

### 2.5 Embedded wallets / connectors with Filecoin (verified where noted)

| Option | Version | Filecoin (314/314159) | Notes |
|---|---|---|---|
| Privy | `@privy-io/react-auth 3.46.0`, `@privy-io/expo 0.75.0`, `@privy-io/chains 0.6.1` | Yes via `supportedChains` with `viem/chains` entries or `defineChain` (verified docs: "At minimum… name and chain ID, native currency, RPC URLs, and a blockexplorer URL"; `addRpcUrlOverrideToChain`) | FilOzone itself opened "add Privy login and embedded wallets to the console" for the Filecoin Pay explorer (issue #381) — good sign. Expo SDK exists. |
| Dynamic | `@dynamic-labs/sdk-react-core 5.9.2` | Yes via `overrides.evmNetworks` (verified docs) | Has a React Native SDK. |
| Web3Auth | `@web3auth/modal 11.4.2` | Yes via custom `chainConfig` (hex chainId, rpcTarget…) (verified docs) | Docs now also live under `docs.metamask.io/embedded-wallets` — Web3Auth became "MetaMask Embedded Wallets" (inferred from doc URLs; package names unchanged). |
| Reown AppKit | `@reown/appkit 1.8.24` + `@reown/appkit-adapter-wagmi 1.8.24`; RN `@reown/appkit-react-native 2.0.6` | Yes via `defineChain({ id: 314, caipNetworkId: 'eip155:314', chainNamespace: 'eip155', … })` (verified docs) | Free, open source; WalletConnect relay for mobile wallets. |
| MetaMask | `@metamask/connect-evm 2.1.1` (wagmi 3 `metaMask()` connector) | Yes — EVM chain; add-network params verified from docs.filecoin.io: mainnet `314`, `https://api.node.glif.io/rpc/v1` (alt. chainup, ankr), `FIL`; Calibration `314159`, `https://api.calibration.node.glif.io/rpc/v1` (alt. `https://rpc.ankr.com/filecoin_testnet`), `tFIL`. | `wallet_addEthereumChain` from wagmi `switchChain` works. |
| Coinbase | `@coinbase/wallet-sdk 4.4.0`; wagmi `coinbaseWallet({ preference: { options: 'eoaOnly' | 'smartWalletOnly' | 'all' } })` | EOA mode: arbitrary EVM chain (inferred). Smart Wallet / Base Account: chain list **not verified** — assume no Filecoin and force `eoaOnly`. | |
| Rabby | — | **Not in Rabby's public chain list** (`api.rabby.io/v1/chain/list`: 73 chains, no Filecoin, checked 2026-10-01). Rabby's "custom network" feature should still allow it (inferred). | |
| Ledger / Glif / FoxWallet / Brave / Trust / imToken / MathWallet / D'CENT | — | Listed on docs.filecoin.io "Wallets"; FEVM (0x) support per wallet not stated there. | Glif is the Filecoin-native web wallet. |

For Stamper's **verification site, no wallet is needed to verify** (read-only RPC). A wallet is only needed by *publishers* who want to self-sign claims on web, and by admins. Keep wagmi + viem with `[filecoinCalibration, filecoin]` and let the backend relay for mobile users.

---

## 3. Web (Next.js) stack

### 3.1 Next.js + viem/wagmi with Filecoin chains (verified)

- `next@16.3.8` (16.0 on 2025-10-21 — Turbopack stable, Cache Components/`"use cache"`; 16.2 March 2026; **16.3 on 2026-08-03** — up to 90% less dev memory, Instant Navigations/partial prefetching, Turbopack persistent build cache; 16.3.8 is the 2026-09-30 security release). No Next 17 announced. `react@19.3.0` on npm; Expo pins 19.2.3 — different apps may use different React versions, only duplicates *within* one app are a problem.
- viem chain definitions (verified from `wevm/viem` source): `filecoin` = id **314**, "Filecoin Mainnet", FIL/18, default RPC `https://api.node.glif.io/rpc/v1`, explorer Filfox `https://filfox.info/en`, `multicall3` at `0xcA11bde05977b3631167028862bE2a173976CA11` (block 3,328,594). `filecoinCalibration` = id **314159**, "Filecoin Calibration", tFIL/18, `https://api.calibration.node.glif.io/rpc/v1`, explorer Filscan `https://calibration.filscan.io`, `testnet: true`, **no `multicall3` entry in viem** — synapse-core's `calibration` chain object does carry multicall3 at the same address plus extra RPCs (`wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1`, `https://rpc.ankr.com/filecoin_testnet`, `https://filecoin-calibration.drpc.org`) and explorers (Blockscout `https://filecoin-testnet.blockscout.com`, Beryx, Filfox `https://calibration.filfox.info`, Glif). Mainnet extras in synapse-core: `wss://wss.node.glif.io/apigw/lotus/rpc/v1`, `https://rpc.ankr.com/filecoin`, `https://filecoin.drpc.org`, Blockscout `https://filecoin.blockscout.com`. Use synapse-core's chain objects (or extend viem's) when you need multicall on Calibration.
  ```ts
  // apps/web/lib/wagmi.ts
  import { createConfig, http } from 'wagmi'
  import { filecoin, filecoinCalibration } from 'viem/chains'
  import { metaMask, walletConnect, coinbaseWallet } from 'wagmi/connectors'
  export const config = createConfig({
    chains: [filecoinCalibration, filecoin],
    connectors: [
      metaMask(),                                        // needs @metamask/connect-evm
      walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_ID! }), // needs @walletconnect/ethereum-provider
      coinbaseWallet({ appName: 'Stamper', preference: { options: 'eoaOnly' } }),
    ],
    transports: { [filecoin.id]: http(), [filecoinCalibration.id]: http() },
    ssr: true,
  })
  ```

### 3.2 Browser capture (verified from the addpipe support table, updated 2026-05-21)

- Chrome 126+: WebM **and MP4**, VP8/VP9/H.264/AV1 (+HEVC from 136), Opus/PCM, AAC-LC in MP4. Safari macOS 14.0.2+/iOS 14.3+: MP4 + H.264 + AAC; **Safari 18.4+** adds WebM, VP8/VP9/HEVC/AV1, Opus; Safari 26 adds ALAC/PCM. Firefox: WebM + VP8 only (Opus/Vorbis). Always feature-detect with `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2')` → fall back to `video/webm;codecs=vp9,opus` → `video/webm`. Normalize server-side with ffmpeg; the *original* Stamper stores is the normalized file, and its hash is what goes on-chain, so the browser's container choice does not matter for verification.
- Photos on web: `getUserMedia` + `ImageCapture.takePhoto()` where available (Chrome), else canvas grab; no EXIF on web captures.

### 3.3 QR scanning (verified versions)

- **`barcode-detector@3.2.2`** (MIT; ponyfill/polyfill of the W3C `BarcodeDetector` API backed by `zxing-wasm@3.1.4`; `import { BarcodeDetector } from 'barcode-detector/ponyfill'`; `new BarcodeDetector({ formats: ['qr_code'] }).detect(imageOrVideo)`; the `.wasm` loads from jsDelivr by default — self-host via `prepareZXingModule` for CSP). Native `BarcodeDetector` is still Chromium/Android-only, so this polyfill is the pragmatic choice.
- `html5-qrcode@2.3.8` — last release **2023-04-15**; wraps zxing-js and uses native BarcodeDetector when available; works but unmaintained. `@zxing/browser@0.2.1` / `@zxing/library@0.23.0` — zxing-js is in low-maintenance mode. Prefer `barcode-detector`.
- Mobile app: `expo-camera` has built-in barcode scanning (`barcodeScannerEnabled`, `onBarcodeScanned`).

### 3.4 Showing the original next to the shared copy (verified versions; SSIM approach inferred)

- Sliders: `react-compare-slider@4.0.0` (React, MIT) or `img-comparison-slider@8.0.7` (web component). Diff overlay: `pixelmatch@7.2.0` (pixel diff with anti-aliasing tolerance; needs same dimensions — resize the shared copy to the original's size first).
- SSIM: `ssim.js@3.5.0` (MIT, pure JS; fine for ≤2 MP in a Web Worker). No maintained SSIM-in-WASM package found; `@techstark/opencv-js@5.0.0-release.1` ships OpenCV as WASM but is heavy (~8–10 MB) — overkill for a compare page. Heavy comparisons (video SSIM/VMAF, PDQ distance) belong in the backend/Python sidecar; the browser only needs to show "visually identical / modified" plus the slider.

---

## 4. Backend

### 4.1 Framework and runtime (verified versions)

- Node **24 LTS** (v24.21.0 "Krypton"; Node 26.10.0 is current but not LTS). TypeScript 6.0.3 (see §5.3). `tsx@4.23.15` for dev.
- **Hono 4.13.12** + `@hono/node-server@2.1.3` (tiny, Web-standard `Request/Response`, zod validator, runs the same code in a Worker if you ever move edge-side) — recommended. Fastify 5.12.5 is the mature alternative with the richer plugin ecosystem (multipart streaming, rate limiting). NestJS 12.1.2 is more ceremony than a one-person VPS project needs.
- Responsibilities of the TS service (`apps/api`):
  1. **Auth + device registration:** challenge issuance, App Attest attestation/assertion verification (`node-app-attest`), Play Integrity decode (`googleapis`), device record with public key + verdicts.
  2. **Upload intake:** resumable binary PUT per upload id (`File.upload` on device → `PUT /v1/uploads/:id` with `Content-Range`), stored on a staging volume; sha256 + PieceCID computed with Node `crypto` + `@filoz/synapse-core/piece` streaming transform.
  3. **Stamping pipeline (jobs):** normalize (ffmpeg/sharp), compute perceptual hashes (sidecar), embed invisible watermark (sidecar, TrustMark), draw visible mark + short code (sharp for images, ffmpeg drawtext/overlay for video), hash the final stamped asset, upload original + stamped to Filecoin via Synapse (2 copies by default), register the claim on FEVM (relay the EIP-712-signed claim or sign as relayer), persist tx hash / block / pieceCids.
  4. **Verification API:** by code / by hash / by upload-a-copy (sha256 exact match → perceptual match via pgvector → TrustMark decode fallback), returns the original's retrieval URLs (FilBeam/provider) and the on-chain record for independent checking.
- Python sidecar (`apps/ml`, FastAPI 0.142.2 + uvicorn 0.54.0, Python 3.12): justified only for **TrustMark** (`trustmark==0.9.2`, MIT incl. models; PyTorch `torch 2.14.1`; models auto-download on first use — served from S3 since April 2026; variants Q (default, PSNR 43–45 dB), P (48–50 dB), C (compact), B; **payload = 100 bits total: BCH_SUPER 40 bits / BCH_5 61 / BCH_4 68 / BCH_3 75** → a 61-bit BCH_5 payload comfortably carries a 48-bit stamp id + schema bits; `encode(img, str, MODE='text'|'binary')`, `decode(img) → (secret, present, schema)`, `remove_watermark`; JS/ONNX implementation is **decode-only**, Rust is full), **PDQ** (`pdqhash==0.2.8`, May 2025, Py 3.9–3.13, C++ build; `compute(img) → (256-bit, quality)`, `compute_dihedral` for 8 rotations/flips; MIT bindings, PDQ code under Meta's licence), and OpenCV (`opencv-python-headless 5.0.0.93`, `pillow 12.3.0`, `imagehash 4.3.2` for pHash/dHash). Note `numpy 2.5.3` requires Python ≥3.12 and `onnxruntime 1.30.0` ≥3.11 — pin Python 3.12 in the sidecar image. Keep the sidecar stateless: `POST /watermark/encode`, `POST /watermark/decode`, `POST /phash` with file paths on the shared volume.

### 4.2 Job queue (verified)

- **BullMQ 6.3.10** (v6 released 2026-07-30): pluggable backends — the **PostgreSQL backend is built in** (`import { Queue, Worker, createPostgresBackend } from 'bullmq'`; `new Queue('stamp', opts, createPostgresBackend)`; `pg` is an optional peer; PostgreSQL 13+; `runMigrations()`; docs state "full API parity" — queues, workers, flows, job schedulers, rate limiting, priorities — and production-ready). Breaking in v6: Redis internals no longer exposed (`BackendFactory` instead of `connection`), legacy repeatable jobs removed (use Job Schedulers), `Worker#resume()` async, `debounce` → `deduplication`.
- Consequence for a single VPS: **Postgres doubles as the queue — no Redis/Valkey container.** `pg-boss@12.35.1` is the Postgres-native alternative if BullMQ's PG backend disappoints. If you still want Redis: `ioredis@6.0.0`; Redis 8 is AGPL-licensed (Valkey/Dragonfly are BSD/BSL alternatives) — a licensing footnote, not a blocker for a self-hosted app.

### 4.3 Staging object storage before Filecoin (verified status)

- **MinIO: GitHub repo `minio/minio` is archived (2026-04-24; last release 2025-10-15).** Don't start a new project on it.
- Simplest: a Docker volume on the VPS (`/srv/stamper/staging`) shared by `api`, `worker` and `ml`; files are deleted after the Filecoin upload is confirmed and the stamped copies are cached. If you want an S3 API locally: **Garage v2.4.1** (Deuxfleurs, lightweight, AGPL) or **RustFS** (Apache-2.0, very active). Managed: Cloudflare R2 (no egress), Backblaze B2, Hetzner Object Storage, or **Fil One** (Storacha's successor; $4.99/TB, no egress) — all S3-compatible, usable via the AWS SDK from the backend.

### 4.4 Postgres schema sketch (design, informed by verified pgvector facts)

`pgvector 0.8.6`: `bit(n)` columns with Hamming `<~>` and Jaccard `<%>`, HNSW/IVFFlat via `bit_hamming_ops` (up to 64,000 dims) — perfect for PDQ (256 bits) and pHash (64 bits). Use the `pgvector/pgvector:pg17` image.

```sql
create extension if not exists vector;

create table users   (id uuid primary key, handle text unique, created_at timestamptz default now());
create table devices (
  id uuid primary key, user_id uuid references users, platform text check (platform in ('ios','android','web')),
  attest_key_id text, attest_public_key bytea, attest_sign_count bigint default 0,
  play_verdict jsonb, claim_signer bytea /* secp256k1 address the device signs claims with */,
  attested_at timestamptz, revoked_at timestamptz);
create table assets (
  id text primary key /* ULID */, owner_id uuid references users, device_id uuid references devices,
  kind text check (kind in ('photo','video')), mime text, bytes bigint, width int, height int, duration_ms int,
  captured_at timestamptz, sha256_original bytea unique, sha256_stamped bytea unique,
  piece_cid_original text, piece_cid_stamped text, stamp_code text unique /* short human code */,
  watermark_scheme text, watermark_payload bit(100), status text, created_at timestamptz default now());
create table claims (
  asset_id text references assets, claim_hash bytea primary key, typed_data jsonb, signature bytea, signer bytea,
  chain_id int, registry text, tx_hash bytea, block_number bigint, log_index int, confirmed_at timestamptz);
create table perceptual (
  asset_id text references assets, pdq bit(256), pdq_quality int, phash bit(64), frame_ts_ms int /* null for photos */);
create index on perceptual using hnsw (pdq bit_hamming_ops);
create index on perceptual using hnsw (phash bit_hamming_ops);
create table filecoin_copies (asset_id text, variant text, provider_id bigint, data_set_id bigint, piece_id bigint,
  retrieval_url text, confirmed_at timestamptz);
create table verifications (id bigserial primary key, asset_id text, method text, distance int, client_ip inet, at timestamptz default now());
```
Nearest-neighbour lookup: `select asset_id, pdq <~> $1 as d from perceptual order by pdq <~> $1 limit 5;` (PDQ threshold ≈ ≤31 bits for "same image").

### 4.5 Deployment on one VPS (design; Compose/Caddy are background knowledge)

```yaml
services:
  caddy:    { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy_data:/data] }
  web:      { build: ./apps/web, env_file: .env }                 # next start (standalone output)
  api:      { build: ./apps/api, env_file: .env, volumes: [staging:/srv/staging] }
  worker:   { build: ./apps/api, command: node dist/worker.js, env_file: .env, volumes: [staging:/srv/staging] }
  ml:       { build: ./apps/ml, volumes: [staging:/srv/staging, models:/root/.cache] }   # FastAPI + TrustMark/PDQ
  postgres: { image: pgvector/pgvector:pg17, volumes: [pg:/var/lib/postgresql/data] }
volumes: { staging: {}, pg: {}, caddy_data: {}, models: {} }
```
One relayer wallet (hot key in `.env`/Docker secret) for FEVM txs and Synapse payments; nightly `pg_dump` + rsync of `staging` off-box. Mobile builds/updates run on EAS, not on the VPS.

---

## 5. Monorepo & DX

### 5.1 Layout

```
stamper/
  apps/
    mobile/            Expo SDK 57 · expo-router 57 · expo-camera · expo-file-system · @expo/app-integrity ·
                       react-native-quick-crypto · viem 2 · (optional) @privy-io/expo
    web/               Next.js 16.3 (App Router) · wagmi 3.7 + viem 2.57 · barcode-detector · react-compare-slider · ssim.js
    api/               Hono 4 on Node 24 · drizzle-orm 0.45 + pg 8.23 · BullMQ 6 (Postgres backend) · @filoz/synapse-sdk 2 ·
                       sharp 0.35 · ffmpeg (system binary) · node-app-attest · googleapis
    ml/                FastAPI · trustmark · pdqhash · opencv-python-headless · pillow   (Python 3.12, Dockerfile)
  packages/
    stamp-core/        pure TS, zero node builtins: sha256 helpers (noble), stamp-code derivation (e.g. Crockford base32 of
                       the first 40 bits of the claim hash + check char), claim canonicalization (RFC 8785 JSON canonicalization
                       or a fixed ABI encoding), EIP-712 domain/types (`as const satisfies TypedData` from abitype), CID/PieceCID
                       string helpers; consumed by mobile, web and api
    contracts/         Foundry project (StampRegistry.sol, tests, scripts, broadcast/)
    contracts-abi/     generated by @wagmi/cli (foundry plugin → `generated.ts`; react plugin for web hooks)
    config/            tsconfig bases, biome/eslint config, tailwind preset
  tooling/             docker-compose.yml, Caddyfile, .maestro/, .github/workflows/
  pnpm-workspace.yaml  turbo.json  package.json
```
`packages/stamp-core` must stay free of Node built-ins and of `multiformats/hashes/sha2` (use `hasher.from` + noble) so the same code runs on Hermes, in the browser and in Node.

### 5.2 Tooling versions (verified)

- `pnpm 12.8.1` (`nodeLinker` default isolated is fine with SDK 57; keep `hoisted` as the documented fallback), `turbo 2.11.5` (cache `build`, `typecheck`, `test`, `lint`; `expo export`/EAS builds are not cached by Turbo — run them in EAS).
- `@wagmi/cli 2.10.0` (deps `viem 2.x`, `abitype ^1.1.1`; peer `typescript >=5.7.3`), foundry plugin options: `project`, `artifacts: 'out/'`, `include/exclude` globs, `deployments: { StampRegistry: { 314: '0x…', 314159: '0x…' } }`, `includeBroadcasts`, `forge: { build, rebuild, clean }`, `namePrefix`, and `wagmi generate --watch` for a tight contracts↔frontend loop:
  ```ts
  // packages/contracts-abi/wagmi.config.ts
  import { defineConfig } from '@wagmi/cli'
  import { foundry, react } from '@wagmi/cli/plugins'
  export default defineConfig({
    out: 'src/generated.ts',
    plugins: [
      foundry({ project: '../contracts', include: ['StampRegistry.json'],
        deployments: { StampRegistry: { 314159: '0x0000000000000000000000000000000000000000' } } }),
      react(),
    ],
  })
  ```
- Foundry **v1.8.3** (2026-09-15). `abitype 1.3.0`.
- Tests: **Vitest 5.0.3** (5.0.0 on 2026-09-03) for `packages/*`, `apps/web`, `apps/api`; `jest-expo@57.0.5` for RN component/unit tests (Expo's supported preset); `@playwright/test 1.63.0` for the web verify flow; **Maestro CLI 2.11.0** (2026-09-29) for mobile E2E with EAS Workflows' `type: maestro` job (Detox 20.51.4 still exists but needs native build config and is no longer where Expo's docs point).
- Lint/format: Biome 2.5.15 (fast, one tool) or ESLint 10.11.0 + `eslint-config-expo`.
- CI: GitHub Actions for `turbo run lint typecheck test` + `forge test`; EAS Workflows for `build → maestro_test → submit` and `eas update` on merge; Docker image build + `docker compose pull && up -d` over SSH for the VPS.

### 5.3 TypeScript 6 vs 7 (verified)

- `typescript@7.0.2` (2026-07-08) is the Go-native compiler: 8–12× faster builds, **but ships "without a programmatic API"** until 7.1 — typescript-eslint, ts-jest, Vue/Svelte/Astro tooling can't use it yet; Microsoft provides `@typescript/typescript6` for side-by-side installs. `typescript@6.0.3` (2026-04-16) is the last JS-based release and the Expo SDK 57 template pins `~6.0.3`. TS 6 defaults changed: `rootDir` defaults to `./`, `types` defaults to `[]`, removed ES5 target, CommonJS `module`, `baseUrl`, classic resolution.
- **Pin `typescript@~6.0.3` workspace-wide**; optionally add `@typescript/native-preview` (tsgo) only for `turbo typecheck` speed. `wagmi` (TS ≥5.9.3) and `@wagmi/cli` (≥5.7.3) are satisfied.
- `prisma`'s npm `latest` tag currently points at `8.0.0-rc.19` (odd — verify before adopting); Drizzle `0.45.3`/`drizzle-kit 0.31.11` is the safer pick for pg + pgvector custom types.

---

## 6. Synapse SDK v2 — the API you will actually call from `apps/api` (verified from source, 2026-09-30)

```ts
import { Synapse } from '@filoz/synapse-sdk'
import * as Piece from '@filoz/synapse-core/piece'
import { privateKeyToAccount } from 'viem/accounts'
import { http } from 'viem'
// chain objects: `calibration` is DEFAULT_CHAIN in synapse-sdk; exact export path of `calibration`/`mainnet` to confirm
// (defined in packages/synapse-core/src/chains.ts: mainnet id 314, calibration id 314159, devnet id 31415926)

const synapse = Synapse.create({            // synchronous in v2
  chain: calibration,                        // defaults to calibration
  account: privateKeyToAccount(process.env.RELAYER_PK as `0x${string}`),
  transport: http(),                         // defaults to chain's transport
  withCDN: true,                             // FilBeam retrieval
  // sessionKey?, requiredPermissions?, source?, pieceBatching?
})

// PieceCID without buffering: pipe the staged file through the transform
const { transform, result } = Piece.transformStream()
await fileStream.pipeThrough(transform).pipeTo(sink)          // or compute from bytes: await Piece.calculate(bytes)
const piece = await result                                    // { root, size, height, toString() → 'bafkz…' }

const res = await synapse.storage.upload(bytesOrReadableStream, {
  pieceCid: piece,                                            // REQUIRED for streaming input
  metadata: { app: 'stamper' },                               // data-set metadata
  pieceMetadata: { assetId, variant: 'original' },            // per-piece metadata
  copies: 2,                                                  // default 2 (primary + SP-to-SP secondary)
  callbacks: { onStored, onPiecesAdded, onPiecesConfirmed },
  signal,
})
// res: { pieceCid, size, requestedCopies, complete, copies: [{ providerId, dataSetId, pieceId, role:'primary', retrievalUrl, isNewDataSet }], failedAttempts }
const bytes = await synapse.storage.download({ pieceCid, withCDN: true })  // CDN → chain → known providers
```
- Constants (synapse-core `utils/constants.ts`): `MIN_UPLOAD_SIZE = 127` bytes, `MAX_UPLOAD_SIZE = 1_065_353_216` bytes (1 GiB × 127/128); Filecoin messages capped at 64 KiB (piece batching). `DEFAULT_COPY_COUNT = 2`, 5 secondary retries.
- Retrieval URLs: FilBeam `https://{ownerAddress}.filbeam.io/{pieceCid}` (Calibration: `…calibration.filbeam.io`), or direct PDP provider `{serviceURL}/piece/{pieceCid}`.
- Addresses from source: USDFC mainnet `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`, Calibration `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`; multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` on both; Warm Storage (FWSS/FWSS-view) and PDPVerifier addresses are in `Abis.generated` and on https://docs.filecoin.cloud/resources/contracts (page not renderable by my fetcher — read it directly).
- `@filoz/synapse-react@0.5.0` (`SynapseProvider` + hooks for balances/deposits/approvals/uploads; breaking 0.5.0: `PdpDataSet.provider` and `Piece.url` may be `null`) is for the **web admin/publisher UI**, not for the phone.

---

## 7. React-Native-specific pitfalls to design around (checklist)

1. **No WebCrypto on Hermes** → `multiformats` sha2, IPLD/UnixFS, CAR builders and anything calling `crypto.subtle` throw. Decide once: `react-native-quick-crypto` + `install()` at app entry, or keep all CID/PieceCID math off-device.
2. **`crypto.getRandomValues` must be polyfilled before viem/noble load** (`react-native-get-random-values` first import, or quick-crypto `install()`).
3. **No streaming hash in `expo-crypto`; no digest on `File`** → quick-crypto `createHash` over `FileHandle.readBytes` chunks, or a local Expo module.
4. **Memory:** never `file.bytes()` a video; stream (`readableStream()`, `File.upload`, `fetch(body: file)`). Android ArrayBuffer cap is 2 GiB.
5. **ESM-only / `exports`-only packages** (`@filoz/synapse-sdk` is `type: module` with subpath exports; `ox`, `multiformats@14`) → Metro package-exports resolution must be on; some packages ship `.ts` sources with `.ts` import specifiers — test the bundle early (spike in week 1).
6. **BigInt + JSON:** Synapse/viem return `bigint` (ids, amounts); `JSON.stringify` throws → central serializer (`(k, v) => typeof v === 'bigint' ? v.toString() : v`) and never put bigint in React Query keys.
7. **SecureStore ≈2 KB per value** → keys/tokens only; pending claims and caches in `react-native-mmkv@4.3.2` (encrypted) or `expo-sqlite`.
8. **Attestation needs real devices + store distribution:** App Attest no simulator, Play Integrity requires Play distribution (internal testing track), neither meaningful in Expo Go → dev builds from day one; keep a "dev device" allowlist in the backend for local work.
9. **Hardware keys are P-256, not secp256k1** → claims are signed by a software secp256k1 key (biometric-gated) or relayed; don't promise "hardware-signed on-chain claims".
10. **EXIF is not durable** (`additionalExif` is stripped by WhatsApp/Instagram/iMessage re-encodes) → visible mark + TrustMark invisible watermark + perceptual index are the durable signals; EXIF is a bonus.
11. **Visible mark must be rendered server-side** (`expo-image-manipulator` cannot composite) so the stamped artifact is byte-reproducible from the original + deterministic parameters.
12. **Background uploads:** iOS via `sessionType: 'background'`; Android only while the app is alive → foreground progress UI with retry, resumable `Content-Range` PUTs on the backend, upload ids persisted locally. `expo-background-task` (≥15 min, deferrable) is only for "retry pending uploads later".
13. **`expo/fetch` is the global fetch (SDK 56+)** — libraries doing `instanceof` checks on RN's `Blob`/`FormData` may misbehave; prefer `Uint8Array`/`ReadableStream` inputs.
14. **One React Native version per monorepo; one React per app** (pnpm isolated is fine; use `pnpm why react-native` if Metro complains).
15. **`@expo/app-integrity` is alpha** → wrap it behind your own `DeviceAttestation` interface so swapping to `@pagopa/io-react-native-integrity` or a local module is a one-file change.
16. **TypeScript 7 breaks typescript-eslint/ts-jest** → stay on `~6.0.3` until 7.1 ships an API.
17. **Package drift:** viem 3 (`next`), Expo 58 (beta), Synapse 2.x (two breaking releases in September), `prisma@latest` = RC → pin exact versions, use Renovate with grouped updates, and keep an `exports`-resolution smoke test in CI.

---

## 8. Recommended stack (one line each)

- Mobile: `expo@~57.0.26`, `react-native@0.86.3`, `expo-router@~57`, `expo-camera@~57`, `expo-file-system@~57`, `expo-crypto@~57`, `expo-secure-store@~57`, `expo-local-authentication@~57`, `@expo/app-integrity@~57`, `react-native-quick-crypto@^1.1.7` (+ nitro-modules, quick-base64), `react-native-get-random-values@^2`, `react-native-mmkv@^4.3`, `viem@^2.57`, `@tanstack/react-query@^5`, `zod@^4`; optional `@privy-io/expo@^0.75` if publishers want a wallet identity on mobile.
- Web: `next@^16.3.8`, `react@19.2.x`, `wagmi@^3.7`, `viem@^2.57`, `@tanstack/react-query@^5`, connectors as needed (`@metamask/connect-evm`, `@walletconnect/ethereum-provider`, `@coinbase/wallet-sdk`), `@reown/appkit` optional, `barcode-detector@^3.2`, `react-compare-slider@^4`, `pixelmatch@^7`, `ssim.js@^3.5`.
- Backend: Node 24, `hono@^4.13` + `@hono/node-server@^2.1`, `drizzle-orm@^0.45` + `pg@^8.23`, `bullmq@^6.3` (Postgres backend), `@filoz/synapse-sdk@^2.0.2` + `viem@^2.57`, `sharp@^0.35`, ffmpeg 7 (system), `node-app-attest@^1`, `googleapis@^182`, `pino@^10`, `zod@^4`; Postgres 17 + pgvector 0.8.6; Python 3.12 sidecar `fastapi 0.142`, `trustmark 0.9.2`, `pdqhash 0.2.8`, `opencv-python-headless 5.0`, `pillow 12.3`.
- DX: `pnpm 12.8`, `turbo 2.11`, `typescript ~6.0.3`, Foundry 1.8.3, `@wagmi/cli 2.10` (+`abitype 1.3`), `vitest 5`, `jest-expo 57`, Maestro 2.11, `@playwright/test 1.63`, Biome 2.5, EAS (Free → Starter $19 when you exceed 15+15 builds/month).

---

## Sources

Expo
- https://expo.dev/changelog/sdk-55 · https://expo.dev/changelog/sdk-56 · https://expo.dev/changelog/sdk-57 · https://expo.dev/changelog/sdk-58-beta · https://expo.dev/changelog/sdk-56-beta
- https://docs.expo.dev/versions/latest/sdk/camera/ · https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-camera/CHANGELOG.md
- https://docs.expo.dev/versions/latest/sdk/filesystem/ · https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/ · https://expo.dev/blog/expo-file-system
- https://docs.expo.dev/versions/latest/sdk/crypto/ · https://docs.expo.dev/versions/latest/sdk/securestore/ · https://docs.expo.dev/versions/latest/sdk/local-authentication/ · https://docs.expo.dev/versions/latest/sdk/background-task/ · https://docs.expo.dev/versions/latest/sdk/imagemanipulator/ · https://docs.expo.dev/versions/latest/sdk/expo/ (expo/fetch + globals)
- https://docs.expo.dev/versions/latest/sdk/app-integrity/ · https://expo.dev/blog/expo-app-integrity · https://docs.expo.dev/build-reference/ios-capabilities/
- https://docs.expo.dev/modules/get-started/ · https://docs.expo.dev/develop/development-builds/introduction/ · https://docs.expo.dev/guides/monorepos/ · https://docs.expo.dev/eas/workflows/examples/e2e-tests/ · https://expo.dev/pricing
- https://raw.githubusercontent.com/expo/expo/sdk-57/templates/expo-template-default/package.json
- https://registry.npmjs.org/ (expo*, @expo/app-integrity dist-tags and dates)

Hermes / RN runtime
- https://reactnative.dev/docs/javascript-environment · https://github.com/facebook/hermes/blob/static_h/doc/blog/2026-06-05-new-hermes-stable-release.md
- https://raw.githubusercontent.com/multiformats/js-multiformats/master/src/hashes/sha2-browser.ts · https://github.com/multiformats/js-multiformats/issues/183
- https://raw.githubusercontent.com/margelo/react-native-quick-crypto/main/README.md · https://www.callstack.com/blog/build-modern-web3-dapps-on-ethereum-with-react-native-and-viem

viem / wagmi / wallets
- https://raw.githubusercontent.com/wevm/viem/main/src/chains/definitions/filecoin.ts · https://raw.githubusercontent.com/wevm/viem/main/src/chains/definitions/filecoinCalibration.ts · https://v3.viem.sh/docs/v2-migration
- https://wagmi.sh/react/guides/migrate-from-v2-to-v3 · https://wagmi.sh/cli/api/plugins/foundry · https://wagmi.sh/react/api/connectors/coinbaseWallet
- https://docs.privy.io/basics/react-native/advanced/configure-evm-networks · https://docs.privy.io/basics/react/advanced/configuring-evm-networks · https://github.com/FilOzone/filecoin-pay-explorer/issues/381
- https://docs.dynamic.xyz/chains/evmNetwork · https://web3auth.io/docs/connect-blockchain/custom-chains · https://docs.metamask.io/embedded-wallets/connect-blockchain/custom-chains · https://docs.reown.com/appkit/react/core/custom-networks
- https://docs.filecoin.io/networks-and-tools/assets/metamask-setup.md · https://docs.filecoin.io/networks-and-tools/assets/wallets.md · https://api.rabby.io/v1/chain/list

Filecoin SDKs
- https://github.com/FilOzone/synapse-sdk · https://raw.githubusercontent.com/FilOzone/synapse-sdk/master/packages/synapse-sdk/package.json · https://raw.githubusercontent.com/FilOzone/synapse-sdk/master/packages/synapse-sdk/src/synapse.ts · …/src/storage/context.ts · …/src/storage/manager.ts · https://raw.githubusercontent.com/FilOzone/synapse-sdk/master/packages/synapse-core/src/chains.ts · …/synapse-core/src/utils/constants.ts · …/synapse-core/src/utils/piece-url.ts · …/synapse-core/src/piece/index.ts · https://raw.githubusercontent.com/FilOzone/synapse-sdk/master/packages/synapse-react/README.md · https://api.github.com/repos/FilOzone/synapse-sdk/releases
- https://docs.filecoin.cloud/ · https://docs.filecoin.cloud/llms.txt · https://docs.filecoin.cloud/developer-guides/session-keys · https://docs.filecoin.cloud/resources/contracts
- https://www.npmjs.com/package/@storacha/client · https://raw.githubusercontent.com/storacha/upload-service/main/packages/w3up-client/README.md · https://github.com/storacha/upload-service · https://storacha.network/ (301 → https://fil.one/) · https://docs.storacha.network/how-to/upload/ (301 → https://fil.one/how-to/upload/) · https://fil.one/

Web capture / QR / compare
- https://addpipe.com/media-recorder-api-demo/ · https://webkit.org/blog/11353/mediarecorder-api/
- https://raw.githubusercontent.com/Sec-ant/barcode-detector/main/README.md · https://github.com/mebjas/html5-qrcode/releases · npm registry (html5-qrcode last publish 2023-04-15)
- npm registry: react-compare-slider, img-comparison-slider, pixelmatch, ssim.js, @techstark/opencv-js
- https://nextjs.org/blog (16.3, 16.3.8 security release)

Backend
- https://docs.bullmq.io/guide/postgresql · https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/changelog.md (6.0.0, 2026-07-30)
- https://raw.githubusercontent.com/pgvector/pgvector/master/README.md (bit vectors, Hamming, HNSW)
- https://api.github.com/repos/minio/minio (archived: true, 2026-04-24) · https://api.github.com/repos/deuxfleurs-org/garage/tags · https://api.github.com/repos/rustfs/rustfs
- https://raw.githubusercontent.com/adobe/trustmark/main/README.md · https://pypi.org/project/pdqhash/ · https://pypi.org/pypi/{trustmark,pdqhash,fastapi,opencv-python-headless,pillow,onnxruntime,torch,numpy,uvicorn}/json
- https://raw.githubusercontent.com/uebelack/node-app-attest/main/README.md · https://developer.android.com/google/play/integrity/standard · https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server (page did not render; verification steps from Apple's documented protocol)
- npm registry: hono, @hono/node-server, fastify, @nestjs/core, bullmq, ioredis, pg, pg-boss, drizzle-orm, drizzle-kit, prisma, sharp, pino, zod, googleapis, node-app-attest, @pagopa/io-react-native-integrity, react-native-device-binding, react-native-passkeys

DX
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · npm registry typescript dist-tags/time (6.0.3 2026-04-16, 7.0.2 2026-07-08)
- https://api.github.com/repos/foundry-rs/foundry/releases/latest (v1.8.3) · https://api.github.com/repos/mobile-dev-inc/maestro/releases/latest (cli-2.11.0) · https://api.github.com/repos/vitest-dev/vitest/releases (5.0.0 2026-09-03)
- https://nodejs.org/dist/index.json (24.21.0 LTS "Krypton") · npm registry: pnpm, turbo, @wagmi/cli, abitype, vitest, jest-expo, detox, playwright, @biomejs/biome, eslint
