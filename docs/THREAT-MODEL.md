# Stamper — Threat model

Scope: the final design in `docs/DESIGN.md`. Attackers considered: a viewer who wants a doctored image to look registered; a stamper who wants a false label; a griefer with a few USDFC and a FIL wallet; an operator insider or a VPS intruder; infrastructure (RPC providers, storage providers, FilOz, Apple, Google). Feasibility: **trivial** (minutes, no money), **cheap** (hours or < $10), **moderate** (days, skills or a device exploit), **hard** (nation-state or vendor compromise). Impact: **false positive** (the page says ORIGINAL / MARKED COPY / level ≥ 1 wrongly), **false label**, **DoS**, **privacy**, **cost**.

Disclosure wording is what the verify page or app says, verbatim, whenever the residual risk applies.

## 1. Verdict-forging attacks

| Attack | Feasibility | Impact | Mitigation in this design | Residual risk | Disclosure wording |
|---|---|---|---|---|---|
| Doctored image registered as a "marked copy" of a real stamp (permissionless derivative) | — (closed) | false positive | `attachDerivative` accepts only an active governed registrar's signature (v2: the stamp's device key); duplicates rejected | registrar key compromise (see §4) | — |
| Front-running a genuine derivative attachment to re-point its hash | — (closed) | false positive | only governed writers can write `stampByDerivativeHash`; relayer serialises | none | — |
| Code hijack: attacker lands a claim with the victim's code first | — (closed) | false label / confusion | codes derived on chain from `stampId`; nobody supplies a code; app shows the code only after the receipt | collision re-draw changes the predicted code (≈ N/2^40) | "Your code is final once the chain confirms it." |
| Deliberate look-alike code at symbol distance 2 (grind a claim whose code resembles a target) | cheap (≈ 27k targets in 2^40, GPU seconds) | confusion | check symbol makes distance 1 impossible; verify page always shows the served original and never confirms by code presence; no "matches" wording | a viewer who does not look at the picture | "Compare the picture, not the code: codes can look alike." |
| Transplanted TrustMark payload (public encoder) + sub-threshold edit | trivial | would be false positive under "MATCHES" | watermark is a lookup key; non-exact results are always "RELATED TO <code> — COMPARE" with the diff map in the header | viewer ignores the diff | "This copy is not byte-identical to the stamped original. Differences are highlighted." |
| Perceptual near-match of an unrelated image (PDQ ≤ 31) | cheap for crafted inputs | would be false positive | same ladder; ties shown; SSIM re-rank; never an auto-pick | as above | same |
| Fake badge / fake verify site | trivial | false belief without lookup | badge is a pointer; one HSTS-preloaded domain; Universal/App Links; in-app scanner; verifier bundle hash in the resolver; tier-distinct families so Stamper's own wordmark is never on unattested uploads | viewers who never click through | "A Stamper mark proves nothing until you look it up at stamper.media." |
| Deferred-PieceCID poisoning by the first binder | — (closed) | permanent DoS + mismatch page | claims always carry a device-signed, CommPv2-validated PieceCID; `bindStorage` never writes it | server returns a wrong CID for a video ⇒ unbindable stamp (visible, not forgeable) | "Filecoin storage proof unavailable for this stamp." |
| Software-key extraction + self-submit to mint L1 stamps | moderate (rooted device) | false label | self-submitted software-key claims register at L0; L1 requires Stamper's per-capture countersignature after checking an attestation bound to the digest; revocation with effective epoch; hardware keys in v1 | extracted key + live attested device (confused deputy) until revoked | "A compromised phone can sign anything until its key is revoked." |
| Attacker self-endorses a key at L2 | — (closed) | false label everywhere | endorsements must recover to an active registrar and cover the whole key struct | registrar compromise (§4) | — |
| Key squatting via self-enrolment of someone else's public key | — (closed) | DoS on enrolment | proof of possession required for every key type | none | — |

## 2. Capture-side attacks

| Attack | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Analog hole: photograph a screen or print | trivial | false belief about the scene | in-app live capture; physical lens ids; L3 sensor evidence reserved; wording never claims scene truth | fundamental | "Stamper cannot tell a real scene from a photographed screen or print." |
| Root exploit + confused-deputy signing (Pixel 10 CVE-2026-43499 "won't fix", jailbreak oracles) | moderate | false label | per-capture attestation bound to `sha256(digest ‖ challenge)`; L2 requires STRONG integrity + CRL re-check per capture (v1); anomaly limits; revocation | private exploits, unrevoked leaked keyboxes | "Hardware attestation is the best available signal, not proof." |
| Virtual camera / HAL injection | moderate | false belief | no picker/intents/share-sheet; physical camera enumeration recorded; attestation tiers; `appAccessRiskVerdict` (v1) | same as above | same |
| Clock or GNSS spoofing | cheap ($200 radio, settings) | wrong time/location claim | three clocks displayed (device, receipt, chain epoch); location opt-in and labelled "device-reported"; chain time is the only hard anchor | `capturedAt` is a claim | "Capture time and location are reported by the device and can be wrong." |
| Offline claim signed long before upload | trivial (by design) | weak lower bound | 72-h deadline; `flags.OFFLINE`; attestation at upload labelled; L2 offline limited to 24 h (v1) | device state at capture unknown | "Captured offline; device attested at upload." |
| Re-stamping someone else's work first | trivial | ownership confusion | `firstStampOf`; three times shown; near-duplicate hint at ingest; no ownership claims in wording | fundamental | "The earliest stamp is not necessarily the creator." |
| Coerced stamping | moderate | harm to the stamper | sealed stamps (v1); withdrawal flag; dispute flag; duress mode after legal review (v2) | fundamental | "A stamp does not prove consent." |

## 3. Registry and chain attacks

| Attack | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Nonce-ordering loss of offline captures under permissionless submission | — (closed) | lost stamps | used-nonce bitmap; App Attest counter equality on chain, monotonicity off chain | none | — |
| Registration DoS via neighbour-code grinding | — (closed) | DoS | no neighbour revert; deterministic derivation with re-draw | none | — |
| Mempool resubmission of a captured claim by a third party | trivial | none (claim lands anyway) | submission is caller-agnostic; `submitter` logged | third party pays gas for you | — |
| Reentrancy through ERC-1271 `isValidSignature` | moderate | state interleaving | `ReentrancyGuardTransient`; effects before the external call; a failed signature reverts everything | none | — |
| Binding griefing: fill slots with dead or foreign data sets | cheap | storage panel noise / DoS on re-replication | `getDataSetListener == FWSS`, `dataSetLive`, `pieceLive`, exact CID required; 4 third-party slots max; dead slots reusable; 4 reserved for governed binders | up to four extra live correct-CID bindings per stamp (harmless) | — |
| FWSS StateView replaced by FilOz | likely over the lifetime | would brick a pinned write path | `bindStorage` reads PDPVerifier only; views resolve `viewContractAddress()` in try/catch (`viewOk = false`) | PDPVerifier proxy semantics change ⇒ registry v2 needed | "Storage proofs are read from third-party Filecoin contracts that may be upgraded." |
| `findPieceIdsByCid` O(N) scan exhausting message gas | — (closed) | DoS on bind | `pieceLive` + `getPieceCid` equality; `findPieceIdsByCid(setId, cid, pieceId, 1)` only as optional cross-check | none | — |
| Reorg before finality | rare | temporary inconsistency | included / safe (≥ 30 epochs) / final policy; 2-epoch reorg re-check; share gated on inclusion | F3 stall on mainnet | "Anchored at epoch N, M epochs ago — pending finality." |
| RPC provider lies or censors | moderate | wrong page | two providers queried and compared (Glif + Ankr); independent `cast` recipe; state-resident sig/CID so no archival logs are needed | both providers colluding | "Verified against two independent Filecoin RPC providers." |
| Governor key compromise | hard (hardware wallet → Safe) | add rogue registrars after 48 h; retroactive revocations | announce delay gives detection time; registrars can self-remove; stamps cannot be altered | 48-h window to notice | — |

## 4. Operator-side attacks (Stamper VPS, keys, staff)

| Attack | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Parser RCE (libvips/ffmpeg/pillow) in the media pipeline | moderate (routine CVEs) | key theft | `worker` and `ml` hold no secrets; uploads are only streamed and hashed by `api`; `/verify/upload` parsed in the worker; image digests pinned | lateral movement inside the Compose network | — |
| Custodian (`api`) compromise: relayer + registrar + session key | moderate | mint L1 keys/stamps and derivatives at Stamper's expense; add pieces; spend FIL | immediate self/owner removal of the registrar and binder; session key `revoke()` runbook; Filecoin Pay allowance caps; 7-day session expiry; countersignature-rate anomaly alerts; public `attestationHash` trail; v1 signer service/KMS | stamps countersigned during the window carry L1 until flagged `RegistrarRemoved` | "Stamps endorsed by a registrar that was later removed are marked." |
| Insider edits the database or serves wrong bytes | moderate | wrong presentation | verdicts come from `eth_call` + browser re-hash; served bytes are re-hashed before "original" | presentation fields (flags, probe times) are trusted UI | "Served by Stamper; hash checked in your browser." |
| App Attest CBOR / Play Integrity JSON / DAG-CBOR parser bugs in `api` | moderate | custodian compromise | small, memory-safe parsers (`cbor`, `pkijs`, `@ipld/dag-cbor`); Google token decoded server-side by Google; size limits; v1 moves signing to a signer service | acknowledged | — |
| Session-key theft from the Docker secret | moderate | add pieces until revoke/expiry | AddPieces-only scope; pinned data sets; allowance caps; weekly rotation | cost up to the cap | — |
| Loss of the payer hardware wallet | hard | cannot top up or create data sets | backup seed in custody; data sets keep proving while funded; registry unaffected | — | — |

## 5. Storage and availability

| Attack / failure | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Provider silently loses a piece | likely over years | unavailable original | 2 FOC copies + off-box mirror written at ingest; retrieval probe at bind time and weekly; re-replication into a new data set with slot reuse | all copies lost ⇒ hash-only verification | "Last retrieval check: <time>. If every copy vanished, only a bit-identical copy could be verified." |
| Provider or FilBeam censors a CID; gateway denylists | moderate | unavailable via one path | provider `/piece`, FilBeam, mirror; CID public for any node; community re-pins | all paths blocked | "The original may be unreachable through some paths." |
| FilBeam quota exhaustion / egress drain by scripted downloads | cheap | cost / 402s | originals on explicit click; per-IP budgets; 402 handled by falling back to provider/mirror; quota alerts | spend up to quota | — |
| USDFC runway exhaustion | operational | data sets terminate after lockup | runway alerts at 60 days, hard stop at 35; public `/health/storage` | — | "Storage payment status: <active/terminated>." |
| Calibration pieces vanish | certain | demo breaks | MVP demos on mainnet | — | — |

## 6. Privacy

| Threat | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Deanonymisation from EXIF/GPS/serials in public originals | trivial if present | privacy | minimised on device before hashing; location only in the on-device-encrypted private record; bystander prompt | PRNU/scene content still identify people and cameras | "Public originals can identify people and cameras." |
| Device fingerprinting via published attestation bundles | — (closed) | cross-service correlation | bundles hashed on chain, encrypted at rest, released on request | release recipients | — |
| Confirm-by-presence of a secretly stamped file via `firstStampOf` | trivial for public stamps | privacy for sealed users | sealed mode uses `sha256(ciphertext)` with a salted commitment in the record; PDQ never computed for sealed assets | public stamps are, by design, public | "Public stamps can be found by anyone holding the same file." |
| Linkability of a device's stamps through a stable `keyId` | trivial | privacy | 12-month key expiry; v2 monthly re-keying and anonymity-set designs | on-chain linkage within a key's lifetime | "Stamps from the same device key are linkable on chain." |
| Plaintext originals held by providers | by design for public mode | privacy | sealed mode (v1) for sensitive material | public mode is public | "Public originals are stored in plaintext on Filecoin." |

## 7. Legal and content

| Threat | Feasibility | Impact | Mitigation | Residual | Disclosure |
|---|---|---|---|---|---|
| Illegal content published under Stamper's payer address | cheap | legal / reputational | FOC commit and FilBeam exposure only after `ingest` checks; strictest quotas on L0; v1 classifier routing and CSAM hash matching (launch gate); takedown pipeline with resolver flags, `deletePieces`, mirror deletion | third-party re-pins cannot be removed; the hash remains on chain | "Withdrawn by Stamper on <date>; copies may exist elsewhere." |
| Erasure requests versus immutable hashes | certain | compliance | hashes are not reversible to content; erasure = delist + stop-serve + piece removal + key destruction (sealed); documented Art. 17(3) exceptions; DPIA | EDPB treats hashes as personal data | — |
| Over-reading verdicts in court or news ("verified") | likely | misuse | banned words; permanent footer; evidence bundle states exactly what is proven; similarity labelled advisory | people quote badly | the footer |

## 8. Trust that cannot be bypassed (stated on the page's "about" link)

FilOz's UUPS proxies (PDPVerifier, FWSS) and their multisig; Apple and Google attestation roots and revocation cadence; the `P256VERIFY` precompile's semantics (v1); the RPC providers' honesty (mitigated by querying two); Stamper's custodian as the second wrapper of every sealed key (v1; export flow ships with the feature).
