# Spike: TrustMark weights mirroring and encode/decode time (WP-05, 2026-10-01)

## Weights
- The `trustmark` 0.9.2 package (MIT) ships no weights. It downloads them on first use from `https://cai-watermark.adobe.net/watermarking/trustmark-models/`.
- **Outcome on 2026-10-01:** the CDN answered HTTP 200 to anonymous `curl` and Python `urllib` for `trustmark_Q.yaml` (2 KB), `encoder_Q.ckpt` (17.3 MB) and `decoder_Q.ckpt` (47.7 MB). All md5 values match the `MODEL_CHECKSUMS` in the package. The 403 described in DESIGN §13.12 was not seen on this day.
- The remover and bbox-detector checkpoints are not needed (`loadRemover=False`).
- `services/ml/scripts/fetch-weights.py` mirrors the three files into `MODELS_DIR` at Docker build time. It tries `TRUSTMARK_WEIGHTS_URL` (our own mirror) first, then the CDN, and checks md5 before an atomic write. The service never downloads at request time, because `check_and_download` is overridden.
- **Open item:** the redistribution terms for the weights still need confirming before we host our own mirror (DESIGN §13.12). The fallback, if the CDN refuses, is an ONNX export from the MIT weights. Until then, `ML_WATERMARK=auto` degrades to the null watermark.

## Timing (host CPU, `torch.set_num_threads(4)`, torch 2.10.0+cpu, Q / BCH_SUPER, strength 1.0)
| Image | Encode | Decode |
|---|---|---|
| 1024×768 | 0.21 s | 0.07 s |
| 4000×3000 (12 MP) | 0.50 s | 0.08 s |

Encode stays under the 1.5 s acceptance budget for 12 MP. The model runs at 256² for encode and 245² for decode, and the residual is upscaled. Most of the 12 MP cost is the resize and merge.

## Robustness seen in tests
- 50 of 50 random 40-bit payloads round-trip on the 1024×768 fixture.
- Round trip through JPEG q75 and a 0.6× resize: the payload is decoded.
- Unmarked images decode to `ok:false`.
- Docker image (`python:3.12-slim`, `--cpus 4`): `/health` answered 5 s after start.
