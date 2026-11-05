# Stamper research — Content-authenticity standards (C2PA / Content Credentials) and prior art, 2026

Date of research: 2026-09-30 / 2026-10-01. Sources are primary wherever possible (spec PDFs, the C2PA conformance-public repo, crates.io / npm registry JSON, GitHub READMEs, vendor docs). Each claim is tagged **[verified]** (read in a primary source), **[secondary]** (press, Wikipedia, vendor blog summaries) or **[inferred]** (my reasoning). Anything that may be stale, renamed or sunset is flagged **STALE/CHANGED**.

---

## 0. Executive summary

- **The spec is at 2.4 (April 2026)**; 2.3 shipped December 2025 and 2.2 in May 2025. The production SDK (`c2pa` Rust crate 0.91.x, Sept 2026) and nearly all conformant products target **2.2**, with 2.3 compliance landing in `c2pa` 0.91.0 (2026-09-21) and 34 of 228 conforming products already listed against 2.4. 2.4 matters to Stamper because it adds a **Manifest Repository "receipt" assertion (`c2pa.repository-receipt`)** and formal routes for publishing manifest stores to a repository — exactly the role a Filecoin-anchored registry can play. [verified]
- **Trust is now gated by the C2PA Conformance Program** (launched mid-2025; the old Interim Trust List was frozen on 2026-01-01). A signer that is not on the C2PA Trust List shows as "unknown source" in Adobe/CAI Verify and only reaches "Valid", never "Trusted". Getting on the list means: expression of interest → legal agreement → security-architecture evidence → listing on the Conforming Products List (CPL) → buy a claim-signing certificate from one of 17 listed CAs (DigiCert, SSL.com, Trufo, Encypher, …). Membership in C2PA is **not** required. Assurance Level 1 certs are valid max 366 days with "no stipulation" on key protection; Level 2 certs are valid max 90 days and require hardware key attestation + secure-boot evidence. Small developers are on the list already (Proofmode Reality Systems LLC, InReality ApS, Evergreen Labs, Trufo), and SSL.com has a **free tier** (one L1 cert/yr + 2,500 trusted timestamps/yr). [verified]
- **The trust model has real, demonstrated holes**: Nikon revoked all Z6III certificates (Sept 2025) after an AI image was signed via NEF injection; David Buchanan forged Pixel 10 (Assurance Level 2) captures via root exploits in Aug 2026 and Google marked it "Won't fix (infeasible)"; an April 2026 academic audit found optional revocation checking, unbound timestamps, validator inconsistency and exclusion-range tampering; a CVPR-2026 paper shows watermark/provenance "integrity clashes". Platforms (Meta, Instagram, X, most CDNs) still strip the manifest on upload. **So C2PA is an interoperability and display layer, not a root of trust** — which is precisely the gap Stamper's own Filecoin-anchored original + hash registry can fill. [verified/secondary]
- **SDK reality**: `c2pa-rs` (Rust, MIT/Apache-2.0) is canonical; `@contentauth/c2pa-node` 0.9.9 signs; `@contentauth/c2pa-web` 0.15.3 reads/validates/builds in the browser but **does not sign** (WASM ~8.7 MB unpacked); `c2pa-python` 0.38.0 signs; `c2patool` 0.28.1 is back in its own repo; `c2pa-swift` (iOS 16+, Secure Enclave ES256) and `c2pa-android` 1.0.0 (API 28+, Keystore/StrongBox, CSR enrollment) exist but are young; **there is no official React Native binding**. Formats: JPEG, PNG, WebP, AVIF, HEIC/HEIF, GIF, TIFF, DNG, JXL, SVG, MP4, MOV, AVI, M4A, MP3, WAV, FLAC, PDF — **no WebM/MKV**. Custom assertions use reverse-domain labels (e.g. `computer.paradox.stamper.anchor`) and ingredient chains use `relationship: parentOf`. [verified]
- **Prior art**: Numbers Protocol (alive; Capture Cam + ProofSnap on the CPL, permissioned Avalanche-subnet chain "Jade" id 10507, ERC-7053 commits, IPFS pinning with Filecoin backup that **expires after one month** unless paid), Truepic (alive, B2B, own PKI via Keyfactor, not on the CPL), ProofMode (alive, GPL, on the CPL at L1 for Android and iOS, OpenPGP + OpenTimestamps + C2PA), Starling Lab (alive research lab; Authenticated Attributes + IPFS/Filecoin/Storj + multi-chain anchoring), Click/Nodle (dormant since March 2024), Serelay (dead since 2021), Attestiv/OpenOrigins (alive, enterprise, proprietary anchoring), Sony/Leica/Canon in-camera signing (alive; Sony's is a paid licence), Nikon (suspended). Nobody combines **public, trustless storage of the original + an EVM registry + a visible short code + a compare-to-original UI + C2PA interop**. That is Stamper's lane.

---

## 1. Standards landscape

### 1.1 C2PA Technical Specification — versions and what changed

| Version | Date | Notes |
|---|---|---|
| 2.4 | April 2026 (PDF metadata 2026-04-23; Wikipedia: 21 Apr 2026) | Current. **[verified: spec PDF §5.3.1]** |
| 2.3 | December 2025 (PDF title "2.3, 2026-01-05") | Live video streaming, unstructured-text embedding, OGG Vorbis, AVIX, EXIF original-preservation images, revised Cloud Data assertion. **[verified: §5.3.2]** |
| 2.2 | 2025-05-01 | The version almost every conformant product and the production SDK targets. **[verified: PDF title; CPL `specVersion`]** |
| 2.1 | Sept 2024 | **[verified]** |
| 2.0 | Jan 2024 | Introduced v2 claims; v1 claims deprecated in SDK. **[verified]** |

What 2.4 adds (quoted from the version history) **[verified]**:
- New **crJSON** JSON-LD serialisation of a manifest store "for use in profile evaluation, interoperability testing, and validation reporting" (not independently verifiable; not an input format).
- New assertions: **`c2pa.repository-receipt`** ("record proof that a C2PA Manifest has been ingested by a C2PA Manifest Repository"), `c2pa.environmental-sustainability`, **`c2pa.ai-disclosure`**.
- Embedding manifests into HTML and structured text.
- Actions: `c2pa.watermarked.bound` actions *should* reference their soft-binding assertion(s); new `relatedAssertions` field; `allActionsIncluded` rules; `c2pa.opened` must hashed-uri-reference its ingredient.
- Ingredients: `digitalSourceType` on ingredients that carry no manifest of their own.
- `specVersion` moved from the claim into `claim_generator_info` (claim-level deprecated).
- **Soft binding updates: "Introduced routes to publish C2PA manifest stores to a manifest repository and to verify proof of their ingestion."** The requirement that `alg` match the soft-binding algorithm list was relaxed from *shall* to *should*.

Definitions Stamper will lean on **[verified: spec text]**:
- **Manifest Repository (§2.4.5)**: "A repository into which C2PA Manifests and C2PA Manifest Stores can be placed, and which can be searched using a content binding."
- **External manifests (§11.4)**: "keeping the C2PA Manifests externally to the asset is an acceptable model … stored in a location, referred to as a manifest repository … As the C2PA Manifest Store is a JUMBF box, it shall be served with the JUMBF Media Type, `application/c2pa`." (`application/x-c2pa-manifest-store` is deprecated.)
- **Repository receipt (§18.27)**: label `c2pa.repository-receipt`; "it shall only appear within an update manifest"; JSON-LD body with `@context`, `@type: "org.c2pa.repository-receipt"`, `repository{uri, manifestId}` and `anchor{uri, parameters?, proof}` where "The structure of the proof object is repository-specific." Example `manifestId`: `urn:c2pa:manifest:sha256:…`.
- **Soft binding assertion (§18.10)**: label `c2pa.soft-binding`; CDDL `soft-binding-map = { "alg": tstr, "blocks": [1* {"scope": {timespan|region}, "value": bstr}], ? "pad", ? "name", ? "alg-params", ? "bindingMetadata" }`. Discovery: "Discovery of the C2PA Manifest shall be performed using one, or a combination of, algorithms identified by the alg field within the C2PA Soft Binding Algorithm List … https://spec.c2pa.org/softbinding-alg-list".
- **Actions vocabulary**: `c2pa.created`, `c2pa.opened`, `c2pa.edited`, `c2pa.placed`, `c2pa.resized`, `c2pa.cropped`, `c2pa.transcoded`, `c2pa.repackaged`, `c2pa.redacted`, `c2pa.published`, … and the watermark roles `c2pa.watermarked` (deprecated), **`c2pa.watermarked.bound`** ("watermarking was applied … for the purpose of soft binding") and **`c2pa.watermarked.unbound`** ("watermarking was applied … without creating a soft binding"). Validation: a `c2pa.watermarked.bound` action without a `c2pa.soft-binding` assertion fails with `assertion.action.softBindingMissing`.
- **Ingredient relationship** "shall be one of the following: `parentOf`, `inputTo`, or `componentOf`" (the c2pa-rs `Relationship` enum also exposes `derivedFrom` per docs.rs — low confidence, not in the 2.4 normative list).
- **Custom assertion labels**: entity-specific namespaces follow the reverse-domain convention `entity = entity-component *("." entity-component)`, components matching `[a-zA-Z0-9][a-zA-Z0-9_-]*`.
- **Validation states**: *well-formed* → *valid* (hashes and signature verify) → *trusted* (signer chains to a trust list, not revoked). The July 2026 *Content Credentials Deployment Guidance 1.0* phrases the user-facing outcomes as **Valid** ("intact … but the signer may not be on the C2PA Trust List"), **Trusted** ("signer is on the C2PA Trust List") and **No Credentials Found**. [verified]

Companion documents (all at spec.c2pa.org): Explainer 2.4, Implementation Guidance 2.4, Harms Modelling 2.0 (2025-05-05), Security Considerations, *Content Credentials Deployment Guidance 1.0* (2026-07-08, c2pa.org PDF). [verified]

### 1.2 Trust model: certificates, conformance program, trust lists

**How trust is decided [verified: CAI conformance docs, Certificate Policy v0.2 (2026-07-31), conformance-public repo]**
- A generator product signs claims with an X.509 claim-signing certificate. A validator calls the manifest *trusted* only if the chain terminates in a trust anchor on the **C2PA Trust List** (PEM/JSON at `github.com/c2pa-org/conformance-public/trust-list/C2PA-TRUST-LIST.{pem,json}`; TSA anchors in `C2PA-TSA-TRUST-LIST.{pem,json}`; CC-BY-4.0). List issue date in the JSON I fetched: 2026-08-05, next update 2027-08-05.
- The trust list currently has **17 organisations / 30 anchor services**: Adobe (claim-signing service ICA), DigiCert (RSA4096 + ECC P-384 roots, L1 claim-signing ICAs), Encypher, Google (root + mobile ICAs incl. "L1" variants), Huanyu Trust, Huawei, Irdeto, SSL.com (RSA + ECC roots), Snowball, Tauth Labs, Trufo, TrustAsia, Verimago, Whole Earth Labs (RealReel), Xiaomi, vivo, Castlabs. TSA list: 16 anchors (DigiCert, Encypher, Google, Huanyu, Huawei, Irdeto, SSL.com, Snowball, Tauth, Trufo, TrustAsia, vivo, Castlabs).
- **Interim Trust List (ITL)**: "As of January 1, 2026, the ITL has been frozen": no new certificates are added; existing ones remain for legacy validation. **STALE/CHANGED**: the pre-2026 route of "submit your cert to CAI's known certificate list" no longer exists for new entrants. [verified]
- **Verify** (verify.contentauthenticity.org) checks `static/trust/allowed.pem` (end-entity) and `anchors.pem` (roots) in `contentauth/verify-site`; otherwise it shows an **"unknown source"** message. [verified]

**Conformance Program [verified: c2pa.org/conformance, CAI docs, Certificate Policy, CPL JSON]**
- Three product categories: **Generator**, **Validator**, **Certificate Authority**. Two **Assurance Levels** (1 and 2). "If you're developing a product that reads or creates Content Credentials, you can apply … To start the process, you must fill out C2PA's expression of interest form"; then sign a legal agreement, supply architecture diagrams/documentation and sample assets, and work with conformance staff. Trufo's guide cites **1 week to 3 months** to approval and a cost of **$3K–8K/yr for an in-house Level 1 pipeline at 1M images/yr (plus ~6 dev-months) vs. $15K–40K managed**. [verified: Trufo guide (vendor source)]
- **Membership is not required**: C2PA FAQ: "You can implement the C2PA specification without joining the organization", but to obtain signing certificates and be listed you must pass conformance. Fees: "Costs may vary depending on the Certification Authority issuing the certificate and the product's desired Assurance Level" (C2PA sets no fee itself). [verified]
- **Conforming Products List (CPL)** (`conforming-products/conforming-products-list.json`): **228 entries as of 2026-10-01**, 132 organisations, all `status: conformant`; `specVersion` 2.2 (192), 2.4 (34), both (2); `conformanceProgramVersion` 0.1 (171) / 0.2 (57). Each record carries the exact certificate **DN (C, O, CN)** the signing certificate must use, `minVersion`, `assurance.maxAssuranceLevel`, `assurance.attestationMethods` (e.g. `Android_KeyAttestation`, `Google_PlayIntegrity`, `Apple_AppAttest`, `AWS_NitroEnclaveAttestation`, `Microsoft_AzureAttestation`), `disallowedSignals` (e.g. `inception: ["nonGenAIDigitalCreation"]`) and the containers (MIME types) it may generate/validate. [verified]
- Notable CPL entries: Google **Pixel Camera** (generator, **Level 2**, Android_KeyAttestation, JPEG only, conformant 2025-06-27, several versions re-listed through 2026-03); Google Photos, Pixel Studio, YouTube services, "Video Boost by Pixel Camera" (L1, 2026-07-16); **Proofmode for Android** (L1, Android_KeyAttestation + Google_PlayIntegrity, 2026-04-06) and **Proofmode for iOS** (L1, Apple_AppAttest, 2026-07-11); **Numbers Co., Ltd. "ProofSnap Android/iOS"** (L1, 2026-01-27) and **"Numbers Verify Engine"** (validator, 2026-07-28); **Trufo Provenance Platform** (L1, AWS Nitro attestation, 2026-05-08); **OpenAI Media Service** (L1, 2026-01-28); **IPTC C2PA Signer Tool** (L1, 2026-03-20); **Encypher** (L1); **Adobe Content Authenticity Inspect** (validator, 2025-08-05); **EZDRM DynamicSigner** (Level 2 via AWS Nitro / Azure attestation); **InReality Capture iOS/Android** (L1, listed against 2.4 on 2026-09-21); **GreenCheckmark** (Android L2 via Play Integrity + Key Attestation; iOS L1 via App Attest); Xiaomi Camera/MediaEditor, vivo Camera (L1, Sept 2025). **Absent** from the CPL on 2026-10-01: Truepic, Nodle/Click, Sony, Leica, Canon, Nikon, Samsung, Cloudflare, Attestiv, OpenOrigins, Meta, TikTok. [verified by presence/absence in the fetched JSON]
- Only Android products hold Level 2 on mobile; every iOS entry is Level 1 (Apple App Attest is accepted only for L1 so far). [verified by CPL inspection] Google's own blog says L2 is "achievable only on Android currently". [verified]

**Certificate Policy v0.2 (2026-07-31) — the numbers that constrain Stamper [verified: PDF text]**
- Claim-signing end-entity certs: **max 366 days validity at Assurance Level 1; max 90 days at Level 2**. Subject Name "MUST match C2PA Conforming Products List (CPL) entry. Requires C, O, CN attributes." Issuing CAs ≤1827 days; TSA issuing CAs ≤5479 days; TSA certs ≤4110 days.
- Assurance level is carried in the certificate via the `c2pa-al` extension, OID **1.3.6.1.4.1.62558.3**.
- **Level 1 key protection: "No stipulation"** (A.1) — enrolment only has to prove the enrolling entity is an instance of the subscriber's product (SCEP/EST/ACME/client certs…). **Level 2 (A.2)**: CA must validate hardware-backed artefacts attesting package names/hashes/code-signing certs, that the key pair "is generated and stored within a hardware-backed platform keystore service or Key Management Service", that the platform "has booted securely into authenticated software images", and that security patches are no older than 90 days.
- OCSP responses are **mandatory** for claim-signing certs; CRLs optional. Revocation is required on "Suspected or confirmed compromise of the Generator Product or attestation failure", key exposure, CPL status change, etc. Subscriber identity is re-authenticated at least every 398 days.
- Applicant = "An entity that has created a Generator Product or a Validator Product…" — organisation validation (OV) is performed by the CA; nothing in the CP forbids a one-person company, and several LLC/ApS/OPC entities are listed. [verified + inferred]

**CA offers (pricing) [verified/secondary]**
- **SSL.com**: C2PA Free Tier (since May 2026): "one Level 1 Claim Signing Certificate valid for 1 year, plus 2,500 trusted timestamps per year, issued via the SSL portal"; Premium: 10,000 timestamps/yr (price not published). Requirement: "a valid C2PA conformance record ID" and organisation validation; "only issue[d] … for tools and devices that have passed C2PA Conformance". C2PA-conformant TSA endpoints: `https://api.c2patool.io/api/v1/timestamps/ecc` and `/rsa`. Also issues CAWG identity certs. [verified: ssl.com product page + press release]
- **Trufo**: annual subscription for C2PA signing / CAWG identity / TSA certs; search snippets quote "certificates start at $300/yr" and "C2PA Claim Signing certificates start at $600/yr; CAWG Identity credentials from $60/yr; enterprise from $20,000/yr" — the pricing page hides numbers behind sign-up, so **treat as unconfirmed**. [secondary]
- **DigiCert**: Device Trust Manager issues Level 1 claim-signing certs; pricing not public. [secondary]
- IPTC's own signing cert came from Trufo; IPTC works with SSL.com, GlobalSign, DigiCert. [secondary]

**Consequence for an indie app [inferred from the above]**: Stamper *can* get on the list (Proofmode Reality Systems LLC and InReality ApS did, at Level 1, within 2026). Without it, every third-party validator will show "unknown source"/"Valid" rather than "Trusted", the ACA Inspect tool will not show Stamper's icon, and platforms that surface the Cr pin will not trust it. Level 2 is realistic only on Android, needs a CA that validates attestation evidence, and — per §1.5 — still does not survive a rooted device.

### 1.3 CAWG (Creator Assertions Working Group) identity assertions

- CAWG now lives under the Decentralized Identity Foundation. **Identity Assertion 1.3 is a "DIF Ratified Specification, 17 August 2026"**; 1.2 was ratified 2025-12-15. Label **`cawg.identity`**. Two credential types: **`cawg.x509.cose`** (identity bound to an X.509 cert; SDK can sign and validate) and **`cawg.identity_claims_aggregation`** (W3C Verifiable Credential from an identity aggregator — e.g. LinkedIn-verified name plus social handles; SDK validates only, "Signing is not supported"). Drafts: `cawg.vlei`, `cawg.vc-vp`, governance. The identity signature is **independent of the C2PA claim signature**: "a trust signal that is independent from (and thus, in addition to) the trust signal provided by the C2PA claim generator itself." It signs a `signer_payload` with `referenced_assertions` (hashlinks) and optional `role`; it can be **redacted** later without breaking the asset. [verified: cawg.io, CAI docs]
- Other CAWG specs: Metadata assertion 1.1, Training-and-Data-Mining 1.1, Organizational Identity Profile 1.0, Consent (draft), Endorsement (draft), UX Guidance 1.0. [verified]
- Privacy: only opt-in claims are exposed; WITNESS's July 2026 report (below) is the reference for why Stamper should default to pseudonymous signing and keep identity assertions opt-in and redactable. [verified/secondary]
- SDK: `c2pa` 0.91.x restructured trust config so "CAWG ICA issuers now require explicit trust listing" and replaced the single `cawg_trust` section with a `trust.anchors` array; the C API gained a "credential-holder identity signer". [verified: release notes]

### 1.4 Durable Content Credentials (soft bindings)

- Definition (CAI docs, Deployment Guidance): hard binding = cryptographic hash in the manifest; soft binding = **invisible watermark** and/or **content fingerprint** registered via `c2pa.soft-binding`, so that "if a copy of the manifest data is stored in an online database, you can use a watermark or a fingerprint to find it again". The guidance is explicit that "No single technique is sufficient on its own: embedded information can be stripped, watermarks can be defeated, and fingerprint matching is probabilistic rather than exact." [verified]
- **Soft Binding Algorithm List** (`github.com/c2pa-org/softbinding-algorithm-list`, JSON): 53 entries at fetch time. Open-source ones: **Adobe TrustMark** variants `com.adobe.trustmark.Q`, `.C`, `.P` (MIT; Python `pip install trustmark`, JS/ONNX, Rust and Hailo ports; 100-bit payload with BCH error-correction schemas; ICCV 2025 paper on arbitrary-resolution robustness), `es.lumatrace` (Java), `com.cognitive-proof.vsrmark.1` (text). Proprietary: Digimarc Validate, Trufo "pawprint" (44/88-bit payload, watermark + fingerprint), ISCC fingerprint (`io.iscc.v0`, ISO 24138), Microsoft InvisMark/WavMark, Meta VideoSeal/PixelSeal/AudioSeal via AIWatermark and Reconize, Imatag, NAGRA NexGuard, Verimatrix, castLabs, Steg.AI, Adobe FlowMark (video) and HierMark (audio), etc. [verified: JSON]
- Adobe's Content Authenticity app (free public beta since 2025-04-29) applies TrustMark + fingerprinting so credentials "stay with it permanently, even if a screenshot is taken"; Verify/Inspect can "search for matching credentials" using Adobe's private index. Third parties cannot query that index — Stamper must run its own. [verified/secondary + inferred]
- The 2.4 spec text ties `c2pa.watermarked.bound` actions to `c2pa.soft-binding` assertions and defines the discovery flow against a manifest repository. **A visible mark that carries no recoverable payload is `c2pa.watermarked.unbound`.** [verified]
- Caveat: Nemecek et al., *Authenticated Contradictions from Desynchronized Provenance and Watermarking* (arXiv 2603.02378, CVPR 2026 workshop) show "integrity clashes" where a valid manifest claiming human capture coexists with a watermark indicating AI generation; they recommend a **cross-layer audit** that evaluates provenance and watermark jointly. [verified]

### 1.5 Adoption in 2025–2026

**Cameras [secondary: Wikipedia adoption table + press; cross-checked where possible]**
- Leica: M11-P (2023-10-26, first), M11-D (2024-09), SL3-S (2025-01), M EV1 (2025-10), SL3-P (2026-06-25). Note: Leica originally used the Interim Trust List; Leica is not on the CPL as of 2026-10-01.
- Sony: α1/α7S III (2024-03) → α1 II, α9 III (2025-01) → α7 IV (2025-03) → PXW-Z300 camcorder (2025-07, first with native video signing) → FX3/FX30 (2025-10) → α7R V (2025-11) → α7 V (2026-05) → α7R VI (2026-06). **Sony "Camera Authenticity Solution" ver. 2026.1 (March 2026)** adds video to *Camera Verify* (beta) and the Image Verification Pre-check SDK; it is a **paid licence per camera**, verification through a dedicated upload URL, and uses 3D-depth metadata as an anti-AI signal; video must be MP4 ≤222 Mbps, no 8K/slow-mo. Not on the CPL. [secondary: newsshooter 2026-03-12, Sony press]
- Canon: EOS R1 / R5 Mark II (2025-07-17). Not on CPL. [secondary]
- Nikon: Z6III firmware 2.00 (Aug 2025) — **certificates revoked** after Horshack's exploit (discovered 2025-09-04; service suspended 2025-09-05): a custom NEF encoder plus the multiple-exposure feature let the camera sign "an AI-generated image of a pug flying a jet". Nikon said all certificates issued are now invalid and the credentials "can no longer be used as proof of provenance"; no restoration reported as of early 2026. PetaPixel's follow-up: "the default behavior of available validation tools is not to check" revocation — Horshack filed a c2patool issue to make OCSP the default (c2pa 0.91 now does OCSP responder validation improvements). **STALE risk**: check Nikon's status before citing. [secondary, two outlets]
- Fujifilm/Panasonic: search summaries call them "C2PA-capable"; Wikipedia's table lists neither. **Unverified.**

**Phones [verified: Google blog 2025-09-10; CPL]**
- **Pixel 10** (announced 2025-09-10): Pixel Camera signs **every JPEG by default**; Google Photos adds credentials on edits and shows them in the *About* panel; keys in **Titan M2 (Android StrongBox)**, timestamps from an isolated secure clock on **Tensor G5** so signatures remain verifiable offline and after certificate expiry; **"One-and-Done": each key and certificate signs exactly one image** to prevent cross-image linkability; no account required, no IP logging; **Assurance Level 2**, "achievable only on Android currently".
- Samsung Galaxy S23+ (Jan 2025): credentials only on AI-edited (Photo Assist) images; Xiaomi Camera and vivo Camera are conformant generators at L1 (Sept 2025). Apple: nothing shipped. [secondary/verified]

**Platforms [secondary unless noted]**
- LinkedIn (May 2024): shows the **Cr** icon and provenance popover; LinkedIn-verified identity feeds Adobe's app via CAWG aggregation. 
- TikTok (2024-05-09, newsroom [verified]): reads Content Credentials at upload to auto-label AIGC and "will start attaching Content Credentials to TikTok content, which will remain on content when downloaded".
- YouTube (Oct 2024): "How this content was made / captured with a camera" label in the description for C2PA-signed uploads. 
- Meta (Feb 2024 labels; joined the C2PA Steering Committee Sept 2024 [verified: spec.c2pa.org/post/meta_pr]): reads C2PA/IPTC at ingest for "AI info" labels **but strips the manifest from served files** (Instagram/Facebook/Threads).
- **Cloudflare Images (2025-02-03, [verified: Cloudflare blog])**: "Preserve Content Credentials" toggle keeps the original manifest and **appends a Cloudflare-signed manifest describing the transformation**, signed with a DigiCert end-entity cert on the trust list — the only CDN doing this.
- Also: Google Search "About this image" (Nov 2024), Pinterest (Apr 2025), X (Jan 2026), OpenAI images (Feb 2024, conformant "OpenAI Media Service" Jan 2026), Google Gemini (Aug 2025). Wikipedia lists "Anthropic Claude: September 2026" — unverified.
- Practical pattern: platforms *read at ingest, label, then discard*; only LinkedIn, TikTok (downloads), Cloudflare and YouTube's label actually propagate anything. [secondary]

### 1.6 Security critiques and human-rights concerns (what Stamper must design around)

1. **Golaszewski, Krawetz, Sherman et al., "Verifying Provenance of Digital Media: Why the C2PA Specifications Fall Short" (arXiv 2604.24890, 2026-04-23)** [verified]: revocation checking is optional and inconsistently implemented; "nothing in the signed data cryptographically binds to the timestamp layer"; different conforming validators disagree on the same file; data outside the hashed ranges (exclusions, e.g. GPS in some metadata locations) can be edited undetected; signed media become "unverifiable within months" when certs expire without trusted timestamps; conformance "relies on self-reporting without source code examination or functional testing". Remedies: mandatory revocation checks, bound timestamps, cross-tool consistency, full-file hashing, independent audits.
2. **David Buchanan, "C2PA Cameras Do Not Survive Contact With Reality" (2026-08-25)** [verified]: on a Pixel 10 (Assurance Level 2) he used a root LPE (CVE-2026-43499) and DRAM fault injection to make StrongBox sign arbitrary content (an AI frog image; a YouTube video as a "camera capture"); "All Android C2PA apps relying on Key Attestation or Google Play Integrity" are affected; Google: "Won't fix (infeasible)", $7,500 bounty. Attestation detects unlocked bootloaders and *known* exploits, not private ones.
3. **Nikon Z6III** (above): first revocation of a camera's certificates; showed validators do not check revocation by default.
4. **Platform stripping**: the manifest rarely survives Meta/X; hence soft bindings and an external lookup (a short code) are not optional.
5. **WITNESS**: co-chairs the C2PA Threats & Harms task force; report *"C2PA Content Credentials and the Surveillance Risk: Adversarial Scenarios and Governance Gaps"* (2026-07-08, Geneva launch) — seven adversarial scenarios around identity disclosure, behavioural profiling and surveillance; "technical standards alone are not enough". Also C2PA *Harms Modelling 2.0* (2025-05-05). Design implications: opt-in location, no mandatory identity, per-asset unlinkable keys (Pixel's model), redactable identity assertions, and no on-chain PII. [verified/secondary]
6. **Semantic limits**: "a valid signature certifies that metadata has not been modified since signing, but it does not certify the semantic truth of the assertions" — any "authentic" badge must be worded as *what was proven* (hash, time, device/app, registry) rather than "this is true". [secondary, widely stated]

---

## 2. SDKs and tooling in 2026

### 2.1 `c2pa-rs` (Rust, canonical)

- Latest: **`c2pa` v0.91.1 (2026-09-27)**; v0.91.0 (2026-09-21) is the "**C2PA 2.3 spec compliance**" breaking release: trust-list restructure (`trust.anchors` array replaces the single `cawg_trust` section; CAWG ICA issuers need explicit trust listing), **verify-after-sign on by default**, did:web loopback/DNS-rebinding rejection, BMFF hardening (native sample reader replaces the `mp4` crate), manifest relative-path-traversal prevention, 70+ deprecated items removed; 0.91.1 adds **PDF manifest writing**, XMP/TIFF/ID3 parsing hardening, OCSP responder validation improvements. `c2pa-c-ffi` v0.91.1 tracks it. MSRV **Rust 1.96**. **MIT OR Apache-2.0**. `main` is never published to crates.io. [verified: releases, README]
- Capabilities: "Create and sign C2PA claims and manifests", embed/parse/validate in supported formats, `Arc<Context>` configuration (replaces global settings), v2 claims (v1 deprecated), progress callbacks/cancellation, C API, bindings (Python, Node, Swift/Kotlin wrappers, WASM). [verified]
- **Formats** (`docs/supported-formats.md`, read on 2026-10-01): `avi`, `avif`, `c2pa`, `dng`, `flac`, `gif`, `heic`, `heif`, `jpg/jpeg`, `jxl`, `m4a`, `mp3`, `mp4` ("Fragmented MP4 (DASH) supported only for file-based operations from the Rust library"), `mov`, `pdf`, `png`, `svg`, `tif/tiff`, `txt`, `wav`, `webp`; plus structured-text formats behind the `unstable_structured_text` feature. **WebM/Matroska are not listed → unsupported.** The table does not separate read vs write; HEIC/HEIF are BMFF-handled and carry no read-only caveat, but **test HEIC write before relying on it**. [verified + inferred]
- Key API (docs.rs, v0.91.1) [verified]:
  - `Builder::add_assertion<S: Into<String>, T: Serialize>(&mut self, label, &data)` and `add_assertion_json` — **custom assertions are just labelled JSON/CBOR**; `add_action`, `add_ingredient(Ingredient)`, `add_ingredient_from_stream(ingredient_json, format, &mut stream)`, `add_resource`, `set_claim_generator_info`, `set_remote_url`, `set_no_embed` (sidecar/remote workflows), `to_archive` / `with_archive` (serialise unsigned builder state), `sign(&dyn Signer, format, src, dst)`, `sign_async`, `sign_file`, `sign_fragmented_files` (DASH), `save_to_stream` (uses the Context's signer).
  - `Ingredient`: `from_stream_info(stream, format, title)`, `from_file_info(path)`, `set_relationship(Relationship)`, `set_is_parent()`, `set_manifest_data(...)`, `set_thumbnail(...)`, `validation_status()`.
  - `Signer` trait: `sign(&[u8])`, `alg()`, `certs()` (DER chain), **`reserve_size()`** ("the size in bytes of the largest possible expected signature" — must cover COSE signature + RFC 3161 token + OCSP staple), `time_authority_url()`, `send_timestamp_request()`, `ocsp_val()`, `dynamic_assertions()`. `CallbackSigner::new(callback, SigningAlg, certs).set_tsa_url(..)` for KMS/HSM/remote signing (callback `Fn(*const (), &[u8]) -> Result<Vec<u8>>`); `AsyncSigner` for `sign_async`.
  - `settings`: `Settings { core, trust, verify, builder, signer, … }`; `Trust` holds `TrustAnchor`s, user anchors, allowed lists, trust config; `Verify { verify_after_reading, verify_after_sign, verify_trust, ocsp_fetch, remote_manifest_fetch, verify_timestamp_trust }`; loadable from JSON/TOML or via `Context`.
  - `ManifestDefinition` (JSON): `claim_version` (default 2), `vendor` (reverse-domain prefix for the manifest label), `claim_generator_info[]`, `title`, `format`, `instance_id`, `thumbnail`, `ingredients[]`, `assertions[]` (`{label, data}`), `redactions[]`, `label`, `hash_alg` (sha256/384/512).
- Security helper repo: `contentauth/c2pa-attacks` (fuzzing/attack tool). [secondary]

### 2.2 `c2patool` (CLI)

- **STALE/CHANGED**: c2patool moved **back into its own repository** (`github.com/contentauth/c2patool`); releases ≤ v0.27.15 live in `c2pa-rs` tagged `c2patool-vX.Y.Z`. Latest **v0.28.1 (2026-09-28, tracks `c2pa` 0.91)**; `brew install c2patool` or prebuilt binaries. [verified: crates.io JSON, README]
- Manifest definition JSON (verbatim shape from docs/manifest.md) [verified]:
  ```json
  {
    "alg": "es256",
    "private_key": "…/es256_private.key",
    "sign_cert": "…/es256_certs.pem",
    "ta_url": "http://timestamp.digicert.com",
    "claim_generator_info": [{"name": "My App", "version": "0.1.0", "icon": {"format": "image/svg+xml", "identifier": "logo.svg"}}],
    "assertions": [
      {"label": "c2pa.actions.v2",
       "data": {"actions": [{"action": "c2pa.created", "softwareAgent": "My Demo",
                 "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalArt"}],
                "allActionsIncluded": true}}
    ]
  }
  ```
  Any additional `{"label": "computer.paradox.stamper.anchor", "data": {...}}` entry becomes a custom assertion. "ACA Inspect will only display an icon for a signing certificate if the certificate can be traced back to a root certificate on the C2PA trust list."
- Flags: `--create <digitalSourceType>` (new asset, auto `c2pa.created`), default *edit* intent (source becomes `parentOf` ingredient with `c2pa.opened`), `--update` (update manifest), `--parent/-p <file|ingredient dir>`, `--ingredient/-i` (extract an ingredient report + `.c2pa` + thumbnail), `--sidecar/-s`, `--remote/-r <url>` (HTTP reference; validators fetch it automatically), `--external-manifest`, `--tree`, `--no_signing_verify`, `--settings`. Trust: `c2patool init trust` fetches and caches the official list; `trust --trust_anchors <pem|url> --allowed_list <pem> --trust_config <cfg> --trust_list_uri <uri>` (env `C2PATOOL_TRUST_ANCHORS` etc.); official anchors URL `https://raw.githubusercontent.com/c2pa-org/conformance-public/refs/heads/main/trust-list/C2PA-TRUST-LIST.pem`; legacy CAI lists at `https://contentcredentials.org/trust/{anchors.pem,allowed.sha256.txt,store.cfg}`. Production guidance: use a subprocess or remote signing service so "private key material never passes through c2patool"; CAWG identity assertions are configurable in signing.md. [verified: usage.md]

### 2.3 `@contentauth/c2pa-node` (Node.js)

- **0.9.9** on the npm registry (2026-09), MIT, **Node ≥ 22**, prebuilt binaries for Linux x86_64/aarch64, macOS arm64/x86_64, Windows x86/ARM (postinstall download; build-from-source needs Rust). Lives in the `contentauth/c2pa-js` monorepo (c2pa-node-v2 merged June 2026). [verified: registry JSON, README]
- Reads, validates and **signs**. README snippets [verified]:
  ```js
  import { Reader, Builder, LocalSigner, CallbackSigner, Context } from '@contentauth/c2pa-node';
  const reader = await Reader.fromAsset(inputAsset); const store = reader.json(); const active = reader.getActive();
  const signer = LocalSigner.newSigner(certificateBuffer, privateKeyBuffer, 'es256');
  const builder = await Builder.newAsync();
  builder.addAssertion('c2pa.actions', actionsAssertion);           // any label works
  await builder.addIngredient(JSON.stringify({ title: 'source.jpg', format: 'image/jpeg' }),
                              { buffer: ingredientBuffer, mimeType: 'image/jpeg' });
  builder.setIntent({ create: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' });
  const manifest = builder.sign(signer, inputAsset, outputAsset);
  // remote/KMS signing:
  const cb = CallbackSigner.newSigner({ alg: 'es256', certs: [certBuffer], reserveSize: 1024 }, async (data) => kmsSign(data));
  await builder.signAsync(cb, inputAsset, outputAsset);
  const ctx = new Context({ verify: { verifyAfterReading: false, verifyTrust: true, ocspFetch: true },
                            trust: { verifyTrustList: true, trustAnchors: 'path/to/anchors.pem' } });
  ```
  (`reserveSize: 1024` in the README example is too small once a TSA token is included — size it from your real signature+token; `c2pa` fails signing if the signature exceeds the reserve.) [inferred]

### 2.4 `@contentauth/c2pa-web` (browser)

- **0.15.3** (registry; the npm page snippet "0.14.4" was already stale), MIT, depends on `@contentauth/c2pa-wasm` 0.13.2 (**unpacked 9,072,229 bytes ≈ 8.65 MB, 7 files**, includes `c2pa_bg.wasm`), `@contentauth/c2pa-types` 0.7.5. Published via npm OIDC trusted publishing. [verified: registry JSON]
- Capabilities: **read + validate** (`createC2pa({wasmSrc})`, `Reader.fromBlob(c2pa, type, blob, context)`, `reader.manifestStore()`, `reader.free()`), trust settings via `new Context({ verify: { verifyTrust: true }, trust: { trustAnchors: 'https://…/anchors.pem' } })`, and a **Builder that can assemble ingredients and `toArchive()`** (the `.c2pa` archive can be signed elsewhere or reused as an ingredient). **No `sign()` in the browser** — signing must happen in Node/Rust/Python or a remote signer. WASM is fetched separately at runtime by default ("inline" build adds significant bundle size). [verified: README]
- **STALE/CHANGED**: the old `c2pa` npm package / `c2pa-js-legacy` monorepo is deprecated — "implementors should use @contentauth/c2pa-web instead". [verified]
- CAI's learning course covers "Formatting C2PA data for L1–L3 disclosures" (three progressive display levels). [verified]

### 2.5 `c2pa-python`

- **0.38.0 (2026-09-29)**, Python ≥ 3.10, MIT OR Apache-2.0; read/validate, Builder with assertions + ingredients, sign with PEM keys or **callback signer**, `Context`/`Settings`, builder intents, archives; examples `read.py`, `sign.py`, `training.py` (Do-Not-Train). Formats = c2pa-rs. [verified: PyPI + GitHub]

### 2.6 Mobile: `c2pa-swift`, `c2pa-android`, React Native

- **c2pa-swift** (contentauth): iOS 16+/macOS 14+/Catalyst, Swift 5.9, Xcode 16; `C2PA.readFile`, `C2PA.signFile`, stream `Reader`/`Builder`; **Secure Enclave hardware-backed ES256 signing**; `SignerInfo(algorithm: .es256, certificatePEM:, privateKeyPEM:, tsaURL:)`; ships a test signing server (CSR + manifest signing with bearer token); dual MIT/Apache-2.0; **no tagged releases yet (58 commits)** → treat as pre-1.0. [verified: README]
- **c2pa-android** (contentauth): **1.0.0 via JitPack `com.github.contentauth:c2pa-android:1.0.0`**, min API 28; read/validate/Builder/sign; signers: direct PEM, callback (HSM/KMS), web-service (remote HTTP), **Android Keystore and StrongBox** (`StrongBoxSigner.createSigner(algorithm = SigningAlgorithm.ES256, certificateChainPEM = …)`); `CertificateManager` does CSR generation/enrolment; dual MIT/Apache-2.0. [verified: README]
- Both wrap `c2pa-rs` through the C API; documented at opensource.contentauthenticity.org/docs/mobile. [verified]
- **React Native: no official binding.** Community: `@rolobits/attestation-photo-mobile` (MIT; JPEG-only capture signed in Secure Enclave / StrongBox-TEE with root/jailbreak checks; manifest embedded as JUMBF; **self-signed cert, no CA chain** so verifiers report unknown signer). Nodle's Click wrote its own c2pa-rs mobile bindings. Guardian Project's `proofmode` crate 0.9.0 (2026-04-01; pins `c2pa` 0.75) ships Android/iOS/WASM/Python/Ruby bindings and "server-side C2PA signing with device attestation, used by ProofSign" (Apple App Attest + Google Play Integrity). [verified]
- Implication: a React Native Stamper needs either a thin native module around c2pa-swift/c2pa-android, or (simpler, and what Proofmode/Trufo/InReality do) **device attestation on-device + manifest assembly and signing on the server**. [inferred]

### 2.7 Sizes (what the manifest costs)

- No primary source states a canonical byte count. From the structure [inferred]: the claim-signature box carries the full DER cert chain (≈2–6 KB), a COSE signature (≈70–500 B), an RFC 3161 timestamp token (≈2–5 KB) and optionally an OCSP staple (≈1–3 KB); assertions are small (hundreds of bytes) unless you embed thumbnails (`c2pa.thumbnail.claim.jpeg`, typically 10–50 KB) or ingredient manifests (which copy the parent's whole manifest store). Expect **~10–20 KB without thumbnails, 30–80 KB with** per JPEG. Pixel's one-cert-per-image design pays the chain each time. Video (BMFF) hashing covers the mdat/moov boxes; the manifest box is similar in size.
- Browser verifier: ≈8.7 MB unpacked WASM package (served .wasm is smaller after compression; measure). [verified size; inferred compression]

### 2.8 Custom assertions and an ingredient chain for Stamper (concrete)

Reverse-domain label (spec-compliant) and a parent chain from the untouched original to the visibly marked derivative [verified API, inferred design]:

```rust
use c2pa::{Builder, Ingredient, Relationship, CallbackSigner, SigningAlg};
use serde_json::json;

// 1) ORIGINAL (private, stored on Filecoin): create-intent manifest
let mut b = Builder::from_json(&json!({
  "claim_generator_info": [{"name": "Stamper", "version": "1.0.0"}],
  "title": "stamp-01J9….jpg", "format": "image/jpeg",
  "assertions": [
    {"label": "c2pa.actions.v2", "data": {"actions": [{"action": "c2pa.created",
       "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"}],
       "allActionsIncluded": true}}
  ]}).to_string())?;
b.add_assertion("computer.paradox.stamper.anchor", &json!({
  "stampId": "S7K2-9QF4",                      // the short code printed in the visible mark
  "cid": "bafy…",                              // CIDv1 of the ORIGINAL bytes
  "pieceCid": "baga…",                         // Filecoin piece CID (if known at sign time)
  "registry": {"chainId": 314, "contract": "0x…", "txHash": "0x…", "block": 0},
  "deviceAttestation": {"type": "Apple_AppAttest|Android_KeyAttestation", "hash": "sha256:…"}
}))?;
b.sign_async(&signer, "image/jpeg", &mut original_in, &mut original_out).await?;

// 2) DERIVATIVE (public, visibly marked): edit-intent manifest whose parent is the original
let mut d = Builder::from_json(&json!({
  "claim_generator_info": [{"name": "Stamper", "version": "1.0.0"}],
  "format": "image/jpeg",
  "assertions": [
    {"label": "c2pa.actions.v2", "data": {"actions": [
       {"action": "c2pa.opened"},
       {"action": "c2pa.watermarked.unbound", "description": "Stamper visible mark + short code"},
       {"action": "c2pa.watermarked.bound"}   // only if an invisible TrustMark carrying stampId is added
     ], "allActionsIncluded": true}},
    {"label": "c2pa.soft-binding", "data": { /* alg: "com.adobe.trustmark.Q", blocks: [...] */ }},
    {"label": "computer.paradox.stamper.anchor", "data": { "stampId": "S7K2-9QF4", "originalCid": "bafy…", "derivedCid": "bafy…" }}
  ]}).to_string())?;
let mut parent = Ingredient::from_stream_info(&mut original_signed, "image/jpeg", "original");
parent.set_relationship(Relationship::ParentOf);   // carries the original's manifest + validation status
d.add_ingredient(parent);
d.sign_async(&signer, "image/jpeg", &mut marked_in, &mut marked_out).await?;

// 3) later, once the Filecoin deal + FEVM tx are final: an UPDATE manifest with c2pa.repository-receipt
```
Notes: in c2patool the same is `c2patool original.jpg --create digitalCapture -m original.json -o original_signed.jpg` then `c2patool marked.jpg -m derivative.json -p original_signed.jpg -o marked_signed.jpg`. The receipt assertion "shall only appear within an update manifest" (`--update`), which is the natural place for post-hoc Filecoin/registry confirmations. [verified spec rule]

---

## 3. Prior art and competitors

| Project | Capture-time approach | Storage | Where trust lives | Known weaknesses | Business model | Status (2026) |
|---|---|---|---|---|---|---|
| **Numbers Protocol** (Capture Cam 2021, ProofSnap 2026, Nit, Verify Engine) | In-app capture; C2PA credential (creator, time, GPS, device) + ERC-7053 commit "the moment it's taken"; ProofSnap is a conformant L1 generator (iOS+Android, 2026-01-27) | IPFS "with redundant gateways"; API registration pins to IPFS "with Filecoin backup" **but unpins after one month** unless Capture subscription or 0.1 NUM/file/month; Filecoin partnership announced 2026-04 | Numbers Mainnet "Jade" (chainId **10507**, RPC `https://mainnetrpc.num.network`, explorer `https://mainnet.num.network`, NUM gas, Avalanche-subnet tech, **permissioned** contract deployment), ERC-7053 `commit(assetCid, commitData)` / `event Commit(recorder, assetCid, commitData)`; Nid = Kubo CIDv1 of the file; Numbers' API/committer keys | Permissioned chain; off-chain assetTree on IPFS; pinning expiry; commit contract address not published in the pages fetched; trust in Numbers' committer; C2PA cert only at L1 | NUM token, pay-per-use API, Capture subscription, NFT minting (Ethereum/Avalanche/Numbers), x402 AI licensing revenue share | **Alive**; Capture Cam updated 2026-04-27; Verify Engine conformant validator 2026-07-28 |
| **Truepic** (Lens SDK 2022→, Vision inspections, Controlled Capture 2.0) | SDK camera with 50+ fraud tests (picture-of-picture, location, device intelligence); on-device signing with per-device certs; C2PA-conformant output | Customer/Truepic cloud | Truepic's own PKI (Keyfactor EJBCA + SignServer on AWS; "replaced blockchain-based trust anchors with PKI"; "millions of certificates", "100M+ images") | Closed, B2B only; **not on the C2PA CPL/trust list as of 2026-10-01**; depends on device integrity | Enterprise SaaS (insurance, lending, warranty, inspections); Lens pricing not public | **Alive** (Vision app updated 2026) |
| **ProofMode** (Guardian Project + WITNESS + Okthanks, since 2013) | Camera app; proof bundle: SHA-256, **OpenPGP signature (.asc)**, CSV sensor/network metadata, **OpenTimestamps (.ots)**, **C2PA manifest (on-device; 3.x targets spec 2.3)**; Play Integrity + hardware attestation; "photos and videos never leave the device" | Local / user-chosen; sponsors include Filecoin Foundation for the Decentralized Web | On-device PGP identity + C2PA cert; **Conformant L1 generator** (Android 2026-04-06, iOS 2026-07-11) | L1 only; PGP identity is self-asserted; UX for non-technical verifiers | Non-profit/grant funded; GPL-3.0 | **Alive** (3.0 launched May 2026) |
| **Starling Lab** (Stanford/USC Shoah) | Framework *Capture → Store → Verify*; captures via ProofMode/Starling Capture/C2PA cameras; **integrity-v2** pipeline (Go, MIT; v1.1.0 2025-04-11, last commit 2026-07-21) with **Authenticated Attributes** (signed metadata claims; `aa-verify` web verifier for VCs) | IPFS, Filecoin (CAR tracking tools), Storj | Anchoring on Avalanche, Numbers, ISCN, NEAR (2024 account) and earlier Hedera for ProvenDB logs (2023); expert attestations; ZK redaction | Research-grade tooling, Linux-only CLI; no consumer product | Academic lab; case studies (Project Dokaz 10k+ pages for ICC, 56k Shoah testimonies on Filecoin, Emmy-nominated Rolling Stone piece) | **Alive** (BBC quote-verification work June 2026) |
| **WITNESS** | Not a product: co-chairs C2PA Threats & Harms; 2026 surveillance-risk report; policy (CA SB 1000) | — | — | — | NGO | Alive |
| **Click (Nodle)** | Camera app; C2PA via own c2pa-rs mobile bindings + "mobile-friendly PKI"; **ContentSign** on-chain proof (Ethereum rollup/zkSync per 2024 PR) | IPFS | Nodle chain + C2PA cert (not on CPL) | App Store **last update v1.14.11 on 2024-03-23**; 3 ratings | Enterprise partnerships, "Click Certify" | **Dormant/STALE** |
| **Serelay** | Early mobile authentication platform | — | — | All C2PA repos **archived Nov 2021** | — | **Dead** |
| **Attestiv** | Capture SDK + "6-point forensic scan", tamper score; fingerprints "to blockchain" (chain unspecified); "full C2PA support Q2 2025"; DeepScan file-validation (2026-07-08) | Attestiv cloud | Vendor | Not on CPL; proprietary | Enterprise (insurance, finance, media) | Alive |
| **OpenOrigins** | Secure Source SDKs (iOS/Android, firmware integration): device attestation, tamper-evident integrity, metadata; Archive Anchor ("Fossilize Your Archives", **CBC/Radio-Canada** case study); infra "Cambium"; privacy-preserving share-a-link proofs | Customer; hashes anchored to "neutral infrastructure" (chain unspecified; earlier press: proprietary blockchain + C2PA) | Vendor | Not on CPL; opaque anchoring | Enterprise | Alive |
| **Sony / Leica / Canon / Nikon** | In-camera signing at capture (Sony: paid *Camera Authenticity Solution* licence + Camera Verify site + 3D-depth check; video since 2026.1) | n/a | Vendor certs (Interim list era); **none on the CPL** | Nikon revoked after NEF-injection; Buchanan-style device compromise | Camera sales / licences | Alive (Nikon suspended) |
| **Adobe Content Authenticity app** (beta 2025-04-29) | Not capture: applies credentials to JPG/PNG (batch 50), LinkedIn-verified identity (CAWG aggregation), social links, AI-training preference, **durable** via TrustMark + fingerprint; Inspect (conformant validator), Chrome extension | Adobe cloud index | Adobe CA (trust list) | Images only; Adobe-hosted matching | Free beta (Creative Cloud funnel) | Alive |
| **Google Pixel 10** | Camera signs every JPEG; L2; StrongBox keys; on-device TSA; one cert per image | Device | Google C2PA CAs (trust list) | Root exploits (Buchanan); JPEG only | Hardware | Alive |
| **Cloudflare Images** | Not capture: preserves + appends a signed transformation manifest | CDN | DigiCert cert | Images only, opt-in per zone | Infra product | Alive |

Observations relevant to Stamper [inferred]:
- Every surviving consumer-facing capture product now treats **C2PA as the interop layer and keeps its own stronger proof** (Numbers: chain commit; ProofMode: PGP+OTS; Truepic: own PKI; Starling: authenticated attributes). None of them makes the **original publicly retrievable in a trustless store with a human-shareable short code**; Numbers comes closest but its storage expires and its chain is permissioned.
- ERC-7053 is a tiny, Final, chain-agnostic event interface — Stamper can emit ERC-7053-compatible `Commit` events on the Filecoin EVM for free interop with Numbers' indexers while keeping its own richer registry.
- Starling's Hedera/multi-chain anchoring and ProofMode's OpenTimestamps show that **anchoring to a second, independent timeline** is cheap insurance; FEVM + an OTS proof would cover both "trustless" and "decades-later verifiable".

---

## 4. Verification UX patterns

- **CAI/Adobe Verify (verify.contentauthenticity.org, open source `contentauth/verify-site`, Apache-2.0, SvelteKit + c2pa-web WASM)**: upload or URL; sections for content summary / produced by / issued by / signed on / edits & activity / ingredients; **ingredient tree** with thumbnails; **before/after comparisons**; trust-list evaluation with an explicit **"unknown source"** state; "searching for matching credentials" for stripped files (Adobe's fingerprint index). Deployment Guidance tells platforms to show the **Cr icon** and link to Verify, and to treat missing/invalid credentials "with suspicion" but not as proof of fakery. [verified]
- **Adobe's three-level progressive disclosure** (design article): L1 lightweight "cr" icon; L2 hover popover with creator + summary; L3 full Inspect history; a verification badge for LinkedIn-verified identity; CAI's course calls these "L1–L3 disclosures". [verified]
- **Google Photos**: credentials in the *About* panel; Pixel shows "edited with AI" descriptors. [verified]
- **Numbers Verify Engine / Asset Profile** (`…/asset-profile?cid=<Nid>`; conformant validator): preview, creator + registration time, licence, **Commits tab** (on-chain history, tx hashes), **NFT tab**, and a **"Fork" badge** when "a substantially similar asset was previously registered, or when a `parentAssetCid` exists", linking to the original's profile — the closest existing thing to "compare against the original". [verified]
- **Sony Camera Verify**: upload-to-URL check, licence-gated, image+video (MP4 ≤222 Mbps). [secondary]
- **Starling Lab "Verify: Authenticity Displays" (Oct 2023)**: catalogue of patterns — C2PA Verify panels, the *Four Corners* interface (click each corner for metadata/backstory/related), a minimal **fingerprint icon** prompting inspection, Webrecorder replay dropdowns, blockchain-registration timelines, storage-location maps; lesson: "authenticity information for each type of digital media will look different". [verified]
- **ProofMode**: "ProofCheck" utility + verify site reading the bundle; also lets humans inspect the CSV. [verified]
- Nobody ships a true **compare-to-original** workflow for a *copy found in the wild*: Verify compares against *ingredients embedded in the file*, Numbers shows duplicates by registration. A side-by-side/slider + perceptual-hash distance + pixel-diff heat-map keyed by the short code is open territory. [inferred]

---

## 5. Recommendations for Stamper

1. **Keep two proof layers, and be explicit about which one is the root of trust.**
   - *Root of trust (Stamper-native)*: SHA-256 + CIDv1 of the **original bytes**, stored on Filecoin (deal/piece CID), registered in Stamper's registry contract on the **Filecoin EVM (mainnet chainId 314)** with `stampId`, `cid`, `pieceCid`, `timestamp`, signer; emit an **ERC-7053-compatible `Commit(recorder, assetCid, commitData)`** event alongside the native event for free interop. Add an OpenTimestamps proof as a second anchor (ProofMode/Starling precedent).
   - *Interop/display layer (C2PA)*: embed a C2PA manifest in both the original and the marked derivative; put the registry facts in a **custom assertion `computer.paradox.stamper.anchor`** (reverse-domain label; CBOR/JSON) and, after finality, a **`c2pa.repository-receipt` update manifest** whose `repository.uri` is Stamper's verify endpoint and whose `anchor.proof` is the FEVM tx + Filecoin deal. This positions the Filecoin store as a **C2PA Manifest Repository** (serve manifest stores as `application/c2pa`, searchable by hash/CID/soft-binding) — a genuinely new thing: a public, non-vendor manifest repository.
2. **Ingredient chain**: sign the original with create-intent (`c2pa.created`, `digitalSourceType=digitalCapture`); sign the public derivative with the original as `parentOf` ingredient and actions `c2pa.opened` + `c2pa.watermarked.unbound` (the visible mark/short code). If you also embed an **invisible TrustMark Q** carrying the stampId (100-bit payload is plenty), add `c2pa.watermarked.bound` + a `c2pa.soft-binding` assertion (`alg: com.adobe.trustmark.Q`, MIT, Python/JS/Rust available). Store the perceptual fingerprint too so stripped/screenshotted copies can be matched by stampId → fingerprint → watermark, in that order.
3. **Signing topology**: capture in the app; compute hash on device; obtain **App Attest / Play Integrity + Android Key Attestation** evidence; upload original to Stamper; **assemble and sign the manifest server-side** (c2pa-rs or c2pa-node with a `CallbackSigner` backed by an HSM/KMS; TSA from the CA) — this is the Level-1 architecture Proofmode, Trufo, InReality and OpenAI use, needs no React Native C2PA binding, and keeps the claim-signing key out of phones (Buchanan). Keep the device attestation hash inside the manifest and the registry so a later L2 upgrade (Android only, 90-day certs, attestation-validating CA) is additive.
4. **Get on the C2PA Conforming Products List at Level 1** early: it is achievable for an LLC, costs are dominated by engineering, SSL.com's free tier covers 2,500 timestamped signatures/year (budget for the 10k premium tier or a TSA plan; the stamp count is the real cost driver). Until listed, Stamper credentials will read "unknown source" in Verify — so the Stamper verify page must be the canonical UX, not Adobe's.
5. **Verifier behaviour**: ship your own validator (c2pa-web in the browser for display, c2pa-rs/node on the server for the verdict) with `verify_trust`, `ocsp_fetch`, `verify_timestamp_trust` on, anchors pinned to the C2PA Trust List + Stamper's issuer; run the cross-layer check (manifest ∧ registry ∧ fingerprint ∧ watermark must agree) to avoid "authenticated contradictions"; render **three states** per layer (Stamper-registered / C2PA Valid / C2PA Trusted) plus an honest "what this does not prove" line.
6. **Compare-to-original UX**: short code → original (served from Filecoin via a gateway with hash check in the browser) → side-by-side + slider + pHash distance + pixel-diff heat-map; show the ingredient tree (original → marked derivative) and the on-chain commit timeline; expose the raw CID/tx for power users (Numbers' "Commits tab" + Starling's four-corners are good references).
7. **Formats**: JPEG + MP4/MOV (H.264/HEVC) as canonical outputs; HEIC accepted but transcode to JPEG for interop (test c2pa-rs HEIC write); **no WebM**; fragmented MP4 only via the file-based Rust path.
8. **Privacy by default** (WITNESS, Pixel): pseudonymous signing identity, per-stamp unlinkable IDs, location opt-in, identity via **opt-in CAWG `cawg.x509.cose` or redactable aggregation assertions**, nothing personal on-chain (hashes + stampId only).
9. **Differentiators to communicate**: (a) the original is publicly retrievable and content-addressed, not just a vendor DB; (b) trustless registry on FEVM with open ERC-7053 events; (c) a human-shareable short code that survives screenshots; (d) interop with every C2PA validator; (e) honest, layered verdicts.

---

## 6. Open questions

1. C2PA 2.4's manifest-repository publish/receipt "API specification and documentation is available here" — the linked repository API doc was not retrieved; confirm its routes before claiming Stamper is a conformant Manifest Repository.
2. Which CAs currently accept `Apple_AppAttest` / `Android_KeyAttestation` evidence for Level 2 enrolment, and at what price (Trufo/SSL.com/DigiCert pricing is unconfirmed beyond SSL.com's free tier)?
3. Real per-asset TSA cost at scale (2,500/yr free; 10,000/yr premium; beyond that?).
4. Does c2pa-rs write HEIC manifests reliably and does `sign_fragmented_files` cover the camera's MOV output? Needs a spike.
5. React Native: wrap c2pa-swift/c2pa-android or stay server-side only? (Server-side recommended; confirm with a prototype.)
6. Numbers' commit-contract address on chain 10507 and its current Filecoin service (Storacha/Lighthouse/Onchain Cloud) were not in the pages fetched.
7. Nikon's 2026 status (restored or not) and Fujifilm/Panasonic implementations are unverified.
8. Whether Stamper wants ERC-7053 compatibility (Numbers indexers) or purely its own registry schema.

---

## 7. Sources

Specs, conformance, trust lists
- https://spec.c2pa.org/specifications/specifications/2.4/specs/_attachments/C2PA_Specification.pdf (2.4; §5.3 version history; §2.4.5; §11.4; §18.10; §18.27)
- https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html
- https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf (title: 2.3, 2026-01-05)
- https://spec.c2pa.org/specifications/specifications/2.2/specs/_attachments/C2PA_Specification.pdf (2.2, 2025-05-01)
- https://spec.c2pa.org/specifications/specifications/2.4/explainer/Explainer.html
- https://c2pa.org/wp-content/uploads/sites/33/2026/07/Content-Credentials-Deployment-Guidance.pdf (1.0, 2026-07-08)
- https://c2pa.org/conformance/ ; https://c2pa.org/faqs/
- https://opensource.contentauthenticity.org/docs/conformance/ ; https://opensource.contentauthenticity.org/docs/conformance/trust-lists/
- https://github.com/c2pa-org/conformance-public (trust-list/C2PA-TRUST-LIST.{pem,json}, C2PA-TSA-TRUST-LIST.{pem,json}, conforming-products/conforming-products-list.json, docs/v0.2)
- https://trufo.ai/tca/repository/c2pa-certificate-policy.pdf (C2PA Certificate Policy v0.2, 2026-07-31)
- https://trufo.ai/articles/c2pa-generator-products-guide ; https://trufo.ai/pricing
- https://www.ssl.com/products/content-authenticity/content-credentials/c2pa/ ; https://www.ssl.com/article/press-release-ssl-begins-issuing-production-ready-c2pa-conformant-certificates/
- https://docs.digicert.com/en/device-trust-manager/tutorials/issue-c2pa-claim-signing-certificates.html
- https://spec.c2pa.org/conformance-explorer/
- https://iptc.org/news/iptc-announces-passing-c2pa-conformance-program-at-the-2026-spring-meeting/
- https://cawg.io/specs/ ; https://cawg.io/identity/1.3/ ; https://opensource.contentauthenticity.org/docs/manifest/reading/reading-cawg-id/
- https://opensource.contentauthenticity.org/docs/durable-cr/
- https://github.com/c2pa-org/softbinding-algorithm-list (softbinding-algorithm-list.json)
- https://github.com/adobe/trustmark
- https://arxiv.org/abs/2603.02378 (Authenticated Contradictions…)
- https://arxiv.org/html/2604.24890v1 (Why the C2PA Specifications Fall Short)
- https://www.da.vidbuchanan.co.uk/blog/android-c2pa.html (2026-08-25)
- https://www.digitalcameraworld.com/photography/photojournalism/nikon-revokes-all-c2pa-image-authenticity-certificates-after-major-vulnerability-exposed
- https://petapixel.com/2025/09/22/nikon-cant-fully-solve-the-z6-iiis-c2pa-problems-alone/
- https://library.witness.org/product/c2pa-privacy/ ; https://www.witness.org/witness-convenes-experts-in-geneva-and-launches-new-report-on-ai-content-authenticity-and-surveillance-risks/ ; https://blog.witness.org/2021/12/witness-and-the-c2pa-harms-and-misuse-assessment-process/
- https://spec.c2pa.org/specifications/specifications/2.0/security/_attachments/Harms_Modelling.pdf
- https://en.wikipedia.org/wiki/Content_Credentials (adoption table; secondary)

Adoption
- https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/ (2025-09-10)
- https://blog.cloudflare.com/preserve-content-credentials-with-cloudflare-images/ (2025-02-03)
- https://newsroom.tiktok.com/en-us/partnering-with-our-industry-to-advance-ai-transparency-and-literacy (2024-05-09)
- https://spec.c2pa.org/post/meta_pr/ ; https://www.tubefilter.com/2024/10/16/youtube-transparency-disclosure-c2pa-cai-generative-ai/
- https://www.newsshooter.com/2026/03/12/sonys-camera-authenticity-solution-now-supports-video/ ; https://pro.sony/ue_US/press/video-authenticity-launch
- https://www.lumethic.com/en/articles/content-credentials-social-media-platforms ; https://aimetadataremover.org/blog/does-instagram-keep-c2pa/ (secondary)

SDKs
- https://github.com/contentauth/c2pa-rs ; https://github.com/contentauth/c2pa-rs/releases ; https://raw.githubusercontent.com/contentauth/c2pa-rs/main/docs/supported-formats.md
- https://docs.rs/c2pa/latest/c2pa/struct.Builder.html ; …/struct.Ingredient.html ; …/trait.Signer.html ; …/struct.CallbackSigner.html ; …/struct.ManifestDefinition.html ; …/settings/index.html
- https://github.com/contentauth/c2patool (README, docs/manifest.md, docs/usage.md) ; https://crates.io/api/v1/crates/c2patool
- https://github.com/contentauth/c2pa-js ; https://registry.npmjs.org/@contentauth/c2pa-web/latest ; https://registry.npmjs.org/@contentauth/c2pa-node/latest ; https://registry.npmjs.org/@contentauth/c2pa-wasm/0.13.2 ; package READMEs under packages/c2pa-web and packages/c2pa-node
- https://github.com/contentauth/c2pa-js-legacy (deprecated)
- https://pypi.org/project/c2pa-python/ ; https://github.com/contentauth/c2pa-python
- https://opensource.contentauthenticity.org/docs/mobile/ ; https://github.com/contentauth/c2pa-swift ; https://github.com/contentauth/c2pa-android
- https://github.com/RoloBits/attestation-photo-mobile ; https://lib.rs/crates/proofmode
- https://learn.contentauthenticity.org/reading-and-validating-content-credentials
- https://github.com/contentauth/verify-site ; https://adobe.design/ideas/behind-the-design-adobe-content-authenticity-app ; https://www.redsharknews.com/adobes-free-content-authenticity-app-public-beta-released

Prior art
- https://docs.numbersprotocol.io/applications/capture/ ; …/developers/numbers-blockchain/mainnet-jade/ ; …/developers/numbers-blockchain/commit-contract/ ; …/developers/numbers-blockchain/commit-contract/on-chain-commit-logs/ ; …/introduction/faq/how-is-the-nid-generated/ ; …/introduction/faq/why-numbers-mainnet-is-permissioned/ ; …/developers/initial-asset-registration/ ; …/applications/verify-engine/asset-profile/
- https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-10507.json ; …/eip155-10508.json
- https://eips.ethereum.org/EIPS/eip-7053 ; https://github.com/numbersprotocol/nit
- https://captureapp.xyz/products/capture-cam/ ; https://fil.org/blog/dev-grant-spotlight-numbers-protocol-puts-digital-creators-in-control-of-their-assets ; https://cryptonews.net/news/blockchain/32747120/ (Filecoin × Numbers, 2026-04)
- https://www.truepic.com/ ; https://www.truepic.com/blog/truepics-new-sdk-will-power-trusted-photo-capture-across-the-internet ; https://www.keyfactor.com/customers/truepic/ ; https://lens.truepic.dev/
- https://proofmode.org/ ; https://proofmode.org/blog/proofmode-android-conformant (2026-05-08) ; https://github.com/guardianproject/proofmode-android
- https://www.starlinglab.org/ ; https://github.com/starlinglab/integrity-v2 ; https://github.com/starlinglab/aa-verify ; https://ffdweb.org/blog/the-starling-lab-framework (2024-03-06) ; https://dispatch.starlinglab.org/p/verify-authenticity-displays (2023-10-16)
- https://contentauthenticity.org/blog/community-story-click (2024-11-04) ; https://apps.apple.com/gb/app/click-camera-trusted-content/id6472920649
- https://github.com/serelay (archived repos)
- https://attestiv.com/digital-media-authenticity/ ; https://www.globenewswire.com/news-release/2026/07/08/3324028/0/en/attestiv-launches-deepscan-extending-deepfake-detection-into-file-validation.html
- https://www.openorigins.com/m ; https://openorigins.com/products/secure-source ; https://openorigins.com/products/archive-anchoring
