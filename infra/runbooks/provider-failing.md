# Runbook: storage provider failing

Signals: probe failures (healthcheck `probe failures`), FilBeam 402/5xx, `FaultRecord` events,
`/v1/health/storage` amber/red.

1. Is it retrieval only (SLO miss) or data loss? `curl -I <serviceURL>/piece/<cid>` for a few recent
   pieces; compare with `pdp-monitor` (`getDataSetLastProvenEpoch`, `provenThisPeriod`).
2. Retrieval only: nothing to do on-chain; the api serves from the other provider or the mirror. Contact
   the provider; note it on `/status` if it lasts over an hour.
3. Proof faults or 3 days of probe failures: run [repair-reupload.md](repair-reupload.md).
4. Data set terminated: stop committing to it (set the replacement `FOC_DATASET_*` first), then repair.
