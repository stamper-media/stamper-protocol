# Runbook: repair re-upload (provider lost pieces)

Trigger: `retrieval-probe` failures for a bound provider for 3 days (ntfy "repair needed"), or
`/v1/health/storage` shows a dead data set (`DataSetDeleted`, `PDPPaymentTerminated`, `ServiceTerminated`).
PDP proofs alone do not catch lost single pieces; retrieval probes are the signal (DESIGN §5.4).

1. **Confirm**: fetch the piece from the provider (`curl -I <serviceURL>/piece/<pieceCid>`) and from
   the other bound provider. The mirror keeps serving originals meanwhile (`/m/*`, hash-checked).
2. **Pick a replacement provider** (laptop): `infra/scripts/foc-bootstrap.sh --env-file infra/env/<net>.env`
   without `--provider-*` prints the ranking. Choose an approved provider not already holding the stamp.
3. **Create the third data set** (laptop, payer key): `pnpm --filter @stamper/foc exec tsx
   scripts/create-data-sets.ts --provider-a <keep> --provider-b <new> …`; it reuses the existing A set and
   prints the new `FOC_DATASET_B_ID`. Update `infra/.env`, `docker compose up -d --force-recreate api worker`.
4. **Re-upload** affected originals from the mirror into the new set; the worker's store/commit path does
   this when the stamp's jobs are re-queued (`store` → `commit` → `bind`). Check bytes by `sha256` and
   `pieceCid` before commit; never re-encode.
5. **Bind again**: `bindStorage` reuses the dead slot (`StorageUnbound` keeps history); nothing in the
   registry is edited. `bindingStatus(…).cidMatches` must be true for the new slot.
6. Watch probes for 24 h, then close the incident. If the old provider recovers, leave its binding as is.
