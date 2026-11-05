#!/usr/bin/env bash
# FOC payer ceremony (laptop only; the payer key never reaches the VPS). Runs @stamper/foc scripts:
#   select-providers → create-data-sets → session-login, and writes FOC_* into an env file.
#
# Usage (export FOC_PAYER_PK in this shell only, then unset it):
#   FOC_PAYER_PK=0x… FOC_PAYER_ADDRESS=0x… FOC_CHAIN_ID=314159 [FOC_RPC_URL=…] \
#   infra/scripts/foc-bootstrap.sh --env-file infra/env/calibration.env \
#     --provider-a <id> --provider-b <id> --session-address 0x… \
#     [--deposit 5] [--rate-allowance 1] [--lockup-allowance 20] [--days 7] [--dataset-env prod]
# Without --provider-a/--provider-b it prints the provider ranking and stops so you can choose.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ENV_FILE="" PA="" PB="" SESSION="${FOC_SESSION_ADDRESS:-}" DEPOSIT=5 RATE=1 LOCKUP=20 DAYS=7 DSENV=prod
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?}"; shift ;;
    --provider-a) PA="${2:?}"; shift ;;
    --provider-b) PB="${2:?}"; shift ;;
    --session-address) SESSION="${2:?}"; shift ;;
    --deposit) DEPOSIT="${2:?}"; shift ;;
    --rate-allowance) RATE="${2:?}"; shift ;;
    --lockup-allowance) LOCKUP="${2:?}"; shift ;;
    --days) DAYS="${2:?}"; shift ;;
    --dataset-env) DSENV="${2:?}"; shift ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
need_cmd pnpm awk
need_env FOC_CHAIN_ID FOC_PAYER_ADDRESS
[[ -n "$ENV_FILE" ]] || die "--env-file is required"
is_address "$FOC_PAYER_ADDRESS" || die "FOC_PAYER_ADDRESS is not an address"
[[ "$FOC_CHAIN_ID" == 314159 || "$FOC_CHAIN_ID" == 314 ]] || die "FOC_CHAIN_ID must be 314159 or 314"

foc() { (cd "${REPO_ROOT}/packages/foc" && ./node_modules/.bin/tsx "scripts/$1.ts" "${@:2}"); }

if [[ -z "$PA" || -z "$PB" ]]; then
  log "select-providers (ranked by /piece/ latency)"
  foc select-providers
  log "re-run with --provider-a <id> --provider-b <id> (two different providers; A should offer CDN)"
  exit 0
fi
[[ "$PA" =~ ^[0-9]+$ && "$PB" =~ ^[0-9]+$ ]] || die "provider ids must be integers"
[[ "$PA" != "$PB" ]] || die "data sets A and B need different providers"
need_env FOC_PAYER_PK
[[ -n "$SESSION" ]] || die "--session-address (or FOC_SESSION_ADDRESS) is required"
is_address "$SESSION" || die "session address is not an address"

log "create-data-sets (deposit $DEPOSIT, rate $RATE, lockup $LOCKUP)"
out="$(foc create-data-sets --provider-a "$PA" --provider-b "$PB" --env "$DSENV" \
  --deposit "$DEPOSIT" --rate-allowance "$RATE" --lockup-allowance "$LOCKUP" | tee /dev/stderr)"
dsa="$(grep -oE 'FOC_DATASET_A_ID=[0-9]+' <<<"$out" | tail -1 | cut -d= -f2)"
dsb="$(grep -oE 'FOC_DATASET_B_ID=[0-9]+' <<<"$out" | tail -1 | cut -d= -f2)"
[[ -n "$dsa" && -n "$dsb" ]] || die "create-data-sets did not print both data set ids"

log "session-login for $SESSION ($DAYS days, AddPieces only)"
foc session-login --session-address "$SESSION" --days "$DAYS"

upsert_env "$ENV_FILE" FOC_MODE real
upsert_env "$ENV_FILE" FOC_CHAIN_ID "$FOC_CHAIN_ID"
[[ -z "${FOC_RPC_URL:-}" ]] || upsert_env "$ENV_FILE" FOC_RPC_URL "$FOC_RPC_URL"
upsert_env "$ENV_FILE" FOC_PAYER_ADDRESS "$FOC_PAYER_ADDRESS"
upsert_env "$ENV_FILE" FOC_DATASET_A_ID "$dsa"
upsert_env "$ENV_FILE" FOC_DATASET_A_PROVIDER_ID "$PA"
upsert_env "$ENV_FILE" FOC_DATASET_B_ID "$dsb"
upsert_env "$ENV_FILE" FOC_DATASET_B_PROVIDER_ID "$PB"
upsert_env "$ENV_FILE" FOC_SESSION_ADDRESS "$SESSION"
log "wrote FOC_* to $ENV_FILE. Now: unset FOC_PAYER_PK; schedule foc-session-rotate.sh weekly."
