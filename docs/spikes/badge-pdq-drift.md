# Spike: badge-vs-PDQ drift (WP-04 seed)

**Status (2026-10-01): not run on this host.** `python3 -c "import pdqhash"` fails with
`ModuleNotFoundError: No module named 'pdqhash'`. The rules forbid global pip installs, and the
`services/ml` venv/container (WP-05) did not exist yet when WP-04 was built, so no PDQ implementation
was available to measure.

## What will produce the number

`packages/marking/test/ml.int.test.ts`, gated on `ML_URL` (a running `services/ml`):

1. Synthetic 1600×1200 JPEG → `applyBadgeImage` (F1).
2. TrustMark Q encode with payload = the 40-bit code value, then decode → the same 40 bits.
3. `hamming(pdq(original), pdq(marked + watermarked))`. Acceptance: ≤ 15 bits. The value is
   printed as `badge-vs-PDQ drift (hamming) = N`.
4. JPEG q80 + 0.75× downscale (sharp), decode still returns the code.

Run: `ML_URL=http://127.0.0.1:<port> pnpm --filter @stamper/marking test:ml`

## Results

| Date | Fixture | Family | Drift (bits) | Notes |
|---|---|---|---|---|
| — | — | — | — | pending the first run against the ml container |

The week-6 tuning should replace the synthetic fixture with real captures (portrait, landscape,
low-texture) and record drift per badge family and per short side.
