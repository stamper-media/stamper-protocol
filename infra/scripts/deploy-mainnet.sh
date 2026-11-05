#!/usr/bin/env bash
# Deploy StampRegistry + StampResolver to Filecoin mainnet (314) with a hardware wallet.
# Same chain as deploy-calibration.sh, plus: refuses if contracts/deployments/mainnet.json exists,
# refuses a raw DEPLOYER_PK, and asks for two typed confirmations.
#
# Usage:
#   MAINNET_RPC_URL=https://… GOVERNOR_ADDR=0x… RESOLVER_OWNER_ADDR=0x… REGISTRAR_ADDR=0x… BINDER_ADDR=0x… \
#   infra/scripts/deploy-mainnet.sh [--simulate] [--skip-verify] [--skip-abi]
#   infra/scripts/deploy-mainnet.sh --verify-only   # (re)publish the recorded deployment on Blockscout
#   HW_WALLET=trezor selects --trezor instead of --ledger. --simulate runs without broadcasting.
#   Source publication is its own step after the broadcast (MAINNET_BLOCKSCOUT_URL); a failure there exits
#   non-zero after the remaining steps, and --verify-only retries it.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SIMULATE=0 VERIFY_ONLY=0 SKIP_VERIFY=0 SKIP_ABI=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --simulate) SIMULATE=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    --skip-abi) SKIP_ABI=1 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
need_cmd forge cast node awk
((SIMULATE + VERIFY_ONLY + SKIP_VERIFY <= 1)) || die "--simulate, --verify-only and --skip-verify are exclusive"
MAINNET_BLOCKSCOUT_URL="${MAINNET_BLOCKSCOUT_URL:-https://filecoin.blockscout.com/api/}"
DEP="${CONTRACTS_DIR}/deployments/mainnet.json"
if [[ $VERIFY_ONLY -eq 1 ]]; then
  [[ -f "$DEP" ]] || die "$DEP is missing: nothing to verify"
  [[ "$(json_get "$DEP" chainId)" == "314" ]] || die "$DEP is not a mainnet (314) deployment"
  verify_on_blockscout "$DEP" 314 "$MAINNET_BLOCKSCOUT_URL" || die "Blockscout verification failed (see above)"
  exit 0
fi
need_env MAINNET_RPC_URL GOVERNOR_ADDR RESOLVER_OWNER_ADDR
export MAINNET_RPC_URL
[[ -z "${DEPLOYER_PK:-}" ]] || die "DEPLOYER_PK is set: mainnet deploys only with a hardware wallet (unset it)"
for k in GOVERNOR_ADDR RESOLVER_OWNER_ADDR; do is_address "${!k}" || die "$k is not an address"; done
for k in REGISTRAR_ADDR BINDER_ADDR; do [[ -z "${!k:-}" ]] || is_address "${!k}" || die "$k is not an address"; done
case "${HW_WALLET:-ledger}" in
  ledger) wallet=(--ledger --sender "$GOVERNOR_ADDR") ;;
  trezor) wallet=(--trezor --sender "$GOVERNOR_ADDR") ;;
  *) die "HW_WALLET must be ledger or trezor" ;;
esac

[[ ! -f "$DEP" ]] || die "$DEP exists: mainnet is deployed once; a new registry is a governance decision (ADR)"
[[ "$(rpc_chain_id "$MAINNET_RPC_URL")" == "314" ]] || die "MAINNET_RPC_URL is not Filecoin mainnet (314)"

cat >&2 <<INFO
Mainnet deployment plan
  governor (hardware wallet) : $GOVERNOR_ADDR
  resolver owner             : $RESOLVER_OWNER_ADDR
  registrar (48 h delay)     : ${REGISTRAR_ADDR:-none}
  binder (48 h delay)        : ${BINDER_ADDR:-none}
  PDPVerifier / FWSS         : ${PDP_VERIFIER:-default 314} / ${FWSS:-default 314}
  broadcast                  : $([[ $SIMULATE -eq 1 ]] && echo "no (simulation)" || echo YES)
INFO

if [[ $SIMULATE -eq 1 ]]; then
  (cd "$CONTRACTS_DIR" && run_heavy forge script script/Deploy.s.sol --rpc-url mainnet "${wallet[@]}")
  log "simulation done; nothing was broadcast"
  exit 0
fi

confirm "314" "This deploys an IMMUTABLE registry on Filecoin mainnet."
confirm "deploy ${GOVERNOR_ADDR: -6}" "Check the governor address on the device screen."

(cd "$CONTRACTS_DIR" && run_heavy forge script script/Deploy.s.sol --rpc-url mainnet --broadcast \
  --skip-simulation --slow --timeout 180 "${wallet[@]}")
[[ -f "$DEP" ]] || die "Deploy.s.sol did not write $DEP"
registry="$(json_get "$DEP" registry)"

verified=skipped
if [[ $SKIP_VERIFY -eq 1 ]]; then
  warn "--skip-verify: sources are NOT published on Blockscout; run --verify-only later"
elif verify_on_blockscout "$DEP" 314 "$MAINNET_BLOCKSCOUT_URL"; then
  verified=yes
else
  verified=FAILED
fi

if [[ $SKIP_ABI -eq 0 ]]; then
  log "pnpm abi"
  (cd "$REPO_ROOT" && run_pnpm abi)
fi

if [[ -n "${EXTRA_REGISTRARS:-}${EXTRA_BINDERS:-}" ]]; then
  confirm "roles" "Announce EXTRA_REGISTRARS=${EXTRA_REGISTRARS:-} EXTRA_BINDERS=${EXTRA_BINDERS:-}."
  announce_roles mainnet "$registry" "${EXTRA_REGISTRARS:-}" "${EXTRA_BINDERS:-}" --skip-simulation "${wallet[@]}"
fi
regs="$(json_get "$DEP" registrars)"
binders="$(json_get "$DEP" binders)"
[[ -n "${EXTRA_REGISTRARS:-}" ]] && regs="${regs:+$regs,}${EXTRA_REGISTRARS}"
[[ -n "${EXTRA_BINDERS:-}" ]] && binders="${binders:+$binders,}${EXTRA_BINDERS}"
log "role activation:"
print_activation "$registry" "$MAINNET_RPC_URL" "$regs" "$binders"

ENV_OUT="${INFRA_DIR}/env/mainnet.env"
write_chain_env "$DEP" "$ENV_OUT" "${MAINNET_RPC_URLS:-$MAINNET_RPC_URL}" 2
upsert_env "$ENV_OUT" FOC_MODE real
upsert_env "$ENV_OUT" FOC_RPC_URL "$MAINNET_RPC_URL"
log "wrote $ENV_OUT — commit contracts/deployments/mainnet.json, then run scripts/foc-bootstrap.sh"
[[ $verified != FAILED ]] ||
  die "deployed and wired, but Blockscout source publication FAILED (see above); retry: $0 --verify-only"
