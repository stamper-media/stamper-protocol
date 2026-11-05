# Stamper — Verification code, identity/UX, economics, privacy and legal considerations

Research date: 2026-09-30/10-01. Sources: primary docs fetched directly where possible (marked **[verified]**), live measurements (**[measured]**), secondary sources (**[secondary]**), or my own derivation/design (**[derived]** / **[inferred]**). Items marked **[STALE?]** may have changed, been renamed or sunset.

Note on method: the session's web-search budget was exhausted mid-way, so a few primary legal texts (EUR-Lex, planalto.gov.br, Vermont legislature) could not be fetched (connection refused / WAF). Where I quote those from memory I say so explicitly; the wording should be re-checked by counsel before it is put in product copy.

---

## 0. Executive summary

- **Code scheme (recommend):** a 12-symbol Crockford Base32 "Stamper code" shown as `XXXX-XXXX-XXXX`: 11 payload symbols (55 random bits, assigned by the registry, never user-chosen, minimum symbol-distance 2 from any existing code) + 1 Crockford mod-37 check symbol, with the issuer re-drawing the payload whenever the check value would fall in the 5 extra symbols (`*~$=U`), so the emitted alphabet is always the 32 clean symbols `0-9 A-Z minus I L O U`. Decoding is case-insensitive, maps `I/L→1`, `O→0`, ignores hyphens/spaces. This detects every single-symbol substitution and every adjacent transposition (derived below), is OCR- and voice-tolerant, is not enumerable (3.6e16 space), and fits a Version-3 QR at 25 % error correction together with the verify URL.
- **Verify URL/QR:** `https://stamper.app/v/ABCD-EFGH-JKMN` (path case-insensitive, served as an Apple Universal Link and Android App Link). QR payload is the same URL in upper case (36 alphanumeric chars → QR version 3, ECC Q, 29×29 modules). A "forensic" variant appends `?c=<CIDv1 base32-upper>` (98 chars → version 6-Q). The CID is not needed in the normal QR because the on-chain registry maps code → CID/hash, and any client can resolve it from a public Filecoin RPC without Stamper's servers.
- **Assurance presentation:** never say "verified/authentic/real". Show (1) a *match outcome* (Identical to original / Same picture, re-encoded / Different / Not registered), (2) a *capture tier* (Registered ▸ App-attested capture ▸ Hardware-signed), (3) *independent anchors* (Filecoin epoch + tx, OpenTimestamps/Bitcoin, RFC 3161 / qualified timestamp), and (4) a permanent "what this does NOT prove" line. Follow the C2PA L1–L4 disclosure levels and WCAG 2.2.
- **Economics:** on Filecoin Onchain Cloud the marginal cost of a 4 MB photo stored 10 years in 2 copies is about **$0.002**; a 100 MB video about **$0.06**; a registration transaction on the FEVM costs about **$0.00001** at today's base fee (100 attoFIL) and FIL price ($1.04). Cost is not the constraint; abuse is. Recommend a free tier gated by device attestation (App Attest / Play Integrity) and quotas, Stamper-sponsored gas via a relayer (ERC-4337 infra does not list Filecoin), and a paid tier for journalists/organisations (encrypted originals, qualified timestamps, evidence-bundle export).
- **Privacy defaults:** publish the original with GPS/serial EXIF stripped, keep the full capture metadata in an encrypted, hash-committed evidence bundle; store originals encrypted at rest (so storage providers never hold plaintext) with the key released by Stamper for public assets; offer a "commit now, reveal later" private mode using a salted commitment; keep nothing personal on-chain (hash, code, CID, timestamp, signer key only). GDPR Recital 51 means a photo of a face is personal data but not automatically *biometric* data; LGPD Art. 4 II(a) excludes purely journalistic processing; EDPB Guidelines 02/2025 say hashes of personal data remain personal data and that "technical impossibility is not a justification" for ignoring erasure — design erasure as delist + key destruction.
- **Legal weight:** a Filecoin registration alone is "an electronic record" — admissible in principle everywhere studied (FRE 901/902(13)-(14), eIDAS Art. 41(1)/45i(1), MP 2.200-2 Art. 10 §2, China's 2021 Online Litigation Rules Arts. 16–19) but with *presumptions* only when wrapped in something the law names: a sworn certification (US), a **qualified** electronic timestamp (EU), an ICP-Brasil **carimbo do tempo** (Brazil), or a neutral, technically-reviewed platform (China). Cheapest way to get those presumptions: timestamp each batch's Merkle root with an RFC 3161 qualified TSA (and an ICP-Brasil ACT for Brazilian users) and with OpenTimestamps, so every asset inherits a qualified timestamp via a Merkle path.

---

## 1. Short human-readable code schemes

### 1.1 Crockford Base32 (now an IETF Internet-Draft) — **[verified]**

Source: crockford.com/base32 and `draft-crockford-davis-base32-for-humans-01` (D. Crockford, K. R. Davis / Cisco; Standards Track; published 2026-04-10, **expires 2026-10-12** — an I-D, not an RFC; expect a -02 or a WG adoption; **[STALE? — check status after Oct 2026]**).

- Alphabet (encode, upper case only): `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (10 digits + 22 letters). Excluded: **I, L** (confusable with 1), **O** (with 0), **U** ("accidental obscenity"; draft adds "or be confused with V").
- Decoding: upper and lower case accepted; `i`/`l` → 1, `o` → 0; hyphens may be inserted anywhere for readability and are ignored on decode.
- Check symbol: "An application MAY append a check symbol … This check symbol can detect symbol-substitution and symbol-transposition errors." It is the number **modulo 37** (37 = smallest prime > 32); the five extra check values use `*`=32, `~`=33, `$`=34, `=`=35, `U`=36.
- Padding rule: zero-extend to a multiple of 5 bits.

Why mod 37 works (**[derived]**): let the payload value be V = Σ dᵢ·32ⁱ. A single substitution changes V by (d′−d)·32ⁱ with 0 < |d′−d| ≤ 31 and 32ⁱ ≢ 0 (mod 37), so the residue changes → detected. An adjacent transposition changes V by (dᵢ−dᵢ₊₁)·32ⁱ·(32−1) = (dᵢ−dᵢ₊₁)·31·32ⁱ, and 31 ≢ 0 (mod 37) → detected. So the Crockford check symbol detects **100 % of single substitutions and 100 % of adjacent transpositions**, the same two classes a Damm/Verhoeff check digit guarantees. It does not guarantee detection of two independent substitutions (≈1/37 ≈ 2.7 % slip) — acceptable when the code is also resolved against a registry that returns a visibly different original.

Practical wrinkle: 5/37 ≈ 13.5 % of payloads produce a check symbol in `*~$=U`, which are hostile to URLs, OCR and voice. Because Stamper's registry assigns random payloads, it can simply **re-draw the payload when the check value ≥ 32**. The detection proof above still holds for emitted codes (a corrupted code whose true check is ≥32 can never match a received check in 0–31). Cost: the code space shrinks by 13.5 % (≈3.1e16 instead of 3.6e16 codes for 11 payload symbols).

### 1.2 Other check-digit options — **[verified]**

- **Damm algorithm** (Wikipedia): detects all single-digit errors and all adjacent transpositions, built on a totally anti-symmetric quasigroup; Damm proved such quasigroups exist for every order except 2 and 6, so an order-32 table exists and would let the check symbol live in the 32-symbol alphabet with no re-draw. Verhoeff detects the same classes but with permutation tables; Luhn is weaker (misses some transpositions). Trade-off: you must publish/ship a 32×32 table; Crockford mod-37 is a one-liner and already has an I-D.
- **Bech32 / BIP-173** (bips.dev/173): alphabet `qpzry9x8gf2tvdw0s3jn54khce6mua7l` ordered so that visually similar characters differ in several bits; a 6-character BCH checksum "guarantees detection of any error affecting at most 4 characters and has less than a 1 in 10⁹ chance of failing to detect more errors" for strings ≤ 89/90 chars; separator `1`; must be all-lower or all-upper, never mixed; **the BIP explicitly warns implementations not to attempt error *correction*** because it can turn an invalid string into a plausible wrong one — the same logic applies to Stamper: detect, never auto-correct. BIP-350 (bech32m) fixed a length-extension weakness (inserting/deleting `q` before a trailing `p`). A 6-symbol checksum is overkill for a 12-symbol code; its value is the proof-grade guarantee, not the length.
- **ISO/IEC 7064** MOD 37-2 / MOD 37,36 are the "official" alphanumeric check systems (knowledge, not re-verified); they use `*` for value 36 — same URL/voice problem as Crockford's extras.

### 1.3 Word-based codes — **[verified]**

- **Proquint** (Wilkerson, arXiv 0901.4016, Jan 2009; dsw/proquint): 5-letter CVCVC words, 16 bits each; consonants `b d f g h j k l m n p r s t v z` (4 bits), vowels `a i o u` (2 bits); e.g. 32 bits → `lusab-babad`; suggested `0q-` magic prefix. 55 bits would need 4 words (64 bits) ≈ 23 letters. Pronounceable but meaningless; ambiguous in speech across languages (b/v, s/z in Portuguese).
- **BIP-39**: 2048-word lists = 11 bits/word; first four letters of each word unique; similar words avoided. 3 words = 33 bits (too small for a global namespace), 5 words = 55 bits. Lists exist in Portuguese, Spanish, English etc., but a code must be language-neutral and the same for everyone — a localized word rendering can only be a *secondary* display.
- **what3words**-style: proprietary, patented, 3 words for a 3 m square (knowledge). Pattern worth borrowing (three short chunks), not the product.

Recommendation: canonical code = Base32 symbols; offer an in-app **spoken rendering** using the NATO alphabet ("Alfa Bravo Charlie Delta – Echo …") rather than a word code.

### 1.4 ISCC short codes — **[verified]**

- ISO 24138:2024 International Standard Content Code. `iscc-core` 1.4.0 (PyPI, 2026-09-24, Apache-2.0); `iscc-sdk` 0.9.5 (2026-07-30). Full ISCC-CODE ≈ 55–56 Base32 chars after the `ISCC:` prefix (e.g. `ISCC:KACT4EBWK27737D2AYCJRAL5Z36G76RFRMO4554RU26HZ4ORJGIVHDI`); each unit (Meta/Semantic/Content/Data/Instance) is 16 chars.
- **ISCC-ID** (IEP-0011, *Draft*, updated 2026-07-03, intended for the ISO 24138 revision): a *registered* short identifier issued by an ISCC-HUB on a signed declaration; 64-bit body = 52-bit microsecond timestamp × 4096 + 12-bit hub id; Base32 with header → **19 characters including prefix**, e.g. `ISCC:MEIGKV5N6NTVF4AB`.
- Relevance: ISCC-IDs are too long and timestamp-structured (enumerable, reveals ordering) for Stamper's visible mark, but ISCC *Content-Codes* are the right tool for the "same picture, re-encoded" similarity verdict, and an ISCC declaration is a cheap extra registry (C2PA has adopted ISCC). **[inferred]**

### 1.5 Length, collisions and enumeration — **[derived]**

Crockford Base32 carries 5 bits/symbol.

| Payload symbols | Bits | Space | P(random guess hits an existing asset) at 1e6 / 1e8 / 1e9 assets | Birthday collision risk if codes were random *without* a registry uniqueness check (1e8 assets) |
|---|---|---|---|---|
| 8 | 40 | 1.1e12 | 9e-7 / 9e-5 / 9e-4 | ~1 (unusable) |
| 10 | 50 | 1.1e15 | 9e-10 / 9e-8 / 9e-7 | ~1 |
| 11 | 55 | 3.6e16 | 3e-11 / 3e-9 / 3e-8 | 0.14 |
| 12 | 60 | 1.2e18 | 9e-13 / 9e-11 / 9e-10 | 0.004 |

Because Stamper has a registry, uniqueness is enforced at issuance (retry on collision), so the birthday column is irrelevant; what matters is (a) not enumerable (a sequential id + checksum would let anyone crawl every asset — bad for bystander privacy and for harassment), (b) guessing resistance, (c) length. 11 payload + 1 check = 12 symbols (`XXXX-XXXX-XXXX`) is the sweet spot; 10 + 1 (`XXXXX-XXXXXX`) is acceptable if 12 is judged too long.

Issuance rule: reject any candidate within symbol-Hamming distance 1 of an existing code (341 neighbours to check per candidate) so that a one-character misread can never land on another valid registered code; with a random 55-bit space this costs ~1e-5 extra draws per issuance.

### 1.6 Look-alike / phishing codes — **[derived + verified]**

Threats and mitigations:
1. *Confusable characters*: eliminated at the alphabet level (no I/L/O/U); decode normalises case and `I/L/O`. For anything the user types, apply Unicode TR39 "confusables" skeleton matching and the **ASCII-Only** restriction level (UTS #39 defines confusables, the `skeleton()` function and six restriction levels; ASCII-Only is the strictest) — i.e. strip/reject non-ASCII before decoding. **[verified: UTS #39]**
2. *Near-miss codes*: the distance-≥2 issuance rule above plus the check symbol; never allow vanity/user-chosen codes.
3. *Look-alike domains* (`stamper.аpp` with Cyrillic а): keep one short canonical domain, HSTS-preload it, print the domain on the visible mark, and make real scans open the app via Universal/App Links (a spoofed domain cannot pass the AASA/assetlinks verification, so it opens in a browser and the app's "scan" flow can warn). Register obvious homoglyph/typo domains.
4. *Replayed codes*: a code can be legitimately printed on a fake image; the verify page must therefore always show the **registered original** side-by-side and the match verdict — the code is a pointer, never a certificate.
5. *Fake verify pages*: teach "verify only at stamper.app or in the app"; the on-chain registry lets third parties build independent verifiers, which is the long-term answer.

### 1.7 QR encoding — **[verified: thonky capacity table; Wikipedia QR]**

- QR alphanumeric mode is a 45-character set: `0–9`, `A–Z` **upper case only**, space, `$ % * + - . / :` — so the whole verify URL should be upper-cased for the QR (`HTTPS://STAMPER.APP/V/ABCD-EFGH-JKMN`, 36 chars). Scheme and host are case-insensitive by spec; make the `/v/` path handler case-insensitive too.
- Error-correction levels restore L 7 %, M 15 %, Q 25 %, H 30 % of codewords.
- Capacities (alphanumeric / byte): V1 21×21: L 25/17, M 20/14, Q 16/11, H 10/7 · V2 25×25: L 47/32, M 38/26, Q 29/20, H 20/14 · V3 29×29: L 77/53, M 61/42, Q 47/32, H 35/24 · V4 33×33: L 114/78, M 90/62, Q 67/46, H 50/34 · V5 37×37: L 154/106, M 122/84, Q 87/60, H 64/44 · V6 41×41: L 195/134, M 154/106, Q 108/74, H 84/58 · V7 45×45: L 224/154 … V8 49×49: L 279/192.
- Therefore: 36-char URL → **Version 3 at ECC Q (47)** or Version 2 at ECC M (38). With the CID appended (`?C=BAFY…`, 98 chars using the base32-**upper** multibase form, which is a valid CIDv1 multibase prefix `B`) → Version 6 at ECC Q (108) or Version 5 at ECC M (122). Burned into a photo at ≥4 px/module plus a 4-module quiet zone, V3 needs ≈150 px; V6 ≈200 px.
- Recommend: default mark carries only the code URL (small, robust); the app's "share evidence" export produces the long QR / `.ots` / bundle for forensic use.

### 1.8 Deep links from the QR — **[verified: Apple & Android docs]**

- **iOS Universal Links**: host `https://stamper.app/.well-known/apple-app-site-association` (no extension), `Content-Type: application/json`, HTTPS, **no redirects**; JSON `{"applinks":{"details":[{"appIDs":["TEAMID.com.stamper.app"],"components":[{"/":"/v/*"}]}]}}`; entitlement `applinks:stamper.app`; Apple's CDN fetches the file (use `?mode=developer` for local testing). The iOS Camera's QR banner opens the URL; when the domain is a verified Universal Link for an installed app, iOS routes it to the app **[inferred from platform behaviour; Apple's camera page could not be fetched]**.
- **Android App Links**: host `https://stamper.app/.well-known/assetlinks.json` = `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"app.stamper","sha256_cert_fingerprints":["AA:BB:…"]}}]`; intent filter with `android:autoVerify="true"`, action VIEW, categories BROWSABLE+DEFAULT, scheme https; on Android 11 and lower *all* hosts in the manifest must verify; Android 12+ supports manual re-verification (`adb shell pm verify-app-links --re-verify`); Android 15+ re-verifies periodically and changes can take up to seven days to propagate.
- Add a custom scheme `stamper://v/<code>` only as a fallback (custom schemes are spoofable and show chooser dialogs).

---

## 2. Verification UX benchmarks

### 2.1 What the benchmarks show

- **Content Credentials Verify** (now `verify.contentauthenticity.org`; `contentcredentials.org/verify` 301-redirects there — **[STALE? URL]**). Displays a content summary, "Produced by", "Issued by"/"Signed by", app or device used, AI tool used, edits/activity, ingredients/history; the **"cr" pin** "signals that the content contains information about its provenance" (contentcredentials.org). Adobe's "durable" credentials add an invisible watermark + fingerprint so stripped credentials can be recovered ("if someone takes a screenshot"). CAI's own wording: Content Credentials "aren't intended to prescriptively indicate whether a piece of content is 'real'" — they establish **provenance, not truth** **[verified: contentauthenticity.org/how-it-works]**.
- **C2PA UX Recommendations 2.2** **[verified]**: four disclosure levels — L1 indicator (the pin), L2 summary "optimized for quick scanning … a confidence signal without overwhelming users", L3 detailed with filtering, L4 forensic "for journalists, forensic experts, or legal teams". Terminology: "Signed by [name]" (not "claim generator"), "Produced by", "Edited on"; say "Content Credentials", not "C2PA". Core principle: *"Instead of asserting definitive claims about an asset's authenticity, empower users with access to Content Credentials information that helps them make informed judgments."* Warns of the **implied-truth effect**: "If some assets are labeled with a generative AI disclosure, viewers may believe that unlabeled content is more likely to be real." Validation states: well-formed-but-untrusted → "The identity of the signer can't be verified"; incomplete → "These Content Credentials contain incomplete provenance"; malformed → hide or "There is a problem with this asset's Content Credentials". Icon may not be altered. Accessibility: WCAG, text alternatives, logical place in the accessibility tree, hover/long-press content "must be interactable without disappearing unexpectedly". Consent: explicit opt-in before recording PII, with a preview of what viewers will see.
- **Truepic** **[verified, partial]**: Lens SDK replaces the native camera, signs C2PA manifests on-device with assertions (location, date/time, device) backed by Truepic's CA; `LensVerifier` verifies manifests locally and returns the manifest key/values. Truepic's 2026 site now leads with *Vision* (virtual inspections) and *Risk Network*, presenting checks as "Location authentic", "Time & date accurate", "Device integrity" — a good model of *named, separately-passable checks* rather than one green tick.
- **Numbers Protocol** **[verified: docs]**: registers a *Nid* (CID) with commit fields (creator, timestamp, location, device, AssetTree, abstract) on **Numbers Mainnet (chain id 10507)**, stores on IPFS with Filecoin backup; the public **asset profile** at `verify.numbersprotocol.io` shows capture time, creator, a *History* (custody) list, NFT status and *Integrity* badges — closest existing analogue to Stamper's "original copy" page.
- **ProofMode** (Guardian Project + WITNESS + Okthanks; GPL-3.0; 3.x is C2PA 2.3-conformant) **[verified]**: proof bundle = SHA-256 of the media + OpenPGP signature + CSV of device/GPS/network/sensor data; optional notarisation via **OpenTimestamps**, **Google SafetyNet/Play Integrity**, C2PA signing; *ProofCheck* / "Proofmode Verify" inspects C2PA/IPTC/EXIF. Lesson: separate *integrity* (hash+signature), *context* (sensors) and *notarisation* (third-party time anchors) in the UI.
- **OpenTimestamps** **[verified]**: hash computed locally; four free public calendars (Alice, Bob, Finney, Catallaxy, donation-funded); `.ots` proof is *pending* until the calendar's Bitcoin tx confirms, then *complete* after an upgrade step; the verifier says, in effect, "Bitcoin block N attests existence as of <date>"; precision is hours, not seconds. Libraries: `opentimestamps-client` 0.7.2 (PyPI, 2024-12-31, LGPL-3.0); JS `opentimestamps` 0.4.9 (2021 — **[STALE?]**).

### 2.2 What users misunderstand — **[verified]**

- Höltervennhoff et al., *"That's another doom I haven't thought about": A User Study on AI Labels as a Safeguard Against Image-Based Misinformation*, CHI '26 (5 focus groups + survey n = 1,354): labels reduced belief in false claims paired with AI images, **but** produced over-reliance — participants became *more* susceptible to false claims with *unlabeled* human-made images, and *less* willing to believe *true* claims paired with labeled AI images. I.e. people read "no label" as "verified" and "label" as "false".
- Golaszewski, Krawetz, Sherman et al., *Verifying Provenance of Digital Media: Why the C2PA Specifications Fall Short* (arXiv 2604.24890, Apr 2026): first independent formal security analysis; validators behave inconsistently, revoked certificates get accepted, trust-list handling is weak; "C2PA may mislead users, platforms, and policymakers if relied upon prematurely"; recommends against high-stakes uses (journalism, legal evidence) until fixed.
- Ide et al., *Signals of Provenance* (arXiv 2505.16057, sighted + blind users) was **withdrawn in June 2026 for reporting errors — do not cite**. Its qualitative point (blind/low-vision users depend on screen readers and inconsistently placed indicators) is still echoed in the C2PA accessibility guidance.
- Known failure modes to design against: "verified" read as "true"; checkmark colour read as endorsement; signer identity confused with subject truth; absence of a mark read as fake (implied-truth effect); timestamp read as *capture* time rather than *registration* time (China's rules and ICP-Brasil FAQ both stress the registration-vs-creation gap).

### 2.3 Honest assurance language — **[derived]**

Three orthogonal axes, each with its own words:

1. **Match outcome** (bytes vs. the registered original): *Identical* (SHA-256 equal) · *Same picture, re-encoded* (perceptual/ISCC Content-Code within threshold; show the diff and say "re-saved by a platform or edited slightly — compare") · *Different* · *Not registered*.
2. **Capture tier** (what Stamper knows about how the bytes were made): *Registered* (hash + time only; uploaded file) · *Captured in Stamper* (in-app camera + App Attest/Play Integrity passed) · *Hardware-signed* (C2PA manifest from a device/camera CA, if present). Each tier gets one sentence of "this means / this does not mean" (e.g. "An app-attested capture shows an unmodified Stamper app on a genuine device took this picture at this time. It does not show what was in front of the lens — a screen or print can be photographed.").
3. **Time anchors** (independent of Stamper): Filecoin epoch + tx hash (F3 finality in tens of seconds, FIP-0086 Final) · Bitcoin via OpenTimestamps (hours) · RFC 3161 token / qualified timestamp (seconds, legally presumed in the EU/Brazil). Show each anchor's own time and who vouches for it.

Always-visible footer: "Stamper shows when this file was registered and whether the copy you have matches the registered original. It does not judge whether what the picture shows is true." Use the C2PA level structure (L1 badge on the image → L2 card → L3 details → L4 raw evidence/JSON). Accessibility: WCAG 2.2 SC 1.4.3 contrast ≥ 4.5:1 for text (3:1 for large text), non-text UI ≥ 3:1 (SC 1.4.11), every indicator has a text alternative, verdicts conveyed by words + icon shape, never colour alone; the visible mark on the image must survive greyscale and has a text form (the code itself) for screen readers.

---

## 3. Economics

### 3.1 Filecoin storage pricing (2026)

**Filecoin Onchain Cloud (FOC) / Filecoin Warm Storage Service** — docs.filecoin.cloud "Storage Costs", fetched 2026-09-30 **[verified]**:
- Storage **$2.50/TiB/month per copy**, charged only while pieces exist; default configuration is **2 copies**; PDP-priced size = payload × 128/127 (+ ≤31 B per piece).
- Proving service **$0.12 per data set per month** (flat; one data set per copy). *(An older Filecoin blog/docs snippet said $0.024 — superseded; **[STALE]**.)*
- CDN egress via Filecoin Beam **up to $14/TiB (≈ $0.014/GiB)**, about half when served from cache; enabling CDN locks ~0.7 + ~0.3 USDFC refundable credits.
- One-time provider fees: create data set $0.025; add pieces $0.008 + $0.003/piece; schedule removal $0.007/call; terminate $0.006; paid from a refundable ~$0.50 lifecycle reserve.
- "Month" = 30 days = 86,400 epochs; default lockup 30 days; pay-per-epoch in **USDFC** (deposit to Filecoin Pay, approve the service operator with rate + lockup allowances). The HackMD cost note mentions a 0.06 USDFC/month floor; the current docs say "there is no minimum floor" for empty data sets.
- Synapse SDK `@filoz/synapse-sdk` **2.0.2** (npm, 2026-09-25, Apache-2.0 OR MIT); constants: `MAX_UPLOAD_SIZE` = 1,065,353,216 bytes (1 GiB × 127/128), `MIN_UPLOAD_SIZE` = 127 bytes, `DEFAULT_LOCKUP_DAYS` = 30, `EPOCHS_PER_MONTH` = 86,400. Mainnet launch was announced for January 2026 (filecoin.io blog) and mainnet contracts are live.
- Networks (from `@filoz/synapse-core/src/chains.ts` and live RPC) **[verified/measured]**: mainnet chain id **314** (`eth_chainId` = 0x13a), RPC `https://api.node.glif.io/rpc/v1`, `wss://wss.node.glif.io/apigw/lotus/rpc/v1`, `https://rpc.ankr.com/filecoin`, `https://filecoin.drpc.org`; explorers filecoin.blockscout.com, beryx.io/fil/mainnet, filfox.info. Calibration chain id **314159** (0x4cb2f), RPC `https://api.calibration.node.glif.io/rpc/v1`, `https://rpc.ankr.com/filecoin_testnet`, `https://filecoin-calibration.drpc.org`; faucets: faucet.calibnet.chainsafe-fil.io, beryx.zondax.ch/faucet, forest-explorer.chainsafe.dev/faucet/calibnet, plus a Calibration USDFC faucet.
- Contract addresses (docs.filecoin.cloud/resources/contracts, 2026-09-30) **[verified]** — Mainnet: Warm Storage Service `0x8408502033C418E1bbC97cE9ac48E5528F371A9f`; StateView `0xcf184Ab1FD8D1a563054d30Aa1fFb08136998172`; PDPVerifier `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F`; **USDFC `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`**; Service Provider Registry `0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB`; Session Key Registry `0x74FD50525A958aF5d484601E252271f9625231aB`; Endorsements `0x59eFa2e8324E1551d46010d7B0B140eE2F5c726b`; Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`. Calibration: Warm Storage `0x02925630df557F957f70E112bA06e50965417CA0`; StateView `0x1B68d64f01bAa42014B9774605867BF4eDC0320f`; PDPVerifier `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C`; USDFC `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`; SP Registry `0x839e5c9988e4e9977d40708d0094103c0839Ac9D`; Session Key Registry `0x518411c2062E119Aaf7A8B12A2eDf9a939347655`; Endorsements `0xAA2f7CfC7ecAc616EC9C1f6d700fAd19087FAC84`.

**Per-asset cost on FOC (2 copies, $0.00488/GiB/month)** **[derived]**: 4 MB photo — $0.0002/yr, **$0.002/10 yr**; 12 MB (48 MP) photo — $0.0007/yr, $0.007/10 yr; 100 MB 1080p minute of video — $0.006/yr, **$0.057/10 yr**; 400 MB 4K minute — $0.023/yr, $0.23/10 yr. Egress: 1,000 views of a 4 MB photo through Beam ≈ $0.05 (less from cache; or serve thumbnails from your own CDN and only originals from Filecoin).

**Storacha → Fil One** **[verified + STALE flag]**: `storacha.network/` and `docs.storacha.network/` now **301-redirect to `fil.one`** — "S3 object storage built for the AI era", **$4.99/TB/month flat**, no egress or API fees, 1 TB free for 30 days, Business tier with 1/3/5-year contracts (page dated 2026). The 2025-era Storacha plans (Mild free 5 GB; Medium $10/100 GB; Extra Spicy $100/2 TB; $0.15/0.05/0.03 per GB overage) and the "Storacha Forge $5.99/TB" figure in Filecoin's blog should be treated as **stale**. The client libraries still exist (`@storacha/client` 2.1.4, npm 2026-05-15; `storacha/upload-service` repo active, no deprecation notice) — confirm commercial status before depending on them.

**Lighthouse** (lighthouse.storage/pricing, 2026) **[verified]**: Filecoin plans — Free 5 GB; Lite $12/mo (or $120/yr) 500 GB; Premium $49/mo 2.5 TB **with encryption & token gating included**; "Pro" add-on $99/mo (encryption, IPNS, SLAs, custom gateway); also Walrus plans. SDK `@lighthouse-web3/sdk` 0.4.7 (npm 2026-07-10, MIT). Lighthouse is "perpetual storage" style pricing: ≈ $0.024/GB/month at the Lite tier, roughly 5× FOC's raw rate but managed.

### 3.2 Gas per registration on the FEVM — **[measured 2026-09-30 + verified formula]**

- Fee formula (docs.filecoin.io): `(GasUsage × BaseFee) + (GasLimit × GasPremium) + (OverEstimationBurn × BaseFee)`; base fee is dynamic with a 100 attoFIL floor; EVM gas and Filecoin gas are different units (the FVM meters the EVM interpreter itself).
- Live mainnet: `eth_gasPrice` = 99,753 attoFIL, `eth_maxPriorityFeePerGas` ≈ 99,883 attoFIL, base fee 100 attoFIL, block 6,416,867; FIL = **$1.042** (CoinGecko, 2026-09-30).
- A real `InvokeContract` message at height 6,416,866 (Filfox API): gasUsed 105.7 M, gasLimit 132 M, premium 194,224 attoFIL → **2.57e-5 FIL ≈ $0.000027**. A second, badly over-estimated message (limit 2.7 B) still cost ≈ 5.4e-4 FIL ≈ $0.00056.
- A Stamper registration (store ~3 words: 32-byte hash, 8-byte code, CID digest, timestamp, signer; emit one event) should land at 20–100 M Filecoin gas → **$0.000003–$0.000013 each, $3–$13 per million registrations** at today's prices. Batch several registrations per message (Merkle root + per-asset events) to cut this further. Risks: base fee spikes under congestion (x10–x100 historically), FIL price. Budget $0.001 per registration to be safe.
- Finality: FIP-0086 (F3) is *Final*: finality drops from ~900 epochs (7.5 h) to "tens of seconds"; show "registered (pending)" until F3-finalised. (Mainnet activation date not re-verified here — **[check]**.)

### 3.3 Who pays — **[verified where noted, otherwise derived]**

- ERC-4337 bundler/paymaster providers do not list Filecoin (Pimlico's supported-chains page: no Filecoin 314/314159 **[verified]**); Filecoin docs do not document 4337/7702 support. Therefore: **Stamper-sponsored gas via a relayer**. The device holds a key (in Secure Enclave / Android Keystore); it signs an EIP-712 `Register{sha256, pieceCid, code, capturedAt, nonce}` struct; the Stamper relayer submits `registerFor(sig, …)`; the contract recovers the signer and stores it. Trust properties: the relayer cannot forge or alter a registration (signature), can only *delay/censor* it — mitigate by publishing the signed struct to the user (they can submit it themselves with any FIL wallet) and by also timestamping with OpenTimestamps.
- Model: **Free** (consumer): N photos + M minutes video per month (e.g. 100 / 10), public originals, 2 copies, 1–2 year retention, OpenTimestamps anchor; **Pro** ($/month): higher quotas, encrypted originals, qualified RFC 3161 and ICP-Brasil timestamps, evidence-bundle export, 10-year retention, API; **Org/Newsroom**: seats, custom retention, SLA, legal-hold. Storage + gas are < $0.01 per typical photo over 10 years, so pricing is a function of abuse-control and support cost, not of Filecoin.
- Keep a FOC runway: deposit USDFC for ≥ 30-day lockup + buffer; alert when runway < 60 days; FOC terminates service when funds run out and the data becomes unprovable/unpaid.

### 3.4 Abuse controls — **[verified sources; design derived]**

- **Device/app attestation**: iOS **App Attest** (DeviceCheck): a Secure-Enclave key attested by Apple; the app signs server challenges ("assertions"); server verifies against Apple's attestation root; iOS 14+; not on all devices; risk metrics via DeviceCheck. Android **Play Integrity**: verdicts `MEETS_STRONG_INTEGRITY` / `MEETS_DEVICE_INTEGRITY` / `MEETS_BASIC_INTEGRITY`, `appRecognitionVerdict = PLAY_RECOGNIZED`, `appLicensingVerdict`, `appAccessRiskVerdict` (screen capture/overlay/accessibility abuse), `recentDeviceActivity`, `deviceRecall` (beta); bind the request with `requestHash` (standard) or `nonce` (classic); default quota **10,000 requests/day** (raisable); Google says do not cache verdicts and use tiered responses ("Allow, Allow with limits, Allow with limits after CAPTCHA, Deny"). Use the attestation both as the capture-tier signal and as the anti-spam gate; bind the nonce to the media hash so the attestation covers *this* capture.
- **Rate limits**: per account, per device key, per IP/ASN; token buckets for uploads and for verify lookups (lookups are cheap but the original-serving endpoint is where egress cost lives — serve thumbnails first, originals on demand).
- **Content scanning before publication**: CSAM hash matching (PhotoDNA / NCMEC-style industry hash lists — vendor agreement required; not re-verified here), NSFW/violence classifiers for *routing to review*, duplicate detection (same hash already registered → link, don't re-store).
- **Takedown on immutable storage**: (1) delist the code (registry entry gets a `revoked` flag or an event — never delete the hash; it is not reversible to content); (2) stop serving the original from Stamper gateways; (3) if the file is on IPFS gateways, add the CID to the **Bad Bits** denylist (`badbits.dwebops.pub/badbits.deny`, maintained by Protocol Labs' takedown team; reports via `ipfs.fyi/report-abuse` or `abuse@ipfs.io`; format IPIP-383 `.deny` with double-hashed entries so the list itself does not leak CIDs; enforced by Kubo's Nopfs plugin and Rainbow); (4) ask the storage providers to stop serving / terminate the data set (FOC `terminate service` fee $0.006; sealed sectors persist until expiry). Academic measurements (Sokoto et al., USENIX Security '24; arXiv 2506.04307, 2025) show the denylist is partial — many gateways and pinning services do not honour it — so **do not rely on deletion; rely on never publishing plaintext you cannot un-publish**: store ciphertext on Filecoin and gate the key (crypto-shredding), see §4.3.
- Legal plumbing: DMCA/EU DSA notice-and-action flow, Brazilian Marco Civil (Art. 19 — court order for removal of third-party content, with the 2025 STF reinterpretation for certain categories; counsel to confirm), transparency reports.

---

## 4. Privacy

### 4.1 Publishing originals publicly — **[verified law; derived design]**

- A face in a photo is personal data; it is *biometric* (special-category) data only when "processed through a specific technical means allowing the unique identification or authentication of a natural person" (GDPR Recital 51) — so **do not run face recognition** on uploads, and the special-category regime (Art. 9) is avoided; LGPD Art. 5 II lists "biometric data" as sensitive with the same logic ("for identification purposes" in the unofficial translation) **[verified: gdpr-info; lgpd-brazil.info]**.
- Lawful basis: the uploader who publishes to the world is not covered by the household exemption (CJEU *Lindqvist*, C-101/01 — knowledge); Stamper is a controller for the verify site. Bases: consent of the uploader for their own data; legitimate interest / freedom of expression for bystanders in public places, with **journalistic derogations** (GDPR Art. 85: member states must reconcile data protection with "freedom of expression and information, including processing for journalistic purposes"; LGPD Art. 4 II(a): the law does not apply to processing "performed solely for … journalistic and artistic" purposes; Art. 4 I: natural persons for "exclusively private and non-economic purposes").
- Erasure: GDPR Art. 17(1) vs. 17(3)(a) "exercising the right of freedom of expression and information" and 17(3)(e) "establishment, exercise or defence of legal claims"; LGPD Art. 18 gives deletion/anonymisation rights. **EDPB Guidelines 02/2025 on blockchain** (adopted 8 April 2025; consultation to 9 June 2025; a v2.0 reportedly adopted 7 July 2026 per Bird & Bird — not confirmed on the EDPB site, **[check]**): "encrypted or hashed data remains personal and the GDPR continues to apply"; the blockchain "should refer to data stored outside the blockchain"; "technical impossibility is not a justification for disregarding the rights of data subjects"; a DPIA "is imperative"; "Open, public blockchains entail particular risks, especially due to the global accessibility of the data"; roles of nodes/controllers are complex.
- Brazil image right: Civil Code Art. 20 and Constitution Art. 5 X protect a person's image; STJ Súmula 403 awards damages for unauthorised *commercial* use of an image regardless of proof of harm (knowledge — confirm with counsel). Stamper's verify page is not commercial use of the subject's image, but a "report this image" + delisting path is needed.

Design consequences: nothing personal on-chain (hash, code, CID, timestamp, signer public key, and a revocation flag only); off-chain originals delistable; DPIA before launch; a bystander takedown flow; a consent screen at capture ("people in this photo may be identifiable — publish anyway / publish blurred / keep private").

### 4.2 EXIF — strip vs. retain — **[derived; C2PA assertion from knowledge]**

- Platforms strip EXIF on upload (which is why hash-matching shared copies fails and perceptual matching is needed). For Stamper: **publish** the original pixels with GPS, device serial, owner name and lens serial removed; **retain** the complete EXIF/sensor set inside an encrypted *capture record* whose hash is part of the registered commitment (a C2PA manifest can carry it as a `stds.exif` assertion; ProofMode keeps it as a signed CSV). Evidence consumers (courts, newsrooms) get the sealed record on request; the public gets pixels + registration time. Offer "publish with location" as an explicit opt-in (useful for journalism, dangerous for activists).

### 4.3 Encrypted-original mode — **[verified vendors; derived design]**

- **Filecoin Onchain Cloud / Synapse** documents no encryption or private-data feature (blog and docs list repair/replication, cross-chain payments, more chains as roadmap) — client-side encryption is on the application. **[verified absence]**
- **Lighthouse Kavach** (`@lighthouse-web3/kavach` 0.2.0 beta, AGPL-3.0; SDK `@lighthouse-web3/sdk` 0.4.7 MIT): client-side encryption, key split by BLS threshold into **5 shares, 3 required**, stored on Lighthouse key nodes; access conditions = token balances, contract calls, block/time, AND/OR, on 15+ EVM chains **including Filecoin** and Solana; `shareFile` / `revokeFileAccess`. Encryption/token-gating is a Premium ($49/mo) or Pro add-on feature. Trust: Lighthouse's key nodes.
- **Lit Protocol**: *Datil* → *Naga* (v1 mainnet live 20 Jan 2026) → **Naga sunset: network stops 25 Mar 2026, chain off 1 Apr 2026**; **Lit v3 "Chipotle"** announced 26 Feb 2026, production target 25 Mar 2026, TEE-based (dstack/Phala), credit-based pricing (LITKEY 25 % discount), governance contracts on **Base**; docs describe encryption "work[ing] in Chipotle" differently from the old access-control-conditions model and do not list Filecoin. npm `@lit-protocol/lit-client` 8.3.1 (Jan 2026) targets the sunset Naga stack. **High churn — avoid as a hard dependency; [STALE? any Lit guide older than March 2026].**
- Recommended design: encrypt every original client-side (AES-256-GCM, per-asset key); store ciphertext on Filecoin via Synapse (so no SP ever holds plaintext → takedown = key destruction, and GDPR erasure becomes tractable); register `sha256(plaintext)`, `cid(ciphertext)`, code and time on-chain; the per-asset key is wrapped to (a) the user's device key and (b) Stamper's KMS. *Public* assets: Stamper serves the key (or the decrypted bytes) on the verify page; *Private* assets: only the owner. Optional "permanent public" switch publishes the key on-chain (irreversible — warn). Decentralise key custody later with Lighthouse Kavach (Filecoin-aware) if users ask for "works without Stamper".

### 4.4 Selective disclosure / commit now, reveal later — **[derived]**

- Publish only a commitment now: `C = SHA-256(salt ‖ bytes)` (32-byte random salt kept with the owner; a plain unsalted hash lets anyone *confirm a guess* — e.g. that a known leaked document is the one committed — so salt it) plus the OpenTimestamps and RFC 3161 anchors on the same value; reveal `salt + bytes` later; verifiers recompute. Store the encrypted bytes on Filecoin at commit time so the reveal is just a key release and the storage proof (PDP) shows the ciphertext existed and was retained.
- Merkle batching: Stamper commits a per-minute/hour Merkle root (one tx + one qualified timestamp per batch); each asset's inclusion proof is in its evidence bundle. This is also what makes qualified timestamps affordable (§5.2).
- Partial disclosure: hash a video in chunks/segments (Merkle tree of segment hashes) so an owner can disclose a clip with its inclusion proof without releasing the whole recording.

---

## 5. Legal / evidentiary treatment

### 5.1 United States — **[verified: Cornell LII; FRE 707 timeline from NatLaw Review/USCourts; Vermont from secondary + memory]**

- FRE 901 (ordinary authentication) always available. **FRE 902(13)**: "A record generated by an electronic process or system that produces an accurate result, as shown by a certification of a qualified person…"; **902(14)**: "Data copied from an electronic device, storage medium, or file, if authenticated by a process of digital identification, as shown by a certification of a qualified person…"; both require the 902(11)/(12) certification and advance notice so the opponent can challenge. The Advisory Committee note says identical hash values "reliably attest to the fact that they are exact duplicates". Stamper should ship a **certification template** for its engineers (how the hash, time anchors and storage proofs are produced) and an **evidence bundle** that a forensic examiner can re-verify independently (hash, Filecoin tx/epoch, Merkle path, `.ots`, RFC 3161 token, attestation receipts).
- *Daubert* (and FRE 702) governs expert testimony about the reliability of the system if challenged; keep the methodology documented, testable and peer-reviewable (open-source verifier).
- **Proposed FRE 707 (machine-generated evidence)**: Advisory Committee voted 8–1 on 2 May 2025; published for comment 15 Aug 2025 – 16 Feb 2026; Advisory Committee noted "greater overall concerns" on 7 May 2026; **Standing Committee on 3–4 June 2026 declined to recommend action and sent it back for revision** together with the deepfake question. If adopted in some form, "machine-generated" outputs offered without an expert (e.g. an automated "manipulation score" or similarity verdict) would face Rule 702-style reliability scrutiny; simple instruments are excluded. Keep Stamper's verdicts simple and reproducible (hash equality, signature validity, time anchors) and treat AI "manipulation detection" as a separate, clearly labelled, lower-weight signal.
- **Vermont 12 V.S.A. § 1913** (2016): a record "electronically registered in a blockchain" is self-authenticating under V.R.E. 902 if accompanied by a written declaration of a qualified person, made under oath, stating the person's qualification, the date and time the record entered the blockchain, that it was entered as part of a regularly conducted activity, and as a regular practice; it then creates rebuttable presumptions that the record is authentic, that its date/time is the date/time it entered the blockchain, and that the person established as making the record did so (wording from memory + secondary summary; primary page was unreachable — **[verify]**). Arizona, Illinois, Delaware have related statutes (secondary).

### 5.2 European Union — **[secondary quotations + knowledge; EUR-Lex unreachable]**

- eIDAS (Reg. 910/2014 as amended by **Reg. (EU) 2024/1183**, in force 20 May 2024) **Art. 41**: (1) an electronic time stamp "shall not be denied legal effect and admissibility as evidence in legal proceedings solely on the grounds that it is in an electronic form or that it does not meet the requirements of the qualified electronic time stamp"; (2) "A qualified electronic time stamp shall enjoy the presumption of the accuracy of the date and the time it indicates and the integrity of the data to which the date and time are bound"; (3) mutual recognition across Member States. **Art. 42** requires a qualified time stamp to bind date/time to data so as to preclude undetectable change, to be based on an accurate time source linked to UTC, and to be signed with an advanced e-signature/seal of a **qualified trust service provider** (ETSI EN 319 421/422 profiles of **RFC 3161**; eIDAS 2.0 makes the ETSI standards binding via implementing acts).
- **Electronic ledgers (new Arts. 45h–45k)**: an electronic ledger "shall not be denied legal effect and admissibility … solely on the grounds that it is in an electronic form or that it does not meet the requirements for qualified electronic ledgers"; a **qualified** electronic ledger "shall enjoy the presumption of the uniqueness and authenticity of the data it contains, of the accuracy of their date and time, and of their sequential chronological ordering"; qualified status requires a QTSP and Commission implementing acts (due May 2025). **Filecoin is not and will not be a "qualified electronic ledger"** — it gets the non-discrimination rule, not the presumption.
- **Practical recipe for EU weight**: every batch root gets a qualified electronic time stamp from a QTSP on the EU Trusted List (price class: cents per token at volume; a free RFC 3161 TSA such as FreeTSA — `https://freetsa.org/tsr`, SHA-256…512, P-384 cert to 2040 — is useful for testing but is **not** qualified). Each asset then holds: Merkle path → root → QTS, giving the Art. 41(2) presumption for the time of registration. Add OpenTimestamps for a trust-minimised second opinion.

### 5.3 Brazil — **[primary for ICP-Brasil/ACTs; statutes quoted from memory, planalto unreachable]**

- **MP 2.200-2/2001** creates ICP-Brasil (Art. 1). **Art. 10 §1**: declarations in electronic documents produced with an ICP-Brasil certification process "presumem-se verdadeiros em relação aos signatários". **Art. 10 §2**: the MP "não obsta a utilização de outro meio de comprovação da autoria e integridade de documentos em forma eletrônica, inclusive os que utilizem certificados não emitidos pela ICP-Brasil, desde que admitido pelas partes como válido ou aceito pela pessoa a quem for oposto o documento" — Stamper's device signatures and Filecoin anchors live here (no presumption, but admissible when accepted/not impugned).
- **Lei 14.063/2020 Art. 4** defines *simples* / *avançada* / *qualificada* electronic signatures (qualified = ICP-Brasil certificate per MP 2.200-2 Art. 10 §1; advanced = non-ICP means uniquely linked to the signer, under their sole control, tamper-evident). A Stamper device key in the Secure Enclave is an *advanced* signature in substance (scope of that law is mainly interactions with public bodies).
- **CPC (Lei 13.105/2015)**: Art. 369 (all legal and morally legitimate means of proof); **Art. 422 §1**: "As fotografias digitais e as extraídas da rede mundial de computadores fazem prova das imagens que reproduzem, devendo, se impugnadas, ser apresentada a respectiva **autenticação eletrônica** ou, não sendo possível, realizada perícia" — Stamper's registration is precisely the "autenticação eletrônica" the CPC anticipates (from memory; **[verify wording]**); Art. 384 *ata notarial* (notary's public faith — the "gold standard" but costly); Arts. 439–441 electronic documents.
- **ICP-Brasil carimbo do tempo** **[verified: gov.br/iti]**: "um selo que comprova que uma informação digital existia numa determinada data e hora no passado", issued by an *Autoridade de Carimbo do Tempo (ACT)* credentialed by ITI under DOC-ICP-11/12/13/14; ITI's FAQ stresses the stamp proves when the document *reached the ACT*, not when it was created. Ten accredited ACTs (ITI list, 2026): BRY, Certisign, **Defesa (credentialed 1 Jul 2026)**, ONR, Prodesp, QuickSoft, Safeweb, Serpro, Soluti, Valid. Secondary sources describe ICP-Brasil timestamps as accepted without expert examination and blockchain + hash registrations (Verifact, OriginalMy) as accepted "atypical documentary evidence" when accompanied by a technical report (**[secondary]**). Recipe: stamp batch roots with an ACT (RFC 3161-compatible APIs are sold per stamp or per package — pricing not verified) for Brazilian users.

### 5.4 China — **[verified: China Justice Observer; LoC summary]**

- 2018 SPC *Provisions on Several Issues Concerning the Trial of Cases by Internet Courts*, Art. 11 — first recognition; **2021 *Online Litigation Rules for People's Courts* (effective 1 Aug 2021), Arts. 16–19**: electronic data stored via blockchain and technically verified as consistent is **presumed un-tampered after chaining** unless rebutted; courts examine the platform's qualification and *neutrality* (no relationship with the parties), technical reliability (certified cloud, open-source capture tools), whether the data was altered **before** chaining, and the **time gap between generation and chaining**. Landmark: Hangzhou Internet Court, *Huatai v. Daotong* (2018) — screenshots/source code hashed to Factom and Bitcoin accepted. For Stamper: minimise and log the capture→hash→chain latency (seconds), keep the capture pipeline open-source, and offer a neutral third-party anchor (Bitcoin via OTS).

### 5.5 Complementary anchors and chain of custody — **[verified standards; derived design]**

- **RFC 3161** (TSA request/response; requester sends only a hash; token signed by the TSA key) — ETSI EN 319 421/422 for qualified profiles. **OpenTimestamps** — free, Bitcoin-anchored, hours precision, needs the upgrade step; include the `.ots` in the bundle. **Filecoin registration** — seconds-to-finality (F3), carries the storage proof itself (PDP) which the other anchors do not.
- **C2PA's legal positioning** **[verified: C2PA Explainer 2.2]**: "provenance information alone cannot tell you whether the digital content is true, accurate or factual"; signers are only accountable for `created_assertions`, not `gathered_assertions`; C2PA says credentials can "improve the chances of that footage being admissible in court" but makes no admissibility claims; the April 2026 security analysis recommends against relying on C2PA for legal evidence until fixed. Treat C2PA as an interoperability layer (export a manifest with Stamper's registration as an assertion) rather than as the trust root.
- **Chain-of-custody documentation**: NIST SP 800-86 (2006) and ISO/IEC 27037:2012 (identification, collection, acquisition, preservation of digital evidence) remain the references courts and experts cite; the Brazilian secondary literature explicitly invokes ISO 27037. Stamper's evidence bundle should therefore record: who/what captured (device key id, app version, attestation result), when (device clock + server receipt time + chain epoch + TSA/OTS times), what (hashes of every artefact, Merkle path), where stored (CID, data set id, provider ids), and every later action (revocations, key releases) — all signed, all exportable as JSON + PDF.

---

## 6. Recommendations (consolidated)

1. **Code**: 12 Crockford symbols `XXXX-XXXX-XXXX` = 11 random payload symbols (registry-unique, distance ≥ 2 from existing codes, never user-chosen) + 1 mod-37 Crockford check symbol, re-drawn so that only the 32-symbol alphabet is emitted; decode normalises case/I/L/O and ignores separators; show a NATO-alphabet spoken form in-app; reserve the first symbol space for a future version marker if you ever need one (e.g. codes starting with `Z` = v2).
2. **Verify URL / QR**: `https://stamper.app/v/<code>` (case-insensitive handler), AASA + assetlinks for `/v/*`, HSTS-preloaded; QR payload upper-case URL, ECC Q, Version 3; forensic QR with `?c=<CIDv1 base32upper>`; print the domain + code as text next to the QR (OCR/screen-reader path); mark survives greyscale.
3. **Assurance presentation**: match outcome × capture tier × time anchors, with C2PA-style L1–L4 disclosure, no "verified/real/authentic" wording, a permanent "does not prove" line, WCAG 2.2 AA, verdict words never colour-only.
4. **Pricing/abuse**: free consumer tier (attested app + quotas), Pro/Org tiers (encrypted originals, qualified timestamps, bundle export, retention); Stamper pays FOC storage (budget ≈ $0.005/GiB/month incl. 2 copies + $0.12/data-set/month + egress) and gas via an EIP-712 relayer (budget $0.001/registration); pre-publication hash matching and classifier routing; takedown = delist + stop-serve + badbits report + SP termination; ciphertext-only on public storage.
5. **Privacy defaults**: public mode strips GPS/serials and keeps a sealed capture record; capture-time bystander prompt; "Private (commit-only)" mode with salted commitment; per-asset encryption with Stamper-released keys; no personal data on-chain; DPIA + LGPD/GDPR notices; journalistic-use declaration unlocks Art. 85 / Art. 4 II(a) handling; retention and erasure = delist + key destruction, with 17(3)(a)/(e) exceptions documented.
6. **Legal weight add-ons**: batch Merkle roots → Filecoin tx + OpenTimestamps + RFC 3161 qualified TSA (EU) + ICP-Brasil ACT (Brazil); evidence bundle + FRE 902(13)/(14) certification template; open-source verifier; log capture→chain latency for Chinese-style review.

---

## 7. Open questions

- Will Filecoin Onchain Cloud add native encryption / private data sets, and when? (Not on the published roadmap.)
- Exact mainnet activation date and observed finality distribution of F3 for the "registered (final)" UX.
- Did the EDPB adopt Guidelines 02/2025 v2.0 on 7 July 2026 and what changed (DPIA, smart contracts, transfers, crypto-agility)?
- Does Lit v3 (Chipotle) support access conditions on Filecoin (chain 314), and what do its credits cost? Is Lighthouse Kavach's 3-of-5 node set acceptable as a key custodian?
- Primary-text confirmation of Vermont § 1913, eIDAS Arts. 41/42/45i–45j, MP 2.200-2 Art. 10, CPC Art. 422 §1 (all quoted from memory/secondary here).
- Brazilian appellate/STJ decisions on blockchain-anchored *media* (not screenshots) as evidence; ANPD position on photos vs. biometric data.
- Pricing of qualified RFC 3161 tokens at volume (EU QTSPs) and of ICP-Brasil ACT stamps via API.
- Perceptual-match thresholds (ISCC Content-Code / pHash) that keep "same picture, re-encoded" honest without false positives.
- Whether to offer an irreversible "publish key on-chain" option, given erasure duties.

---

## Sources

Codes
- https://www.crockford.com/base32.html
- https://www.ietf.org/archive/id/draft-crockford-davis-base32-for-humans-01.html
- https://en.wikipedia.org/wiki/Damm_algorithm
- https://bips.dev/173/ and https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
- https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
- https://arxiv.org/abs/0901.4016 ; https://github.com/dsw/proquint (proquint.c)
- https://github.com/iscc/iscc-core ; https://ieps.iscc.codes/iep-0011/ ; https://github.com/iscc/iscc-ieps ; https://pypi.org/project/iscc-core/
- https://www.unicode.org/reports/tr39/
- https://www.thonky.com/qr-code-tutorial/character-capacities ; https://en.wikipedia.org/wiki/QR_code
- https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- https://developer.android.com/training/app-links/verify-android-applinks

Verification UX
- https://spec.c2pa.org/specifications/specifications/2.2/ux/UX_Recommendations.html
- https://spec.c2pa.org/specifications/specifications/2.2/explainer/Explainer.html
- https://contentcredentials.org/ ; https://verify.contentauthenticity.org/ ; https://contentauthenticity.org/how-it-works
- https://helpx.adobe.com/creative-cloud/help/content-credentials.html (via search summary)
- https://lens.truepic.dev/ ; https://www.truepic.com/
- https://docs.numbersprotocol.io/developers/initial-asset-registration/
- https://proofmode.org/about ; https://github.com/guardianproject/proofmode-android
- https://opentimestamps.org/
- https://arxiv.org/abs/2505.22845 (Höltervennhoff et al., CHI '26)
- https://arxiv.org/abs/2604.24890 (Golaszewski et al., 2026)
- https://arxiv.org/abs/2505.16057 (withdrawn 2026-06 — not relied on)
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Economics
- https://docs.filecoin.cloud/developer-guides/storage/storage-costs/
- https://docs.filecoin.cloud/resources/contracts/
- https://docs.filecoin.cloud/introduction/about/
- https://filecoin.io/blog/posts/introducing-filecoin-onchain-cloud/
- https://hackmd.io/@hugomrdias/synapse-costs
- https://github.com/FilOzone/synapse-sdk (packages/synapse-core/src/chains.ts, utils/constants.ts) ; https://www.npmjs.com/package/@filoz/synapse-sdk
- https://docs.filecoin.io/networks-and-tools/networks/calibration.md ; https://docs.filecoin.io/networks-and-tools/networks/mainnet.md
- https://docs.filecoin.io/core-concepts/filecoin-evm-runtime/how-gas-works.md
- https://api.node.glif.io/rpc/v1 (eth_chainId, eth_gasPrice, eth_maxPriorityFeePerGas — live 2026-09-30) ; https://filfox.info/api/v1/message/… (gas details) ; https://api.coingecko.com/api/v3/simple/price?ids=filecoin
- https://github.com/filecoin-project/FIPs/blob/master/FIPS/fip-0086.md
- https://docs.pimlico.io/guides/supported-chains
- https://fil.one/ ; https://fil.one/pricing (storacha.network and docs.storacha.network redirect here) ; https://github.com/storacha/upload-service ; https://www.npmjs.com/package/@storacha/client
- https://www.lighthouse.storage/pricing ; https://github.com/lighthouse-web3/lighthouse-package ; https://github.com/lighthouse-web3/encryption-sdk
- https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity
- https://developer.android.com/google/play/integrity/overview
- https://badbits.dwebops.pub/ ; https://specs.ipfs.tech/ipips/ipip-0383/ ; https://blog.ipfs.tech/2023-content-blocking-for-the-ipfs-stack/
- https://www.usenix.org/conference/usenixsecurity24/presentation/sokoto ; https://arxiv.org/abs/2506.04307

Privacy
- https://gdpr-info.eu/recitals/no-51/ ; https://gdpr-info.eu/art-17-gdpr/ ; https://gdpr-info.eu/art-85-gdpr/
- https://www.activemind.legal/guides/edpb-blockchain/ ; https://www.edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en ; https://www.twobirds.com/en/insights/2026/netherlands/edpb-adopts-final-guidelines-on-blockchain-and-personal-data-a-practical-guide-for-organisations (paywalled; search snippet only)
- https://lgpd-brazil.info/ (unofficial LGPD translation; Arts. 3, 4, 5, 7, 11, 18)
- https://spark.litprotocol.com/ ; https://spark.litprotocol.com/naga-network-sunset/ ; https://developer.litprotocol.com/
- https://docs.lighthouse.storage/

Legal
- https://www.law.cornell.edu/rules/fre/rule_902
- https://natlawreview.com/article/machine-generated-evidence-challenges-federal-rules-inside-contested-proposed ; https://www.uscourts.gov/sites/default/files/document/2025-12-01_evidence_rules_committee_report.pdf
- https://legislature.vermont.gov/statutes/section/12/081/01913 (unreachable during research; text from memory/secondary)
- https://eur-lex.europa.eu/eli/reg/2024/1183/oj ; https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02014R0910-20241018 (unreachable; quotations via https://truescreen.io/insights/eidas-2-qualified-timestamp-requirements-qtsp/ , https://anchorify.cloud/resources/eidas-qualified-timestamps/ , https://en.wikipedia.org/wiki/Regulation_(EU)_2024/1183 )
- https://datatracker.ietf.org/doc/html/rfc3161 ; https://freetsa.org/index_en.php
- https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm ; https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/L14063.htm ; https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm (all unreachable; quoted from memory)
- https://www.gov.br/iti/pt-br/assuntos/icp-brasil/autoridades-de-carimbo-do-tempo ; https://www.gov.br/iti/pt-br/acesso-a-informacao/perguntas-frequentes/carimbo-do-tempo
- https://legale.com.br/blog/prova-digital-integridade-temporal-e-cadeia-de-custodia/ ; https://www.verifact.com.br/ ; https://blog.originalmy.com/advogados-seguranca-juridica-fe-publica/ (secondary, Brazil)
- https://www.chinajusticeobserver.com/a/how-chinese-courts-review-electronic-evidence-stored-on-blockchain ; https://www.loc.gov/item/global-legal-monitor/2021-07-21/china-supreme-peoples-court-issues-online-litigation-rules-addressing-review-of-blockchain-evidence/
- https://csrc.nist.gov/pubs/sp/800/86/final
