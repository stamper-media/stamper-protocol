# @stamper/minimise

Strips identifying metadata from captures **without re-encoding pixels or samples**, before the
device hashes them (DESIGN §7.1, risk #11), and inspects files so the worker can show that the
stripping happened. Pure TypeScript: zero runtime dependencies, no Node built-ins (DataView /
Uint8Array only), so it runs in Node, browsers and Hermes (Expo).

## Public API

```ts
minimiseJpeg(bytes): { bytes, report }   // APP1 Exif rewritten to a whitelist; XMP, IPTC, MPF, COM, vendor APPn, EOI trailer dropped
minimiseMp4(bytes): { bytes, report }    // moov/udta and trak/udta dropped, location/serial/owner/identifier mdta keys
                                          // dropped from moov|trak/meta (ilst renumbered), XMP uuid boxes dropped,
                                          // parent sizes and stco/co64 chunk offsets fixed, mdat copied untouched
minimiseMp4Stream(source, sink, { chunkSize? }): Promise<MinimiseReport>   // for files > STREAM_THRESHOLD (64 MiB)
inspectJpeg(bytes): { hasGps, hasSerial, hasMakerNote, hasXmp, orientation?, dims?, segments }
inspectMp4(bytes): { hasUdta, hasLocation, boxes }
sniff(bytes): "image/jpeg" | "video/mp4" | "video/quicktime" | "image/heic" | "unknown"
MinimiseError   // thrown for malformed, truncated or unsupported input
```

`MinimiseReport = { removed, kept, publicExif: { make, model, exposure, iso, focalLength }, orientation?, width?, height? }`
feeds the record's `sanitised` lists (DESIGN §3.4).

**JPEG whitelist.** IFD0: Make, Model, Orientation, X/YResolution, ResolutionUnit. Exif IFD:
ExposureTime, FNumber, ISO, ExifVersion, DateTimeOriginal, FocalLength, ColorSpace,
PixelX/YDimension. Everything else (GPS IFD, serials, CameraOwnerName, MakerNote, UserComment,
ImageUniqueID, Software, Artist, IFD1 thumbnail, ...) is dropped. APP0 JFIF, APP2 ICC_PROFILE,
APP14 Adobe, DQT/DHT/SOF/DRI are kept verbatim; SOS..EOI is copied byte for byte. Byte order of the
TIFF is preserved. Output is idempotent.

**MP4 limits.** Fragmented files are refused (MinimiseError) only when a removal would shift
absolute offsets (`mfra`, or `tfhd` with base-data-offset). `saio` offsets of encrypted tracks are
not rewritten (camera output never has them).

## Env

None.

## Tests

```sh
pnpm --filter @stamper/minimise test        # vitest: jpeg, mp4, inspect, golden, robustness (fuzz + purity)
pnpm --filter @stamper/minimise typecheck
pnpm --filter @stamper/minimise build && pnpm --filter @stamper/minimise check-pure
```

The integration test is `test/golden.test.ts › golden › both-platforms`. Cross-checks: `exifr`
and `sharp` (identical decoded pixels) always run; `exiftool`, `ffprobe` and `ffmpeg` (equal
duration, streams and decoded frame hashes) run when installed and are skipped otherwise.

## Fixtures

`test/fixtures/*` are committed and synthetic: real coded data from ffmpeg `testsrc`, with
phone-like metadata written by `scripts/synth-jpeg.mjs` (its own TIFF writer, independent of
`src/`) and by exiftool for the videos. Regenerate with `pnpm --filter @stamper/minimise fixtures`
(needs ffmpeg with libx264/aac, exiftool), then `UPDATE_GOLDEN=1 pnpm --filter @stamper/minimise test`
to refresh `golden.json`. No real camera files are committed (privacy); the iOS `moov/meta` layout
is covered by a synthetic MOV built in `test/helpers.ts`.

## Stubbed

Nothing. HEIC is only sniffed, not minimised.
