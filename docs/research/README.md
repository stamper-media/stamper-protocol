# Research record (2026-09-30 / 2026-10-01)

Nine web-sourced research reports, one verified-facts sheet extracted from the installed Filecoin Onchain Cloud SDK, three architecture proposals and three adversarial critiques. `docs/DESIGN.md` was synthesized from these. The facts sheet (`VERIFIED-SDK-FACTS.md`) is ground truth for SDK API shapes and contract addresses; where a report and the sheet disagree, the sheet wins, and where the design cites a later live `cast` read (pricing, `findPieceIdsByCid` cost), the design wins.

| File | Dimension |
|---|---|
| VERIFIED-SDK-FACTS.md | `@filoz/synapse-sdk` 2.0.2 / `synapse-core` 0.10.0 API, chain config, contract addresses, PDPVerifier/FWSS view signatures |
| filecoin-storage.md | Filecoin Onchain Cloud, Storacha, Lighthouse, retrieval, CID computation |
| fevm-contracts.md | FEVM toolchain, finality (F3 status), P256VERIFY precompile, relayers, indexing |
| c2pa-prior-art.md | C2PA 2.4, Content Credentials, Numbers / Truepic / ProofMode / Starling |
| watermarking.md | TrustMark, Video Seal / PixelSeal, attacks, visible-badge rendering |
| trusted-capture.md | App Attest, Play Integrity, Key Attestation, WebAuthn limits, claim format |
| perceptual-hashing.md | SHA-256 / PieceCID v2, PDQ, vPDQ, pgvector indexing, verification ladder |
| app-stack.md | Expo SDK 57, Hermes crypto gaps, Next.js 16, Hono, BullMQ, monorepo tooling |
| codes-ux-legal.md | Crockford Base32 codes, QR/URL, verify UX, pricing, privacy, evidentiary law |
| threat-model.md | Attack catalogue 2024–2026 and defenses |
| proposals/ | The three architect proposals and the three critiques that produced DESIGN.md |
