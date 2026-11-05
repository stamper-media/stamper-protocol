# stamper-protocol

Media provenance on Filecoin Onchain Cloud. This repo holds the protocol: the `StampRegistry` and
`StampResolver` contracts on FEVM, the TypeScript packages every other Stamper repo builds on, and
the infra that deploys the whole stack. Design and plan: [docs/](docs/) ([DESIGN.md](docs/DESIGN.md),
[ADRS.md](docs/ADRS.md), [verify-independently.md](docs/verify-independently.md)).

## Stamper repos

| Repo | What |
|---|---|
| [stamper-protocol](https://github.com/stamper-media/stamper-protocol) | FEVM contracts, the shared `@stamper/*` packages (npm), infra and design docs |
| [stamper-services](https://github.com/stamper-media/stamper-services) | custodian api + worker, ml sidecar, whole-flow e2e |
| [stamper-app](https://github.com/stamper-media/stamper-app) | stamp from the browser (web) and the phone (iOS, Android) |
| [stamper-explorer](https://github.com/stamper-media/stamper-explorer) | the public check site: stamp pages, QR, compare, check a file |

Clone them side by side (`stamper-protocol/`, `stamper-services/`, … in one folder): scripts that need
another repo look for it there, or in `STAMPER_<NAME>_DIR`.

## What is here

| Path | Package | What |
|---|---|---|
| `contracts/` | Foundry | `StampRegistry`, `StampResolver`, mocks, deploy scripts, deployments (`calibration.json`) |
| `packages/contracts-abi` | `@stamper/contracts-abi` | generated ABIs + deployments reader |
| `packages/core` | `@stamper/core` | identifiers, stamp codes, claims, records, check ladder (pure TS) |
| `packages/foc` | `@stamper/foc` | Synapse SDK wrapper + mock FOC |
| `packages/marking` | `@stamper/marking` | badge, share card, perceptual hash, watermark hooks |
| `packages/minimise` | `@stamper/minimise` | EXIF / MP4 metadata minimiser (pure TS) |
| `infra/` | | Compose (api, worker, ml, Explorer, app, Postgres, Caddy), deploy and ops scripts, runbooks |

## Commands

```sh
pnpm install
pnpm build && pnpm test
pnpm lint && pnpm typecheck
pnpm test:contracts      # forge test --root contracts
pnpm test:anvil          # @anvil tests; needs ANVIL_RPC_URL
pnpm test:infra          # compose, Caddy, env and script checks
pnpm abi                 # regenerate @stamper/contracts-abi
pnpm pack:packages       # build + pack @stamper/* into .packs/ (what npm publish would upload)
```

## Publishing the packages

The five `packages/*` are public npm packages (`MIT OR Apache-2.0`), version 0.1.0. To publish:
`pnpm build && pnpm -r --filter './packages/*' publish --access public` (or push a `v*` tag; the
`publish` workflow needs an `NPM_TOKEN` secret). Until they are on npm, the other repos install them
from `vendor/*.tgz`, copied from this repo's `.packs/` by their `scripts/sync-protocol.sh`.

## Toolchain

Node ≥ 22.12, pnpm 10.32, TypeScript ~6.0.3, Foundry 1.3.5. Versions come from the `catalog:` in
`pnpm-workspace.yaml`.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
