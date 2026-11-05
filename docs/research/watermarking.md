# Stamper research — Watermarking (visible mark + short code, invisible robust watermark, C2PA soft bindings, attacks)

Date: 2026-09-30. Sources are primary (GitHub READMEs/source files, PyPI/npm registries, C2PA spec HTML, arXiv) unless marked otherwise. Tags: **[verified]** = read from a primary source; **[inferred]** = my derivation/estimate; **[stale?]** = old or community-measured, re-verify; **[unverified]** = from memory or a secondary source.

---

## 0. Executive summary

1. **The only production-grade, permissively licensed, TS/Node-reachable invisible image watermark in 2026 is Adobe TrustMark** (MIT; PyPI `trustmark` 0.9.2, 2026-09-08; Rust crate `trustmark` 0.4.0, 2026-09-29, encode+decode over ONNX; JS decoder over ONNX Runtime Web with WebGPU/WASM). It is on the C2PA soft-binding algorithm list as `com.adobe.trustmark.Q|P|C`. Its 100-bit payload carries **40 / 61 / 68 / 75 data bits** depending on BCH level; a 40-bit stamp id fits `BCH_SUPER` exactly (t=8 correctable flips). **[verified]**
2. **For video, Meta Video Seal / PixelSeal** (MIT; PyPI `videoseal` 1.0.1; 256-bit payload; temporal propagation every k=4 frames; ~1.1 s CPU or ~0.4 s GPU per second of video on server-class hardware) is the only open option worth using. It is PyTorch/TorchScript only, so it needs a **Python sidecar** (GPU worker). PixelSeal (Dec 2025) is the most robust open image/video model published (0.91 bit accuracy under JPEG-40 + 71 % crop + brightness 0.5, vs 0.52 TrustMark-P). **[verified]**
3. **All post-hoc invisible watermarks are removable and forgeable in 2026.** Diffusion editing/regeneration drives TrustMark/StegaStamp/VINE to 50–76 % bit accuracy; WmForger forges Video Seal payloads at 83 % bit accuracy and TrustMark at 61 % with a black-box preference model; TrustMark even ships its own remover. Therefore the invisible watermark is a **durable lookup key**, not a security primitive. Security comes from the on-chain registry (content hash + stamp id), the served original, and a **perceptual-hash match** (PDQ / ISCC) between the copy being verified and the registered original. C2PA itself says exactly this ("fingerprint counters watermark spoofing"). **[verified]**
4. **C2PA 2.4 (April 2026)** has everything Stamper needs: `c2pa.soft-binding` assertion (`alg`, `blocks[{scope,value}]`), actions `c2pa.watermarked.bound` / `.unbound` (`c2pa.watermarked` is deprecated), a **Soft Binding Resolution API** (`/matches/byBinding`, `/matches/byContent`, `/manifests/{id}`, `/bindings`, receipts) and the new `c2pa.repository-receipt` assertion. Stamper's stamp-id watermark maps 1:1 to a soft binding value; Stamper's backend can be a C2PA Manifest Repository. Node: `@contentauth/c2pa-node` 0.9.9 (`Builder.addAssertion`, `LocalSigner`/`CallbackSigner`). **[verified]**
5. **Visible mark**: render on device with `@shopify/react-native-skia` 2.13.1 offscreen surfaces (Expo SDK 57 bundles Skia) and/or on the server with `sharp` 0.35.5 `composite()` (images) and ffmpeg `overlay`+`drawtext` (video; `overlay_cuda`/`overlay_vulkan`/`overlay_vaapi`/`overlay_opencl` exist for GPU paths). `expo-image-manipulator` cannot composite. On-device video overlay is awkward in 2026: FFmpegKit was archived 2026-07-02; FFmpegKitNext is source-only (LGPL/GPL). Do video marking server-side. **[verified]**
6. Recommended short code: **40-bit stamp id → 8 Crockford-Base32 chars + 1 check char**, e.g. `K3Q9-XA2M-7` (no I/L/O/U, case-insensitive). Same 40 bits go into TrustMark `BCH_SUPER` (images) and into a 4×-repeated 64-bit block (id + CRC) inside the 256-bit Video Seal payload. **[inferred design]**

---

## 1. Visible mark rendering

### 1.1 On device (React Native / Expo)

| Package | Version (npm, 2026-09-30) | License | Notes |
|---|---|---|---|
| `expo` | 57.0.26 (dev-dep react-native 0.86.3) | MIT | Current Expo SDK is **57** [verified via npm]. |
| `@shopify/react-native-skia` | 2.13.1 (peer RN ≥ 0.78) | MIT | Expo SDK 57 documents Skia as a first-class module. Offscreen API: `makeOffscreenSurface(w,h)` + `drawOffscreen(surface, <Component/>)`, `drawAsImage(<Component/>, {width,height})`, canvas `makeImageSnapshot()/makeImageSnapshotAsync()`, then `image.encodeToBytes(ImageFormat.JPEG, quality)` / `encodeToBase64()` [verified from docs mirror + search results; the official docs URL layout changed, so cross-check `shopify.github.io/react-native-skia`]. |
| `expo-image-manipulator` | 57.0.20 | MIT | `ImageManipulator.manipulate(uri)` context API: **resize / crop / rotate / flip / extent only**, JPEG/PNG/WebP output, `compress` 0–1. **No compositing, no text** → use only to normalise/resize before marking [verified]. |
| `react-native-image-marker` | 2.1.1 (2026-08-20) | MIT | Native text/image overlays (position, scale, opacity, blend modes, stroke, tiling), JPEG/PNG quality; iOS 13+/Android 24+/RN-Web. Its "invisible watermark" is a light tracing scheme (tested only for 0.9–1.1× resize and limited crops) — **not** a robust watermark [verified]. Good fallback if you don't want Skia in the pipeline. |
| `react-native-qrcode-skia` | 0.3.1 | MIT | QR drawn with Skia; can be drawn into the same offscreen surface as the badge [verified version; API details from search only]. |
| `qrcode` (node-qrcode) | 1.5.4 | MIT | Server + browser + RN(SVG) QR generation; use it server-side to rasterise the badge [verified]. |

Recommended on-device flow (images): capture (VisionCamera/expo-camera) → keep the **original** bytes untouched (hash them; they are what goes to Filecoin) → draw the marked *preview/share* copy with Skia offscreen: `<Image>` of the capture + badge group (rounded dark pill, code text, QR) → `encodeToBytes(JPEG, 92)`. Rendering is GPU-backed and takes tens of ms for a 12 MP frame [inferred].

Video on device: **FFmpegKit is retired** (repo archived 2026-07-02; old binaries remain on npm/CocoaPods but frozen). **FFmpegKitNext** (github.com/arthenica/ffmpeg-kit-next) is the maintained continuation, supports RN/Flutter bindings, ships FFmpeg 9.0.1 / 8.1.2, but is **source-only** (Nix/MSYS2 builds; no npm/CocoaPods) and LGPL v3 / GPL v3 with `--enable-gpl` [verified]. Alternatives are native AVFoundation (`AVMutableVideoComposition` + CALayer overlay) and Android Media3 Transformer overlay effects [unverified, from memory]. Recommendation: **do not** mark video on device in v1; upload the original and let the server produce the marked derivative.

### 1.2 Server side (Node)

`sharp` 0.35.5 (Apache-2.0; Node ≥ 20.9; libvips ≥ 8.18.7) — `composite()` accepts an array of `{ input, blend='over', gravity='centre', top, left, tile, premultiplied, density }`; `input` may be a Buffer, a path, an **SVG string** or a creation object (`{ create: … }` or `{ text: { text: '<span …>Pango markup</span>', font, rgba: true } }`). Caveats: resize/rotate/extract in the same pipeline are applied **before** composition; the overlay must fit inside the base [verified].

```ts
import sharp from 'sharp';
import QRCode from 'qrcode';

export async function markImage(orig: Buffer, code: string, url: string) {
  const base = sharp(orig).rotate();                    // honour EXIF orientation first
  const { width, height } = await base.metadata();
  const short = Math.min(width!, height!);
  const badgeH = Math.round(short * 0.055);             // ~4–6 % of the short side
  const qrPx  = Math.round(badgeH * 0.9);
  const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: qrPx, type: 'png' });
  const fontPx = Math.round(badgeH * 0.42);
  const pillW = Math.round(qrPx + fontPx * 0.62 * (code.length + 1) + badgeH * 0.8);
  const svg = `<svg width="${pillW}" height="${badgeH}">
      <rect x="0" y="0" rx="${badgeH/2}" ry="${badgeH/2}" width="${pillW}" height="${badgeH}" fill="rgba(0,0,0,0.62)"/>
      <text x="${qrPx + badgeH*0.45}" y="${badgeH*0.67}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace"
            font-weight="700" font-size="${fontPx}" fill="#fff">${code}</text></svg>`;
  const margin = Math.round(short * 0.03);
  return base
    .composite([
      { input: Buffer.from(svg), gravity: 'southeast', top: height! - badgeH - margin, left: width! - pillW - margin },
      { input: qr, top: height! - badgeH - margin + Math.round((badgeH - qrPx)/2), left: width! - pillW - margin + Math.round(badgeH*0.05) },
    ])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
}
```
(Fonts must exist in the container: install the TTF and let fontconfig find it.)

ffmpeg (video). `overlay` options: `x, y, eof_action, format, alpha, shortest, repeatlast`; `drawtext`: `fontfile, text, x, y, fontsize, fontcolor, box, boxcolor, boxborderw, borderw, bordercolor, shadowcolor, alpha, enable` (+ text expansion / runtime commands) [verified from ffmpeg-filters.html]. `drawtext` requires a build with libfreetype (+fontconfig; newer builds also need libharfbuzz — [unverified]). Example:

```bash
ffmpeg -i in.mp4 -i badge.png -filter_complex \
 "[1:v]scale=-1:'min(ih,ceil(min(W,H)*0.055))':flags=lanczos[b]; \
  [0:v][b]overlay=x=W-w-round(min(W,H)*0.03):y=H-h-round(min(W,H)*0.03):format=auto, \
  drawtext=fontfile=/fonts/JetBrainsMono-Bold.ttf:text='K3Q9-XA2M-7':fontsize=h/28: \
  fontcolor=white:borderw=2:bordercolor=black@0.7:x=w-tw-round(min(w,h)*0.03)-round(min(w,h)*0.07):y=h-th-round(min(w,h)*0.045)" \
 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart -c:a copy out.mp4
```
Hardware paths: `overlay_cuda` (since FFmpeg 4.2), `overlay_vulkan` (4.3), `overlay_vaapi`, `overlay_opencl`, `overlay_qsv`, `overlay_videotoolbox` (patch series 2024, verify in your build) [verified Changelog for cuda/vulkan; others from filter docs/mailing list]. With CUDA the PNG overlay must be converted to `yuva420p` and `hwupload`ed, and main/overlay software formats must match [verified, mailing list/dev forum]. In practice the overlay is cheap; **the encoder dominates** → use `h264_nvenc` / `hevc_videotoolbox` / `h264_vaapi` for the encode and keep the overlay in software unless you already keep frames on the GPU for the invisible watermark.

### 1.3 Design rules for a mark that survives recompression and stays unobtrusive

Measured platform behaviour (what the mark must survive):
- Chuman et al. 2018 (arXiv 1810.02062, measured with JPEGsnoop) **[stale?]**: Twitter re-encodes to 4:2:0 at QF 85 (only if the upload QF ≥ 85; resizes above 4096² or 3 MB); Facebook re-encodes everything to 4:2:0 at QF 71–85 and caps at 2048² (HQ) or 960² (LQ); Tumblr caps 1280²; Google+/Flickr no recompression at the time.
- Community measurements 2025 (dev.to, explicitly *simulated* parameters, not official) **[unverified]**: WhatsApp long edge ≈ 1600 px, JPEG q ≈ 70–72; Instagram long edge 1080 px, q ≈ 80; Telegram q ≈ 89 no resize; WeChat short edge 1080, q ≈ 80. Chroma subsampling 4:2:0 is universal.
- Consequence: the shared copy will typically be **1080–1600 px wide, JPEG q 70–85, 4:2:0** and possibly centre-cropped to 4:5 or 1:1.

Rules **[inferred from the above + QR/Base32 specs]**:
1. **Size everything relative to the short side of the output image**, not in absolute pixels: badge height 4–6 % of the short side; code cap-height ≥ 1.6 % of the short side (≥ 17 px after a 1080 px downscale); stroke/border widths ≥ 2 px *after* worst-case downscale (0.27× for a 4032 px photo → 1080 px) — so ≥ 8 px in the 4032 px original.
2. **Luminance contrast, not chroma contrast**: white text on a 60–70 % black pill (WCAG ≥ 4.5:1) — 4:2:0 halves chroma resolution, so colour-on-colour marks blur.
3. **Placement**: bottom-right with a margin of ~3 % of the short side; for portrait captures keep the badge inside the central 4:5 crop window (inset from the bottom by ≥ (H − 1.25·W)/2) so Instagram-style crops don't remove it.
4. **QR**: encode a short uppercase-alphanumeric URL (`HTTPS://STMP.TO/K3Q9XA2M7`, 25 chars fits **Version 2 (25×25), ECC M**; ECC levels L/M/Q/H ≈ 7/15/25/30 % recovery [verified qrcode.com]). Denso Wave's rule of ≥ 4 dots per module [verified] translates to ≥ 4 px per module after downscale: 25 modules + 2×4 quiet zone = 33 modules × 4 px ≈ 132 px at 1080 px ≈ 12 % of width. That is large; a QR is a *convenience*, the **text code is the primary human channel**. Use Version 1/2 only, ECC M or Q, and drop the QR on very small outputs.
5. **Code alphabet**: Crockford Base32 [verified spec]: digits + 22 letters, excludes I, L, O, U (confusable / obscenity), decoding is case-insensitive and maps i/l→1, o→0; optional mod-37 check symbol. 8 symbols = 40 bits; display as `XXXX-XXXX-C` (C = check symbol). Font: a monospaced face with slashed zero and tabular figures (JetBrains Mono / IBM Plex Mono / Inter tabular) [recommendation].
6. Never rely on the visible mark for integrity: it is trivially cropped/inpainted; it exists for *discoverability* (a human can type it into Stamper).

---

## 2. Invisible robust watermarking — images

### 2.1 Candidates at a glance

| Method | Repo / package | License | Payload | Blind? | Runtime | Status (2026-09) |
|---|---|---|---|---|---|---|
| **TrustMark** (Adobe, ICCV 2025) | `adobe/trustmark`; PyPI `trustmark` **0.9.2** (2026-09-08); crates.io `trustmark` **0.4.0** (2026-09-29); JS decoder | MIT | 100 bits raw → **40/61/68/75 data bits** (BCH_SUPER/5/4/3) | yes | PyTorch (CPU/GPU), ONNX (Rust/JS), Hailo NPU | Active; C2PA-listed (`com.adobe.trustmark.Q/P/C`) |
| **PixelSeal / Video Seal 1.0 / ChunkySeal** (Meta FAIR) | `facebookresearch/videoseal`; PyPI `videoseal` **1.0.1** (2025-07-21) | MIT (code + weights) | **256 bits** (Video Seal 1.0, PixelSeal); 1024 (ChunkySeal); 96 (v0.0 legacy) | yes | PyTorch / TorchScript only | Active (PixelSeal & ChunkySeal Dec 2025; WmForger NeurIPS'25) |
| **Watermark Anything (WAM)** (Meta, ICLR 2025) | `facebookresearch/watermark-anything` | MIT (`wam_mit.pth`, SA-1B) / CC-BY-NC (`wam_coco.pth`) | **32 bits**, localized, multi-message | yes | PyTorch; 256² default | Active; slowest (3.6 s CPU / s of video) |
| Stable Signature (Meta, ICCV 2023) | `facebookresearch/stable_signature` | **CC-BY-NC 4.0** | 48 bits | yes | needs fine-tuned LDM decoder | Only for generated images — **not applicable** |
| StegaStamp (Tancik 2020) | `tancik/StegaStamp` | MIT | 100 bits → 56 after BCH | yes | **TensorFlow 1.13** | Unmaintained; still the most robust in WAVES; print/re-photo focus |
| HiDDeN (2018) | `ando-khachatryan/HiDDeN` | MIT | ~30 bits | yes | PyTorch 1.x | Research baseline only |
| RivaGAN (2019) | `DAI-Lab/RivaGAN` | MIT | 32 bits (video) | yes | PyTorch | Research; 10× slower than DWT-DCT |
| invisible-watermark (ShieldMnt) | PyPI **0.2.0** (2023-07-06) | MIT | arbitrary (e.g. 32–48 bits) | yes | NumPy/OpenCV/PyWavelets (+torch for RivaGAN) | "experimental"; dwtDct fast, **fails on resize/crop** |
| blind_watermark (guofei9987) | PyPI **0.4.4** (2023-04-08) | MIT | text/image | needs wm length/password | NumPy/OpenCV | Claims crop/rotate recovery only when the attack geometry is known |
| Google SynthID (image) | — | proprietary | — | — | Google-only detector | Not usable (only SynthID-Text is open) [secondary source] |
| Digimarc, Imatag, Steg.AI, Trufo, castLabs… | C2PA-listed | commercial | — | — | SaaS | Out of scope for an open stack |

**JS/WASM/ONNX ports**: the only serious JavaScript artefact is Adobe's TrustMark **decoder** (`tm_watermark.js` + `tm_datalayer.js`; models `decoder_Q.onnx`, `decoder_P.onnx`, `resizer.onnx` from `https://cai-watermark.adobe.net/watermarking/trustmark-models/`; WebGPU for the decoders, WASM for the anti-aliased resizer; sequential inference required because "WebGPU will fail silently and intermittently if multiple concurrent inference calls are made") [verified from source]. The Rust crate proves ONNX **encoder** graphs exist (`encoder_{variant}.onnx`) [verified docs.rs]. npm has **no** maintained DWT-DCT port (the npm `invisible-watermark` 1.0.17 from 2019 is an unrelated "watermark auto injector") [verified npm search]. `onnxruntime-node` 1.30.0, `onnxruntime-web` 1.30.0, `onnxruntime-react-native` 1.24.3 (MIT) are current [verified].

### 2.2 TrustMark in depth (the image primitive to use)

- **Payload layout** (from `datalayer.py`) [verified]: 100 bits = data + BCH ECC + 4 version bits (2 reserved + 2-bit schema id). Schemas: `BCH_SUPER` 40 data / 56 ECC / corrects 8 flips; `BCH_5` 61/35/5 (**default**); `BCH_4` 68/28/4; `BCH_3` 75/21/3. BCH over GF(2^7) (m=7, n≤127, shortened to 96 bits) [inferred from ECC = 7·t].
- **Presence decision**: decode succeeds iff BCH returns a non-negative flip count and the schema bits are valid [verified]. **False-accept estimate** if the extractor emits ~random bits on unmarked content [inferred, order-of-magnitude]: BCH_SUPER ≈ 2×10⁻⁶ (≈1/500 000; ≈5×10⁻⁷ if reserved bits are checked), BCH_5 ≈ 1.9×10⁻³ (≈1/530), BCH_4 ≈ 1.3×10⁻² (≈1/77), BCH_3 ≈ 7×10⁻². → With BCH_5/BCH_4 roughly 0.2–1 % of arbitrary unmarked images will "decode" to a garbage id. Stamper must therefore treat a decoded id as a **registry lookup key** and confirm with a perceptual-hash match; TrustMark's FAQ itself says perceptual-hash validation is required to prevent spoofing [verified FAQ].
- **Variants** [verified FAQ]: Q (default; ResNet-50 decoder ≈35 MB; PSNR ≈ 43–45 dB), P (>48–50 dB, less robust; strength internally ×1.25), C (ResNet-18, ≈20 MB, 38–40 dB), B (older). **Variants are mutually incompatible**; one watermark per image (re-encoding overwrites).
- **Resolution handling** [verified source]: encoder runs at 256×256 on a centre region; the residual is bilinearly upsampled to full resolution with 1 % edge feathering ("arbitrary resolution", min ≈150 px short side, tested >12K px); decode at 256 (Q) / 224 (P); detection mode downsizes to ≤1600 px edge. `encode(img, secret, MODE='text'|'binary', WM_STRENGTH=1.0, WM_MERGE='bilinear')`, `decode(img, MODE, DETECTFIRST=False, ROTATION=False) -> (secret, present, schema)`.
- **Robustness** [verified paper/FAQ/3rd-party]: trained against 3 geometric + 15 signal perturbations (JPEG QF 40–70, crops 244/256, resize 0.8–1.0, blur, noise, colour ops…). Independent 2026 measurements: JPEG-50 **98.2 %**, resize 0.5× **97.5 %**, centre-crop 0.9 **96.8 %** bit accuracy (arXiv 2603.12949); JPEG-40 **0.98** but crop-71 % **0.65** and JPEG40+crop71+brightness **0.52** (PixelSeal paper). FAQ: survives ~20 % area loss from four-sided crops, screenshots, "most non-editorial transformations", printing at 1.5× strength, and decodes on most social platforms at 70–80 % strength. Weak spots: heavy crops, Gaussian noise/box blur, geometric misalignment, and any diffusion edit (see §5).
- **Speed** [verified]: 125 ms encode / 25 ms decode on an RTX 3090 (paper); "tens of ms / ms" on an RTX 3070 (FAQ); Video Seal's Table 6 measures TrustMark at **0.64 s CPU per second of video** (≈27 ms/frame at 24 fps, 2× Xeon 6230) and 0.41 s for extraction; the fastest of the compared models on CPU. Budget ≈0.1–0.3 s per 12 MP image on a modest cloud CPU including the resize [inferred].
- **Node integration options** [inferred from verified facts]: (a) spawn `trustmark-cli` (Rust, ONNX via `ort` 2.0.0-rc.10) as a sidecar process — simplest, no Python; (b) wrap the `trustmark` crate with napi-rs; (c) run `encoder_Q.onnx`/`decoder_Q.onnx` in `onnxruntime-node` and port the pre/post-processing + BCH datalayer to TS (`tm_datalayer.js` already covers decode; the BCH *encoder* must be ported); (d) Python sidecar with the reference package (needed anyway for Video Seal).
- **Mobile decode** [inferred]: the ResNet-50 decoder (≈35 MB fp32, ~4 GFLOPs at 256²) is feasible in `onnxruntime-react-native` 1.24.3 (NNAPI/CoreML EPs) — expect ~50–300 ms per decode on 2023+ phones; untested. Mobile **encode** is plausible (encoder is small, 256² input, but the residual upsample/blend must be re-implemented) — defer to v2.

### 2.3 Video Seal / PixelSeal for images

Video Seal 1.0 (256-bit) and PixelSeal (256-bit) work on images too (`videoseal.load("pixelseal").embed(img)`), with `scaling_w` (default 0.2) and JND attenuation for strength/visibility trade-off [verified README]. Detection = per-bit sign of `preds[:,1:]` plus a detection logit; confidence via bit-accuracy p-value (256 bits at ≥75 % agreement ⇒ p ≈ 2×10⁻¹⁶; at ≥60 % ⇒ 7×10⁻⁴ [computed]). PixelSeal numbers [verified paper]: JPEG-40 0.98, crop-71 % **0.98**, combined **0.91**, H.264 q40 0.90; PSNR 48.9 dB; embedder U-Net 43.8 M params, extractor ConvNeXt-v2-Tiny 33.4 M params. Weakness: "severe cropping, warps" [paper]. No ONNX/CoreML export is provided (TorchScript `y_256b_img.jit` only) [verified]. Note the PyPI release (1.0.1, Jul 2025) predates PixelSeal — install from git.

### 2.4 Capacity vs a 32–64-bit stamp id

- TrustMark: 40 bits (BCH_SUPER, most robust, lowest FPR) or 61 bits (BCH_5). A **40-bit id** (10¹² stamps) is the sweet spot: exactly fills BCH_SUPER and yields an 8-char code.
- PixelSeal/Video Seal: 256 raw bits, no built-in ECC → put `[ver:8][id:40][crc:16]` = 64 bits, repeated 4×, majority-vote on decode [inferred design]; or reserve bits for a truncated HMAC (adds nothing against copy-forgery, see §5).
- WAM: 32 bits — too small for id + redundancy; keep WAM only as a research option for *localized* tamper evidence.

### 2.5 Robustness matrix (best available evidence; bit accuracy unless noted)

| Transform | TrustMark-Q/P | PixelSeal | Video Seal 1.0 | WAM | DWT-DCT(-SVD) | Notes |
|---|---|---|---|---|---|---|
| JPEG q 40–50 | 0.98 (q40/q50) | 0.98 | 0.95 | 1.00 | poor below the embed QF | [verified 2603.12949, 2512.16874] |
| JPEG q 70–85 + 4:2:0 (platform re-encode) | decodes at 70–80 % strength on most platforms | expected ≥0.98 | expected ≥0.95 | — | survives same-QF recompress only | [FAQ; inferred] |
| Resize 0.5× | 0.975 | robust | robust | 256² native | **fails** | [verified; dev.to sim] |
| Centre crop 10 % | 0.968 | — | — | — | fails w/o geometry | |
| Crop to 71 % area | **0.65** | **0.98** | 0.83 | 0.77 | fails | [2512.16874] |
| JPEG40 + crop71 + brightness | 0.52 | 0.91 | 0.69 | 0.62 | fails | |
| Screenshot | OK (FAQ) | likely OK | likely OK | ? | fails (resize) | |
| Print → re-photograph | OK at 1.5× strength | degrades under warps | ? | ? | fails | StegaStamp is the specialist |
| Diffusion edit (InstructPix2Pix strong) | 0.55 | not reported | — | — | — | all ≈ coin-flip [2603.12949] |
| Diffusion regeneration | 12.8 % (2602.20680 snippet) | — | — | — | — | treat as **not survivable** |
| Black-box forgery (WmForger) | forged to 0.61 | — | forged to **0.83** | — | — | [2510.20468] |

### 2.6 Legacy transform-domain libraries — verdict

`invisible-watermark` (dwtDct) is fast (used by Stable Diffusion) and survives same-quality JPEG recompression, but the 2025 dev.to measurement shows DWT+RS **fails on any resize** while TrustMark recovered 10/10 across simulated WhatsApp/WeChat/Telegram/Instagram channels including resizes [unverified but consistent with its design]. `blind_watermark` needs the watermark length and password and only "recovers" from crops when you supply the crop geometry. Neither has a maintained release since 2023. **Do not use them as Stamper's primary invisible layer**; they may serve as a cheap *secondary* redundant mark if you want a non-learned fallback.

---

## 3. Invisible watermarking — video

- **Video Seal** [verified paper/README]: embeds on every **k = 4th frame** and propagates the watermark residual to the following 3 frames ("temporal watermark propagation"); extractor runs per frame and aggregates (`detect_video_and_aggregate`, chunk 16, step 4, `avg`/`squared_avg`/`l1norm_avg`/`l2norm_avg`). Multistage training with differentiable H.264/H.265 in the loop. Robustness on SA-V: identity 0.99, H.264 0.85 (log10 p −15.7), H.264 + 50 % crop + brightness 0.5 **0.73** vs WAM 0.55 / TrustMark 0.51 / MBRS 0.50; PixelSeal reaches 0.90 under H.264 q40.
- **Compute** (Table 6, per second of video, 2× Xeon 6230 + V100) [verified]: embed **1.14 s CPU / 0.42 s GPU**; extract **0.69 s CPU / 0.11 s GPU**; 42.0 GFLOPs embed / 3.1 GFLOPs extract at 256². The GPU path is bottlenecked by CPU↔GPU transfer and CPU-side ops on high-res frames. **Estimate for Stamper** [inferred]: a 1-minute 1080p clip ≈ 70 s on a 40-core Xeon or ≈ 25 s on a V100/L4-class GPU; on a 4-vCPU cloud VM expect 5–15× slower (6–17 min per minute) → run a **GPU worker queue** (T4/L4) and return the marked derivative asynchronously. Extraction for verification costs ~0.7 s per video-second on CPU; sample 1 frame/s for a quick check.
- **Pipeline**: `ffmpeg -i in.mp4 -f rawvideo -pix_fmt rgb24 -` → Python (`inference_streaming.py` style chunked embed) → `ffmpeg -f rawvideo … -i - -i in.mp4 -map 0:v -map 1:a -c:v libx264 -crf 18–23 -c:a copy`. Keep CRF ≤ 23 for the *Stamper-served* derivative; the platforms' re-encode (roughly CRF 28–35 equivalents) is what the 0.85–0.90 figures cover.
- **Per-frame image watermarks**: TrustMark's FAQ says it is "not designed for video"; a per-keyframe TrustMark is only useful as a screenshot-of-video fallback. Adobe registered a video watermark `com.adobe.flowmark.A` (arXiv 2607.05261) in 2026, but no open implementation was found [verified registry entry; availability unverified].
- **On-device video watermarking**: not realistic in 2026 — no mobile export exists, the PixelSeal embedder is 43.8 M params, and the CPU figures above are for a 40-core server. Do it server-side.

---

## 4. C2PA soft bindings and durable Content Credentials

### 4.1 Spec facts (C2PA 2.4, April 2026) [verified from the spec HTML]

- **Assertion `c2pa.soft-binding`** (CDDL `soft-binding-map`): `alg: tstr` (from the C2PA soft binding algorithm list; may be inherited from an enclosing `alg_soft`), `blocks: [1* soft-binding-block-map]` where each block is `{ scope: soft-binding-scope-map, value: bstr }` (value is "in algorithm specific format"); optional `pad`, `pad2`, `name`, `alg-params: bstr`, `bindingMetadata {description, contact, informationalUrl}`, deprecated `url`, `metadata`. Scope: `timespan {start, end}` in ms or `region` (regions-of-interest CDDL); `extent` deprecated. c2pa-rs mirrors this (`SoftBinding { alg, blocks, name, alg_params, pad, pad2 }`, `SoftBindingBlock { scope, value }`).
- **Actions**: `c2pa.watermarked` is **DEPRECATED**; use `c2pa.watermarked.bound` (watermark inserted to create a soft binding — a `c2pa.soft-binding` assertion **shall** be present, else validation fails with `assertion.action.softBindingMissing`) or `c2pa.watermarked.unbound`. 2.4 adds `relatedAssertions` in the action's `parameters` and recommends `.bound` actions reference their soft-binding assertion(s). Region roles `c2pa.watermarked.bound/unbound` exist for spatial/temporal ranges.
- **Manifest Repository** = "a repository into which C2PA Manifests … can be placed, and which can be searched using a content binding". **`c2pa.repository-receipt`** (new in 2.4; only in an *update manifest*) records `repository {uri, manifestId}` and an `anchor {uri…}` proof that a repository ingested the manifest.
- **Soft Binding Resolution API** (supplementary spec since 2.2; `…/2.4/softbinding/Decoupled.html#SBR-API`): query routes `GET|POST /matches/byBinding` (`alg`, `value` base64, `maxResults` default 10, `hintAlg`/`hintValue`, `returnActiveManifest`), `POST /matches/byContent` (upload asset; server extracts bindings), `POST /matches/byReference` (HTTPS URL); fetch routes `GET /manifests/{manifestId}`, `GET|POST /manifests/{manifestId}/receipts`; store routes `POST /manifests`, `POST|PUT /bindings`, `DELETE /manifests/{manifestId}`; `GET /services/supportedAlgorithms`. Responses: `matches[{ manifestId, endpoint?, similarityScore 0–100 }]`. Auth: OAuth 2.0 client-credentials with scopes `fetch:manifests`, `store:bindings`, `store:manifests`; unauthenticated access is allowed by an empty security requirement.
- **Algorithm list** (`c2pa-org/softbinding-algorithm-list`, JSON served at `https://spec.c2pa.org/softbinding-alg-list/softbinding-algorithm-list.json`): 53 entries as of 2026-09 incl. `com.adobe.trustmark.Q` (#4), `.C` (#5), `.P` (#13), fingerprints `io.iscc.v0` (#3, IEP-0020 draft) and `com.adobe.icn.dense` (#6), `com.microsoft.invismark.1`, third-party registrations of Meta's models (`com.aiwatermark.videoseal.1`, `com.aiwatermark.pixelseal.1`, `me.reconize.videoseal.1`), Adobe's `com.adobe.hiermark.A` (audio) and `com.adobe.flowmark.A` (video). Identifiers are reverse-domain namespaced; entries need `identifier, alg, type, entryMetadata` and `decodedMediaTypes` or `encodedMediaTypes`, optionally `softBindingResolutionApis`. **Stamper should register its own ids** (e.g. `<stamper-domain>.pixelseal.1`) via PR rather than reuse another vendor's.

### 4.2 How Adobe binds TrustMark to a manifest [verified from `c2pa/c2pa_watermark_example.py` + Adobe API docs]

```json
{ "label": "c2pa.soft-binding",
  "data": { "alg": "com.adobe.trustmark.Q",
            "blocks": [ { "scope": {}, "value": "2*0110…(68 bits)" } ] } }
```
The value is `"<schema>*<bitstring>"` (schema 2 = BCH_4 in the example); the identifier is random bits generated at signing time; the example appends the (now deprecated) `{"action":"c2pa.watermarked"}` and signs with `c2patool`. Adobe's hosted Soft Binding API takes `hintAlg=com.adobe.trustmark.P` and `hintValue=` base64 of `"2*…"`, `alg=com.adobe.icn.dense` for the fingerprint, `x-api-key` auth. "Signpost" mode: encode `BCH_SUPER` with the integer registry id of a *co-present* proprietary watermark.

### 4.3 The durable-credentials recovery flow (three pillars, CAI blog 2026-01-22) [verified]

metadata (cryptographic, strippable) + watermark (survives platforms, carries an id) + fingerprint (signed in the manifest, "counters watermark spoofing"). Recovery: decode watermark → id → `/matches/byBinding` → fetch manifest → validate signature → compare the manifest's signed fingerprint with the asset in hand → present. Since C2PA 2.2 an ingredient assertion can flag that its manifest was *recovered* via soft binding.

### 4.4 ISCC as the fingerprint soft binding [verified]

`io.iscc.v0` value = ISCC-SEQ bytes (concatenated ISCC-UNITs, each header + 256-bit body, version 0); units compared by Hamming distance of bodies ("unrelated content differs in about half of the bits"); **no threshold is specified** (resolver's choice). Libraries: Python `iscc-core` 1.4.0 (2026-09-24, ISO 24138:2024 reference), `iscc-sdk` (Python 3.11–3.14); polyglot `iscc-lib` (Rust) with **`@iscc/lib` 0.6.0** (napi, Apache-2.0) and **`@iscc/wasm` 0.6.0** — low-level: you must decode pixels (sharp) yourself. Demo: `iscc/iscc-c2pa-demo`.

### 4.5 Node C2PA tooling [verified]

`@contentauth/c2pa-node` **0.9.9** (MIT; lives in the `contentauth/c2pa-js` monorepo with `c2pa-web`, `c2pa-wasm`, `c2pa-types`; prebuilt for Linux x64/arm64, macOS, Windows). `Builder.addAssertion(label, data)`, signers `LocalSigner` (cert + optional TSA), `CallbackSigner` (HSM/KMS), `IdentityAssertionSigner`. The old `c2pa-node` 0.5.26 and `c2pa-node-v2` repo are deprecated/archived.

---

## 5. Attacks and what robustness is realistic in 2026

- **WAVES** (ICML 2024; arXiv 2401.08573 v3) [verified]: 26 attacks (distortions, regeneration incl. VAE/diffusion/rinsing, adversarial embedding/surrogate). Tree-Ring collapses under regeneration and grey-box adversarial attacks; Stable Signature is "completely destroyed" by regeneration; StegaStamp is the most robust overall and only mildly hurt by diffusive regeneration/rinsing (Regen-Diff TPR@0.1 %FPR 0.943; Regen-VAE 1.000).
- **Editing Away the Evidence** (arXiv 2603.12949, 2026) [verified]: conventional post-processing leaves TrustMark/StegaStamp/VINE at >95 %, but InstructPix2Pix at strength 0.4/0.8 → TrustMark 76.1 %/55.0 %, VINE 85.4 %/60.7 %; drag/compose edits 60–79 %. The authors prove information-theoretic decay of low-amplitude watermarks along diffusion trajectories; recommendations: semantic/localised watermarks, diffusion-aware augmentation, in-generator watermarking.
- **Vanishing Watermarks** (arXiv 2602.20680) and **When Denoising Becomes Unsigning** (2603.04696): same conclusion; snippet reports TrustMark 99.9 % → 12.8 % under regeneration and 0 % under guided removal [partially verified via search snippet].
- **What Breaks Local Watermarks** (arXiv 2609.16832, Sep 2026) [verified abstract]: 55 transformations over MaskWM, WAM, OmniGuard, TrustMark, PixelSeal — "geometric misalignment and generative local edits (inpainting/outpainting) can completely impair payload recovery"; signal distortions are tolerated by the strongest methods.
- **WmForger** (NeurIPS 2025 spotlight; code in `videoseal/wmforger`) [verified]: black-box, single-image forging/removal with an image-preference model — forging bit accuracy CIN 100 %, MBRS 83 %, **Video Seal 83 %**, TrustMark 61 %; removal to 49–64 %; ≈31 dB PSNR. Cause: decoders that "tend to ignore the image" (Video Seal) or content-independent patterns (CIN/MBRS) → averaging/transfer attacks work. Defence: content-aware decoders, i.e. *bind the payload to the content* — exactly what a fingerprint check does.
- **Averaging attacks**: same mechanism; per-asset unique payloads reduce but don't eliminate it because the *model* pattern is shared and the models are public (TrustMark ships a remover; anyone can run it) [verified + inferred].
- **Re-watermarking as removal** (arXiv 2605.16796) [title only]: stacking another watermark degrades the first — relevant because TrustMark overwrites an existing TrustMark (single watermark per image) and Adobe apps may re-mark Stamper images.

**Realistic 2026 robustness statement**: an invisible watermark reliably survives *distribution* (JPEG/WebP/H.264 re-encode, resize, screenshot, moderate crop ≤ 20–30 %, brightness/contrast) but **not** *semantic editing* (diffusion edits, inpainting, heavy crops, warps) and **not** a motivated adversary (removal or forgery with public tools). Design for the former; detect the latter by comparing with the original.

**Is "visible code + on-chain registry + perceptual-hash lookup" a sound layered fallback?** Yes, with two precise roles [inferred]:
1. The **registry** (Filecoin EVM) is the trust anchor: stamp id → {CID of original, SHA-256 of original and of the marked derivative, PDQ (32 bytes) / ISCC content code, signer, timestamp}. Nothing about the verdict depends on the watermark being unforgeable; forging an id only points the verifier at an original that will *not* perceptually match the forged content.
2. **Perceptual match is the gate for the strong verdict**: PDQ distance ≤ 31 (Meta's threshold; hashes with quality < 50 discarded) or ISCC Image-Code Hamming distance below a threshold Stamper calibrates. PDQ is designed for resize/compression/minor edits; it is *not* robust to large crops/flips/rotations — so also store the dense-ish signals (ISCC Image-Code, optionally multiple crops' PDQs) and always **show the original side-by-side** so a human can judge. Residual risk: an attacker takes a real stamped photo, makes a small but meaning-changing edit (e.g. a face swap in 5 % of the pixels) that stays within the PDQ threshold, and keeps/re-forges the watermark. Mitigation: never say "authentic" for a non-byte-identical copy — say "matches stamp X within tolerance; compare with original", and make the byte-exact (CID) match the only path to "original".

---

## 6. Recommended layered marking scheme for Stamper

### 6.1 Identifiers

- `stamp_id`: 40-bit, allocated by the registry (sequential or random-with-uniqueness). Short code = 8 Crockford-Base32 chars + 1 check char, shown as `K3Q9-XA2M-7`; QR = `HTTPS://<short-domain>/<8 chars>` (Version 2, ECC M).
- Registry record (FEVM): `stamp_id → { cid_original, sha256_original, sha256_marked, pdq_original (bytes32), iscc_image_or_video (bytes32/bytes), c2pa_manifest_id, signer, ts }`. Perceptual hashes on-chain let anyone re-run the fallback lookup without trusting Stamper's servers.

### 6.2 Layers and where they run

| Layer | Images | Video | Runs on | Why |
|---|---|---|---|---|
| L0 Hard binding | SHA-256 + CID of the untouched capture; device signs `sha256‖stamp_id‖ts` with a device key | same | **Device** | The only step that must happen before bytes leave the phone; everything else is derivable. |
| L1 Visible mark | Skia offscreen badge (pill + code + QR) for the in-app share copy; `sharp` composite for the canonical served derivative | ffmpeg `overlay`+`drawtext` | Device (preview) + **Server** (canonical) | Human-readable lookup key; must be deterministic server-side so `sha256_marked` is reproducible. |
| L2 Invisible watermark | **TrustMark Q, `BCH_SUPER`, 40-bit stamp id**, strength 1.0 (≈43 dB) via Rust CLI/napi or Python sidecar; store `alg=com.adobe.trustmark.Q`, `value="0*<bits>"` | **PixelSeal (fallback Video Seal 1.0)**, 256-bit payload = 4×[ver8‖id40‖crc16], Python GPU worker | **Server** | Survives platform re-encode/resize/screenshot; TrustMark is C2PA-listed and has a browser decoder; video models are Python-only. |
| L3 C2PA manifest | `@contentauth/c2pa-node`: `c2pa.actions` (`c2pa.created`, `c2pa.watermarked.bound` with `relatedAssertions`), `c2pa.soft-binding` ×2 (TrustMark id; `io.iscc.v0` ISCC-SEQ), thumbnail, `c2pa.repository-receipt` (update manifest) pointing at Stamper's repository + on-chain tx | same with the video alg id Stamper registers | **Server** | Interop with any C2PA validator; recovery when metadata is stripped. |
| L4 Perceptual index | PDQ (pdq-wasm / ThreatExchange WASM) + ISCC Image-Code (`@iscc/lib`) of original and marked copies, in a Hamming index (BK-tree/FAISS binary) | vPDQ per-frame (C++/Python; needs FFmpeg libs) + ISCC Video-Code | **Server** (+ browser PDQ for client-side compare) | Lookup when both marks are gone; spoof gate for the strong verdict. |
| Verify (web/app) | 1) bytes → SHA-256/CID → on-chain; 2) C2PA validate (`c2pa-web` WASM); 3) TrustMark **JS decoder** (WebGPU/WASM) → id → registry → fetch original from Filecoin/IPFS → PDQ compare in browser; 4) type/scan the code; 5) server-side PDQ/ISCC nearest-neighbour | 1)+2) same; 3) upload/URL → server Video Seal extract (~0.7 s per video-second CPU) + vPDQ | Browser first, server fallback | Keeps the "trustless" property: a verifier needs only the chain, the IPFS gateway and public models. |

### 6.3 Verdict ladder (what the UI says)

`ORIGINAL` (byte-exact CID match) → `SIGNED DERIVATIVE` (valid C2PA manifest, hard hash matches the marked derivative) → `MATCHES STAMP <id>` (watermark id decodes **and** PDQ ≤ 31 / ISCC within threshold; show side-by-side + distance) → `RELATED TO STAMP <id> — ALTERED` (id decodes or code typed but perceptual mismatch, or perceptual match without id) → `UNKNOWN`.

### 6.4 Library/versions checklist (all verified 2026-09-30)

Server: `sharp` 0.35.5; `qrcode` 1.5.4; `@contentauth/c2pa-node` 0.9.9; `@iscc/lib` 0.6.0; `pdq-wasm` 0.3.9 (community) or ThreatExchange's WASM build; `onnxruntime-node` 1.30.0 (if running TrustMark ONNX in-process); Rust `trustmark` 0.4.0 / PyPI `trustmark` 0.9.2 (torch ≥ 2.3.1); PyPI `videoseal` 1.0.1 (+ git for PixelSeal; torch ≥ 2.3.1, timm 0.9.16); ffmpeg ≥ 6/7 with libx264, libfreetype, and NVENC/VideoToolbox as available. Web: `onnxruntime-web` 1.30.0 + Adobe's `tm_watermark.js`/`tm_datalayer.js`; `c2pa-web`. Mobile: Expo SDK 57, `@shopify/react-native-skia` 2.13.1, `expo-image-manipulator` 57.0.20 (normalisation only), optional `onnxruntime-react-native` 1.24.3 for on-device TrustMark decode.

---

## 7. Open questions / things to test before committing

1. On-device TrustMark decode/encode latency with `onnxruntime-react-native` on mid-range Android (NNAPI) — no published numbers.
2. Redistribution terms of TrustMark model weights served from `cai-watermark.adobe.net` (package is MIT; the CDN listing is 403 to anonymous clients) — confirm you may mirror `encoder_Q.onnx`/`decoder_Q.onnx`.
3. Empirical 2026 platform pipelines (WhatsApp, Instagram, X, TikTok, Telegram) — the only measured data is from 2018 (Twitter/Facebook) and 2025 simulations; build a harness that pushes stamped assets through real apps and records bit accuracy for TrustMark strength 0.8–1.5 and PixelSeal `scaling_w`.
4. Whether to run PixelSeal or Video Seal 1.0 in production (PixelSeal is newer/stronger but Dec-2025; the PyPI package predates it) and GPU cost per minute at Stamper's expected volume.
5. Perceptual thresholds: PDQ ≤ 31 is Meta's generic guidance; ISCC defines none — calibrate on Stamper's own corpus (originals vs platform copies vs edited fakes).
6. C2PA registry entries for Stamper's video watermark id and whether Meta will register an official id for Video Seal/PixelSeal; whether Adobe open-sources `flowmark.A`.
7. Interaction with other watermarkers: TrustMark re-encoding overwrites a prior TrustMark, and any SynthID/Digimarc mark added by platforms is invisible to Stamper — decide how the verdict handles "id not found but perceptual match".

---

## Sources

- TrustMark: https://github.com/adobe/trustmark · FAQ https://github.com/adobe/trustmark/blob/main/FAQ.md · datalayer https://raw.githubusercontent.com/adobe/trustmark/main/python/trustmark/datalayer.py · core https://raw.githubusercontent.com/adobe/trustmark/main/python/trustmark/trustmark.py · C2PA example https://raw.githubusercontent.com/adobe/trustmark/main/c2pa/c2pa_watermark_example.py · JS https://github.com/adobe/trustmark/tree/main/js and https://raw.githubusercontent.com/adobe/trustmark/main/js/tm_watermark.js · Rust https://github.com/adobe/trustmark/tree/main/rust, https://docs.rs/trustmark/latest/trustmark/, https://crates.io/crates/trustmark · PyPI https://pypi.org/project/trustmark/ · paper https://arxiv.org/abs/2311.18297 (ICCV 2025 version: https://openaccess.thecvf.com/content/ICCV2025/papers/Bui_TrustMark_Robust_Watermarking_and_Watermark_Removal_for_Arbitrary_Resolution_Images_ICCV_2025_paper.pdf)
- CAI durable credentials: https://opensource.contentauthenticity.org/docs/durable-cr/ · https://opensource.contentauthenticity.org/docs/durable-cr/trustmark-intro/ · https://opensource.contentauthenticity.org/docs/durable-cr/sb-algs/ · https://opensource.contentauthenticity.org/docs/trustmark/c2pa/ · https://opensource.contentauthenticity.org/docs/trustmark/js/ · blog https://contentauthenticity.org/blog/three-pillars-of-provenance · Adobe Soft Binding API https://developer.adobe.com/cai-soft-binding-api
- C2PA spec 2.4: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html · Soft Binding Resolution API https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html · algorithm list https://github.com/c2pa-org/softbinding-algorithm-list and https://spec.c2pa.org/softbinding-alg-list/softbinding-algorithm-list.json · c2pa-rs soft_binding.rs https://raw.githubusercontent.com/contentauth/c2pa-rs/main/sdk/src/assertions/soft_binding.rs · c2pa-js https://github.com/contentauth/c2pa-js · c2pa-node-v2 (archived) https://github.com/contentauth/c2pa-node-v2 · npm @contentauth/c2pa-node https://www.npmjs.com/package/@contentauth/c2pa-node
- ISCC: IEP-0020 https://ieps.iscc.codes/iep-0020/ · iscc-lib https://github.com/iscc/iscc-lib · iscc-core https://pypi.org/project/iscc-core/ · npm @iscc/lib, @iscc/wasm · demo https://github.com/iscc/iscc-c2pa-demo
- Meta: Video Seal https://github.com/facebookresearch/videoseal · TorchScript https://github.com/facebookresearch/videoseal/blob/main/docs/torchscript.md · PyPI https://pypi.org/project/videoseal/ · paper https://arxiv.org/abs/2412.09492 · PixelSeal https://arxiv.org/abs/2512.16874 · ChunkySeal https://arxiv.org/abs/2510.12812 · WmForger https://arxiv.org/abs/2510.20468 · WAM https://github.com/facebookresearch/watermark-anything and https://arxiv.org/abs/2411.07231 · OmniSealBench https://github.com/facebookresearch/omnisealbench · Stable Signature https://arxiv.org/abs/2303.15435
- Legacy: StegaStamp https://github.com/tancik/StegaStamp · HiDDeN https://github.com/ando-khachatryan/HiDDeN · RivaGAN https://github.com/DAI-Lab/RivaGAN · invisible-watermark https://github.com/ShieldMnt/invisible-watermark and https://pypi.org/project/invisible-watermark/ · blind_watermark https://github.com/guofei9987/blind_watermark and https://pypi.org/project/blind-watermark/
- Attacks: WAVES https://arxiv.org/abs/2401.08573 · Editing Away the Evidence https://arxiv.org/abs/2603.12949 · Vanishing Watermarks https://arxiv.org/abs/2602.20680 · When Denoising Becomes Unsigning https://arxiv.org/abs/2603.04696 · What Breaks Local Watermarks https://arxiv.org/abs/2609.16832 · Watermarks Attack Watermarks https://arxiv.org/abs/2605.16796
- Platform pipelines: Chuman et al. https://arxiv.org/abs/1810.02062 · dev.to simulated chat-app channels (unverified) https://dev.to/harrisonsec/why-hidden-data-dies-in-chat-apps-lsb-vs-a-robust-watermark-measured-1n64
- Visible mark tooling: sharp composite https://sharp.pixelplumbing.com/api-composite/ · npm sharp · ffmpeg filters https://ffmpeg.org/ffmpeg-filters.html · FFmpeg Changelog https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/Changelog · overlay_cuda/videotoolbox patches https://ffmpeg.org/pipermail/ffmpeg-devel/2020-April/259469.html, https://ffmpeg.org/pipermail/ffmpeg-devel/2024-March/322822.html · FFmpegKit (archived) https://github.com/arthenica/ffmpeg-kit · FFmpegKitNext https://github.com/arthenica/ffmpeg-kit-next · react-native-skia https://shopify.github.io/react-native-skia/ (offscreen docs mirror https://mintlify.wiki/shopify/react-native-skia/canvas/offscreen) · Expo Skia https://docs.expo.dev/versions/latest/sdk/skia/ · expo-image-manipulator https://docs.expo.dev/versions/latest/sdk/imagemanipulator/ · react-native-image-marker https://github.com/JimmyDaddy/react-native-image-marker · node-qrcode https://www.npmjs.com/package/qrcode · react-native-qrcode-skia https://www.npmjs.com/package/react-native-qrcode-skia · QR ECC https://www.qrcode.com/en/about/error_correction.html · QR module size https://www.qrcode.com/en/howto/cell.html · Crockford Base32 https://www.crockford.com/base32.html
- Perceptual hashing: PDQ https://github.com/facebook/ThreatExchange/tree/main/pdq · vPDQ https://github.com/facebook/ThreatExchange/tree/main/vpdq · npm pdq-wasm, sharp-phash
- Runtimes: npm onnxruntime-node, onnxruntime-web, onnxruntime-react-native
- SynthID status (secondary): https://techcabal.com/2026/06/25/what-is-synthid-and-how-does-it-detect-ai-generated-images/
