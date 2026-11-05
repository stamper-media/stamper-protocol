#!/bin/sh
# Regenerates test/fixtures/*. Needs ffmpeg (libx264 + aac) and exiftool; node for the JPEG synthesiser.
# Fixtures are committed; regenerating changes their bytes, so re-run the golden update afterwards:
#   UPDATE_GOLDEN=1 pnpm test
set -eu
cd "$(dirname "$0")/.."
F=test/fixtures
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
FF="ffmpeg -hide_banner -loglevel error -y"

# JPEG: real baseline coded data, synthetic phone metadata (see synth-jpeg.mjs).
$FF -f lavfi -i testsrc=size=48x32 -frames:v 1 -q:v 5 -fflags +bitexact -flags +bitexact "$T/base.jpg"
node scripts/synth-jpeg.mjs "$T/base.jpg" "$F"

# MP4 (Android-like): faststart (moov before mdat, so removal shifts chunk offsets), ©xyz location,
# then an XMP uuid box added by exiftool.
$FF -f lavfi -i testsrc=size=64x48:rate=10:duration=1 -f lavfi -i sine=frequency=440:duration=1 \
  -c:v libx264 -threads 1 -pix_fmt yuv420p -c:a aac -shortest -fflags +bitexact \
  -metadata location="-23.5505-046.6333/" -metadata make=Google -metadata model="Pixel 8" \
  -movflags +faststart "$F/pixel.mp4"
exiftool -q -overwrite_original -XMP-dc:Creator="Fixture Owner" "$F/pixel.mp4"
exiftool -q -overwrite_original -UserData:GPSCoordinates="-23.5505, -46.6333" "$F/pixel.mp4"

# MOV (iOS-like): moov after mdat, mdta keys in moov/meta (location ISO6709, make/model), ©xyz in udta.
$FF -f lavfi -i testsrc=size=64x48:rate=10:duration=1 -f lavfi -i sine=frequency=440:duration=1 \
  -c:v libx264 -threads 1 -pix_fmt yuv420p -c:a aac -shortest -fflags +bitexact -f mov \
  -movflags use_metadata_tags \
  -metadata com.apple.quicktime.location.ISO6709="-23.5505-046.6333+760.000/" \
  -metadata com.apple.quicktime.make=Apple -metadata com.apple.quicktime.model="iPhone 15 Pro" \
  -metadata location="-23.5505-046.6333/" "$F/iphone.mov"
ls -l "$F"
