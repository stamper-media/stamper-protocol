#!/usr/bin/env bash
# Deploy StampRegistry + StampResolver to Filecoin Calibration and wire everything after it:
#   forge script Deploy.s.sol → source publication on Blockscout → pnpm abi → Roles.s.sol
#   → registrar/binder activation times (48 h) → infra/env/calibration.env
#
# Usage:
#   DEPLOYER_PK=0x… RESOLVER_OWNER_ADDR=0x… REGISTRAR_ADDR=0x… BINDER_ADDR=0x… \
#   CALIBRATION_RPC_URL=https://… infra/scripts/deploy-calibration.sh [--skip-verify] [--skip-abi] [--force]
#   infra/scripts/deploy-calibration.sh --verify-only     # (re)publish the recorded deployment on Blockscout
#   ANVIL_RPC_URL=http://127.0.0.1:<port> infra/scripts/deploy-calibration.sh --dry-run [--out-dir DIR]
#
# Source publication runs after the broadcast as its own step (forge verify-contract, then a Blockscout v2
# check, BLOCKSCOUT_URL). If it fails, the remaining steps still run and the script exits non-zero at the end;
# --verify-only retries it without keys or RPC.
#
# --dry-run runs the same chain against anvil (RPC=anvil): DeployLocal.s.sol (mocks + mock data sets),
# Roles.s.sol for EXTRA_REGISTRARS/EXTRA_BINDERS (default: one extra anvil binder), activation times,
# and writes <out-dir>/anvil.json + <out-dir>/anvil.env (default out-dir: infra/env). It never touches
# contracts/deployments/anvil.json or regenerates the ABI package.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

DRY_RUN=0 VERIFY_ONLY=0 SKIP_VERIFY=0 SKIP_ABI=0 FORCE=0 OUT_DIR="${INFRA_DIR}/env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    --skip-abi) SKIP_ABI=1 ;;
    --force) FORCE=1 ;;
    --out-dir) OUT_DIR="${2:?--out-dir needs a value}"; shift ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
need_cmd forge cast node awk
((DRY_RUN + VERIFY_ONLY + SKIP_VERIFY <= 1)) || die "--dry-run, --verify-only and --skip-verify are exclusive"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

if [[ $DRY_RUN -eq 1 ]]; then
  need_env ANVIL_RPC_URL
  RPC="$ANVIL_RPC_URL"
  [[ "$(rpc_chain_id "$RPC")" == "31337" ]] || die "ANVIL_RPC_URL is not an anvil node (chain id != 31337)"
  export DEPLOYER_PK="${DEPLOYER_PK:-$ANVIL_PK0}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"; rm -f "${CONTRACTS_DIR}/${rel_out:-/nonexistent}"' EXIT
  # forge only writes under contracts/deployments (fs_permissions): use a transient hidden file there.
  rel_out="deployments/.dryrun-$$.json"
  log "DeployLocal.s.sol → $RPC"
  (cd "$CONTRACTS_DIR" && DEPLOYMENTS_OUT="$rel_out" FOUNDRY_BROADCAST="$tmp/broadcast" \
    run_heavy forge script script/DeployLocal.s.sol --rpc-url "$RPC" --broadcast >"$tmp/deploy.log" 2>&1) ||
    { tail -20 "$tmp/deploy.log" >&2; die "DeployLocal failed"; }
  mv "${CONTRACTS_DIR}/${rel_out}" "${OUT_DIR}/anvil.json"
  DEP="${OUT_DIR}/anvil.json"
  registry="$(json_get "$DEP" registry)"
  log "skip: Blockscout source publication and pnpm abi (dry run)"
  EXTRA_BINDERS="${EXTRA_BINDERS-0x976EA74026E726554dB657fA54763abd0C3a0aa9}"
  FOUNDRY_BROADCAST="$tmp/broadcast" announce_roles "$RPC" "$registry" "${EXTRA_REGISTRARS:-}" "$EXTRA_BINDERS" \
    --private-key "$DEPLOYER_PK"
  regs="$(json_get "$DEP" registrars)"
  binders="$(json_get "$DEP" binders)"
  [[ -n "${EXTRA_REGISTRARS:-}" ]] && regs="${regs:+$regs,}${EXTRA_REGISTRARS}"
  [[ -n "$EXTRA_BINDERS" ]] && binders="${binders:+$binders,}${EXTRA_BINDERS}"
  log "role activation:"
  print_activation "$registry" "$RPC" "$regs" "$binders"
  ENV_OUT="${OUT_DIR}/anvil.env"
  write_chain_env "$DEP" "$ENV_OUT" "$RPC" 0
  upsert_env "$ENV_OUT" FOC_MODE mock
  upsert_env "$ENV_OUT" ATTEST_MODE stub
  log "wrote $DEP and $ENV_OUT"
  exit 0
fi

# ── Calibration ────────────────────────────────────────────────────────────────────────────────
BLOCKSCOUT_URL="${BLOCKSCOUT_URL:-https://filecoin-testnet.blockscout.com/api/}"
DEP="${CONTRACTS_DIR}/deployments/calibration.json"
if [[ $VERIFY_ONLY -eq 1 ]]; then
  [[ -f "$DEP" ]] || die "$DEP is missing: nothing to verify"
  [[ "$(json_get "$DEP" chainId)" == "314159" ]] || die "$DEP is not a Calibration (314159) deployment"
  verify_on_blockscout "$DEP" 314159 "$BLOCKSCOUT_URL" || die "Blockscout verification failed (see above)"
  exit 0
fi
need_env CALIBRATION_RPC_URL DEPLOYER_PK RESOLVER_OWNER_ADDR
export CALIBRATION_RPC_URL
is_address "$RESOLVER_OWNER_ADDR" || die "RESOLVER_OWNER_ADDR is not an address"
[[ -z "${REGISTRAR_ADDR:-}" ]] || is_address "$REGISTRAR_ADDR" || die "REGISTRAR_ADDR is not an address"
[[ -z "${BINDER_ADDR:-}" ]] || is_address "$BINDER_ADDR" || die "BINDER_ADDR is not an address"
[[ "$(rpc_chain_id "$CALIBRATION_RPC_URL")" == "314159" ]] || die "CALIBRATION_RPC_URL is not Calibration (314159)"
if [[ -f "$DEP" && $FORCE -eq 0 ]]; then
  die "$DEP exists; pass --force to deploy a new registry (consumers must then move to it)"
fi

log "Deploy.s.sol → Calibration"
(cd "$CONTRACTS_DIR" && run_heavy forge script script/Deploy.s.sol --rpc-url calibration --broadcast \
  --skip-simulation --slow --timeout 180)
[[ -f "$DEP" ]] || die "Deploy.s.sol did not write $DEP"
registry="$(json_get "$DEP" registry)"

# Publication is its own step, not `forge script --verify`: a verify error there aborted the run before the
# ABI/roles/env steps and could not be retried without redeploying (docs/spikes/blockscout-verification.md).
verified=skipped
if [[ $SKIP_VERIFY -eq 1 ]]; then
  warn "--skip-verify: sources are NOT published on Blockscout; run --verify-only later"
elif verify_on_blockscout "$DEP" 314159 "$BLOCKSCOUT_URL"; then
  verified=yes
else
  verified=FAILED
fi

if [[ $SKIP_ABI -eq 0 ]]; then
  log "pnpm abi (regenerates @stamper/contracts-abi with the new deployment)"
  (cd "$REPO_ROOT" && run_pnpm abi)
fi

announce_roles calibration "$registry" "${EXTRA_REGISTRARS:-}" "${EXTRA_BINDERS:-}" --skip-simulation \
  --private-key "$DEPLOYER_PK"
regs="$(json_get "$DEP" registrars)"
binders="$(json_get "$DEP" binders)"
[[ -n "${EXTRA_REGISTRARS:-}" ]] && regs="${regs:+$regs,}${EXTRA_REGISTRARS}"
[[ -n "${EXTRA_BINDERS:-}" ]] && binders="${binders:+$binders,}${EXTRA_BINDERS}"
log "role activation (the api cannot endorse or bind before these times):"
print_activation "$registry" "$CALIBRATION_RPC_URL" "$regs" "$binders"

ENV_OUT="${OUT_DIR}/calibration.env"
write_chain_env "$DEP" "$ENV_OUT" "${CALIBRATION_RPC_URLS:-$CALIBRATION_RPC_URL}" 2
upsert_env "$ENV_OUT" FOC_MODE real
upsert_env "$ENV_OUT" FOC_RPC_URL "$CALIBRATION_RPC_URL"
log "wrote $ENV_OUT — merge it into infra/.env, then run scripts/foc-bootstrap.sh"
[[ $verified != FAILED ]] ||
  die "deployed and wired, but Blockscout source publication FAILED (see above); retry: $0 --verify-only"
