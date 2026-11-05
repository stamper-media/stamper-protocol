# infra — Compose, Caddy, env, secrets, deploy and ops scripts (WP-11)

The single-VPS deployment of DESIGN §9.5, the local dev profile, and the scripts that chain
contracts → ABI → roles → FOC bootstrap. Not a pnpm package; it needs only bash, docker compose v2,
Node 22 and (for deploys) foundry.

## Files
| Path | What |
|---|---|
| `docker-compose.yml` | prod: caddy, web, api (`ROLE=api`, the only service with secrets), worker (`ROLE=worker`, no secrets), ml (4 CPUs), postgres (pgvector pg17), backup (offen → S3, nightly `pg_dump`) |
| `docker-compose.dev.yml` | profile `dev`: anvil (`--block-time 1`), postgres, ml, mock-sp (`@stamper/foc` piece server), caddy `tls internal`; api/worker/web run on the host |
| `Caddyfile`, `Caddyfile.dev`, `caddy/routes.caddy` | TLS + HSTS preload; `/v1/*`, `/.well-known/*`, `/m/*`, `/healthz` → api; rest → web; 500 MB uploads, 100 MB verify uploads, 2 MB other API bodies; `/metrics` never public |
| `.env.example` | every variable of every package (dev-safe defaults, `PROD:` notes); copy to `infra/.env` |
| `secrets/` | Docker-secret templates + README (relayer, registrar, FOC session, resolver owner, record wrap key, Play SA JSON) |
| `env/` | generated `<net>.json` / `<net>.env` from the deploy scripts (git-ignored) |
| `scripts/deploy-calibration.sh` | `Deploy.s.sol` → Blockscout source publication → `pnpm abi` → `Roles.s.sol` → 48 h activation times → `env/calibration.env`; `--dry-run` does the same on anvil; `--verify-only` (re)publishes the recorded deployment (no keys, no RPC) |
| `scripts/deploy-mainnet.sh` | same with `--ledger`/`--trezor`, two typed confirmations, refuses if `deployments/mainnet.json` exists or `DEPLOYER_PK` is set; `--simulate`, `--verify-only` |
| `scripts/lib/blockscout.mjs` | `verify_on_blockscout` helper: constructor args from Blockscout's indexed creation input (and a check that the local build is its prefix), then waits until the v2 API reports `is_verified` under the expected contract name |
| `scripts/foc-bootstrap.sh` | laptop payer ceremony: select-providers → create-data-sets → session-login; writes `FOC_*` |
| `scripts/foc-session-rotate.sh` | `generate` / `login` / `activate` / `revoke` / `cleanup` (alias `rotate-session-key.sh`) |
| `scripts/vps-bootstrap.sh` | Docker + compose plugin, ufw 22/80/443, swap, volumes, healthcheck cron (`--dry-run`) |
| `scripts/healthcheck.sh` | scrapes api/worker `/metrics`, thresholds, ntfy |
| `scripts/smoke.sh` | integration test of the dev profile (see below) |
| `scripts/check-env.mjs` | asserts `.env.example` ⊇ every env key the code reads |
| `scripts/backup-restore.md`, `runbooks/*.md` | operations |

## Deploy (fresh VPS)
`sudo infra/scripts/vps-bootstrap.sh` → `cp infra/.env.example infra/.env` (set `COMPOSE_PROFILES=prod`,
`DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, `BACKUP_S3_*`, `NTFY_URL`, merge `env/<net>.env`) →
fill `infra/secrets/` → `docker compose -f infra/docker-compose.yml up -d`.

## Dev
`docker compose -f infra/docker-compose.dev.yml --profile dev up -d`, then `pnpm dev` for api/worker/web
with `infra/.env`. All host ports bind 127.0.0.1 and come from `DEV_*_PORT`, `MOCK_SP_PORT`, `API_PORT`,
`WEB_PORT`. On a shared host set `STAMPER_HEAVY_LOCK` / `STAMPER_PNPM_LOCK` to flock files.

## Blockscout source publication
Both deploy scripts publish sources as a separate step after the broadcast (`verify_on_blockscout` in
`scripts/lib/common.sh`): `forge verify-contract --skip-is-verified-check --watch` per contract, then a check
of `GET <explorer>/api/v2/smart-contracts/<addr>` until `is_verified` is true under the expected name. A
failure is printed in red at once, the remaining steps still run, and the script exits non-zero at the end;
`--verify-only` retries it. Forge's own "already verified" check is skipped because Filecoin Blockscout serves
an unrelated verified twin for fresh FEVM contracts (docs/spikes/blockscout-verification.md). Knobs:
`BLOCKSCOUT_URL` / `MAINNET_BLOCKSCOUT_URL`, `VERIFY_INDEX_TIMEOUT_S` (900), `VERIFY_STATUS_TIMEOUT_S` (180),
`VERIFY_POLL_INTERVAL_S` (15). `STAMPER_CONTRACTS_DIR` points the scripts at another foundry tree (tests).

## Tests
```sh
node --test infra/test/*.test.mjs  # compose prod+dev, caddy validate, shellcheck/bash -n, env superset,
                                   # healthcheck thresholds, vps-bootstrap dry run, deploy dry run on anvil,
                                   # --verify-only against a mock Blockscout + stub forge
infra/scripts/smoke.sh             # compose up (dev) → deploy dry run → host api → https://localhost/healthz,
                                   # /v1/health/storage, ml /health, mock-sp /piece/<cid> 404 → down -v
```
`SHELLCHECK=/path/to/shellcheck` enables shellcheck when it is not on PATH. Tests skip with a reason when
docker, forge or anvil are missing. smoke.sh options: `SMOKE_SKIP_ML=1`, `SMOKE_SKIP_API=1`,
`ML_IMAGE=<prebuilt>`, `SMOKE_PROJECT=<compose project>`.

## Stubbed / needs credentials
Calibration and mainnet deploys, FOC ceremonies, ntfy and S3 backups need real
keys, funds and buckets; they are implemented but only the anvil dry run, compose validation and the
smoke test run locally. Blockscout publication needs no key: the Calibration registry and resolver were published on
2026-10-01 and `deploy-calibration.sh --verify-only` confirms it. healthcheck metric names other than `stamper_jobs_*` are a contract with the api
(`stamper_queue_oldest_age_seconds`, `stamper_tx_latency_seconds_max`, `stamper_probe_failures`,
`stamper_runway_days`; override with `HC_METRIC_*`); absent metrics never alert.
