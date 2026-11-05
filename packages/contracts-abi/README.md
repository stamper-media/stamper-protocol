# @stamper/contracts-abi

Typed ABIs (`as const`), per-chain deployments and viem helpers for `StampRegistry` / `StampResolver`.

## API
- ABIs: `stampRegistryAbi`, `stampResolverAbi`, `pdpVerifierAbi`, `fwssAbi`, `fwssStateViewAbi`,
  `mockPdpVerifierAbi`, `mockFwssAbi`, `mockStateViewAbi`.
- Deployments: `deployments` (31337 from `contracts/deployments/anvil.json`; 314159/314 are placeholders with
  the FOC addresses and a zero registry until deployed), `deploymentFor(chainId)` (throws if unknown or not
  deployed), `parseDeployment(json)` (validates a deployments JSON read at runtime), `isDeployed`, `MULTICALL3`.
- Reads (`PublicClient`; Multicall3 only when the client's chain declares it): `readStampByCode`,
  `readStampBundle`, `readBindingStatuses`, `readUsedNonce`, `readPredictCode`.
- Calldata encoders (no signing): `encodeRegisterStamp`, `encodeRegisterKey`, `encodeRevokeKey`,
  `encodeAttachDerivative`, `encodeBindStorage`, `encodeSetFlag` (+ `ResolverFlag`).
- Types: `Stamp`, `DeviceKey`, `StoredBinding`, `Derivative`, `BindingStatus`, `CaptureClaimStruct`,
  `KeyEnrolmentStruct`, `KeyRevocationStruct`, `DerivativeStruct`, `BindingStruct`.

## Scripts
- `generate` — `forge build` then `scripts/gen-abi.mjs`: writes `src/abis.gen.ts` and `src/deployments.gen.ts`
  (checked in; `gen` skips the forge build).
- `build`, `typecheck`, `test` (unit: ABI selectors against DESIGN §4.1, encoders, deployments).
- `test:anvil` — needs `ANVIL_RPC_URL` and `forge`: runs `DeployLocal` (to a temp deployments file), advances
  time 48 h, enrols a key, registers a countersigned stamp, then checks every read helper. Skipped without
  `ANVIL_RPC_URL`.

Nothing is stubbed. Calibration and mainnet registry addresses stay zero until `Deploy.s.sol` runs with real keys.
