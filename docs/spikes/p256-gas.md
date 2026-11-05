# Spike: P256VERIFY gas on FEVM (ADR-005) — NOT RUN

Status (2026-10-01): **not measured.** `contracts/script/MeasureP256.s.sol` is written but needs a funded
Calibration key (`DEPLOYER_PK`), and none exists in this environment.

How to run:
```
cd contracts
DEPLOYER_PK=0x... forge script script/MeasureP256.s.sol --rpc-url calibration --broadcast --skip-simulation --slow
```
It deploys `P256GasProbe`, then calls `measure()` with one valid and one invalid vector from
`test/vectors/p256.json`. Each call emits `Measured(gasUsed, ok, outLength)` (gas used around the `0x0100`
staticcall), and the receipts' `gasUsed` gives the full transaction cost. Record both here: they are recorded,
not acted on.

Local reference (revm, not FEVM): with `forge test --odyssey` the precompile path passes every vector in
`test/vectors/p256.json`. revm gas tells us nothing about FEVM's instrumented Wasm cost.
