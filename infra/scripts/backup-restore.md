# Backups and restore

`backup` (offen/docker-volume-backup) runs nightly (`BACKUP_CRON_EXPRESSION`, default 03:30 UTC). Before
each archive it execs `pg_dump -Fc` in the postgres container into the `pgdump` volume (label
`docker-volume-backup.archive-pre`), then uploads `pgdump` + `staging` as
`stamper-<timestamp>.tar.gz[.gpg]` to `BACKUP_S3_BUCKET` and prunes after `BACKUP_RETENTION_DAYS`.
Originals are also in the off-box mirror bucket and in two FOC data sets, so `staging` is a convenience.

## Manual backup
`docker compose -f infra/docker-compose.yml exec backup backup`

## Restore (fresh VPS)
1. `vps-bootstrap.sh`, `.env`, `secrets/` (from your password manager, never from the backup).
2. `docker compose -f infra/docker-compose.yml up -d postgres`
3. Download and unpack the archive (decrypt with `gpg -d` if `BACKUP_GPG_PASSPHRASE` was set).
4. `docker compose -f infra/docker-compose.yml exec -T postgres pg_restore -U stamper -d stamper --clean --if-exists < backup/pgdump/stamper.dump`
5. Optional: copy `backup/staging/*` into the `stamper_staging` volume.
6. `docker compose -f infra/docker-compose.yml up -d` and check `/status` and `/v1/health/storage`.

Test a restore into a scratch VPS once per quarter.
