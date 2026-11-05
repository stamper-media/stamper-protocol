#!/usr/bin/env bash
# Cron healthcheck (every 5 min, installed by vps-bootstrap.sh): scrape api + worker /metrics from
# inside their containers, compare with thresholds, post alerts to ntfy.
#
# Env: NTFY_URL (no URL → print only), DOMAIN (also probes https://$DOMAIN/healthz),
#      HC_MAX_QUEUE_AGE_S=600 HC_MAX_TX_LATENCY_S=300 HC_MAX_PROBE_FAILURES=0 HC_MIN_RUNWAY_DAYS=60
#      HC_METRIC_QUEUE_AGE / HC_METRIC_TX_LATENCY / HC_METRIC_PROBE_FAILURES / HC_METRIC_RUNWAY_DAYS
#      override the metric names. METRICS_FILE=<file> skips scraping (tests). --dry-run never posts.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
if [[ -f "${INFRA_DIR}/.env" ]]; then
  # Read only the keys this script needs; never source the whole file.
  for k in NTFY_URL DOMAIN HC_MAX_QUEUE_AGE_S HC_MAX_TX_LATENCY_S HC_MAX_PROBE_FAILURES HC_MIN_RUNWAY_DAYS; do
    if [[ -z "${!k:-}" ]]; then
      v="$(grep -E "^${k}=" "${INFRA_DIR}/.env" | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" || true
      [[ -z "$v" ]] || export "$k=$v"
    fi
  done
fi

Q_MAX="${HC_MAX_QUEUE_AGE_S:-600}" TX_MAX="${HC_MAX_TX_LATENCY_S:-300}"
PF_MAX="${HC_MAX_PROBE_FAILURES:-0}" RUNWAY_MIN="${HC_MIN_RUNWAY_DAYS:-60}"
M_Q="${HC_METRIC_QUEUE_AGE:-stamper_queue_oldest_age_seconds}"
M_TX="${HC_METRIC_TX_LATENCY:-stamper_tx_latency_seconds_max}"
M_PF="${HC_METRIC_PROBE_FAILURES:-stamper_probe_failures}"
M_RW="${HC_METRIC_RUNWAY_DAYS:-stamper_runway_days}"

scrape() {
  docker compose -f "${INFRA_DIR}/docker-compose.yml" exec -T "$1" node -e \
    "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/metrics').then(r=>r.text()).then(t=>process.stdout.write(t),()=>process.exit(1))"
}

alerts=()
if [[ -n "${METRICS_FILE:-}" ]]; then
  metrics="$(cat "$METRICS_FILE")"
else
  metrics=""
  for svc in api worker; do
    if m="$(scrape "$svc" 2>/dev/null)"; then metrics+=$'\n'"$m"; else alerts+=("$svc: /metrics unreachable"); fi
  done
  if [[ -n "${DOMAIN:-}" && "${DOMAIN}" != localhost ]]; then
    curl -fsS -m 10 -o /dev/null "https://${DOMAIN}/healthz" || alerts+=("https://${DOMAIN}/healthz failing")
  fi
fi

# max <metric>: largest sample value across label sets; empty when absent.
max() {
  awk -v m="$1" '$1 !~ /^#/ { n=$1; sub(/\{.*/, "", n); if (n == m) { if (!seen || $NF+0 > best) best = $NF+0; seen = 1 } }
    END { if (seen) print best }' <<<"$metrics"
}
min() {
  awk -v m="$1" '$1 !~ /^#/ { n=$1; sub(/\{.*/, "", n); if (n == m) { if (!seen || $NF+0 < best) best = $NF+0; seen = 1 } }
    END { if (seen) print best }' <<<"$metrics"
}
gt() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a+0 > b+0) }'; }

v="$(max "$M_Q")"; [[ -n "$v" ]] && gt "$v" "$Q_MAX" && alerts+=("queue age ${v}s > ${Q_MAX}s")
v="$(max "$M_TX")"; [[ -n "$v" ]] && gt "$v" "$TX_MAX" && alerts+=("tx latency ${v}s > ${TX_MAX}s")
v="$(max "$M_PF")"; [[ -n "$v" ]] && gt "$v" "$PF_MAX" && alerts+=("probe failures ${v} > ${PF_MAX}")
v="$(min "$M_RW")"; [[ -n "$v" ]] && gt "$RUNWAY_MIN" "$v" && alerts+=("USDFC runway ${v} d < ${RUNWAY_MIN} d")

if [[ ${#alerts[@]} -eq 0 ]]; then
  echo "ok"
  exit 0
fi
msg="$(printf '%s\n' "${alerts[@]}")"
printf 'ALERT\n%s\n' "$msg"
if [[ $DRY -eq 0 && -n "${NTFY_URL:-}" ]]; then
  curl -fsS -m 10 -H "Title: Stamper alert" -H "Priority: high" -d "$msg" "$NTFY_URL" >/dev/null ||
    warn "ntfy post failed"
fi
exit 1
