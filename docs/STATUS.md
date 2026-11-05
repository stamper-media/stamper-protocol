# Stamper MVP status

Checked 2026-10-01, 06:01–06:30 UTC, by the final integration runner, after the gap-fix pass (e2e, infra, .github, packages/foc, services/api). The checks ran on the working tree. Nothing is committed, so the plan's "clean clone of `main`" cannot be tested yet.

**Summary.** The whole local stack is green: install, typecheck, every unit and integration suite, forge, pytest, the infra tests and `e2e/run-local.sh` (49 s, every leg including ml and Playwright). CI would still fail at `pnpm lint`: 2 formatting errors, both in infra files added by the gap-fix pass.

> **Follow-up fixes, 2026-10-01 06:27Z (main session, after the final pass):** root `pnpm lint` is now clean (the two infra Blockscout files were formatted); `packages/contracts-abi` was regenerated and now includes the Calibration (314159) deployment; the api runway alert now fires below 60 days, matching DESIGN and `healthcheck.sh`; the api test suites no longer leave `/tmp/stamper-wp0*` dirs behind (a vitest global teardown in `services/api` removes the dirs a run created; 110/110 api tests pass) and the 312 leftover dirs were removed. Real FOC storage on Calibration passed `packages/foc/test/calibration.int.test.ts` (store on both providers, session-key commit, provider and FilBeam download re-hashed) after the payer scripts were fixed to wait for transaction receipts. `infra/env/calibration.env` is still not written; the non-secret ids live in the owner's `~/.config/stamper/` files.

On Calibration, both contracts are deployed and now Blockscout-verified (partial match). No role is active yet because of the 48 h role delay: the registrar activates at **2026-10-03T04:46:00Z** and the binder at **2026-10-03T04:47:00Z** (read from chain at about 06:25Z). The full Calibration flow cannot pass before 2026-10-03T04:47:00Z.

Not done yet:
- The Calibration e2e run (role delay).
- The mainnet deploy and its Blockscout verification.
- Device builds and Maestro flows.
- Running the stack on a VPS.

## Test runs (this pass)

| Command | Result |
|---|---|
| `flock .pnpm.flock pnpm install` | ok: lockfile up to date, 10 workspace projects |
| `pnpm -r typecheck` | pass in all 9 packages |
| `pnpm -r test` | pass: contracts-abi 8, core 100, minimise 70, foc 28 (+1 skipped), marking 43 (+1 file skipped), web 39, mobile 35 (jest), api 110, e2e 12 |
| `forge test` (contracts/) | 56 passed, 1 skipped (fork test: `CALIBRATION_RPC_URL not set`) |
| `services/ml/.venv/bin/python -m pytest -q` | 40 passed in 109 s; no "TrustMark Q weights unusable" line, so the real-model tests ran |
| `bash e2e/run-local.sh` | **PASS** in 49 s (details below) |
| `node --test infra/test/*.test.mjs` | 21 passed, 0 skipped. shellcheck is not installed on this host, so the shell test fell back to `bash -n`; the CI `infra` job pins shellcheck 0.11.0. |
| `pnpm lint` (biome; part of the CI `ts` job) | pass (the 2 formatting errors below were fixed in the follow-up) |
| `node scripts/check-pure.mjs packages/core packages/minimise` | 21 files clean |
| `e2e/run-calibration.sh` with no keys in the environment | `SKIP run-calibration: missing …`, exit 0 |

**`pnpm -r test` details**
- foc: the skipped file is `calibration.int.test.ts` (no Calibration env in this shell).
- marking: the skipped file is `ml.int.test.ts` (needs `ML_URL`).
- api 110 includes the Docker Postgres tests, the anvil custodian flow test, the worker pipeline test against the ml venv, and the new ops-metrics and capture-TTL tests.
- e2e 12 includes the poll and role pre-flight tests, and the regression test that `flow.ts` exits within 60 s after an enrolment failure.

**`e2e/run-local.sh` legs** (code E4E6PW0MG). All of these passed:
- timings: capture→202 0.09 s, 202→receipt 0.92 s, receipt→marked 5.91 s, marked→bound 2.17 s, bound→probe-ok 1.86 s
- role pre-flight: pending before the warp, active after it
- enrol and claim
- pipeline: 2 bindings, probe ok
- chain re-verify
- ORIGINAL: re-hashed from the mock SP
- STAMPER_MARKED_COPY
- RELATED: ml up, PDQ distance 0
- video-server-piececid: registered with PIECECID_SERVER_COMPUTED
- verify-independently: 18 checks
- Playwright: 6 passed, 1 skipped (the api-blocked test runs only in fixture mode)
- total<10min: 47 s

Nothing was left running: no container, process or temp dir. During cleanup the shell printed one `Killed` job line. That is expected: cleanup sends TERM, waits 1 s, then sends KILL, and one child took longer than the second.

**`pnpm lint` errors** (formatting only; owner: infra)
- `infra/scripts/lib/blockscout.mjs`
- `infra/test/blockscout.test.mjs`

`node_modules/.bin/biome format --write` on these two files fixes both. The earlier errors in `packages/foc` and `services/api` are fixed. In this pass, `e2e/roles.ts` and `e2e/test/lib.test.ts` were reformatted (formatting only); the e2e typecheck and its 12 tests were re-run afterwards and pass.

**Builds.** No `packages/*/dist` is older than its `src`.

**Not run in this pass**
- `apps/web` `test:e2e` (Playwright fixture mode). The .github gap-fix pass reported 7 passed.
- `marking` `test:ml`, `foc` `test:calibration` and the forge fork tests.
- `pnpm build` (including `next build`), and the prod images and compose stack.
- The CI workflow itself (there is no remote). The .github pass ran actionlint 1.7.12 on it with rc 0.

## Calibration state

- `contracts/deployments/calibration.json`:
  - registry `0xb64F15D327C9953C8fCaB3700C5e92772a5021c9`
  - resolver `0x08298D447E7f1215939E48A64FEfF75075722B0c`
  - `deployedAtBlock` 4116779 (2026-10-01T04:42:30Z)
- Blockscout: the filecoin-testnet.blockscout.com v2 API reports StampRegistry and StampResolver as `is_verified: true`, compiler v0.8.30. Both are partial matches, which is expected with `bytecode_hash=none`. See `docs/spikes/blockscout-verification.md`.
- Roles, read through Glif at about 06:25Z:
  - `isActiveRegistrar(0xe5bF…302F)` and `isActiveBinder(0x461C…6F7a)` are both `false`.
  - `registrarActiveFrom` is 2026-10-03T04:46:00Z and `binderActiveFrom` is 2026-10-03T04:47:00Z.
  - Both are later than deploy block + 48 h, because the roles were announced in later blocks. See `docs/spikes/e2e-calibration.md`.
- Another session started a run-calibration at 04:59Z. It failed at enrol with `EnrolRejected … NotRegistrar`, then waited in the old pipeline poll until its `timeout` stopped it at 05:57:29Z. It wrote no report. Both problems are now handled:
  - `flow.ts` skips the pipeline after a failed claim and exits at once.
  - `run-calibration.sh` runs a role pre-flight first. While roles are pending it prints a SKIP line with the activation time and exits 0.
- The deploy's post-broadcast steps never ran on this host. `packages/contracts-abi/src/deployments.gen.ts` (02:19Z) has no Calibration (314159) entry, and `infra/env/calibration.env` does not exist.

## MVP definition of done (§7)

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | `e2e/run-local.sh` green | **met** (working tree) | PASS in 49 s, all legs ok. On a clean clone, run `pnpm install && pnpm build` first: the script stops if `packages/*/dist` is missing. |
| 2 | `e2e/run-calibration.sh` green | **unmet** | Blocked by the role delay. Re-run after 2026-10-03T04:47:00Z, or set `E2E_ROLE_WAIT_S` to wait. |
| 3 | Registry + resolver on Calibration **and mainnet**, Blockscout-verified | **unmet** (Calibration half met) | Calibration is deployed and Blockscout-verified. There is no `mainnet.json`: the deploy needs the owner's hardware wallet and FIL. |
| 4 | Android Maestro flow on Calibration; iOS TestFlight with App Attest | not testable here | Host has Java 11 only and no Apple, Google or EAS accounts. The flows are written but have never run. |
| 5 | ORIGINAL only after an in-browser re-hash; banned-word tests in core, web, mobile, api | **met** | Playwright "exact path: ORIGINAL only after the original is fetched and re-hashed" passed in run-local. The copy tests pass in all four packages. |
| 6 | Six containers + backup sidecar on one VPS, secrets only in `api` | not testable here | The prod compose defines caddy, web, api, worker, ml, postgres + backup, with secrets only on `api`. There is no VPS, and the prod images were not built in this pass. |
| 7 | `docs/verify-independently.md` reproduces a verdict with cast + curl | **met, with caveats** | Run inside run-local: 18 checks pass. The PieceCID step and the P-256 / ERC-1271 signature branches need `node`. The mainnet REG address is unpublished. |

## Build-order gates (§2)

| Level | State |
|---|---|
| 0 | Typecheck passes. CI has never run (no remote). It would fail at `pnpm lint` (2 infra formatting errors). |
| 1 | Green: unit suites pass; DeployLocal produces `anvil.json` in run-local; `contracts-abi` builds. |
| 2 | Green: custodian `flow.anvil.test.ts`, Playwright against the local stack, and mobile jest. Web fixture-mode Playwright: the .github pass reported 7 passed; it was not re-run here. |
| 3 | Worker `pipeline.test.ts` green (Docker Postgres + ml venv + MockFoc). |
| 4 | run-local green. run-calibration is blocked by the role delay until 2026-10-03T04:47:00Z. |

## Work packages

| WP | State | Main open items |
|---|---|---|
| 00 repo | done | `pnpm lint` red (2 infra files). `.npmrc`, `vitest.workspace.ts`, `.node-version`, `tsconfig.pure.json` and `docs/spikes/README.md` are still missing. CI now has the e2e-local, infra (pinned shellcheck) and web-e2e jobs, plus the ml weight fetch with a skip guard and a shared ml cache. It has never run on GitHub. |
| 01 contracts | done | Calibration deployed and Blockscout-verified. Mainnet not deployed. `MeasureP256.s.sol` not run. The P-256 and commpv2 vectors are self-generated or come from one live read. |
| 02 core | done | Test vectors not reconciled with `contracts/test/vectors`. No `web`/`upload` capture source. Hermes untested. The reworded FOOTER needs owner sign-off. |
| 03 foc | done | Calibration integration and ceremony scripts not run in this pass. `dataSetHealth` has no unit test. The mock SP has no CORS. The lint errors are fixed. |
| 04 marking | done | `test:ml` and the badge-vs-PDQ drift table not run. ffmpeg 7 untested. Glyph is a placeholder. |
| 05 ml | done | TrustMark weight redistribution terms unconfirmed. ONNX fallback documented only. |
| 06 api foundation | done | The four healthcheck metrics are now emitted. The api test suites leave `mkdtemp` dirs (`/tmp/stamper-wp06-*`, `/tmp/stamper-wp07-*`) behind on every run; 314 from earlier runs are still in /tmp. `handleRunway` sends its ntfy alert below 30 days, while DESIGN and `healthcheck.sh` use 60. |
| 07 api custodian | done | Real App Attest, Play Integrity and FOC never ran. The capture-challenge TTL is now `CAPTURE_CHALLENGE_TTL_S` (default 3600 s, an unconfirmed guess); DESIGN §7.4 still says 5 min. No CORS (prod is same-origin via Caddy). |
| 08 worker | done | Real FOC and S3 never ran. RELATED upload result lacks a top-level code. F0 badge is applied to web uploads. Probe alert has no rate limit. Whole files are held in memory. |
| 09 web | done | The api-less path does not look up providers through ServiceProviderRegistry. Lighthouse not measured. Two-RPC disagreement only warns. |
| 10 mobile | done | No native build or Maestro run. No push notifications (polls instead). `reissued.newCaptureId` not followed. Hermes timing spike not measured. |
| 11 infra | done | Blockscout publication is now its own step, with a `--verify-only` retry; Calibration is verified. 2 biome formatting errors in the new Blockscout files. The Calibration deploy's `pnpm abi` and env-file steps never ran (see Calibration state). Real deploy, bootstrap, ntfy, backup and VPS paths never ran. |
| 12 e2e | done | run-local green. The `flow.ts` hang is fixed, the role pre-flight is added, and `docs/spikes/e2e-calibration.md` is written. run-calibration is blocked until 2026-10-03T04:47:00Z. |
| 13 minimise | done | No HEIC support. Synthetic fixtures only. |
| 14 web capture | done (flag off) | No Playwright test. Web uploads get the F0 badge. Capture source is recorded as in-app camera. |

## Stubbed or mocked in the local stack

- `ATTEST_MODE=stub` (stub tokens).
- `FOC_MODE=mock`: MockFoc, the mock SP, MockPDPVerifier and MockFWSS on anvil.
- In-memory or stubbed S3.
- The `nullWatermark` fallback when there are no weights.
- Abuse score 0.
- No video PDQ.
- Placeholder glyph.
- `PIECE_IMPL=fr32`.
- Self-generated P-256, code, claim and commpv2 vectors.

## Needs the owner (credentials, accounts, decisions)

**Credentials and accounts**
- Calibration: keys are present on the host, outside the repo. Re-run `e2e/run-calibration.sh` after 2026-10-03T04:47:00Z (or with `E2E_ROLE_WAIT_S`), then add the result to `docs/spikes/e2e-calibration.md`. Run `pnpm abi` so `@stamper/contracts-abi` includes the Calibration deployment.
- Mainnet: hardware-wallet governor/deployer, payer with FIL + USDFC, relayer FIL. Then `deploy-mainnet.sh` (which now includes the Blockscout publication step) and the data-set ceremony.
- Apple Developer Program, and Google Play Console + Play Integrity service-account JSON.
- EAS, or a local JDK 17 / Android Studio.
- VPS, `stamper.media` DNS, S3 bucket credentials, ntfy topic.
- TrustMark weight redistribution terms (or the ONNX route). For CI, optionally a `TRUSTMARK_WEIGHTS_URL` mirror variable.

**Decisions**
- Sign-off on the banned-word rewording (core FOOTER, web /about, Playwright strings).
- RPC-disagreement policy.
- Capture-challenge TTL: confirm or change the 3600 s default, then update DESIGN §7.4.
- Runway alert threshold: resolved to 60 days everywhere in the follow-up.
- Whether `contracts/lib` is committed as plain files or as submodules.
