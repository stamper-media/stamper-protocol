# Stamper — Trusted capture, device attestation and key management (mobile + web), state of the art as of 2026-10-01

Dimension: trusted capture, device attestation, key management for Stamper's iOS / Android / web apps, and how the resulting signed capture claims reach a Filecoin-EVM registry.

Legend used throughout:
- **[verified]** — read directly from a primary source (vendor docs, spec, repo, package registry) during this research.
- **[reported]** — secondary press/community source; not confirmed against a vendor document.
- **[inferred]** — my engineering inference from verified facts; marked so the architecture team can challenge it.
- **[stale?]** — something that changed recently, is deprecated, renamed, or that I could not re-confirm.

Research constraints: the web-search budget for this session was exhausted mid-way; everything after that point was obtained by fetching known URLs. Items I could not retrieve are listed in "Open questions".

---

## 0. Executive summary

1. **Both mobile platforms give Stamper a hardware-backed P-256 signing key plus a vendor-rooted proof of app and device integrity.** On iOS this is one mechanism, App Attest (key in the Secure Enclave, attested by Apple, assertions sign arbitrary `clientData` with a monotonic counter). On Android it is two complementary mechanisms: Android Key Attestation (an X.509 chain from a key you generate in the TEE/StrongBox up to Google's root, carrying verified-boot state, patch levels and the calling app's package/signing certs) and the Play Integrity API (a Google-issued verdict: `MEETS_DEVICE_INTEGRITY` / `MEETS_STRONG_INTEGRITY`, `PLAY_RECOGNIZED`, `LICENSED`). Since May 2025 Play Integrity's Android 13+ verdicts are themselves derived from Key Attestation. [verified]
2. **The web cannot attest anything.** Passkeys prove a user, not a device or a page; the PRF extension derives symmetric secrets, it cannot sign arbitrary data; the WebAuthn `sign` extension is a 2024 draft PR with no implementations; `getUserMedia` gives no provenance. Web captures must be labelled as a lower assurance level ("Stamper witnessed this upload at time T from account A"), which is exactly what Truepic does with its Lens Web SDK (upload, then server-side verification). [verified]
3. **Filecoin EVM can verify the device's P-256 signature on-chain natively.** FIP-0113 (`P256VERIFY` precompile at `0x0100`, EIP-7951/RIP-7212-compatible) is Final and shipped in network version 28 "Fire Horse" on mainnet at epoch 6052800, 2026-05-27T14:00:00Z (builtin-actors v18.0.0). This removes the main objection to putting per-capture device signatures on-chain and it corrects the sibling threat-model's assumption that no such precompile exists. Gas is Wasm-instrumented (no fixed schedule), so it must be measured. [verified; gas = open]
4. **Attestation verification (Apple x5c chains, Android chains, Play Integrity tokens) stays off-chain**, performed by a Stamper "verifier" that then registers the device public key on the contract with an EIP-712 countersignature and stores the raw attestation bundle on Filecoin (content-addressed) so anyone can re-run the verification against Apple/Google roots. Per-capture signatures are then verified on-chain forever without trusting Stamper. [inferred design]
5. **Honest limits:** the analog hole (photographing a screen or print) is not solved by any attestation scheme; C2PA says so explicitly, Truepic bolts on a "picture-of-picture" score, and Apple's reported "Reference Image" (iPhone 18 Pro, iOS 27) adds an ML "confidence model" for photographed screens. On Android, `MEETS_STRONG_INTEGRITY` is spoofable with a leaked, not-yet-revoked OEM keybox (TrickyStore); Google mitigates with its revocation list and Remote Key Provisioning (mandatory for devices launching with Android 16). On iOS, App Attest is only bypassable with a modified OS and Apple exposes a per-device "risk metric" (number of attested keys in 30 days) to catch key farms. [verified]
6. **Recommended assurance scheme:** L0 web/unattested, L1 attested app (App Attest or Play Integrity DEVICE + Play-recognized), L2 hardware-attested key (App Attest production + risk metric, or Android Key Attestation TEE/StrongBox with verified boot + CRL + patch level, plus Play Integrity STRONG where Play exists), L3 reserved for secure-element + sensor-level evidence / ingesting C2PA Level-2 device manifests (Pixel 10). Exact flows in §6.

---

## 1. iOS: App Attest, DeviceCheck, Secure Enclave keys, React Native/Expo modules

### 1.1 What App Attest attests [verified]

Source: Apple, "Establishing your app's integrity", "Validating apps that connect to your server", "Attestation Object Validation Guide", "Assessing fraud risk", "Preparing to use the App Attest service", `DCAppAttestService` (all read 2026-09-30/10-01).

- App Attest lets the app "create a hardware-based, cryptographic key that uses Apple servers to certify that the key belongs to a valid instance of your app", then "cryptographically sign server requests using the certified key". Apple's threat statement: "A compromised version of your app running on a genuine, unmodified Apple device can't create valid assertions. However, an attacker that modifies the device's operating system might bypass restrictions."
- Availability (`DCAppAttestService`): iOS 14.0+, iPadOS 14.0+, Mac Catalyst 14.0+, macOS 11.0+, tvOS 15.0+, watchOS 9.0+, visionOS 1.0+. Requires an App ID registered in the developer account and the App Attest capability. Not available on the iOS Simulator (Expo docs: `isSupported` is false there). Only Action, extensible-SSO and watchOS extensions are supported; "All other extension types are not supported, even if `isSupported` is true".
- Key: generated by `generateKey` inside the Secure Enclave; the returned `keyId` is "already in Base64" and equals base64(SHA-256(public key in X9.62 uncompressed form)). The private key "can never be directly read or modified" by any process. Keys "remain valid through regular app updates, but don't survive app reinstallation, device migration, or restoration of a device from a backup". Apple says to generate one key "for each user account on each device" and not to reuse a key among users.
- Attestation (`attestKey(keyId, clientDataHash:)`): `clientDataHash` must be SHA-256 of a one-time server challenge of "at least 16 bytes". Returns a CBOR attestation object `{fmt: "apple-appattest", attStmt: {x5c: [credCert, caCert], receipt}, authData}` following WebAuthn authenticator-data layout. Server-side steps (verbatim list from Apple, condensed):
  1. Verify `x5c` (leaf `credCert` + intermediate "Apple App Attestation CA 1") up to the **Apple App Attestation Root CA** (PEM below).
  2. `nonce = SHA256(authData || SHA256(challenge))`.
  3. The `credCert` extension OID `1.2.840.113635.100.8.2` (DER sequence containing one octet string) must equal `nonce`.
  4. SHA-256 of the `credCert` public key (X9.62 uncompressed) must equal `keyId`.
  5. `authData.rpIdHash == SHA256("<TEAMID>.<bundleId>")` (on macOS the signing identifier replaces the bundle id).
  6. `counter == 0`.
  7. `aaguid` is `appattestdevelop` in development or `appattest` + seven `0x00` bytes in production. (Note: Apple's "Preparing" article says `appattestsandbox` for the sandbox; the validation guide says `appattestdevelop`. Accept both in dev, only `appattest\0…` in production.) [stale?: inconsistent Apple docs]
  8. `credentialId == keyId`.
  9. New in the 2026 docs: verify `apple_validation_category_01` (UInt32) in the `extensions` CBOR map of `authData`: 1 = OS executable, 2 = TestFlight, 3 = development signing, 4 = **App Store**, 5 = Enterprise/ad-hoc, 6 = Developer ID, 10 = other. And `apple_bundle_version_01` (string) = the app's bundle version. These let Stamper distinguish App Store builds from TestFlight/dev builds at verification time.
- Assertion (`generateAssertion(keyId, clientDataHash:)`): returns CBOR `{signature, authenticatorData}`; the signature (ECDSA P-256, DER) is over `nonce = SHA256(authenticatorData || SHA256(clientData))`; `authenticatorData` here contains only the first fields (rpIdHash, flags, 4-byte counter). Server must check rpIdHash, that the counter is strictly greater than the previous one, that the challenge embedded in `clientData` matches, and (2026 docs) the validation category and bundle version extensions. "There's no restriction on the number of assertions that you can make with a key."
- Rate limits: "we generally recommend that your apps call [attestKey] fewer than 100 requests per second across all installations", "ramping up no more than 10 million users per day per app"; "The rate limit threshold may fluctuate dynamically to protect Apple's certificate signing infrastructure." On `serverUnavailable` retry later with the same key; on any other error discard the key and generate a new one. `DCError` codes: `featureUnsupported`, `invalidInput`, `invalidKey`, `serverUnavailable`, `unknownSystemFailure`.
- Receipt and risk metric: the attestation's `receipt` (PKCS#7, Apple Root CA G3) can be POSTed server-to-server to `https://data.appattest.apple.com/v1/attestationData` (sandbox: `https://data-development.appattest.apple.com`) with a DeviceCheck-enabled ES256 JWT (same procedure as an APNs provider token). The returned `RECEIPT` has field 17 **Risk Metric** = "the number of attested keys associated with a given device over the past 30 days" (look for a low number); field 19 Not Before (refresh only after it; 304 otherwise), field 21 Expiration (refresh before it). Receipt verification: signature, chain to Apple Root CA G3, App ID in field 2, creation time (field 12) no more than five minutes old, attested public key (field 3) matches. HTTP 429 = too many requests. "You can't use a receipt generated in one environment to request a new receipt in the other."
- Environment: entitlement `com.apple.developer.devicecheck.appattest-environment` (`development` | `production`); distributed builds (TestFlight, App Store, Enterprise) always operate in production.

Apple App Attestation Root CA (downloaded from https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem, P-384, valid 2020-03-18 to 2045-03-15) [verified]:

```
-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
```

Important consequence for Stamper [inferred from the verified assertion format]: an App Attest **assertion is a hardware signature over arbitrary app-chosen bytes** (`clientData`). If `clientData` *is* the canonical capture claim, every capture is signed by the Secure Enclave key, bound to the app (rpIdHash), to the build category, and to a monotonic counter — no separate signing key is needed on iOS.

### 1.2 DeviceCheck (DCDevice) [verified]

- A separate, older service: the app obtains an ephemeral device token; the server can `POST` to `https://api.devicecheck.apple.com/v1/{query_two_bits|update_two_bits|validate_device_token}` (dev: `api.development.devicecheck.apple.com`) with an ES256 JWT. Apple stores **two bits per device per developer** (`bit0`, `bit1`, plus `last_update_time` YYYY-MM). The bits live on Apple's servers, so they persist across app reinstalls; useful as a "this device was banned / already got its free quota" flag. It does **not** attest app integrity. Error 429 on too many requests.

### 1.3 Secure Enclave keys via Security framework / CryptoKit [verified]

- "Works only with NIST P-256 elliptic curve keys. These keys can only be used for creating and verifying cryptographic signatures, or for elliptic curve Diffie-Hellman key exchange". "Can't encode preexisting keys." Hardware: A7 or later; Macs with T2/Touch ID or M1+.
- Create with `kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom`, `kSecAttrKeySizeInBits: 256`, `kSecAttrTokenID: kSecAttrTokenIDSecureEnclave`, access control `SecAccessControlCreateWithFlags(..., kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage [| .biometryCurrentSet], ...)`. `ThisDeviceOnly` means not in backups/migration (which is "also inherent to using the Secure Enclave"). Sign with `SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data)` (DER signature). CryptoKit alternative: `SecureEnclave.P256.Signing.PrivateKey`.
- Difference from App Attest: a plain SE key has **no Apple attestation**; nobody but your own app knows it is in the SE. Use it only if you need raw signatures outside the assertion format (e.g., for a different envelope); then bind it to the App Attest key by signing its public key inside an assertion (key-binding assertion). Recommended default: use the App Attest key directly (§1.1).

### 1.4 React Native / Expo modules (status October 2026)

| Module | What it exposes | Status | Fit for Stamper |
|---|---|---|---|
| `@expo/app-integrity` (Expo SDK 58 docs modified 2026-09-23; changelog latest 58.0.1; jsDelivr package.json showed 57.0.2; MIT) [verified] | iOS: `isSupported`, `generateKeyAsync()`, `attestKeyAsync(keyId, challenge)`, `generateAssertionAsync(keyId, challenge)` (base64 outputs). Android: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)`, `requestIntegrityCheckAsync(requestHash)`, `generateHardwareAttestedKeyAsync(keyAlias, challenge)`, `getAttestationCertificateChainAsync(keyAlias)` (base64 X.509 list), `isHardwareAttestationSupportedAsync()`. Errors `ERR_APP_INTEGRITY_PROVIDER_INVALID`, `ERR_APP_INTEGRITY_SERVER_UNAVAILABLE`. | Introduced Sept 2025 as alpha (SDK 54); the SDK 58 page no longer carries the alpha label. Android hardware attestation added in 0.1.8. Listed as "Included in Expo Go" — but App Attest's RP ID is the host app's App ID, so attestations made inside Expo Go would be for Expo Go's App ID, i.e. only development builds are meaningful [inferred]. | Best-maintained option. Gap: no function to **sign** with the Android hardware-attested key (only the chain is exposed), and the iOS `generateAssertionAsync` takes a `challenge` string that the module hashes — check in source that the hash is SHA-256 of exactly the bytes you pass, so the server can reproduce `clientDataHash`. |
| `react-native-device-binding` 1.0.1 (MIT; repo created 2026-04-20, 5 stars) [verified] | `generateKeyPair(alias)` → `{publicKey (SPKI DER b64), keyAttestation: "secure_enclave_ios" \| "android_keystore_strongbox" \| "android_keystore"}`, `getPublicKey`, `signChallenge(alias, utf8)` → SHA256withECDSA DER, `deleteKeyPair`, `hasKeyPair`, `isStrongBoxAvailable`. RN 0.70+, iOS 13+, Android API 23+; software fallback on simulators. | Very young, single maintainer. | Gives raw signing on both platforms, but its Android key is generated **without** `setAttestationChallenge`, so no attestation chain; it cannot by itself reach L2 on Android. |
| `@silencelaboratories/react-native-secure-key` 0.2.1 (Nitro modules `^0.35.4`; license "SEE LICENSE IN LICENSE"; 0 stars; pushed 2026-08-31) [verified] | `createIfNotExistSecureKey(alias)`, `getSecureKey`, `sign(alias, msg)` → base64 DER, `verify`, `deleteSecureKey`, `createMessageSigner`. TEE/SE keypair. | Niche, built for Silence Labs' MPC SDK. | Same gap as above (no attestation challenge), unclear license. |
| Older libs (`react-native-secure-element`, `react-native-secure-key-store`, `mosip/secure-keystore`) | assorted | Not re-verified for 2026 maintenance. [stale?] | Avoid. |

Recommendation: use `@expo/app-integrity` for App Attest + Play Integrity + Android attestation-chain retrieval, and write one small Expo Module (Kotlin ~150 lines, Swift ~100 lines) that adds `signWithAttestedKey(alias, bytes)` (Android: `Signature.getInstance("SHA256withECDSA")` on the Keystore key created with `setAttestationChallenge`) and, if ever needed, a plain Secure Enclave key on iOS. Do not depend on single-maintainer community modules for the trust root of the product. [inferred]

Server-side verification libraries [verified]:
- `node-app-attest` 1.0.1 (MIT; deps `asn1js`, `cbor`, `pkijs`; repo pushed 2026-03-16; 49 stars; 7 open issues) — JS attestation + assertion verification. Must be checked/extended for the newer `apple_validation_category_01` / `apple_bundle_version_01` steps.
- `veehaitch/devicecheck-appattest` (Kotlin, Apache-2.0, 82 stars) — last push July 2023 [stale?].
- Apple's "Attestation Object Validation Guide" provides a full sample attestation object with expected intermediate values (nonce `h7fQbZOkKU5G8BHma2zEAPC6sgcpl2xhlYC0KuYL/24=`, etc.) — use it as a test vector for whatever verifier Stamper ships.

---

## 2. Android: Play Integrity API and Key Attestation

### 2.1 Play Integrity API [verified]

Sources: Android developer docs — overview, standard, classic, verdicts, improvements, setup, device-recall pages; Play Console "What's new".

- Library: `implementation 'com.google.android.play:integrity:1.6.0'` (setup page). Free. Default quota **10,000 token requests/day and 10,000 token decryptions/day**, shared by classic and standard requests; increases via the quota form (up to 1 week processing). Overview page: minimum Android 6.0 (API 23) for both request types with library ≥ 1.4.0 (Expo docs still say API 21 — [stale?]).
- **Standard requests** (recommended for ≥95% of apps): one-time warm-up `IntegrityManagerFactory.createStandard(ctx).prepareIntegrityToken(PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(n).build())` (few seconds, limited to 5 warm-ups/min per app instance), then `provider.request(StandardIntegrityTokenRequest.builder().setRequestHash(h).build())` — a few hundred ms. `requestHash` ≤ 500 bytes, should be a SHA-256 of a stable serialization of the request (never raw sensitive data). Smart on-device caching and Google-side replay mitigation. Provider can expire → `INTEGRITY_TOKEN_PROVIDER_INVALID` (19) → re-prepare. `TOO_MANY_REQUESTS` → back off.
- **Classic requests**: `IntegrityManagerFactory.create(ctx).requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(nonce).build())`, nonce URL-safe base64, 16–500 chars, server-generated unique value (and/or hash of the request); latency a few seconds; 5 per minute per instance; do not cache; for "highest-value" actions.
- **Decrypt/verify**: either `POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken` `{ "integrity_token": "…" }` with a service account (scope `playintegrity`) on the Cloud project linked in Play Console, or locally with keys downloaded from Play Console: the token is a **JWE (A256KW + A256GCM) wrapping a JWS (ES256)**. Switching between Google-managed and self-managed keys immediately invalidates previously downloaded keys. Replay protection: decoding the same token again returns cleared verdicts (`deviceRecognitionVerdict` empty, app/licensing `UNEVALUATED`).
- **Verdict fields** (JSON, order not guaranteed):
  - `requestDetails`: `requestPackageName`, `requestHash` (standard) or `nonce` (classic), `timestampMillis` (check freshness window).
  - `appIntegrity`: `appRecognitionVerdict` ∈ `PLAY_RECOGNIZED | UNRECOGNIZED_VERSION | UNEVALUATED`; `packageName`, `certificateSha256Digest[]`, `versionCode`. `PLAY_RECOGNIZED` requires the exact build to be distributed by Google Play (internal testing track suffices).
  - `deviceIntegrity.deviceRecognitionVerdict[]` ∈ `MEETS_BASIC_INTEGRITY | MEETS_DEVICE_INTEGRITY | MEETS_STRONG_INTEGRITY | MEETS_VIRTUAL_INTEGRITY` (empty list = signs of attack/compromise/emulator). Opt-in extras: `deviceAttributes.sdkVersion`, `recentDeviceActivity.deviceActivityLevel` (`LEVEL_1` ≤10 standard req/h … `LEVEL_4` >50), `deviceRecall` (beta).
  - `accountDetails.appLicensingVerdict` ∈ `LICENSED | UNLICENSED | UNEVALUATED`.
  - `environmentDetails.appAccessRiskVerdict.appsDetected[]` ∈ `KNOWN_/UNKNOWN_ × INSTALLED | CAPTURING | CONTROLLING | OVERLAYS` (public beta since the May 2026 Play Console update; needs library ≥1.4.0 and adds latency; `verdictOptOut` per request) and `environmentDetails.playProtectVerdict` ∈ `NO_ISSUES | NO_DATA | POSSIBLE_RISK | MEDIUM_RISK | HIGH_RISK | UNEVALUATED`.
- **Meaning of the device levels since the May 2025 "improved verdicts" (Android 13+):**
  - `MEETS_DEVICE_INTEGRITY`: "hardware-backed proof that the device bootloader is locked and the loaded Android OS is a certified device manufacturer image".
  - `MEETS_STRONG_INTEGRITY`: DEVICE **plus** a security update "within the last year" for all partitions (OS and vendor); "this condition might change in the future". Google measured a ~14.5% drop in STRONG responses when this took effect.
  - `MEETS_BASIC_INTEGRITY`: Android Platform Key Attestation present; bootloader may be unlocked, boot state unverified; **rooted devices qualify**; no security guarantee.
  - On Android ≤12, STRONG does not require a recent patch — Google's own snippet: `if (sdkVersion < 33) check "MEETS_STRONG_INTEGRITY" else "MEETS_DEVICE_INTEGRITY"`.
  - `MEETS_VIRTUAL_INTEGRITY` only for Google Play Games on PC emulators; ordinary emulators get an empty verdict.
- **Device recall (beta)**: 3 bits per device **per developer account**, persist across reinstall and factory reset, retained 3 years, written server-side via `POST https://playintegrity.googleapis.com/v1/{pkg}/deviceRecall:write` within 14 days of the token; not available on emulators; permitted only for abuse prevention. Useful to ban a device whose attested keys were caught farming.
- Console: the "App integrity" page was replaced by **"Protected with Play"** (May 2026) [stale?: older docs/screens].
- SafetyNet Attestation is deprecated and superseded by Play Integrity; C2PA's guidance text still names "Android SafetyNet" — treat as stale. [verified that the guidance names it; shutdown date not re-verified]

### 2.2 Android Key Attestation [verified]

Source: "Verify hardware-backed key pairs with key attestation" (developer.android.com) read 2026-10-01; `android/keyattestation` repo.

- Request: `KeyGenParameterSpec.Builder(alias, PURPOSE_SIGN or PURPOSE_VERIFY).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(DIGEST_SHA256).setAttestationChallenge(challenge).setIsStrongBoxBacked(true /* optional */)`; then `KeyStore.getInstance("AndroidKeyStore").getCertificateChain(alias)`. "Send the certificates to a separate server that you trust for validation … Don't complete the following validation process on the same device."
- Chain: leaf (your key) → intermediate(s) → Google root. Attestation extension OID `1.3.6.1.4.1.11129.2.1.17` ASN.1 `KeyDescription { attestationVersion, attestationSecurityLevel (Software=0 | TrustedEnvironment=1 | StrongBox=2), keymasterVersion, keymasterSecurityLevel, attestationChallenge, uniqueId, softwareEnforced AuthorizationList, teeEnforced/hardwareEnforced AuthorizationList }`. In the hardware-enforced list: `origin` (must be `GENERATED`), `rootOfTrust { verifiedBootKey, deviceLocked, verifiedBootState (Verified | SelfSigned | Unverified | Failed), verifiedBootHash }`, `osVersion`, `osPatchLevel` (YYYYMM), `vendorPatchLevel`, `bootPatchLevel`; in the software-enforced list: `attestationApplicationId` (calling package name(s), version and signing-cert digests). "Only the first occurrence of the extension in the chain can be trusted."
- Roots and revocation: valid roots as JSON at `https://android.googleapis.com/attestation/root` (currently two: the RSA root with subject `SERIALNUMBER=f92009e853b6b045`, 2022-03-20 → 2042-03-15; and the ECDSA P-384 "Key Attestation CA 1", 2025-07-17 → 2035-07-15, which "will begin signing attestation certificate chains on February 1, 2026"). Revocation list at `https://android.googleapis.com/attestation/status` (JSON `entries` keyed by serial with `status: REVOKED|SUSPENDED`, `reason: KEY_COMPROMISE|SOFTWARE_FLAW`, `expires`, `comment`; about a thousand entries today, overwhelmingly `KEY_COMPROMISE`; respect `Cache-Control`). "Devices launched before 2021 have attestation keys with expired certificates. These keys are still trustworthy unless they appear in the certificate revocation list."
- Remote Key Provisioning: "For devices that launch with Android 16, the system supports only RKP. This policy phases out factory keys." "Attestation key leaks only affect the older provisioning mechanism … and don't apply to attestation keys certified by the newer RKP mechanism." RKP certificates are short-lived: "ensure that RKP certificates continue to have their validity period checked". Newer chains carry a provisioning-information extension (schema at source.android.com).
- Verifier: Google now says "Use the attestation verification Kotlin library … If you are using a different verifier, we recommend moving to the Kotlin library instead" (`android/keyattestation`, Apache-2.0, pushed 2026-09-28, 145 stars; `Verifier(GoogleTrustAnchors, ::getGoogleRevocationStatusFromWeb, { Instant.now() }, ConstraintConfig(...)).verify(chain, challengeChecker)` → `Success | ChallengeMismatch | PathValidationFailure | …`). No official JS port exists [not found]; a Node backend should either run this library in a small JVM verification service or implement the checks with `@peculiar/x509` + an ASN.1 parser and reuse Google's test vectors. [inferred]
- Emulators: an emulator's chain does not reach a Google root (software security level), so Key Attestation fails closed; Play Integrity returns an empty device verdict. [inferred from verified definitions]
- GrapheneOS and other de-Googled devices: GrapheneOS recommends apps use Key Attestation instead of Play Integrity: accept `verifiedBootState == Verified`, or `SelfSigned` with `verifiedBootKey` in the signed list at `https://grapheneos.org/attestation.json` (e.g., Pixel 10a `d8f879d10419eddc9fcda6280718be763f6bf12299e1f72df3ea8ad8a8eb7f80`). Expo's `generateHardwareAttestedKeyAsync` exists for exactly this path ("GrapheneOS and other secure Android distributions"). [verified]

Minimal Kotlin for the Stamper key (to put in the custom Expo module) [inferred, API shapes verified]:

```kotlin
val spec = KeyGenParameterSpec.Builder("stamper-capture-v1", PURPOSE_SIGN or PURPOSE_VERIFY)
    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
    .setDigests(KeyProperties.DIGEST_SHA256)
    .setAttestationChallenge(serverChallenge)          // ≥16 random bytes from Stamper
    .apply { if (strongBox) setIsStrongBoxBacked(true) } // catch StrongBoxUnavailableException, retry without
    .build()
KeyPairGenerator.getInstance(KEY_ALGORITHM_EC, "AndroidKeyStore").run { initialize(spec); generateKeyPair() }
val chain = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getCertificateChain("stamper-capture-v1")
// signing a claim:
val sig = Signature.getInstance("SHA256withECDSA").run { initSign(privateKey); update(claimBytes); sign() } // DER
```

---

## 3. Web: passkeys, PRF/largeBlob, Web Crypto, and what a browser cannot prove

### 3.1 Identity with passkeys [verified]

- WebAuthn Level 3 is a W3C Recommendation dated 2026-08-25 (no substantive changes since the 2026-05-26 CR snapshot). Extensions defined: `appid`, `appidExclude`, `credProps`, **`prf`**, **`largeBlob`** (+ authenticator-side ones). There is **no `sign` extension** in L3. Attestation statement formats: packed, TPM, android-key, android-safetynet, fido-u2f, none, apple, compound.
- Synced platform passkeys (iCloud Keychain, Google Password Manager) are the norm; they identify the account, not a device, and in practice return attestation `none` (passkeys.dev shows no device-bound attestation support in its matrix). [verified matrix; "none" is widely known, not re-verified in a vendor doc]

### 3.2 Can a passkey sign arbitrary data? No. [verified]

- PRF: "allows a pseudo-random function (i.e. HMAC), stored on the security key, to be evaluated when getting a credential" (Chromium intent-to-ship). It maps to CTAP2 `hmac-secret`; inputs are hashed with the context string "WebAuthn PRF" + NUL; output is a deterministic 32-byte secret per credential and salt; available in `navigator.credentials.get()` (some authenticators also at `create()`). It is **key derivation, not signing**. Support (Corbado matrix, Aug 2026): Android/Google Password Manager everywhere; Windows Hello since the Feb 2026 update KB5077181 on 24H2/25H2 with Chrome 147+/Firefox 148+; macOS 15+ via iCloud Keychain in Safari 18+/Chrome 132+/Firefox 139+; iOS 18.4+ (18.0–18.3 had data-loss bugs in hybrid flows); third-party managers inconsistent (1Password/Proton/Keeper/Enpass full; Bitwarden/KeePassXC partial; Dashlane/NordPass none). Corbado: "A capability flag is not a promise" and "no mission-critical function should require it".
- largeBlob: per-credential opaque storage, requires a client-side discoverable (resident) credential, `{support: "required"|"preferred"}` at create, `{read: true}` / `{write: ArrayBuffer}` at get, outputs `{supported, blob, written}`; authenticators "may have limited storage". Storage, not signing. Browser matrix not re-verified [stale?].
- The WebAuthn "sign" extension (w3c/webauthn PR #2078 by Yubico's emlun): opened 2024-05-28, still a **draft** (last activity 2025-05-19); "No active implementations"; Yubico has only internal prototypes. Do not plan on it.

### 3.3 Deriving a web signing key [verified APIs; design inferred]

- Web Crypto: `crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, /*extractable*/ false, ["sign"])`; `CryptoKey` is `[Serializable]`, so the object can be stored in **IndexedDB** and loaded later; `exportKey`/`wrapKey` on a non-extractable key throw `InvalidAccessError`. Ed25519 signing is also in the current spec (support varies). Keys are per-origin, per-browser-profile, wiped with site data, and run in the page's JS environment — nothing attests where they live.
- Pattern: (1) passkey login (identity); (2) generate a non-extractable P-256 key in the browser, store it in IndexedDB; (3) register its public key with the server **inside the passkey-authenticated session** (so the server binds key → account); optionally (4) use PRF to derive an AES-GCM key that encrypts a server-held backup of *metadata* (not the key, which is non-extractable). The web key therefore proves "the same browser profile that logged in as A signed this" — nothing about the device, camera, or page integrity.

### 3.4 Limits of "trusted capture" in a browser [verified facts; conclusion inferred]

- `getUserMedia` returns frames from whatever the OS calls a camera: virtual-camera drivers (OBS etc.), browser extensions and DevTools can substitute content; there is no device or app attestation on the web, and WebAuthn attestation (even where present) attests the authenticator, not the page.
- Industry confirmation: Truepic's **Lens Web SDK** is a `<lens-camera>` web component over `getUserMedia` that uploads captures "to the Lens API for verification and processing"; no client-side signing is documented — verification is server-side, exactly the posture Stamper should adopt for web.
- Labelling: web captures are **L0 — "Uploaded through Stamper web; device not attested"**. The visible mark/code should carry the level so viewers can tell L0 from L2 at a glance; the on-chain record carries `level` too.

---

## 4. The capture claim: contents, canonicalization, verification, keys, identity

### 4.1 Claim contents [inferred design, informed by C2PA 2.2 and Pixel 10 practice]

Minimal fields (all mandatory unless marked optional); encode as **DAG-CBOR** so the claim is itself a CID:

```
StamperClaim v1
  v: 1
  mediaCid: CID (CIDv1, raw or dag-pb/UnixFS, sha2-256 of the exact bytes)
  mediaSha256: bytes32           // redundant with CID but convenient on-chain
  mediaType: "image/jpeg" | "image/heic" | "video/mp4" | ...
  dims: {w, h} | {w, h, durationMs, fps}
  capturedAt: int (ms, device wall clock)        // untrusted
  monotonicNs: int (device uptime)               // ordering within a device/key
  counter: int                                   // App Attest counter or per-key counter
  deviceKeyId: bytes32 = sha256(SPKI) (Android/web) | App Attest keyId (iOS)
  platform: "ios" | "android" | "web"
  app: {bundleId|package, version, build}
  level: 0 | 1 | 2 | 3                           // assurance level claimed by the app; verifier may downgrade
  capture: { source: "in-app-camera", noGalleryImport: true, facing: "back"|"front", lensId?, liveVideo?: true }
  cameraSettings?: { iso, exposureMs, focalLengthMm, aperture, hdr, flash }   // optional
  location?: { lat, lon, altM?, hAccM, vAccM?, ts, source: "gps"|"fused"|"network" } // optional, consent-gated
  sensorEvidence?: { livePhotoMovieCid?, depthMapCid?, burstCids?[] }         // future work (§5.7)
  serverChallenge: bytes32                       // nonce issued for this capture session
  accountId: bytes32                             // pseudonymous user id (hash)
  wallet?: address                               // optional, only after EIP-712 link (§4.6)
  redactions?: { locationHash?: bytes32 }        // see redaction note below
```

- Redaction: carry hashes of optional PII sub-objects (`locationHash = sha256(dag-cbor(location))`) in the public claim, keep the plaintext sub-object in a private, access-controlled part; the signature stays valid when the plaintext is withheld (C2PA 2.2 uses the same idea for redactable assertions).
- "Live capture" flags cannot be *proven* cryptographically on any platform; they are statements by the app, trusted exactly as far as the app binary is attested (App Attest validation category 4 / Play `PLAY_RECOGNIZED` + DEVICE). That is why they sit inside the signed claim and why the app must never offer a gallery-import path into the signed flow.

### 4.2 Canonicalization options [verified specs]

| Option | Spec | Pros | Cons |
|---|---|---|---|
| DAG-CBOR | IPLD codec 0x71; strict RFC 8949 §4.2.1 deterministic encoding (shortest ints, bytewise-sorted keys, no indefinite lengths, 64-bit floats, tag 42 for CIDs) | Deterministic by construction; claim bytes hash directly to a CID; binary; CBOR is already the format of App Attest objects and COSE | Less human-readable; needs a strict encoder |
| JCS (RFC 8785, Informational, 2020) | sorted members by UTF-16 code units, ES6 number formatting, no whitespace, I-JSON subset | Keeps JSON readable; fine for API payloads | Floats are a foot-gun (coordinates); not content-addressed natively |
| EIP-712 | typed-struct hashing: `keccak256("\x19\x01" ‖ domainSeparator ‖ hashStruct(msg))`, `eth_signTypedData_v4` | Native to wallets and Solidity; perfect for wallet-link and verifier countersignatures | secp256k1/ecrecover-oriented; awkward for device P-256 keys |
| COSE_Sign1 (RFC 9052, Internet Standard) | `Sig_structure = ["Signature1", protected, external_aad, payload]`; headers `alg`, `kid`, x5chain (RFC 9360) | What C2PA uses; natural envelope if Stamper later emits C2PA manifests | Extra layer; protected-header bytes must be stored |

Recommendation: claim body = DAG-CBOR; device signature over `sha256(claimBytes)` (Android raw ECDSA, web ECDSA) or via App Attest assertion with `clientData = claimBytes` (iOS); envelope for storage = COSE_Sign1 with `payload = claimBytes` so a C2PA manifest can be derived later; EIP-712 only for wallet links and verifier receipts. [inferred]

### 4.3 Signature formats to normalise [verified]

- iOS assertion: `signature` is DER ECDSA over `nonce = sha256(authenticatorData ‖ sha256(clientData))`; keep `authenticatorData` (37 bytes: rpIdHash ‖ flags ‖ counter) with the claim — the verifier (and the contract) needs it to recompute the nonce.
- Android/web: DER `SHA256withECDSA` / Web Crypto raw `r‖s` (64 bytes). Convert DER → raw `(r, s)` client-side before upload; the FEVM precompile takes raw `r, s` (§4.4).
- Public keys: store as uncompressed X9.62 (65 bytes) → `(x, y)` for the contract and `sha256(SPKI)` as `deviceKeyId`.

### 4.4 Server verification, countersignature and on-chain registration [verified primitives; flow inferred]

Why the split: verifying an Apple x5c chain (P-384 ECDSA), an Android chain (RSA-4096/P-256/P-384 mixed, ASN.1 extension parsing, CRL fetch) or decrypting a Play Integrity JWE on-chain is impractical. Verifying the **device's per-capture P-256 signature** on-chain is now cheap and native.

FEVM facts [verified]:
- FIP-0113 "secp256r1 (P-256) P256VERIFY Precompile for FEVM" — status **Final**; address `0x0000000000000000000000000000000000000100`; input 160 bytes = `hash ‖ r ‖ s ‖ qx ‖ qy`; output 32-byte `…01` on success, **empty on failure (no revert)**; EIP-7951's stricter validation (point-at-infinity rejection, `r' ≡ r mod n`) with RIP-7212 interface compatibility; no low-`s` malleability check. Gas: "FEVM does not adopt Ethereum's fixed gas schedule for precompiles" — cost comes from Wasm instruction accounting → **must be measured on calibration (chain id 314159)**.
- Shipped: builtin-actors v18.0.0 release notes "EIP-7951 (RIP-7212-compatible): secp256r1 P256VERIFY precompile (#1708)"; Lotus CHANGELOG: nv28 "Fire Horse", **mainnet epoch 6052800 = 2026-05-27T14:00:00Z**, Lotus v1.36.0, actors v18.0.0, with FIP-0113 listed among the nv28 FIPs. nv29 "Solstice" (actors v19) is on calibration since 2026-09-28; mainnet not yet scheduled. The builtin-actors source also lists the standard Ethereum precompiles 0x01–0x09 (incl. `sha256` at 0x02, used below), BLS12-381 (0x0B–0x11, FIP-0105), and Filecoin natives `0xFE..01 resolve_address`, `..02 lookup_delegated_address`, `..03 call_actor`, `..05 call_actor_id`, `..06 get_randomness`.
- Fallback if ever needed on a chain without the precompile: Daimo `P256Verifier` (pure Solidity, MIT, Veridise-audited Oct/Nov 2023, ~330k gas on Ethereum, CREATE2 address `0xc2b78104907F722DABAc4C69f826a522B2754De4`).

Flow:
1. **Enrol a device key (once per user-device):** app sends `{platform, attestationBundle, pubkey, claimedLevel}`. Verifier runs the vendor checks (§1.1 / §2.1 / §2.2), computes the achieved `level`, stores the raw bundle (Apple attestation object + receipt; Android chain + decoded Play verdict) on Filecoin → `attestationCid`, and submits `registerDeviceKey(DeviceKey{x, y, platform, level, attestationCid, validFrom, expiresAt}, verifierSig)` where `verifierSig` is an EIP-712 signature by a whitelisted verifier address. Anyone can later download `attestationCid` and re-run the verification against Apple/Google roots — the chain records *who* vouched and *for what evidence*.
2. **Register a capture (every capture):** app uploads media (CID) + claim + device signature. Verifier checks the signature off-chain too (cheap) and the Play Integrity token whose `requestHash == base64url(sha256(claimCid ‖ serverChallenge))` (Android), or the App Attest counter progression (iOS), then relays `registerCapture(claimHash, keyId, r, s, authData?)` (or the user's wallet relays it — see §4.6). The contract recomputes the digest and calls the precompile:

```solidity
// sketch, not audited
address constant P256VERIFY = 0x0000000000000000000000000000000000000100;
struct DeviceKey { bytes32 x; bytes32 y; uint8 platform; uint8 level; bytes32 attestationCid; uint64 validFrom; uint64 expiresAt; uint64 revokedAt; address registrar; uint32 lastCounter; }

function registerCapture(bytes32 claimHash, bytes32 keyId, bytes32 r, bytes32 s, bytes calldata iosAuthData) external {
    DeviceKey storage k = keys[keyId];
    require(k.validFrom != 0 && k.revokedAt == 0 && block.timestamp < k.expiresAt, "key");
    bytes32 digest = claimHash;                                   // Android / web: sha256(claimBytes)
    if (k.platform == IOS) {                                      // App Attest assertion: sha256(authData || sha256(clientData))
        require(iosAuthData.length == 37 && bytes32(iosAuthData[0:32]) == STAMPER_RPID_HASH, "rpid");
        uint32 counter = uint32(bytes4(iosAuthData[33:37]));
        require(counter > k.lastCounter, "counter"); k.lastCounter = counter;
        digest = sha256(abi.encodePacked(iosAuthData, claimHash));
    }
    (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(digest, r, s, k.x, k.y));
    require(ok && out.length == 32 && out[31] == 0x01, "sig");  // empty output == invalid
    captures[claimHash] = Capture({ keyId: keyId, level: k.level, registeredAt: uint64(block.timestamp) });
    emit CaptureRegistered(claimHash, keyId, k.level);
}
```

(`sha256` is precompile 0x02; `claimHash` must be the sha2-256 multihash digest of the DAG-CBOR claim, i.e. the CID's digest; dedupe by `claimHash`. Enforce `s ≤ n/2` client-side or in-contract if signature uniqueness ever matters.)

3. **Verifier receipt (optional, off-chain):** an EIP-712 `AttestationReceipt{claimHash, keyId, level, verifiedAt}` signed by the verifier lets the app show "verified" instantly and lets any relayer post the registration later.

### 4.5 Key lifecycle: rotation and revocation [inferred, informed by vendor guidance]

- One key per user per device (Apple's guidance; also what Android attestation and Play licensing naturally bind). Keys die on reinstall/migration — expect churn; Apple's risk metric counts keys per device over 30 days, so do not create keys needlessly.
- Rotation: new key enrolment references the old `keyId`; if the old key still exists, sign the new public key with it (continuity proof); set `expiresAt` (e.g., 12 months, or the RKP certificate's `notAfter` on Android, whichever is sooner) and require re-attestation (new Play Integrity token / new App Attest receipt refresh) at renewal.
- Revocation triggers: user action (from a passkey-authenticated session or a wallet signature); verifier action on evidence (Apple risk metric spike; Android chain serial appearing in `attestation/status`; Play Integrity verdict downgrade on later tokens; device-recall bits set); contract stores `revokedAt`. Captures registered before `revokedAt` remain valid (their `registeredAt` is block time — see §5.5); captures after are rejected.
- Per-platform re-check cadence: Android — fetch a fresh Play Integrity standard token per capture (cheap) and re-evaluate the CRL daily; iOS — refresh the receipt metric monthly (after `Not Before`), request a fresh assertion per capture (counter).

### 4.6 Identity: per-user vs per-device, and optional wallet link [verified primitives; design inferred]

- Account identity = passkey (web/mobile), optionally Sign in with Apple/Google. Device keys attach to the account at enrolment; the claim carries `accountId` (hash) so a viewer sees "same account" without a real identity.
- Optional wallet link: wallet signs EIP-712 `LinkWallet{accountId, keyId, nonce, expiry}` via `eth_signTypedData_v4`; the device key countersigns the same digest; the contract (or verifier) stores `keyId → wallet`. Afterwards the wallet can relay `registerCapture` itself, which removes Stamper from the per-capture path entirely (device signature is verified by the precompile; the wallet only pays gas). Session keys (the Synapse `SessionKeyRegistry` noted by the Filecoin dimension) are secp256k1 and software-held — fine for paying/storing, never for signing claims.

---

## 5. Limitations to state honestly, and what industry does

### 5.1 The analog hole [verified]

- C2PA Security Considerations: the capture device "correctly records and signs what came through the camera lens. However, the resulting image leads the viewer to a false conclusion" — C2PA's scope "is limited to digital tampering detection, not preventing physical reproduction attacks". It also names the hardware attacker who "might inject their own data between the lens and the camera's CPU".
- Truepic Lens API returns a **"picture-of-picture"** analysis: `recapture` score flagged above 0.5, blur score flagged below 40, entropy flagged below 0.02, plus screen detection; statuses `Pass | Recapture | Warning | Blurry | Low Entropy`.
- Apple "Reference Image" [reported by InfoQ 2026-09-24 and digitalapplied 2026-09-18, citing Apple's 2026-09-15 announcement]: iPhone 18 Pro/Pro Max main sensor, iOS/iPadOS/macOS 27, opt-in capture mode; the sensor signs the digitised frame with a factory key, the Secure Enclave signs other metadata, a composite RSA-3072 + ML-DSA-87 signature is applied after development; explicitly **not C2PA**; "a neural network with hidden weights" scores photographed screens; no public verifier described; not in the EU/China at launch. Treat as a signal of direction, not as an API Stamper can use today.
- Research: moiré/screen-recapture detectors exist (e.g., "Through the Lens", arXiv 2510.23225, DeepMoiréFake dataset: moiré degrades deepfake detectors by up to 25.4% and demoiréing makes it worse) — detection is a scoring problem, not a proof. Stamper wording: **"authentic capture ≠ true scene"**; add a recapture-risk score as advisory metadata later.

### 5.2 Rooted / jailbroken devices and Play Integrity bypasses (status 2026) [verified community sources; synthesis inferred]

- Mechanism: PlayIntegrityFix / PlayIntegrityFork spoof build fingerprints (enough for BASIC, and DEVICE on Android < 13). On Android 13+, DEVICE/STRONG depend on hardware Key Attestation, so the community uses **TrickyStore** (closed-source since 1.1.0; latest release 1.4.1, 2024-11-02; repo pushed 2025-11-30; 6.4k stars) which "hacks the leaf certificate" or generates a whole chain from a **leaked OEM `keybox.xml`** and can spoof the security patch level. PlayIntegrityFork's README: STRONG is "Kinda…" achievable and "requires the latest official Tricky Store and an unrevoked hardware keybox.xml". Guides dated 2026-01-01 (magiskzip) and June 2026 (XDA) report STRONG passing on e.g. a Pixel 9 Pro; another June-2026 guide calls STRONG "unreachable with unlocked bootloader — a physical limitation" — both are consistent: without a valid keybox STRONG is impossible; with a leaked, unrevoked one it passes until Google revokes it.
- Google's counters: the revocation list (~1000+ `KEY_COMPROMISE` serials), RKP (leaks "don't apply to attestation keys certified by RKP"; RKP-only for devices launching with Android 16), hardware-backed verdicts since May 2025, patch-recency in STRONG, `appAccessRiskVerdict`, device recall.
- What Stamper can do: (a) require **both** Play Integrity (DEVICE/STRONG) and a Key Attestation chain for the same app at enrolment, and re-check the CRL on every capture, not just at enrolment; (b) prefer chains carrying the RKP provisioning-info extension and short validity for the top tier (leaked keyboxes are factory keys) [inferred]; (c) require `attestationApplicationId` to match Stamper's package and signing cert; (d) require `deviceLocked == true` and `verifiedBootState == Verified` (or GrapheneOS SelfSigned); (e) rate-limit keys per account and use `recentDeviceActivity`, device recall and Apple's risk metric; (f) treat STRONG as "best available", not as proof — which is why the on-chain record carries `level` and `attestationCid`, so trust can be re-evaluated if a keybox is later revoked (verifier can mark keys revoked retroactively and viewers can see the date).
- iOS: no public, reliable App Attest forgery on unmodified devices; Apple's own caveat is a modified OS. Jailbreak detection in-app is advisory only.

### 5.3 Emulators [verified]

- iOS Simulator: App Attest unsupported (`isSupported == false`). Android emulators: Key Attestation does not chain to a Google root; Play Integrity returns an empty device verdict (`MEETS_VIRTUAL_INTEGRITY` is only for Play Games on PC). Device recall is not available on emulators. → emulator captures can only be L0.

### 5.4 Attestation and assertion replay [verified]

- App Attest: server challenge ≥16 bytes hashed into the attestation; assertion counter must strictly increase; receipt creation time ≤ 5 minutes when exchanged. Play Integrity: bind the token to the request with `requestHash` (standard) or a unique `nonce` (classic); re-decoding a token clears its verdicts; check `timestampMillis` freshness; never cache verdicts. Key Attestation: `attestationChallenge` must equal the server's challenge (Google's library ships `ChallengeMatcher` + `InMemoryLruCache`). Stamper: one `serverChallenge` per capture session, single-use, 5-minute TTL; store used challenges.

### 5.5 Timestamp trust [verified facts; policy inferred]

- Device clock is user-settable → `capturedAt` is a claim, not a fact. Server receive time is trusted by Stamper only. Filecoin block time: 30-second epochs; `block.timestamp` on the FEVM is the epoch's time, so the chain proves "registered no later than" with 30 s granularity (and Filecoin finality semantics are the Filecoin dimension's topic). RFC 3161 time-stamp tokens (CMS SignedData over the claim hash, TSA cert with `id-kp-timeStamping`, `accuracy`, `nonce`) give an independent, portable "existed-before" proof; C2PA 2.2 requires RFC 3161 tokens in the COSE unprotected header `sigTst2` (v1 `sigTst` is deprecated) and notes "Manifests without time-stamps cease to be valid when the signing credential expires or becomes revoked".
- State of the art: Pixel 10 runs an **on-device, offline TSA** with a "trusted clock in secure environment, completely isolated from user-controlled one" — not available to third-party apps.
- Stamper policy: show three times — device `capturedAt`, Stamper `receivedAt`, chain `registeredAt` — and flag |capturedAt − receivedAt| above a threshold; optionally add an RFC 3161 token from a public TSA to the stored envelope so validity survives Stamper's own keys.

### 5.6 Camera-feed injection [inferred; literature not retrieved]

- Virtual-camera apps/tweaks on rooted or jailbroken devices, and emulator camera feeds, can present arbitrary frames to an in-app camera. Attestation tiers (§6) exclude the cheap cases; `appAccessRiskVerdict` surfaces capturing/overlay/controlling apps on Android; sensor-level evidence (§5.7) raises the bar further. State it as a residual risk at L1/L2.

### 5.7 Sensor-level signals (future work) [verified APIs; use inferred]

- iOS: Live Photos (`isLivePhotoCaptureEnabled`, a short movie around the still) and depth (`AVCapturePhotoOutput.isDepthDataDeliveryEnabled`; dual camera yields relative disparity in 1/m, TrueDepth yields absolute depth in metres; depth is embedded in the HEIF/JPEG via `fileDataRepresentation()`). A flat screen or print yields a near-planar depth map and no parallax across the Live Photo frames — a strong recapture signal, though not a proof. Android: CameraX/Camera2 depth where available. Plan: hash the auxiliary artefacts into `sensorEvidence`, store them with the original, and let the verifier (or a later model) score them.

### 5.8 What C2PA-enabled devices do, for calibration [verified]

- C2PA 2.2: COSE_Sign1 claim signatures (ES256/ES384/Ed25519/PS256), X.509 certs with the `c2pa-kp-claimSigning` EKU, hard bindings (`c2pa.hash.data`, `c2pa.hash.bmff.v3`, general box hash, collection hash; SHA-256/384/512), `c2pa.actions.v2` with mandatory `c2pa.created`/`c2pa.opened`, `digitalSourceType` values such as `http://c2pa.org/digitalsourcetype/digitalCapture` (IPTC `digitalCapture` in older manifests), validation states well-formed / valid / **trusted** (signer on a trust list). C2PA Trust List launched mid-2025; the Interim Trust List was frozen on 2026-01-01; the Conformance Program is "risk-based" and products are listed with Assurance Levels (level definitions document not retrieved — see Open questions). C2PA guidance recommends "leveraging available platform-specific features … (e.g., Android SafetyNet, Apple DeviceCheck and AppAttest)" for claim generators, attaching time-stamps at signing, and adding a "Time-Stamp Manifest" later for offline captures.
- Google Pixel 10 (2025-09-10): Pixel Camera is **Assurance Level 2** ("currently only possible on Android" for a mobile app); Google's C2PA CA uses Android Key Attestation certificates that "include the package name and signing certificates associated with the app", genuine-device and Play-Protect-certified status, and patch recency; claim signing keys are generated in **StrongBox (Titan M2, CC PP.0084 AVA_VAN.5)**; "each key and certificate is used to sign exactly one image" ("No two images ever share the same public key"); on-device offline TSA. This is the closest existing blueprint for Stamper's Android L2/L3 path — and for a future "ingest and verify third-party C2PA manifests" feature.
- Truepic (Lens SDK v1.0.0.141 referenced in docs): hardware-backed keys, PKI-signed C2PA manifests (JUMBF, SHA-256) with Truepic's CA, sealed GPS (accuracy in metres) and time, recapture scoring; web via server-side verification.

---

## 6. Recommended assurance-level scheme and exact flows

### 6.1 Levels

| Level | Label shown to viewers | Requirements enforced by the verifier (all must hold) | Residual risk to disclose |
|---|---|---|---|
| **L0** | "Uploaded via web / unattested device" | Passkey-authenticated session; web-generated non-extractable P-256 key registered in that session; server-witnessed hash and time | Anything: virtual camera, edited file, screen photo |
| **L1** | "Captured in the Stamper app" | iOS: App Attest attestation verified, `apple_validation_category_01 == 4` (App Store) or 2 (TestFlight, dev only), assertion counter increasing. Android: Play Integrity standard token with `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`, `requestHash` bound to the claim; Key Attestation chain to a Google root with `origin == GENERATED`, TEE or StrongBox, `attestationApplicationId` matches | Modified OS (iOS), leaked keybox (Android), camera injection, analog hole |
| **L2** | "Hardware-attested capture" | L1 plus — iOS: production `aaguid`, receipt exchanged and risk metric ≤ threshold (tune; start at ≤ 5), key age ≤ 12 months. Android: `MEETS_STRONG_INTEGRITY` (or GrapheneOS SelfSigned-with-known-key path), `deviceLocked == true`, `verifiedBootState ∈ {Verified, SelfSigned-known}`, `osPatchLevel` within 12 months, chain serials absent from the CRL (re-checked at each capture), StrongBox when the device has it | Unrevoked leaked keybox, hardware attacker, analog hole |
| **L3** (later) | "Secure-element capture with sensor evidence" | L2 plus StrongBox-only + RKP-provisioned chain, sensor evidence present and scored (Live Photo/depth/burst), optional RFC 3161 token; or an ingested C2PA manifest from a Conformance-Program Level-2 device verified against the C2PA trust list | Analog hole (scored, not excluded) |

The visible mark should prefix the short code with the level (e.g., `L2-7Q4K…`), and the registry stores `level` per key and per capture so a key downgrade (CRL hit, revocation) can be reflected on the verify page with the date.

### 6.2 iOS flow (App Attest only; no second key)

1. First run / new account: `generateKeyAsync()` → persist `keyId` (Keychain). `GET /attest/challenge` (≥16 random bytes, 5-min TTL). `attestKeyAsync(keyId, challenge)` → `POST /attest/ios {keyId, attestation, challengeId}`.
2. Verifier: 12-step validation (§1.1), store public key, receipt and `validationCategory`; POST receipt to Apple for the `RECEIPT` with risk metric; compute level; store bundle on Filecoin → `attestationCid`; `registerDeviceKey` on-chain with EIP-712 verifier signature.
3. Each capture: capture with `AVCapturePhotoOutput` (never `PHPicker`); build the DAG-CBOR claim with `serverChallenge` from `GET /capture/challenge`; `generateAssertionAsync(keyId, claimBytes)`; upload media + claim + assertion (`signature`, `authenticatorData`).
4. Verifier: recompute `sha256(authData ‖ sha256(claim))`, verify ECDSA, counter > last, rpIdHash, extensions; relay `registerCapture(claimHash, keyId, r, s, authData)`; return the mark code.
5. On `serverUnavailable` during attestation retry with the same key; on other `DCError`s discard and regenerate (expect to see this in the risk metric).

### 6.3 Android flow (Key Attestation + Play Integrity)

1. App start: `prepareIntegrityTokenProviderAsync(cloudProjectNumber)` (warm-up).
2. Enrolment: `GET /attest/challenge`; `generateHardwareAttestedKeyAsync("stamper-capture-v1", challenge)` (custom module: try StrongBox first); `getAttestationCertificateChainAsync(alias)`; `requestIntegrityCheckAsync(base64url(sha256(spkiHash ‖ challenge)))`; `POST /attest/android {chain, integrityToken, challengeId}`.
3. Verifier: decode the token (Google endpoint or local JWE/JWS), check `requestHash`, package, `timestampMillis`, verdicts; verify the chain with Google's Kotlin verifier (trust anchors from `attestation/root`, CRL from `attestation/status`, challenge match, `attestationApplicationId`, security level, root of trust, patch levels, RKP validity); compute level; store bundle → `attestationCid`; `registerDeviceKey`.
4. Each capture: CameraX/Camera2 capture in-app; claim with `serverChallenge`; `requestIntegrityCheckAsync(base64url(sha256(claimCid ‖ serverChallenge)))` (standard token per capture is cheap); `sign(alias, claimBytes)` → DER → raw `(r, s)`; upload media + claim + signature + token.
5. Verifier: verify signature off-chain, decode token, re-check CRL for the key's chain serials, relay `registerCapture(claimHash, keyId, r, s, "")`.
6. Devices without Play services (GrapheneOS etc.): skip the token; cap at L2 via the SelfSigned-with-known-key rule, and label "Google-free device, hardware-attested".

### 6.4 Web flow (L0)

1. Passkey registration/login (WebAuthn L3, `residentKey: "preferred"`, optionally `prf` for encrypting local drafts).
2. `generateKey(ECDSA P-256, extractable=false, ["sign"])` → IndexedDB; `POST /keys/web {spki}` in the authenticated session → verifier registers it at level 0 (optionally on-chain, same precompile).
3. Capture via `getUserMedia` in the Stamper page (or plain upload — treat identically); claim with `platform: "web"`, `capture.source: "web-getUserMedia"` and no live flags; sign with Web Crypto (`{name: "ECDSA", hash: "SHA-256"}`, raw `r‖s`).
4. Verifier records `receivedAt`, hashes, and registers at L0; the mark reads `L0-…` and the verify page says "device not attested".

---

## 7. Verified-vs-inferred ledger and staleness flags

- Verified from primary sources: all Apple App Attest / DeviceCheck / Secure Enclave statements and the root PEM; Play Integrity request types, quotas, verdict fields and 2025 definitions, decode options, device recall; Android Key Attestation schema, roots, CRL, RKP/Android 16, Kotlin verifier; Expo and community module APIs, versions and repo activity; WebAuthn L3 status, PRF/largeBlob semantics, `sign` PR status, Web Crypto `[Serializable]`/non-extractable semantics; C2PA 2.2 structures, trust-list dates, guidance; Pixel 10 C2PA implementation; Truepic Lens API/Web SDK behaviour; RFC 8785/9052/3161, EIP-712, DAG-CBOR; FIP-0113, builtin-actors v18.0.0, nv28 mainnet date; Daimo verifier.
- Reported (secondary): Apple Reference Image details; XDA/magiskzip bypass guides; Corbado's PRF support matrix (vendor-independent but well maintained).
- Inferred: the claim schema, the on-chain design, assurance thresholds, "leaked keyboxes are factory keys", emulator behaviour of Key Attestation, Expo Go RP-ID caveat, camera-injection assessment.
- Stale / renamed / inconsistent: `appattestdevelop` vs `appattestsandbox` in Apple docs; Play Console "App integrity" → "Protected with Play" (May 2026); SafetyNet references in C2PA guidance; Android attestation root RSA → ECDSA "Key Attestation CA 1" signing since 2026-02-01; Expo `@expo/app-integrity` alpha (SDK 54) → unlabelled in SDK 58, and jsDelivr "latest" 57.0.2 vs changelog 58.0.1; `veehaitch/devicecheck-appattest` unmaintained since 2023; TrickyStore closed-source and last released 2024-11; C2PA `sigTst` → `sigTst2`; Interim Trust List frozen 2026-01-01; Play Integrity minimum API 23 (v1.4.0+) vs Expo's "API 21".

## 8. Open questions

1. Measured gas of `P256VERIFY` (0x100) and of the `registerCapture` path on Filecoin calibration (314159) and mainnet (314) — needed before committing to per-capture on-chain verification versus batching.
2. C2PA Conformance Program Assurance Level 1/2 definitions (document URL not found); needed if Stamper wants to map L2/L3 to C2PA levels or ingest Level-2 manifests.
3. Whether a maintained JS/TS Android Key Attestation verifier exists; otherwise plan a small JVM service around `android/keyattestation`.
4. Exact Expo module behaviour: does `generateAssertionAsync(keyId, challenge)` hash the string you pass (SHA-256 of UTF-8) and can it take raw bytes? Does `generateHardwareAttestedKeyAsync` request StrongBox? (read the source in `packages/expo-app-integrity`).
5. Apple Reference Image: official developer documentation, whether third-party apps can request Reference-mode captures, and whether its signature can be verified outside Apple devices.
6. Current cadence of Google keybox revocations and whether Play Integrity will tie STRONG to RKP-only chains (would close the leaked-keybox hole for new devices).
7. largeBlob browser matrix (not re-verified) — only relevant if Stamper ever wants per-passkey blob storage.
8. Camera-injection literature (KYC "virtual camera" attacks) for a quantified risk statement at L1/L2.

---

## Sources

Apple
- https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity
- https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
- https://developer.apple.com/documentation/devicecheck/attestation-object-validation-guide
- https://developer.apple.com/documentation/devicecheck/assessing-fraud-risk
- https://developer.apple.com/documentation/devicecheck/preparing-to-use-the-app-attest-service
- https://developer.apple.com/documentation/devicecheck/dcappattestservice
- https://developer.apple.com/documentation/devicecheck/dcerror-swift.struct
- https://developer.apple.com/documentation/devicecheck/accessing-and-modifying-per-device-data
- https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave
- https://developer.apple.com/documentation/avfoundation/capturing-photos-with-depth
- https://developer.apple.com/documentation/avfoundation/capturing-still-and-live-photos
- https://www.apple.com/certificateauthority/private
- https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem

Google / Android
- https://developer.android.com/google/play/integrity/overview
- https://developer.android.com/google/play/integrity/standard
- https://developer.android.com/google/play/integrity/classic
- https://developer.android.com/google/play/integrity/verdicts
- https://developer.android.com/google/play/integrity/improvements
- https://developer.android.com/google/play/integrity/setup
- https://developer.android.com/google/play/integrity/device-recall
- https://developer.android.com/privacy-and-security/security-key-attestation
- https://android.googleapis.com/attestation/root
- https://android.googleapis.com/attestation/status
- https://github.com/android/keyattestation
- https://play.google.com/console/about/whats-new/
- https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/
- https://grapheneos.org/articles/attestation-compatibility-guide

Bypass status (community)
- https://github.com/osm0sis/PlayIntegrityFork
- https://github.com/5ec1cff/TrickyStore and https://github.com/5ec1cff/TrickyStore/releases
- https://magiskzip.com/how-to-pass-integrity-with-strong-check-on-rooted-devices/
- https://xdaforums.com/t/how-2-pass-strong-integrity-hide-root-june-2026.4781271/ (search snippet only; page blocked)
- https://xdaforums.com/t/guide-how-to-pass-strong-integrity-and-bypass-root-detection-apps-revolut-company-portal-google-wallet-etc-working-as-of-june-22nd-2026.4773849/ (search snippet only)

React Native / Expo / server libraries
- https://docs.expo.dev/versions/v58.0.0/sdk/app-integrity/
- https://docs.expo.dev/versions/unversioned/sdk/app-integrity/
- https://expo.dev/blog/expo-app-integrity
- https://raw.githubusercontent.com/expo/expo/main/packages/expo-app-integrity/CHANGELOG.md
- https://cdn.jsdelivr.net/npm/@expo/app-integrity/package.json
- https://cdn.jsdelivr.net/npm/react-native-device-binding/README.md and package.json; https://api.github.com/repos/piroposantosdev/react-native-device-binding
- https://cdn.jsdelivr.net/npm/@silencelaboratories/react-native-secure-key@0.2.1/README.md and package.json; https://api.github.com/repos/silence-laboratories/react-native-secure-key
- https://npmjs.com/package/node-app-attest ; https://cdn.jsdelivr.net/npm/node-app-attest/package.json ; https://api.github.com/repos/uebelack/node-app-attest
- https://api.github.com/repos/veehaitch/devicecheck-appattest

Web
- https://www.w3.org/TR/webauthn-3/
- https://github.com/w3c/webauthn/pull/2078
- https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI/m/Oz1C7oEYAgAJ
- https://www.corbado.com/blog/passkeys-prf-webauthn
- https://passkeys.dev/device-support/
- https://w3c.github.io/webcrypto/
- https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey

C2PA / industry
- https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html
- https://spec.c2pa.org/specifications/specifications/2.2/security/Security_Considerations.html
- https://spec.c2pa.org/specifications/specifications/2.2/guidance/Guidance.html
- https://c2pa.org/conformance/
- https://vision.truepic.dev/docs/lens-api.md
- https://vision.truepic.dev/docs/lens-web-sdk-reference.md
- https://truepic.com/c2pa/capture ; https://truepic.com/technology
- https://www.infoq.com/news/2026/09/apple-reference-image-provenance/
- https://www.digitalapplied.com/blog/apple-reference-image-vs-content-credentials-photo-proof
- https://arxiv.org/pdf/2510.23225

Formats and standards
- https://datatracker.ietf.org/doc/html/rfc8785 (JCS)
- https://datatracker.ietf.org/doc/html/rfc9052 (COSE)
- https://datatracker.ietf.org/doc/html/rfc3161 (TSP)
- https://ipld.io/specs/codecs/dag-cbor/spec/
- https://eips.ethereum.org/EIPS/eip-712

Filecoin EVM
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/FIPS/fip-0113.md
- https://raw.githubusercontent.com/filecoin-project/FIPs/master/README.md
- https://raw.githubusercontent.com/filecoin-project/builtin-actors/master/actors/evm/src/interpreter/precompiles/mod.rs
- https://github.com/filecoin-project/builtin-actors/releases and /releases/tag/v18.0.0
- https://raw.githubusercontent.com/filecoin-project/lotus/master/CHANGELOG.md
- https://docs.filecoin.io/core-concepts/filecoin-virtual-machine/blocks-and-tipsets.md
- https://github.com/daimo-eth/p256-verifier
