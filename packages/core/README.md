# @stamper/core

Pure TypeScript primitives shared by mobile (Hermes), the browser and Node. The package uses no Node built-ins, and `scripts/check-pure.mjs` enforces that on `dist/`.

## Public API (`import … from "@stamper/core"`)

| Module | Exports |
|---|---|
| constants | `DEFAULT_ORIGIN`, `CHAINS`, `KT`, `PF`, `FLAG`, `MEDIA`, `DERIV_KIND`, `TYPEHASH`, `ZERO_BYTES32`, `P256VERIFY_PRECOMPILE`, `epochToUnix` |
| code | `CODE_ALPHABET`, `encodeCode`, `formatCode`, `normaliseCode`, `deriveCode`, `predictCode`, `codeCandidate`, `codeToNato` |
| claim | `stamperDomain`, the six `*Types` objects, the struct types, `hashCaptureClaim` (= stampId), `hashKeyEnrolment`, `hashKeyPossession`, `hashCountersignature`, `hashKeyRevocation`, `hashDerivativeAttachment`, `captureClaimTypedData`, `assertCaptureClaim`, `claimDeadline` |
| keys | `keyIdFromAddress`, `keyIdFromP256`, `verifyDeviceSignature` (secp256k1 / P256_RAW / P256_APPATTEST; ERC1271 → false), `appAttestBinding` |
| piece | `PieceCID` (type), `pieceCidOf`, `pieceCidHasher` (`impl: "synapse" \| "fr32"`), `pieceCidBytes`, `pieceCidHex`, `pieceCidString`, `parsePieceCid`, `validateCommPv2`, `rawPieceSizeBounds`, `contentLengthFits` |
| fr32 | `fr32Hasher`, `fr32PieceCid`, `expandQuad`, `fr32Node`, `zeroComm`, `fr32Sizing`, `encodePieceCidV2` (the pure-JS fallback) |
| record | `CaptureRecord`, `captureRecordSchema` (zod, strict, integers only), `encodeRecord`, `decodeRecord`, `recordHash`, `encodeDagCbor` |
| verdict | `decide` (the DESIGN §8.1 ladder over an injected `VerifyIO`), `verdictLabel`, `finalityState`, `effectiveLevel`, `PERCEPTUAL_MAX_DISTANCE` |
| copy | `tierSentence`, `FOOTER`, `BANNED_WORDS`, `containsBannedWord` |
| url | `verifyUrl`, `qrPayload`, `forensicQrPayload`, `parseVerifyPath` |
| encoding | hex, base64 and base64url, and utf8 helpers that do not use `Buffer` |

## Env
None. `DEFAULT_ORIGIN` (`https://stamper.media`) is the one place this package names the domain. Every URL helper takes an override for the origin.

## Scripts
- `pnpm --filter @stamper/core build`: compiles `src` to `dist/` with `tsconfig.build.json`, which uses no Node types.
- `pnpm --filter @stamper/core typecheck`: checks `src` and `test`.
- `pnpm --filter @stamper/core test`: runs vitest.
- `node scripts/check-pure.mjs packages/core`: runs the purity gate on `dist/`.

## Test vectors (`test/vectors/`)
- `codes.json`: generated with `cast abi-encode` and `cast keccak`, so it does not depend on viem. It includes forced-collision cases. Replace it with WP-01's `contracts/test/vectors/codes.json` once that file exists.
- `typehashes.json`: the DESIGN §4.1 type strings and the hashes frozen in plan §0.8.
- `claims.json`: three claims (secp256k1 online, P-256 raw, App Attest offline), each with its private key, digest, signature and authData. The api, web and mobile tests reuse them. They were computed with viem and noble. Reconcile them with WP-01's `cast` `hashClaim` output.
- `commpv2.json`: positive vectors from `@filoz/synapse-core` `calculate()`, plus hand-built negative vectors. Extend it with the negative vectors from WP-01 and the Calibration pin.

## Notes and stubs
- Nothing is stubbed. ERC-1271 signatures cannot be checked without the chain, so `verifyDeviceSignature` returns `false` for them.
- PieceCID v2 states its padding exactly, so `rawPieceSizeBounds` returns `min === max`.
- `FOOTER` rewords DESIGN §1.2 to avoid the banned word "matches". It says "…whether the copy you have is byte-for-byte the stored original…".
- `decide()` returns `NOT_REGISTERED` with `anomaly: "piececid-hit-without-sha256"` when a PieceCID equals a stamp's but the sha256 found nothing. The caller should alert and show no verdict.
