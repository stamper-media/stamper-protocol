# Stamper threat model: attacks and defenses for a Filecoin-anchored media-provenance system (2024–2026)

Research date: 2026-09-30. Sources preferred from 2025–2026; anything older is marked. Each claim is tagged **[verified]** (read from a primary source during this research), **[secondary]** (press/blog summarising a primary source) or **[inferred]** (my reasoning from verified facts). "Load-bearing" findings are the ones Stamper's architecture depends on.

---

## 0. Framing: what a Stamp can and cannot prove

Every serious 2025–2026 result on media provenance converges on the same limit. Cryptographic capture provenance (C2PA, Truepic, ProofMode, Numbers, and Stamper) can at best prove:

> "A key that Stamper enrolled for device D signed these exact bytes, and a registry entry for them existed on the Filecoin chain no later than epoch E."

It cannot prove that the pixels depict a real scene (analog hole, staged scenes), that device D was not compromised (rooted device confused-deputy attacks), that the clock/location were honest (SDR GNSS spoofing needs no root), or that the person holding the phone was not coerced. C2PA's own Security Considerations 2.4 puts "misuse of signed C2PA assets", "assumed trust between identities" and "inability to identify artificial content" explicitly out of scope **[verified: spec.c2pa.org 2.4 Security Considerations]**. The August 2026 Pixel 10 break (below) shows that even the highest C2PA assurance level (AL2) collapses to "someone with root on a Pixel signed this" **[verified: Buchanan blog, 2026-08-25]**.

Stamper's honest product claim is therefore **"unaltered since it was stamped on device D at or before time T"**, never "authentic" or "true". Section 8 lists the residual risks that must be disclosed in the verify UI.

### Assumed Stamper architecture (used to reason about threats)

Inferred from the brief; other research dimensions will refine it.

1. In-app live capture (photo/video) on iOS/Android; no gallery import.
2. On device: compute the content hash / PieceCID of the original bytes; create a *claim* (hash, capture metadata, device id, capture time) and sign it with a hardware-backed device key (Secure Enclave / StrongBox).
3. Upload the original to Filecoin Onchain Cloud (Filecoin Warm Storage Service, PDP-proven, two copies by default) and/or other pinning; the registry stores the PieceCID / CID.
4. A relayer (or the user's own wallet) submits the signed claim to a registry contract on the Filecoin EVM (mainnet chain id 314, calibration 314159 **[verified: FilOzone/filecoin-services README]**). The contract verifies the device signature and assigns a short stamp code.
5. The output asset carries a visible mark with the short code (+ optional invisible watermark / perceptual hash "soft binding").
6. Anyone verifies by code (or by uploading a suspect copy) on the Stamper site/app, which fetches the registry record and the original from Filecoin and shows a side-by-side comparison.

---

## 1. Capture-side threats

### 1.1 Analog hole: photographing a screen or print (recapture attack)

**Feasibility: trivial. Impact: highest. Defense: partial, never complete.**

- The USENIX Security 2025 paper *Scoop* defines the recapture attack against "all provenance-based techniques": the adversary displays fake content on a screen, projector or printed surface and uses a provenance-asserting secure camera to capture it. Their mitigation combines the phone's depth sensor with learned depth estimation to detect flat display media even when the display is not visually identifiable; reported accuracy ≈95% on iPhone 14 Pro (LiDAR) and 74% on a Galaxy S20+ over 78 scenarios **[verified: USENIX Sec '25 Scoop abstract]**. Depth-based detection therefore depends on hardware Stamper does not control on most Android phones.
- The companion USENIX Security 2025 paper *Chimera* is the attack side: a GAN-based generator that pre-compensates the physical transformations of recapture so that the recaptured, cryptographically signed image fools *both* recapture detectors and deepfake detectors "with a high success rate while having high visual quality"; code is public (github.com/ssysarch/Chimera) **[verified: USENIX Sec '25 Chimera abstract]**.
- Moiré/recapture classifiers (e.g., SWIN-transformer identification, ~82% accuracy, 2025) are useful as a *friction* signal, not a gate **[secondary: Springer SIVP 2025 via search]**. Truepic holds several US patents on "detecting image recapture" (11037284, 11544835, 12159442), which shows the industry treats this as heuristic, layered detection **[secondary: USPTO listings via search]**.
- Buchanan's conclusion after breaking Pixel C2PA: "even optimal mitigations cannot stop physical attacks (photographing screens)" **[verified: Buchanan blog]**.

**Stamper now:** (a) capture depth/LiDAR data where the OS exposes it (iOS `AVDepthData`, Android `DEPTH16`/ToF) and run a Scoop-style flatness test on-device; store the result as a *signal* in the claim, not a verdict. (b) Require a short live-capture window (multi-frame burst, small motion parallax check) so a printed flat surface is harder to pass. (c) Show "single shot, no depth data" as a lower-confidence tier in the verify UI.
**Stamper later:** on-device recapture classifier updates; publish false-positive rates.
**Residual risk to disclose:** "A Stamp cannot tell whether the camera was pointed at a real scene or at a screen/print."

### 1.2 Staged scenes

No provenance system detects a real camera pointed at a fake situation (actors, props, misleading framing). Not a technical threat; a wording one. Stamper's UI must never say "real event". **[inferred; consistent with C2PA Harms Modelling 2.0, 2025-05-05]**

### 1.3 Camera injection (virtual cameras, USB/HDMI injection, HAL replacement)

**Feasibility: low-to-medium skill. Impact: high. Defense: partial.**

- iProov reports that "native virtual camera" apps intercept video at the OS layer between the physical camera and the requesting app, request only ordinary camera permissions, were found in everyday app stores, and — the key finding — "don't require rooted or jailbroken devices". Attacks grew 2,665% in 2024 with a Q2-2024 peak of 785 weekly incidents **[verified: iProov blog]**. Entrust's 2026 fraud report and others show continued growth in 2025 (injection attacks on iOS +741% YoY) **[secondary: search summaries; the iOS figure is from a vendor report I did not read]**.
- On rooted Android, Xposed/LSPosed modules such as *CamSwap*/VCAM hook Camera1 and Camera2 APIs and substitute MP4 files or RTSP/RTMP/HLS streams for the sensor feed **[secondary: project READMEs via search]**.
- Hardware injection: UVC/USB cameras and HDMI capture dongles are "cameras" to the OS. Android supports external USB cameras; iPadOS 17+ supports external cameras; iPhone does not expose them to AVFoundation for third-party apps as far as I know **[inferred; not verified this session]**.

**Stamper now:** open the camera through the platform API (CameraX/Camera2, AVFoundation), enumerate physical cameras and refuse external/USB/virtual ids (`LENS_FACING_EXTERNAL`, non-built-in `AVCaptureDevice`); record the camera id, sensor timestamps, frame-duration jitter and physical characteristics in the signed claim; require the app to run the capture pipeline itself (no `ACTION_IMAGE_CAPTURE` intents, no share-sheet imports). Combine with device attestation (1.5) because most non-root injection tools must live in another app or in a modified framework.
**Stamper later:** liveness-style challenge (random torch/flash pattern, screen-colour flash reflected in the scene, sensor-fusion consistency between gyroscope and optical flow) as an optional "high-assurance" tier.
**Residual risk:** on a rooted/compromised device the sensor feed can be replaced with no detectable trace.

### 1.4 Gallery import spoofed as live capture

Pure application-logic attack: a modified client sends an arbitrary file as if captured. Mitigations are the same as 1.3 plus 1.5, and the signed claim must contain capture-pipeline evidence (sensor timestamps, per-frame metadata, camera characteristics) that a file lacks. **[inferred]** Note that C2PA's exclusion-range design lets GPS be edited in a Pixel 10 Pro manifest without detection **[verified: arXiv 2604.24890]**; Stamper's claim must sign *all* metadata it displays.

### 1.5 Emulator, root and attestation bypass (state in 2026)

**Feasibility: medium (Android), low-to-medium (iOS). Impact: very high (enables 1.3, 1.4, 1.6). Defense: partial and eroding.**

Android (Play Integrity):
- Verdicts: `MEETS_BASIC_INTEGRITY`, `MEETS_DEVICE_INTEGRITY`, `MEETS_STRONG_INTEGRITY`; `MEETS_VIRTUAL_INTEGRITY` exists only for Google Play Games on PC **[verified: developer.android.com verdict docs via search]**.
- Since May 2025 the device-integrity verdict requires a hardware-backed, positive verified-boot signal on Android 13+ (Google estimated ~0.4% of devices affected); strong integrity additionally requires a security patch within the last 12 months **[verified: developer.android.com improvements page; Microsoft Intune support tip]**.
- Bypass status: DEVICE integrity is still routinely passed on rooted phones with Magisk/Zygisk + Play Integrity Fix + DenyList/Shamiko; STRONG integrity requires a valid, non-revoked hardware keybox, so the bypass economy runs on *leaked OEM keyboxes* that Google crawls and revokes, often within a week **[secondary: XDA/HackTricks/DroidWin guides]**. Conclusion: STRONG is a meaningful bar but not a guarantee; it also excludes many honest users (custom ROMs, older patch levels).
- The decisive 2026 development: exploit-based root on a *locked* bootloader. CVE-2026-43499 ("GhostLock"/NebuSec IonStack, a futex-PI use-after-free) is packaged as *Root-My-Pixel*, giving temporary root on stock, locked-bootloader Pixels from an unprivileged shell in ~10 minutes **[verified: GitHub alex193a/Root-My-Pixel README]**. Buchanan's Pixel 10 C2PA forgery notes that attestation cannot detect this because the bootloader stays locked and AVB keys are unmodified **[verified: Buchanan blog]**. Play Integrity's `MEETS_STRONG_INTEGRITY` will therefore pass on a rooted device in this window.

iOS (App Attest / DeviceCheck):
- App Attest proves that a genuine Secure Enclave signed a challenge for a given App ID; it carries no jailbreak detection, no OS version and no hardware-model binding. The *aaoracled* research tool runs a headless attestation oracle on a jailbroken iPad mini 4 (iPadOS 15.8.8) that mints attestations and assertions for arbitrary App IDs over HTTP **[verified: github.com/regulad/aaoracled]**.
- Jailbreak availability: Dopamine 3.0 (August 2026) supports iOS 26.0–26.0.1 on A12/A13 only; A8–A17 on iOS 15–18.7.1; no public jailbreak for A18/A19 (iPhone 16/17) at the time of writing **[secondary: MacRumors 2026-08-07; Dopamine README via search]**. Practical consequence: an attacker needs an older iPhone, which App Attest cannot distinguish from a new one.

**Stamper now:** require Play Integrity (classic request, server-side decode, nonce bound to the claim hash) and App Attest + per-request assertions; store the verdict tier in the registry record and *display it* ("device integrity: strong / device / none"). Enforce everything server-side and on-chain (signature over the claim), never trust client flags. Rate-limit and anomaly-score per device key (bursts of stamps, impossible travel, identical sensor noise).
**Stamper later:** device reputation and revocation (1.6); optional "trusted device" tier for newsroom hardware.
**Residual risk:** "A determined attacker with root on a supported phone can make Stamper sign anything. Attestation raises cost; it does not close the hole."

### 1.6 Key extraction versus key misuse (the confused-deputy lesson)

- Nobody extracted a StrongBox or Secure Enclave key in the cases studied. They did not need to: with root, an attacker asks the keystore to sign arbitrary data on behalf of the legitimate app. Buchanan: "an attacker does not need the raw key material". Google's Pixel Camera, the only mobile app at C2PA Assurance Level 2, signed an AI-generated image and a YouTube video as "captured with a camera"; Adobe Inspect and CAI Verify accepted them; Google classified it "Won't Fix (Infeasible)" on 2026-07-14 and paid a $7,500 bounty; disclosure 2026-08-25 **[verified: Buchanan blog; Hacker Factor "Glitter Milk"]**.
- Nikon's Z6 III shipped C2PA on 2025-08-27; within days the Multiple Exposure feature was used to sign foreign raw files (a NEF encoder turned any TIFF, including an AI "pug flying a jet", into a signed NEF). Nikon suspended the service on 2025-09-05 and revoked every certificate issued on 2025-09-21 **[verified: Digital Camera World; PetaPixel/DPReview via search]**.
- Revocation is where designs fail: C2PA validators are not required to check revocation, and Google's privacy-preserving per-photo certificates mean revoking one certificate does nothing against future forgeries from the same device **[verified: arXiv 2604.24890; Hacker Factor]**.

**Stamper now (this is where Stamper can beat C2PA):** an on-chain device registry. Each device enrolls a hardware-backed public key once (with the Android key-attestation chain / App Attest receipt verified at enrollment); every claim carries `deviceId` and is verified against the registered key; the registry supports *revocation with an effective epoch* so verifiers can show "signed by a device revoked on 2026-xx-xx (stamps before that date unaffected/affected)". Keys must be non-exportable, hardware-backed, and (Android) `setUserAuthenticationRequired` with a biometric/credential binding, which at least forces the attacker to be present at the device. Keep a per-device stamp counter so replayed or reordered claims are detectable.
**Privacy cost:** a stable device id links all stamps by one device (see 4.1). Mitigation: rotate device sub-keys periodically with an on-chain link only Stamper can resolve, or use anonymity-set designs like *Birthmark* (key tables with anonymity sets > 1,000 devices, proven with ProVerif) **[verified: arXiv 2602.04933 abstract]**.
**Residual risk:** compromise of a device between enrollment and revocation produces valid stamps.

### 1.7 Time and location spoofing

- Mock locations: Android 12+ exposes `Location.isMock()`; apps can also detect apps holding `ACCESS_MOCK_LOCATION`; on rooted phones an Xposed module (HideMockLocation) hides all of this **[secondary: developer guides via search]**.
- RF spoofing needs no root at all: a Raspberry Pi + HackRF + antenna (~$225, or SDRs from ~$150) broadcasts fake GNSS; attack time 15 s–5 min, range ~50 m; phones that fuse Wi-Fi/cell positioning are harder to fool **[secondary: RTL-SDR, GPS World, GPSPatron via search]**.
- Clock: the device clock is user-settable. Google's TrustedTime API (February 2025, `com.google.android.gms:play-services-time:16.0.1`) returns Google-infrastructure time independent of the local clock, requires network since boot, and gives an error estimate **[verified: Android Developers Blog, Feb 2025]**. iOS has no equivalent; use a server-signed time challenge.
- Chain time is trustworthy but coarse: Filecoin block timestamps must equal the value implied by genesis time, block time and epoch, so the epoch of registry inclusion is an honest *upper bound* ("existed by") **[verified: spec.filecoin.io block validation]**.

**Stamper now:** store three times in the claim — device time, TrustedTime/server-challenge time, and the on-chain epoch — and display all three; label location as "device-reported" and make it opt-in; compare GNSS with Wi-Fi/cell fixes and flag disagreement. Never let the visible badge imply location.
**Residual risk:** "Location is what the phone reported; it can be spoofed with a $200 radio."

### 1.8 Multi-device collusion and Sybil stamping

Ten honest phones stamping the same staged scene produce ten valid stamps; an attacker can enroll many cheap devices. Stamps must never be aggregated into a "truth score". Enrollment friction (attestation tier, optional identity for newsroom accounts) and per-device reputation are the only levers. **[inferred]**

---

## 2. Post-capture threats

### 2.1 Invisible watermark removal (state of the art)

- WAVES (ICML 2024) standardised distortion, regeneration ("rinsing") and adversarial attacks; single diffusion/VAE regeneration already breaks Tree-Ring at 0.1% FPR **[verified: arXiv 2401.08573 abstract; details secondary]**.
- *UnMarker* (IEEE S&P 2025) removes SynthID and Stable Signature watermarks more than 50% of the time with no knowledge of the scheme, no detector access, via spectral analysis + cropping + high/low-frequency disruption **[verified: University of Waterloo news, 2025-07-23; secondary for internals]**.
- *Diffusion-based image editing for breaking robust watermarks* (arXiv 2510.05978, Oct 2025): near-zero recovery for StegaStamp, TrustMark and VINE after guided regeneration, high visual fidelity; the authors prove mutual information between the image and payload vanishes under enough diffusion **[verified: abstract]**. TrustMark is Adobe's open-source watermark used for C2PA soft bindings.
- *Watermarks attack watermarks* (arXiv 2605.16796, May 2026): simply re-watermarking with another scheme drops bit accuracy by 25–48% across 96 dataset/victim/attack combinations; no gradients or keys needed **[verified: abstract]**.
- Video: *VideoMarkBench* (arXiv 2505.21620) finds VideoSeal notably vulnerable to noise-like removal attacks and that frame deletion/reordering defeats schemes that treat the video as one unit **[secondary via search]**.
- *Authenticated contradictions* (arXiv 2603.02378, Mar 2026): a valid C2PA manifest asserting human capture can coexist with pixels carrying an AI watermark because neither layer checks the other; demonstrated on 500 SDXL images with Pixel Seal; a cross-layer audit catches it **[verified: abstract]**.

**Implication (load-bearing):** an invisible watermark is a *re-linking convenience* for cropped/recompressed copies, never a security control. It should carry only the stamp code (a pointer), and the verifier must always resolve the pointer to the registry and compare against the original.

### 2.2 Visible badge cropping and fake badges

The brief's central UX question: *how does the verifier make the visible code useless without the registry lookup?* By design, not by detection:

1. The visible mark is a pointer, and the product says so ("Look it up"). The trust signal is the *verify result*, never the badge. No Stamper surface may render a green check from the presence of a mark.
2. Codes carry a checksum (e.g., Crockford Base32 alphabet without I/L/O/U plus a check symbol) so mistyped/look-alike codes fail immediately and cannot be confused visually; the QR/deep link embeds the canonical domain.
3. Verification is a *comparison*, not a lookup: the verify page fetches the registered original from Filecoin, renders it beside the suspect copy, aligns/normalises (scale, crop, recompression) and shows a diff heat-map with a plain verdict: "matches the original", "cropped from the original (region shown)", "does not match — differs in these areas". An attacker who overlays a real code (#123) on a doctored image gets the doctored image publicly contrasted with the original.
4. Perceptual-hash search lets a viewer verify an image whose badge was cropped off (2.4), so legitimate images do not become "unverifiable" when platforms crop them.
5. Never label a badge-less or unmatched image "fake"; label it "not registered / no match" (stripping is the normal fate of metadata: WordPress and screenshots strip C2PA manifests **[verified: arXiv 2604.24890]**).

**Residual risk:** viewers who do not click through are fooled by fake badges; user studies show provenance labels *raise* trust even when misunderstood (5.4).

### 2.3 C2PA manifest stripping and forgery

If Stamper also emits C2PA manifests (for interoperability), plan for:
- Stripping is pervasive and unavoidable; C2PA's own answer is "manifest repositories", i.e., a registry — which Stamper already has **[verified: C2PA 2.4 Security Considerations 4.3.1.1]**.
- The April 2026 analysis of spec 2.2–2.4 (Adobe Inspect, CAI Verify, Verifieddit, Proofmode Verify; Pixel 10 Pro, Nikon Z6 III) found: timestamps can be replaced undetected because nothing signed references them; revocation checking is optional and OCSP-only; metadata in exclusion ranges (GPS on Pixel 10 Pro) is editable; validators disagree on the same file; and media become unverifiable within months when signing certificates expire (conflicting with 22–25-month legal retention windows) **[verified: arXiv 2604.24890]**.
- Forging *Stamper's* manifest requires Stamper's or a device's key; the device-level attack surface is 1.5–1.6.

**Stamper now:** make the on-chain record the root of trust, not the C2PA certificate: verifiers check the device key *as registered at the claim's epoch*, so expiry is irrelevant. If emitting C2PA, sign with the same registered key, put the stamp code in an assertion, never use exclusion ranges for displayed metadata, and expect third-party validators to disagree.

### 2.4 Re-stamping a manipulated copy as a new "original"

Because capture is live, re-stamping requires the analog hole or injection (Section 1), so this collapses to those attacks plus *ordering*:
- Ordering defense: the registry gives every stamp an inclusion epoch (deterministic chain time) plus the signed device time; the verifier shows "earliest registered stamp of this content: #123, 2 days earlier". Relayer reordering is bounded by the signed device/TrustedTime timestamps and by a per-device monotonic counter **[inferred; chain-time fact verified]**.
- Near-duplicate detection at stamp time: compute PDQ (images; recommended match ≤31 bits Hamming, discard quality ≤49) and vPDQ/TMK-style video hashes **[verified: Meta ThreatExchange PDQ README]**; when a new stamp is within threshold of an existing one, attach an "ingredient hint" ("looks like stamp #123 from 2 days earlier") to the new record and surface it in verification. Warn, do not block: twins, panoramas and multi-shot events legitimately collide.
- Front-running: if Stamper ever attaches "first-to-register" rights, use commit-reveal (hash of claim first, claim later) so a mempool observer or the relayer cannot jump the queue **[inferred]**.

### 2.5 CID collisions versus perceptual-hash collisions

- Content hashes (SHA-256 multihash CIDs, Filecoin PieceCIDs) have no practical collisions; a hard binding is exact.
- Perceptual hashes are *not* collision resistant by design and are actively attacked: targeted second-preimage attacks against PhotoDNA and PDQ (USENIX Security 2023 *Squint Hard Enough*) **[verified: abstract]**; *Atkscopes* (USENIX Security 2025) gives a unified multiresolution attack that both evades and *triggers* pHash, PDQ, PhotoDNA and NeuralHash **[verified: abstract]**; an LLM-guided black-box program-evolution attack (arXiv 2607.11472, July 2026) beats prior black-box baselines with fewer queries and lower L2 distortion (composite score reductions: NeuralHash 41.2%, PDQ 38.3%, pHash 34.0%, PhotoDNA 8.1%) **[verified: abstract]**. Certified alternatives (*CertPHash*, USENIX Security 2025) bound evasion and collision but need a trained model, not a fixed algorithm **[verified: abstract]**.
- Inversion: low-budget generative inversion of perceptual hashes recovers image content, which is why IBSA-removal tools are told to use secure hash matching **[verified: arXiv 2412.06056 abstract]**. Publishing PDQ hashes of *private* or not-yet-released originals on-chain would leak them.

**Implication (load-bearing):** perceptual hashes are for candidate retrieval only; the verdict must come from the exact hash or from the visual comparison against the stored original. Keep perceptual hashes of unreleased originals off-chain (or publish only after the original is public).

---

## 3. Infrastructure threats

### 3.1 Filecoin data loss (deals, provider failure, PDP monitoring)

Verified facts about the stack Stamper will use:
- Filecoin Onchain Cloud went live on mainnet on 2026-03-26; Warm Storage costs $2.50 per TiB-month *per copy*, two copies on independent providers by default (the second provider pulls from the first); providers must keep ≥95% storage success, <1% PDP fault rate and ≥95% retrieval success or are removed; if the secondary provider fails "the system automatically selects a replacement and retries"; automated fault-triggered re-replication and sealed PoRep backup copies are *roadmap*, not shipped **[verified: filecoin.io mainnet-launch post]**.
- PDP: challenges are seeded from drand via the FIP-0095 beacon contract, one challenge set per proving period, a successful proof emits an on-chain event, a fault is recorded when the provider calls `nextProvingPeriod` without proving; the design doc states PDP "proves possession, not durability" and offers "detection confidence, not failure prevention" **[verified: FilOzone/pdp design.md; docs.filecoin.cloud PDP overview]**. PDPVerifier proxies: mainnet `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F`, calibration `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` **[verified: FilOzone/pdp README]**. The word "proxy" means the verifier is upgradeable by its owner (see 3.5).
- Payments: 30-day lockup; extra rails for CDN (0.7 USDFC) and cache-miss (0.3 USDFC) credits; proving service $0.12/dataset-month; CDN egress up to $14/TiB; when an account is underfunded, uploads fail and providers may terminate rails and claim the lockup; pieces "persist at the provider until garbage-collected" **[verified: docs.filecoin.cloud payments cookbook]**. Search summaries also cite a 30-day window before removal after termination **[secondary]**.
- Legacy deal market context: active deal data fell 11% QoQ in Q2 2025 as zero-priced onboarding deals expired **[secondary: Messari]** — expiry-driven loss is a real pattern.

**Stamper now:** treat the on-chain hash as the source of truth and storage as replaceable. Keep ≥3 independent copies (two FWSS copies + one Stamper-controlled replica, e.g., own IPFS/Kubo node or a second pinning service), monitor PDP proof/fault events per data set and alert, watch USDFC runway with a hard floor well above 30 days, and rehearse restore from any single copy. Publish a public "storage health" page per stamp (last successful proof epoch, copy count).
**Stamper later:** sealed PoRep cold copies once FOC ships them; multi-provider selection policy; on-chain funding endowment per stamp so originals outlive the company.
**Residual risk:** "If every copy is lost the stamp remains verifiable only for someone who still holds a bit-exact copy."

### 3.2 Gateway censorship and denylists

- The Bad Bits denylist (badbits.dwebops.pub) is enforced on Protocol Labs gateways and only partially elsewhere; re-chunking yields a new CID that escapes it **[verified: 2025 arXiv 2506.04307 / USENIX Sec '24 via search]**. Any single gateway can be compelled to block a CID.

**Stamper now:** retrieve from the storage providers' own PDP retrieval endpoints and from Filbeam (pay-per-byte CDN with cache-hit/miss rails **[secondary: Synapse SDK docs]**) with automatic failover, and expose the CID so anyone can fetch from any gateway or node. The verifier must still work when the original is unreachable: show "original temporarily unavailable" and allow hash-only verification of a bit-exact copy the viewer already holds.
**Residual:** Stamper itself can be forced to remove originals (DMCA, court orders); the on-chain record then reads "withdrawn".

### 3.3 Relayer censorship or key compromise

Design so the relayer is a gas sponsor, nothing more:
- The device signs an EIP-712 typed claim (content hash, PieceCID, metadata hash, device id, nonce, deadline). The registry contract verifies that signature against the on-chain device key, so a compromised relayer cannot forge; it can only *withhold* or *delay*. **[inferred; standard pattern]**
- Self-submission: because the claim is self-contained, any wallet holding FIL can submit it (mainnet RPCs: Glif `https://api.node.glif.io/rpc/v1`, Ankr, ChainUp, Lava, NOWNodes; most public RPCs guarantee only the latest 2000 blocks (~16.7 h) of state **[verified: docs.filecoin.io RPC page]**). Ship the "submit with my own wallet" path from day one; document it.
- Key-curve caveat (open question, load-bearing): Secure Enclave and Android hardware keys are P-256 (Android also supports Ed25519 since API 33); the FEVM verifies secp256k1 natively (`ecrecover`) and, to my knowledge, has no RIP-7212 P-256 precompile. On-chain P-256 verification in Solidity is feasible but costs a few hundred thousand gas per claim on the EVM; FEVM gas differs. Options: (a) Solidity P-256 verifier per claim; (b) verify P-256 attestation once at enrollment and bind a secp256k1 signing key — but that key would live in software and be extractable, weakening 1.6; (c) batch claims into Merkle roots signed by the relayer *and* individually signed by devices, with fraud proofs. Needs a gas measurement on calibration net.
- Reordering/timestamp games by the relayer are bounded by device-signed timestamps and per-device nonces (2.4).

### 3.4 Chain reorgs before finality

- Filecoin Fast Finality (F3, FIP-0086, GossiPBFT) activated on mainnet on 2025-04-29 at epoch 4,920,480, finalising in minutes instead of the 900-epoch (7.5 h) Expected-Consensus fallback; safety holds against < 1/3 of quality-adjusted power; if F3 halts, EC continues and finality reverts to 900 epochs **[verified: FIP-0086; go-f3/Filecoin announcement via search]**.
- Lotus v1.33.0 added `/v2` APIs where the Ethereum block tag `finalized` maps to the F3-finalized epoch and `safe` to F3-finalized or 200 epochs behind head, whichever is more recent; `/v1` keeps `finalized` = 900 epochs and `safe` = 30 epochs **[verified: Lotus v1.33.0 release notes]**.

**Stamper now:** show a stamp as "pending" until its transaction is in a `finalized` tipset on the v2 API; fall back to the 900-epoch rule if the F3 certificate stream stalls; never issue the visible code from an unconfirmed receipt (the code can be reserved off-chain but marked pending).

### 3.5 Smart-contract upgrade and admin risks

- Stamper's registry: make the record store append-only and non-upgradeable (or behind a long timelock with a public multisig), with revocation and code-assignment logic separable. Anything upgradeable is a trust assumption verifiers must be told about. **[inferred; standard practice]**
- Inherited risk: FWSS/PDPVerifier are upgradeable proxies operated by the FilOz/Filecoin ecosystem (contract "Mainnet Proxy" addresses) **[verified: addresses; upgrade governance not verified]**. The registry must reference content by PieceCID/CID, not by FWSS data-set ids, so storage contracts can change without touching stamps.

### 3.6 Indexer lies

The verify web app must not trust its own indexer: it should `eth_call` the registry directly (and, for high-value verification, against two independent RPC providers), verify the device signature client-side, and let power users point at their own node. Historical event queries need an archival RPC (public ones keep ~2000 blocks of state) **[verified: docs.filecoin.io]**. Offer a downloadable CLI verifier so the registry is checkable without Stamper's servers.

### 3.7 Phishing verify sites and look-alike codes

Attackers will register look-alike domains and generate fake "Stamper ✓" pages. Mitigations: one canonical verify domain with HSTS preload; QR/deep links only to that domain; in-app scanner as the recommended path; codes with a checksum and an unambiguous alphabet; the brand mark itself never doubling as a "verified" signal (2.2); public education that verification happens *at* the registry, plus a signed, versioned verifier bundle whose hash is published on-chain so third parties can host mirrors. **[inferred]**

---

## 4. Social and legal threats

### 4.1 Deanonymization of sources through stored originals and metadata

- The World Privacy Forum's technical review (2025-09-03) documents how C2PA identity assertions and automatic metadata (GPS with altitude, camera make/model/lens, timestamps, 3D depth maps) expose creators, and notes election observers' warnings about "persecution through metadata" **[verified: WPF report]**. A 2026 SSRN paper frames content credentials as a surveillance risk with governance gaps **[not fetched (HTTP 403); title only]**. WITNESS's 2025 work asks that specifications let creators remove sensitive information before sharing and never require identity documents for assertions **[secondary: WITNESS "Human Rights in Standards", June 2025]**.
- Stamper-specific vectors: the *original* itself (faces, documents, reflections), EXIF/GPS, the stable device id linking all of a source's stamps, and sensor-noise fingerprints (PRNU) that let anyone link a stored original to the same camera's other photos — *Birthmark* deliberately builds keys from PRNU, which shows how identifying it is **[verified: arXiv 2602.04933 abstract]**.

**Stamper now:** strip EXIF by default; location and device model opt-in; offer a *sealed stamp* (hash on-chain now, original encrypted at rest, revealed later or never) for at-risk users; rotate device sub-keys so device linkage is resolvable only by Stamper (or not at all); never require identity for stamping; run a DPIA.

### 4.2 Coerced stamping and plausible deniability

- Precedent: GrapheneOS's duress PIN (v2024053100) wipes keys silently; a January 2025 US case charged a traveller with evidence destruction for using it **[secondary: Android Authority / press via search]** — a warning that duress features carry legal exposure.
- Stamper options: a duress passcode that produces a normal-looking stamp flagged privately as under-duress (surfaced later, at the user's request), delayed publication (sealed stamps), and a user-initiated dispute flag on any stamp. Deniability limit: once a hash is on-chain, "I never took this" is not credible; sealed stamps at least keep *content* deniable until reveal. **[inferred]**

### 4.3 Right to erasure versus immutable storage

- EDPB Guidelines 02/2025 (draft April 2025, finalised July 2026 with minor changes) say personal data should stay off-chain with only hashes or proofs on-chain, require DPIAs, and acknowledge that erasure on immutable ledgers may be impracticable **[verified: Slaughter and May summary of the final text; EDPB draft via search]**.
- Good news for Stamper: PDP data sets support piece deletion (scheduled removals) and pieces are garbage-collected after rail termination **[verified: pdp design.md; payments cookbook]**, so *originals are deletable*; only the hash and the stamp record persist. A photo hash may still be personal data if the photo is obtainable elsewhere, so the registry should store a salted commitment (hash of hash + per-stamp salt kept with the original) where practical, and mark deleted stamps "withdrawn by the author".
- EU AI Act Article 50 transparency and machine-readable marking obligations apply from 2026-08-02 (Code of Practice published 2026-06-10) **[secondary: legal summaries]**; relevant only if Stamper adds generative features, but Stamper's "captured, not generated" claim will be read in that context.

### 4.4 Misuse of "verified" as "true"

- A 6,114-participant study (US/UK/Norway, ICWSM) found C2PA-style provenance labels increase perceived transparency, credibility and trust in the source **[secondary: ICWSM paper via search]**; a 2025 news-recommender study found many participants misinterpreted the labels and wondered whether the label itself was faked **[secondary: CEUR Vol-4056]**; the Content Credentials icon "performed well in building trust" while failing to communicate its meaning **[secondary: CHI 2025 label study]**. Hacker Factor's blunt version: valid signatures can "launder disinformation as fact" **[verified: Hacker Factor Glitter Milk post]**.

**Stamper now:** fixed, tested wording ("Unaltered since it was stamped on <date> by device tier <X>. Stamper cannot confirm what the camera was pointed at."), no green check for content, colour-neutral results, and a one-line residual-risk disclosure on every verify page (Section 8).

---

## 5. Academic and industry references (2025–2026 unless noted)

| Ref | What it establishes for Stamper |
|---|---|
| Buchanan, *C2PA Cameras Do Not Survive Contact With Reality* (2026-08-25) + Hacker Factor *Glitter Milk* | Root → confused deputy defeats hardware-backed signing; revocation model matters more than key protection |
| Nikon Z6 III forgery (Sep 2025), all certificates revoked 2025-09-21 | Feature-level signing bugs; revocation must be checkable by verifiers |
| *Verifying Provenance of Digital Media: Why the C2PA Specifications Fall Short* (arXiv 2604.24890, Apr 2026; also IACR ePrint 2026/804) | Timestamp replacement, optional revocation, exclusion-range edits, validator inconsistency, certificate expiry |
| *Authenticated Contradictions* (arXiv 2603.02378, Mar 2026) | Keep watermark and registry in sync; cross-layer audit |
| *The Birthmark Standard* (arXiv 2602.04933, Feb 2026) | Hardware root of trust + consortium chain + anonymity sets; closest academic design to Stamper |
| *Scoop* and *Chimera* (USENIX Security 2025) | Analog hole: depth-based mitigation vs. GAN-compensated recapture |
| C2PA Security Considerations 2.4 and Harms Modelling 2.0 (2025-05-05) | Official threat list; what C2PA declares out of scope |
| WAVES (ICML 2024), UnMarker (S&P 2025), arXiv 2510.05978, 2605.16796, VideoMarkBench (2505.21620) | Watermarks are not a security control |
| *Squint Hard Enough* (USENIX Sec 2023), *Atkscopes* and *CertPHash* (USENIX Sec 2025), arXiv 2607.11472 (Jul 2026), arXiv 2412.06056 | Perceptual hashes: second-preimage, evasion, triggering, inversion |
| World Privacy Forum C2PA review (2025-09-03); WITNESS (2025); SSRN surveillance-risk paper (2026, not fetched) | Privacy/deanonymization harms |
| EDPB Guidelines 02/2025 (final July 2026) | Off-chain personal data, hashes on-chain, DPIA |
| iProov native virtual camera research; CVE-2026-43499 / Root-My-Pixel; aaoracled; Dopamine 3.0 | Injection and attestation-bypass feasibility in 2026 |
| Filecoin: FIP-0086/F3 (mainnet 2025-04-29), Lotus v1.33.0 v2 tags, FOC mainnet (2026-03-26), PDP design, FWSS payments | Storage/finality/censorship facts |
| Truepic recapture-detection patents; Numbers Protocol | Industry practice. **No public Truepic or Numbers Protocol security postmortem was found in 2025–2026 searches**; their absence is not evidence of robustness. |

---

## 6. Prioritized threat matrix

Feasibility: cost/skill for an attacker in 2026. Impact: harm to Stamper's core claim if it succeeds. "Now" = must ship with v1; "Later" = after launch.

| # | Attack | Feasibility | Impact | Build now | Build later | Residual risk to disclose |
|---|---|---|---|---|---|---|
| 1 | Analog hole (screen/print recapture) | Trivial | Critical | Live multi-frame capture, depth-flatness signal where hardware allows, "single-shot" tier shown in UI | Recapture classifier updates, high-assurance liveness tier | "Cannot tell a real scene from a photographed screen or print" |
| 2 | Root/exploit + confused-deputy signing (Pixel-style) | Medium (public one-click root for some Pixels; iOS needs older hardware) | Critical | Play Integrity STRONG/App Attest bound to claim nonce; on-chain device registry with revocation epochs; per-device counters and anomaly scoring | Device reputation, newsroom-verified device tier, key rotation | "A compromised phone can sign anything until revoked" |
| 3 | Camera injection (virtual camera apps, USB/HDMI, HAL hooks) | Low–medium (no root needed for some virtual cameras) | High | Physical-camera enumeration and refusal of external/virtual devices; capture-pipeline evidence in the signed claim; attestation | Sensor-fusion/flash-challenge liveness | Same as #2 |
| 4 | Fake or transplanted visible badge | Trivial | High (reputational) | Badge = pointer; checksummed codes; verify = side-by-side comparison + diff; never "fake" for unmatched | Public education, verifier mirrors | "A mark proves nothing until looked up" |
| 5 | Filecoin copy loss (provider failure, underfunding, no auto-repair yet) | Medium (operational, not adversarial) | High | ≥3 copies incl. one Stamper-controlled; PDP fault monitoring; USDFC runway alerts | Sealed PoRep cold copies, per-stamp endowment | "If all copies vanish, only a bit-exact holder can verify" |
| 6 | Relayer censorship/compromise | Low | Medium | Device-signed EIP-712 claims verified on-chain; self-submit path; nonces/deadlines | P-256 on-chain verification cost engineering | "Relayer can delay, not forge" |
| 7 | Perceptual-hash second-preimage / inversion | Medium (public tooling) | Medium | pHash only for retrieval; verdict from exact hash or visual comparison; no on-chain pHash for unreleased originals | Certified hashes | "Similar-looking images are not the same image" |
| 8 | Re-stamping / ordering games | Requires #1–#3 | Medium | Chain epoch + signed device time + TrustedTime; near-duplicate warning with ingredient hint | Commit-reveal if originality rights are added | "Earliest stamp ≠ original creator" |
| 9 | Watermark removal | Low (open-source attacks) | Low (if watermark is only a pointer) | Treat watermark as convenience | Re-evaluate against WAVES-style suite | none needed beyond #4 |
| 10 | Time/location spoofing | Low ($150–$225 SDR, no root) | Medium | Three-clock record; location opt-in and labelled "device-reported" | Wi-Fi/cell cross-checks | "Location can be spoofed with a cheap radio" |
| 11 | Deanonymization via originals/metadata/device linkage | Low | Critical for at-risk users | EXIF stripping, opt-in location, sealed stamps, key rotation, DPIA | Anonymity-set device keys | "Public originals can identify people and cameras" |
| 12 | Gateway/denylist censorship | Low | Medium | Multi-source retrieval, CID exposure, hash-only verification | Community mirrors | "Original may be unreachable through some gateways" |
| 13 | Reorg before finality | Low (F3 live) | Low | `finalized` tag on Lotus v2; EC fallback | — | none |
| 14 | Registry/admin upgrade abuse | Low | High | Non-upgradeable/timelocked registry; PieceCID-based references | — | "Storage contracts are third-party upgradeable" |
| 15 | Phishing verify sites | Low | Medium | Canonical domain, in-app scanner, checksummed codes, signed verifier bundle | — | "Only trust the registry" |
| 16 | Coerced stamping | Low | High for at-risk users | Sealed/delayed stamps, dispute flag | Duress mode (with legal review) | "A stamp does not prove consent" |
| 17 | Multi-device collusion/Sybil | Low | Medium | No aggregation into truth scores; enrollment friction | Reputation | "Many stamps ≠ truth" |
| 18 | "Verified" read as "true" | Certain | High | Fixed wording, neutral colours, residual-risk line on every result | User testing | (this *is* the disclosure) |

---

## 7. Build now versus later (condensed)

**Now (v1):** live capture only, physical-camera enumeration, hardware-backed device keys with on-chain enrollment and revocation epochs, attestation tiers displayed, EIP-712 device-signed claims with self-submit, three-clock timestamps, EXIF stripping and opt-in location, ≥3 storage copies with PDP monitoring and runway alerts, F3-finalized status, comparison-based verification with checksummed pointer codes, near-duplicate warnings, non-upgradeable registry referencing PieceCIDs, sealed stamps, plain-language residual-risk text.

**Later:** depth/liveness high-assurance tier, device reputation, P-256 verification cost optimisation, sealed PoRep backups, certified perceptual hashes, anonymity-set keys, duress mode after legal review, third-party verifier mirrors.

---

## 8. What no system can prove (disclosure text candidates)

1. That the scene in front of the camera was real, unstaged or not a screen/print.
2. That the device was uncompromised at capture time (root exploits defeat hardware attestation; Google rated the Pixel case "infeasible" to fix).
3. That the reported location or device time is honest.
4. That the person stamping was not coerced, and that the account holder is who they say they are.
5. That the *first* stamp of a scene is the *original* creator's.
6. That an image *without* a valid stamp is fake.

---

## Sources

Primary (read this session):
- Buchanan, "C2PA Cameras Do Not Survive Contact With Reality" — https://www.da.vidbuchanan.co.uk/blog/android-c2pa.html
- Hacker Factor, "C2PA and Pixel Glitter Milk" — https://www.hackerfactor.com/blog/index.php?/archives/1102-C2PA-and-Pixel-Glitter-Milk.html
- arXiv 2604.24890, "Verifying Provenance of Digital Media: Why the C2PA Specifications Fall Short" — https://arxiv.org/html/2604.24890v1 (also https://eprint.iacr.org/2026/804)
- arXiv 2603.02378, "Authenticated Contradictions from Desynchronized Provenance and Watermarking" — https://arxiv.org/html/2603.02378v1
- arXiv 2602.04933, "The Birthmark Standard" — https://arxiv.org/abs/2602.04933
- C2PA 2.4 Security Considerations — https://spec.c2pa.org/specifications/specifications/2.4/security/Security_Considerations.html
- C2PA Harms Modelling 2.0 (2025-05-05) — https://spec.c2pa.org/specifications/specifications/2.0/security/_attachments/Harms_Modelling.pdf
- Scoop (USENIX Security 2025) — https://www.usenix.org/conference/usenixsecurity25/presentation/liu-yuxin
- Chimera (USENIX Security 2025) — https://www.usenix.org/conference/usenixsecurity25/presentation/park
- WAVES — https://arxiv.org/abs/2401.08573 ; UnMarker — https://uwaterloo.ca/news/media/watermarks-offer-no-defense-against-deepfakes
- arXiv 2510.05978 — https://arxiv.org/abs/2510.05978 ; arXiv 2605.16796 — https://arxiv.org/abs/2605.16796
- Squint Hard Enough — https://www.usenix.org/conference/usenixsecurity23/presentation/prokos ; Atkscopes — https://www.usenix.org/conference/usenixsecurity25/presentation/zhang-yushu ; CertPHash — https://www.usenix.org/conference/usenixsecurity25/presentation/yang-yuchen ; arXiv 2607.11472 — https://arxiv.org/abs/2607.11472 ; arXiv 2412.06056 — https://arxiv.org/abs/2412.06056
- PDQ README — https://github.com/facebook/ThreatExchange/blob/main/pdq/README.md
- iProov native virtual camera research — https://www.iproov.com/blog/native-virtual-camera-attacks-invisible-threat-biometric-solution
- aaoracled — https://github.com/regulad/aaoracled
- Root-My-Pixel (CVE-2026-43499) — https://github.com/alex193a/Root-My-Pixel
- Android TrustedTime API — https://android-developers.googleblog.com/2025/02/trustedtime-api-introducing-reliable-approach-to-time-keeping-for-apps.html
- Play Integrity verdicts/improvements — https://developer.android.com/google/play/integrity/verdict ; https://developer.android.com/google/play/integrity/improvements
- Nikon revocation — https://www.digitalcameraworld.com/photography/photojournalism/nikon-revokes-all-c2pa-image-authenticity-certificates-after-major-vulnerability-exposed
- World Privacy Forum C2PA review — https://worldprivacyforum.org/posts/privacy-identity-and-trust-in-c2pa/
- EDPB Guidelines 02/2025 — https://www.edpb.europa.eu/system/files/2025-04/edpb_guidelines_202502_blockchain_en.pdf ; final-text summary — https://thelens.slaughterandmay.com/post/102ndb2/edpb-finalises-guidelines-on-gdpr-and-blockchain
- FIP-0086 (F3) — https://github.com/filecoin-project/FIPs/blob/master/FIPS/fip-0086.md ; Lotus v1.33.0 — https://github.com/filecoin-project/lotus/releases/tag/v1.33.0 ; go-f3 — https://github.com/filecoin-project/go-f3
- Filecoin Onchain Cloud mainnet — https://www.filecoin.io/blog/posts/filecoin-onchain-cloud-is-live-on-mainnet/ ; PDP design — https://github.com/FilOzone/pdp/blob/main/docs/design.md ; PDP README — https://github.com/FilOzone/pdp ; PDP overview — https://docs.filecoin.cloud/core-concepts/pdp-overview/ ; payments cookbook — https://docs.filecoin.cloud/cookbooks/payments-and-storage/ ; filecoin-services — https://github.com/FilOzone/filecoin-services
- Filecoin mainnet RPCs — https://docs.filecoin.io/networks-and-tools/networks/mainnet/rpcs ; block validation — https://spec.filecoin.io/systems/filecoin_blockchain/struct/block/
- Bad Bits denylist — https://badbits.dwebops.pub/ ; IPFS anonymity/abuse study — https://arxiv.org/abs/2506.04307

Secondary (press, forums, vendor summaries):
- PetaPixel / DPReview / heise on Nikon Z6 III; MacRumors on Dopamine iOS 26; XDA/HackTricks/DroidWin on Play Integrity bypass and keybox revocation; RTL-SDR / GPS World / GPSPatron on GNSS spoofing; Messari "State of Filecoin Q2 2025"; ICWSM provenance-label study; CEUR Vol-4056 image-trust-label study; CHI 2025 label design study; arXiv 2505.16057; WITNESS "Human Rights in Standards" (2025); SSRN 6986118 (not fetched); Synapse SDK / Filbeam docs; USPTO Truepic recapture patents; VideoMarkBench arXiv 2505.21620; EU AI Act Article 50 summaries (CSA, Baker McKenzie).
