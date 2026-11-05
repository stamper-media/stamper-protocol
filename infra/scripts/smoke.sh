#!/usr/bin/env bash
# Integration smoke test of the dev profile on this machine:
#   docker compose --profile dev up (anvil, postgres, ml, mock-sp, caddy tls internal)
#   → deploy-calibration.sh --dry-run against the compose anvil
#   → api on the host (ROLE=api, FOC_MODE=mock, ATTEST_MODE=stub, throwaway anvil keys)
#   → wait for https://localhost:<port>/healthz, /v1/health/storage, ml /health, mock-sp /piece/<cid> 404
#   → docker compose down -v (always, also on failure).
# Env: every host port may be preset (DEV_ANVIL_PORT DEV_PG_PORT DEV_ML_PORT DEV_HTTPS_PORT DEV_MOCK_SP_PORT MOCK_SP_PORT
# API_PORT); unset ones get a free random port. SMOKE_PROJECT (compose project, default stamper-smoke),
# SMOKE_SKIP_ML=1, SMOKE_SKIP_API=1, ML_IMAGE (reuse a built ml image instead of building).
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
need_cmd docker curl node python3

free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
for k in DEV_ANVIL_PORT DEV_PG_PORT DEV_ML_PORT DEV_HTTPS_PORT DEV_MOCK_SP_PORT MOCK_SP_PORT API_PORT; do
  [[ -n "${!k:-}" ]] || export "$k=$(free_port)"
done
export WEB_PORT="${WEB_PORT:-$(free_port)}"
PROJECT="${SMOKE_PROJECT:-stamper-smoke}"
TMP="$(mktemp -d)"
export DEV_STAGING_DIR="$TMP/staging" MOCK_SP_DIR="$TMP/mock-sp"
mkdir -p "$DEV_STAGING_DIR" "$MOCK_SP_DIR" "$TMP/secrets" "$TMP/env"
API_PID=""
compose() { docker compose -p "$PROJECT" -f "${INFRA_DIR}/docker-compose.dev.yml" --profile dev "$@"; }
cleanup() {
  local rc=$?
  [[ -z "$API_PID" ]] || kill "$API_PID" 2>/dev/null || true
  [[ -z "$API_PID" ]] || wait "$API_PID" 2>/dev/null || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP"
  if [[ $rc -eq 0 ]]; then log "smoke: PASS"; else warn "smoke: FAIL (rc=$rc)"; fi
}
trap cleanup EXIT

services=(anvil postgres mock-sp caddy)
[[ "${SMOKE_SKIP_ML:-0}" == 1 ]] || services+=(ml)
log "compose up (${services[*]}) project=$PROJECT"
compose up -d --quiet-pull --wait --wait-timeout 300 "${services[@]}" >"$TMP/compose.log" 2>&1 ||
  { tail -20 "$TMP/compose.log" >&2; die "compose up failed"; }

export ANVIL_RPC_URL="http://127.0.0.1:${DEV_ANVIL_PORT}"
"${INFRA_DIR}/scripts/deploy-calibration.sh" --dry-run --out-dir "$TMP/env"

wait_http() { # wait_http <url> <expected-code> [curl args…]
  local url=$1 want=$2 code _
  shift 2
  for _ in $(seq 1 90); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$@" "$url" || true)"
    [[ "$code" == "$want" ]] && { log "ok $want $url"; return 0; }
    sleep 1
  done
  warn "$url: expected $want, last $code"
  return 1
}

if [[ "${SMOKE_SKIP_API:-0}" != 1 ]]; then
  # Throwaway anvil keys (public test keys): relayer = binder #2, registrar #1, resolver owner #3.
  printf '%s' 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a >"$TMP/secrets/relayer_pk"
  printf '%s' 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d >"$TMP/secrets/registrar_pk"
  printf '%s' 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 >"$TMP/secrets/resolver_owner_pk"
  printf '0x%s' "$(openssl rand -hex 32)" >"$TMP/secrets/foc_session_pk"
  openssl rand -hex 32 >"$TMP/secrets/record_wrap_key"
  printf '{}' >"$TMP/secrets/play_sa.json"
  log "api on the host :$API_PORT"
  (
    set -a
    # shellcheck disable=SC1091
    . "$TMP/env/anvil.env"
    set +a
    export ROLE=api HOST=0.0.0.0 PORT="$API_PORT" LOG_LEVEL=warn
    export DATABASE_URL="postgres://stamper:${DEV_PG_PASSWORD:-stamper}@127.0.0.1:${DEV_PG_PORT}/stamper"
    export FOC_MODE=mock ATTEST_MODE=stub FOC_DATASET_A_ID=1 FOC_DATASET_B_ID=2
    export FOC_DATASET_A_PROVIDER_ID=1 FOC_DATASET_B_PROVIDER_ID=2 FOC_RPC_URL="$ANVIL_RPC_URL"
    export STAGING_DIR="$DEV_STAGING_DIR" CACHE_DIR="$TMP/cache" MODELS_DIR="$TMP/models"
    export PUBLIC_BASE_URL="https://localhost:${DEV_HTTPS_PORT}" VERIFY_BASE_URL="https://localhost:${DEV_HTTPS_PORT}"
    export RELAYER_PK_FILE="$TMP/secrets/relayer_pk" REGISTRAR_PK_FILE="$TMP/secrets/registrar_pk"
    export RESOLVER_OWNER_PK_FILE="$TMP/secrets/resolver_owner_pk" FOC_SESSION_PK_FILE="$TMP/secrets/foc_session_pk"
    export RECORD_WRAP_KEY_FILE="$TMP/secrets/record_wrap_key" PLAY_SA_JSON_FILE="$TMP/secrets/play_sa.json"
    cd "${STAMPER_SERVICES_DIR:-${REPO_ROOT}/../stamper-services}/services/api"
    exec ./node_modules/.bin/tsx src/main.ts
  ) >"$TMP/api.log" 2>&1 &
  API_PID=$!
  wait_http "http://127.0.0.1:${API_PORT}/healthz" 200 || { tail -20 "$TMP/api.log" >&2; exit 1; }
  wait_http "https://localhost:${DEV_HTTPS_PORT}/healthz" 200 -k || die "caddy → api failed"
  wait_http "https://localhost:${DEV_HTTPS_PORT}/v1/health/storage" 200 -k || die "/v1/health/storage failed"
  body="$(curl -sk -m 10 "https://localhost:${DEV_HTTPS_PORT}/v1/health/storage")"
  grep -q '"1"\|: *1[,}]' <<<"$body" || die "/v1/health/storage does not list mock data set 1: ${body:0:200}"
fi

[[ "${SMOKE_SKIP_ML:-0}" == 1 ]] || wait_http "http://127.0.0.1:${DEV_ML_PORT}/health" 200 || die "ml /health failed"
cid="$(cd "${REPO_ROOT}/packages/foc" && node --input-type=module -e \
  'import * as P from "@filoz/synapse-core/piece"; process.stdout.write(String(await P.calculate(new Uint8Array(127))))')"
wait_http "http://127.0.0.1:${DEV_MOCK_SP_PORT}/piece/${cid}" 404 || die "mock-sp /piece/ check failed"
