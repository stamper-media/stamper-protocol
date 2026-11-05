#!/usr/bin/env bash
# Weekly FOC session-key rotation (and emergency revoke). The key lives only in the api's Docker
# secret on the VPS; the payer signs on a laptop. Run the steps in order:
#
#   [VPS]    foc-session-rotate.sh generate           # new key → secrets/foc_session_pk.next, prints address
#   [laptop] FOC_PAYER_PK=0x… foc-session-rotate.sh login  --address <new>   # session-login (AddPieces, 7 d)
#   [VPS]    foc-session-rotate.sh activate           # swap secret, recreate api, prints old address
#   [laptop] FOC_PAYER_PK=0x… foc-session-rotate.sh revoke --address <old>   # session-revoke
#   [VPS]    foc-session-rotate.sh cleanup            # shred the previous key file
#
# Emergency (key suspected leaked): run `revoke --address <current>` first, then the full rotation.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SECRETS="${SECRETS_DIR:-${INFRA_DIR}/secrets}"
CUR="${SECRETS}/foc_session_pk" NEXT="${SECRETS}/foc_session_pk.next" PREV="${SECRETS}/foc_session_pk.prev"
cmd="${1:-}"
shift || true
ADDR="" DAYS=7
while [[ $# -gt 0 ]]; do
  case "$1" in
    --address) ADDR="${2:?}"; shift ;;
    --days) DAYS="${2:?}"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

addr_of() { cast wallet address --private-key "$(cat "$1")"; }
foc() { (cd "${REPO_ROOT}/packages/foc" && ./node_modules/.bin/tsx "scripts/$1.ts" "${@:2}"); }
compose() { docker compose -f "${INFRA_DIR}/docker-compose.yml" "$@"; }

case "$cmd" in
  generate)
    need_cmd cast node
    [[ ! -e "$NEXT" ]] || die "$NEXT exists: finish (activate) or delete the pending rotation first"
    umask 077
    cast wallet new --json | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const [w] = JSON.parse(s);
        if (!/^0x[0-9a-fA-F]{64}$/.test(w.private_key)) process.exit(3);
        process.stdout.write(w.private_key);
      });' >"$NEXT"
    chmod 600 "$NEXT"
    log "new session key written to $NEXT"
    echo "address: $(addr_of "$NEXT")"
    echo "next: on the laptop run: FOC_PAYER_PK=… $0 login --address $(addr_of "$NEXT")"
    ;;
  login)
    need_env FOC_PAYER_PK
    is_address "$ADDR" || die "--address <new session address> is required"
    foc session-login --session-address "$ADDR" --days "$DAYS"
    ;;
  activate)
    need_cmd cast docker
    [[ -s "$NEXT" ]] || die "no pending key at $NEXT (run generate first)"
    old=""
    [[ -s "$CUR" ]] && old="$(addr_of "$CUR")"
    [[ -s "$CUR" ]] && cp -p "$CUR" "$PREV"
    install -m 600 "$NEXT" "$CUR"
    rm -f "$NEXT"
    log "recreating api with the new session key"
    compose up -d --no-deps --force-recreate api
    echo "active: $(addr_of "$CUR")"
    [[ -z "$old" ]] || echo "next: on the laptop run: FOC_PAYER_PK=… $0 revoke --address $old"
    ;;
  revoke)
    need_env FOC_PAYER_PK
    is_address "$ADDR" || die "--address <old session address> is required"
    foc session-revoke --session-address "$ADDR"
    ;;
  cleanup)
    [[ -e "$PREV" ]] || { log "nothing to clean"; exit 0; }
    shred -u "$PREV" 2>/dev/null || rm -f "$PREV"
    log "previous session key removed"
    ;;
  *) sed -n '2,13p' "$0"; [[ -z "$cmd" || "$cmd" == -h || "$cmd" == --help ]] || exit 2 ;;
esac
