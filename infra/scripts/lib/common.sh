#!/usr/bin/env bash
# Shared helpers for infra/scripts/*.sh (sourced, never executed).
# shellcheck shell=bash

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "${INFRA_DIR}/.." && pwd)"
# STAMPER_CONTRACTS_DIR overrides the foundry project (tests point it at a fixture tree).
CONTRACTS_DIR="${STAMPER_CONTRACTS_DIR:-${REPO_ROOT}/contracts}"
export INFRA_DIR REPO_ROOT CONTRACTS_DIR

# Well-known anvil test keys (public; anvil only).
ANVIL_PK0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ANVIL_PK0

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing command: $c"; done
}

need_env() {
  local k
  for k in "$@"; do [[ -n "${!k:-}" ]] || die "missing env: $k"; done
}

is_address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }

# Run a memory-heavy command (forge with via_ir) under an optional host-wide lock.
run_heavy() {
  if [[ -n "${STAMPER_HEAVY_LOCK:-}" ]]; then flock "${STAMPER_HEAVY_LOCK}" "$@"; else "$@"; fi
}

# Run pnpm under an optional lock so concurrent installs never corrupt the lockfile.
run_pnpm() {
  if [[ -n "${STAMPER_PNPM_LOCK:-}" ]]; then flock "${STAMPER_PNPM_LOCK}" pnpm "$@"; else pnpm "$@"; fi
}

# json_get <file> <key> -> prints the value (arrays joined by ",").
json_get() {
  node -e '
    const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (v === undefined) process.exit(3);
    process.stdout.write(Array.isArray(v) ? v.join(",") : String(v));
  ' "$1" "$2"
}

# upsert_env <file> <KEY> <VALUE>: replace or append KEY=VALUE, keeping the file mode private.
upsert_env() {
  local file=$1 key=$2 value=$3 tmp
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "bad env key: $key"
  [[ "$value" != *$'\n'* ]] || die "env value for $key contains a newline"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp "${file}.XXXXXX")"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" k "=" { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

# rpc_chain_id <rpc-url>
rpc_chain_id() { cast chain-id --rpc-url "$1"; }

# First field of a cast call result ("1730000000 [1.73e9]" -> 1730000000).
cast_uint() { cast call "$@" | awk '{print $1}'; }

# print_activation <registry> <rpc> <registrars csv> <binders csv>
print_activation() {
  local registry=$1 rpc=$2 regs=$3 binders=$4 a ts now
  now="$(date +%s)"
  IFS=',' read -r -a _r <<<"$regs"
  for a in "${_r[@]}"; do
    [[ -n "$a" ]] || continue
    ts="$(cast_uint "$registry" "registrarActiveFrom(address)(uint256)" "$a" --rpc-url "$rpc")"
    printf '  registrar %s active from %s (%s h from now)\n' "$a" "$(date -u -d "@$ts" +%FT%TZ)" "$(((ts - now) / 3600))"
  done
  IFS=',' read -r -a _b <<<"$binders"
  for a in "${_b[@]}"; do
    [[ -n "$a" ]] || continue
    ts="$(cast_uint "$registry" "binderActiveFrom(address)(uint256)" "$a" --rpc-url "$rpc")"
    printf '  binder    %s active from %s (%s h from now)\n' "$a" "$(date -u -d "@$ts" +%FT%TZ)" "$(((ts - now) / 3600))"
  done
}

# write_chain_env <deployments.json> <env-file> <rpc-urls csv> <reorg-depth>
write_chain_env() {
  local dep=$1 out=$2 rpcs=$3 reorg=$4 chain registry resolver pdp fwss
  chain="$(json_get "$dep" chainId)"
  registry="$(json_get "$dep" registry)"
  resolver="$(json_get "$dep" resolver)"
  pdp="$(json_get "$dep" pdpVerifier)"
  fwss="$(json_get "$dep" fwss)"
  upsert_env "$out" CHAIN_ID "$chain"
  upsert_env "$out" RPC_URLS "$rpcs"
  upsert_env "$out" REGISTRY_ADDRESS "$registry"
  upsert_env "$out" RESOLVER_ADDRESS "$resolver"
  upsert_env "$out" PDP_VERIFIER_ADDRESS "$pdp"
  upsert_env "$out" FWSS_ADDRESS "$fwss"
  upsert_env "$out" REORG_DEPTH "$reorg"
  upsert_env "$out" FOC_CHAIN_ID "$chain"
  upsert_env "$out" NEXT_PUBLIC_CHAIN_ID "$chain"
  upsert_env "$out" NEXT_PUBLIC_RPC_URLS "$rpcs"
  upsert_env "$out" NEXT_PUBLIC_REGISTRY_ADDRESS "$registry"
  upsert_env "$out" NEXT_PUBLIC_RESOLVER_ADDRESS "$resolver"
  upsert_env "$out" EXPO_PUBLIC_CHAIN_ID "$chain"
  upsert_env "$out" EXPO_PUBLIC_REGISTRY_ADDRESS "$registry"
}

# announce_roles <rpc alias or url> <registry> <csv registrars> <csv binders> <forge wallet args...>
# Runs contracts/script/Roles.s.sol once per address (governor-signed; active after 48 h).
announce_roles() {
  local rpc=$1 registry=$2 regs=$3 binders=$4 a
  shift 4
  IFS=',' read -r -a _r <<<"$regs"
  for a in "${_r[@]}"; do
    [[ -n "$a" ]] || continue
    is_address "$a" || die "bad registrar address: $a"
    log "Roles: addRegistrar $a"
    (cd "$CONTRACTS_DIR" && REGISTRY="$registry" WHO="$a" ACTION=addRegistrar \
      run_heavy forge script script/Roles.s.sol --rpc-url "$rpc" --broadcast --slow "$@" >/dev/null)
  done
  IFS=',' read -r -a _b <<<"$binders"
  for a in "${_b[@]}"; do
    [[ -n "$a" ]] || continue
    is_address "$a" || die "bad binder address: $a"
    log "Roles: addBinder $a"
    (cd "$CONTRACTS_DIR" && REGISTRY="$registry" WHO="$a" ACTION=addBinder \
      run_heavy forge script script/Roles.s.sol --rpc-url "$rpc" --broadcast --slow "$@" >/dev/null)
  done
}

# confirm <expected> <prompt>: read a typed confirmation from the terminal.
confirm() {
  local expected=$1 prompt=$2 got
  [[ -r /dev/tty ]] || die "confirmation needs a terminal"
  printf '%s\n  type "%s" to continue: ' "$prompt" "$expected" >/dev/tty
  read -r got </dev/tty
  [[ "$got" == "$expected" ]] || die "confirmation mismatch; aborted"
}

# verify_on_blockscout <deployment.json> <chain id> <blockscout api url, e.g. https://…/api/>
# Publishes the StampRegistry and StampResolver sources recorded in <deployment.json> on Blockscout and
# returns non-zero unless Blockscout's v2 API then reports each address verified under its own name.
# Idempotent: already-verified contracts are skipped. forge's own "already verified" pre-check is skipped
# on purpose: Filecoin Blockscout indexes fresh FEVM contracts with runtime code 0xfe and serves an
# unrelated verified twin through getsourcecode, so plain `forge verify-contract` says "already verified"
# and publishes nothing. Knobs (seconds): VERIFY_INDEX_TIMEOUT_S (900) to wait for Blockscout to index
# the creation input, VERIFY_STATUS_TIMEOUT_S (180) to wait for the verified state, VERIFY_POLL_INTERVAL_S (15).
verify_on_blockscout() {
  local dep=$1 chain=$2 api=$3 name key addr args js="${INFRA_DIR}/scripts/lib/blockscout.mjs"
  local poll=(--interval-s "${VERIFY_POLL_INTERVAL_S:-15}") failed=()
  [[ -f "$dep" ]] || { warn "verify: $dep is missing"; return 1; }
  if ! (cd "$CONTRACTS_DIR" && run_heavy forge build >/dev/null); then
    warn "verify: forge build failed in $CONTRACTS_DIR"
    return 1
  fi
  for name in StampRegistry StampResolver; do
    key=registry
    [[ $name == StampResolver ]] && key=resolver
    if ! addr="$(json_get "$dep" "$key")" || ! is_address "$addr"; then
      failed+=("$name: no $key address in $dep")
      continue
    fi
    if node "$js" status --api "$api" --address "$addr" --name "$name" --timeout-s 0 2>/dev/null; then
      log "Blockscout: $name $addr is already verified"
      continue
    fi
    if ! args="$(node "$js" ctor-args --api "$api" --address "$addr" "${poll[@]}" \
      --artifact "${CONTRACTS_DIR}/out/${name}.sol/${name}.json" --timeout-s "${VERIFY_INDEX_TIMEOUT_S:-900}")"; then
      failed+=("$name $addr: no constructor arguments (see above)")
      continue
    fi
    log "forge verify-contract $name $addr → $api"
    if ! (cd "$CONTRACTS_DIR" && run_heavy forge verify-contract "$addr" "src/${name}.sol:${name}" \
      --chain "$chain" --verifier blockscout --verifier-url "$api" --constructor-args "$args" \
      --skip-is-verified-check --watch --retries 10 --delay 15) >&2; then
      failed+=("$name $addr: forge verify-contract failed (see above)")
      continue
    fi
    node "$js" status --api "$api" --address "$addr" --name "$name" "${poll[@]}" \
      --timeout-s "${VERIFY_STATUS_TIMEOUT_S:-180}" || failed+=("$name $addr: Blockscout does not report it verified")
  done
  if ((${#failed[@]})); then
    printf '\033[1;31merror:\033[0m Blockscout source publication FAILED: %s\n' "${failed[@]}" >&2
    return 1
  fi
  log "Blockscout: StampRegistry and StampResolver sources are published"
}
