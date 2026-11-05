# @stamper/marking

Deterministic server-side rendering of Stamper derivatives (Node only) and the clients for the ml
sidecar. The worker (WP-08) orchestrates; everything here can be reproduced from the original and
the `RenderParams` hashed into `paramsHash`.

## Public API (`import … from "@stamper/marking"`)

- `badgeGeometry(w, h, family, domain?)`: DESIGN §6.1 geometry. Pill height is 0.05·S rounded to
  an even number, so the radius is an integer. Margin is 0.03·S, cap height is ≥ 0.016·S, and the
  badge sits bottom-right, inset to survive a central 4:5 crop. Throws when S < 160.
- `renderBadgeSvg({ family, code9, geometry, domain? })`: a pure SVG string the size of the pill.
  Text is converted to outlines from the bundled JetBrains Mono Bold, with the font's `zero` feature
  applied for a slashed zero. Rendering therefore never depends on system fonts or fontconfig.
- `applyBadgeImage(bytes, { family, code9, imageDigest })` → `{ bytes, params, width, height }`.
  Auto-orients from EXIF, composites the SVG and writes a mozjpeg q92 4:4:4 JPEG with no metadata.
- `applyBadgeVideo(in, out, { family, code9, imageDigest, ffmpegPath? })`. Uses ffprobe for the
  dimensions, then a pre-rendered badge PNG, then ffmpeg `overlay` with libx264 `-crf 20 -preset
  medium`, `-movflags +faststart`, `-c:a copy` and `-map_metadata -1`.
- `renderShareCard({ code9, tierSentence, qrPayload, thumbnail? })`: a 1080×1350 PNG. The QR is
  version 2 with ECC M at 16 px/module, and the call throws unless the payload fits.
- `renderPreview(bytes, maxEdge)` and `renderThumb(bytes, 320)` return WebP.
- `RenderParams`, `paramsHash(p)`: sha256 of the canonical DAG-CBOR from `@stamper/core`
  `encodeDagCbor`. Input is validated by a strict zod schema. `watermark.strength` is hashed as its
  decimal string because DAG-CBOR in core forbids floats.
- `createMlClients(ML_URL, { timeoutMs })` → `{ watermark, pdq, health }`, which follows the
  services/ml HTTP contract (multipart field `image`, plus `payload` and `strength`).
  `nullWatermark` is the fallback: encode returns the input unchanged and decode returns
  `{ ok: false }`.
- `pdqVariants(bytes)`: fixed variant ids that are mirrored in the DB `renditions.variant`:
  - 0–3: rotate 0/90/180/270° clockwise.
  - 4–7: mirror horizontally, then rotate 0/90/180/270°.
  - 8: central 4:5 crop.
  - 9: central 1:1 crop.

  All variants are taken after EXIF orientation and returned as PNG.
- `hamming`, `pdqToBitString` (MSB-first, for pgvector `bit(256)`), `pdqFromHex`, and `ssim(a, b)`
  (ssim.js on grey images downscaled to 256 px).
- `buildC2paAnchorAssertion(...)` builds the `media.stamper.anchor` assertion. `C2paSigner`,
  `notImplemented()` and `unimplementedC2paSigner` are v1 hooks.
- `BADGE_COPY` and `SHARE_COPY` hold the user-facing strings. Tests check them against the
  banned-word list.

## Env

`FFMPEG_PATH` (default `ffmpeg`), `FFPROBE_PATH` (default: next to `FFMPEG_PATH`, else `ffprobe`),
`ML_URL` (read by the caller and by `test/ml.int.test.ts`).

## Tests

`pnpm --filter @stamper/marking test` runs the unit tests. Fixtures are generated in memory by
`test/fixtures.ts` (sharp test patterns, an EXIF-6 image, and a 2 s lavfi `testsrc` clip with AAC
audio). The video test skips with a visible reason when ffmpeg or ffprobe is missing.
`ML_URL=http://127.0.0.1:<port> pnpm --filter @stamper/marking test:ml` runs the integration test
against a running services/ml.

## Stubbed / deferred

C2PA signing is a v1 hook and throws. `nullWatermark` stands in when ml is disabled. The badge
glyph (`assets/glyph.svg`) is a placeholder mark until there is a brand asset. The font is
JetBrains Mono Bold under the OFL (`assets/fonts/OFL.txt`).
