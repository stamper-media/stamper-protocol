# contracts — StampRegistry, StampResolver, mocks

Foundry project for the Stamper chain layer (DESIGN §4, IMPLEMENTATION-PLAN WP-01).
solc 0.8.30, `evm_version = cancun`, `via_ir`, optimizer 200. OpenZeppelin 5.6.1 and forge-std 1.17 are
vendored under `lib/` (installed with `forge install --no-git`; nested `.git` dirs removed).

## Contracts
- `src/StampRegistry.sol` — immutable registry: the full DESIGN §4.1 interface, plus `isActiveRegistrar` /
  `isActiveBinder`. Normative paths of §4.3 (registerStamp), §4.4 (bindStorage + slot policy), §4.5 (codes).
  Key types: secp256k1 (0), P-256 raw (1), P-256 App Attest (2), ERC-1271 (3). P-256 goes through the
  `0x0100` precompile (`src/lib/P256.sol`, low-s enforced).
- `src/StampResolver.sol` — advisory flags and verifier release hashes (§4.8).
- `src/lib/Cids.sol` — PieceCID v2 validation, copied from FilOzone/pdp.
- `src/mocks/` — `MockPDPVerifier`, `MockFWSS`, `MockStateView`, `MockERC1271` (dev chains only, unprotected).

Interface details the design left open (decided here):
- `registerKey` App Attest proof of possession: `popSig = authData(37 B, counter 0) ‖ r ‖ s`.
- `registerKey` without an endorsement always stores level 0 and registrar 0, whatever `e.level` says.
- `revokeKey`: the registrar path also requires the registrar to still be active; an existing revocation can
  only be moved earlier; `retroactive = effectiveEpoch < block.number`. App Attest self-revocation accepts any
  counter.
- secp256k1 signatures go through `ECDSA.tryRecoverCalldata`, so a malformed signature gives `BadSig` (not
  an OZ custom error) and `verifyClaim` returns false instead of reverting.
- Revert strings follow the design; Cids failures are FilOzone's custom errors (`InvalidCommPv2Prefix`, …).
- `"Dup"` in `registerStamp` cannot be reached: a replayed claim always fails `"NonceUsed"` first.

## Tests
```
forge test                                         # everything; P-256 runs on the daimo verifier etched at 0x100
forge test --odyssey --match-path 'test/*[Pp]256*' # P-256 against the revm precompile (set REQUIRE_P256_PRECOMPILE=1 to assert it is active)
forge snapshot --match-path test/Gas.t.sol --check # gas reference (.gas-snapshot, snapshots/GasTest.json)
CALIBRATION_RPC_URL=https://api.calibration.node.glif.io/rpc/v1 forge test --match-path 'test/fork/*'
```
`test/Flow.t.sol` is the WP-01 integration test. Vectors are in `test/vectors/` (`gen_vectors.py` regenerates
`p256.json` and `codes.json`; `commpv2.json` is a pinned Calibration read; `daimo-p256-verifier.hex` is
`forge inspect P256Verifier deployedBytecode` of `test/vendor/P256Verifier.sol`, daimo-eth/p256-verifier).

## Deploy
- anvil: `forge script script/DeployLocal.s.sol --rpc-url $ANVIL_RPC_URL --broadcast` deploys the mocks
  plus registry and resolver, announces registrar/binder, creates mock data sets 1 (A) and 2 (B), and writes
  `deployments/anvil.json`. Roles activate 48 h later: `cast rpc evm_increaseTime 172800 && cast rpc evm_mine`.
  Env (optional): `DEPLOYER_PK`, `REGISTRAR_ADDR`, `BINDER_ADDR`, `RESOLVER_OWNER_ADDR`, `MOCK_SP_A`, `MOCK_SP_B`,
  `DEPLOYMENTS_OUT`.
- Calibration / mainnet: `script/Deploy.s.sol` (see header; env `DEPLOYER_PK` on Calibration only,
  `RESOLVER_OWNER_ADDR`, `REGISTRAR_ADDR`, `BINDER_ADDR`, `PDP_VERIFIER`/`FWSS` overrides). It writes
  `deployments/{calibration,mainnet}.json`. Not run: no funded key exists.
- `script/Roles.s.sol` changes roles (`ACTION`, `REGISTRY`, `WHO`). `script/MeasureP256.s.sol` is the P-256 gas
  spike (see docs/spikes/p256-gas.md).

After a contract change, run `pnpm --filter @stamper/contracts-abi generate` to refresh the TypeScript ABIs.
