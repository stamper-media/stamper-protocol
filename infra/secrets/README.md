# Docker secrets (api only)

Each file below is mounted at `/run/secrets/<name>` **only into the `api` container** (the custodian)
and reaches the process as `<NAME>_FILE`. The worker refuses to boot if any `*_FILE` or raw key is in
its environment. Create the real files next to the `.example` templates, `chmod 600`, and never commit
or copy them anywhere else.

| File | Env (in api) | Content | How to create |
|---|---|---|---|
| `relayer_pk` | `RELAYER_PK_FILE` | 32-byte hex secp256k1 key; pays gas for `registerStamp`/`bindStorage` | `cast wallet new` |
| `registrar_pk` | `REGISTRAR_PK_FILE` | 32-byte hex key; its address is announced with `addRegistrar` (active after 48 h) | `cast wallet new` |
| `foc_session_pk` | `FOC_SESSION_PK_FILE` | 32-byte hex FOC session key (AddPieces only, 7-day expiry) | `infra/scripts/foc-session-rotate.sh generate` |
| `resolver_owner_pk` | `RESOLVER_OWNER_PK_FILE` | 32-byte hex key owning `StampResolver` (flags, withdrawals) | `cast wallet new` |
| `record_wrap_key` | `RECORD_WRAP_KEY_FILE` | 32 random bytes, hex; wraps private capture records | `openssl rand -hex 32` |
| `play_sa.json` | `PLAY_SA_JSON_FILE` | Google service-account JSON for Play Integrity decoding | Google Cloud console |

Write a key without leaving it in shell history:

```sh
umask 077
cast wallet new --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].private_key))' > infra/secrets/relayer_pk
openssl rand -hex 32 > infra/secrets/record_wrap_key
```

Keys that are **never** on the VPS: the FOC payer key (`FOC_PAYER_PK`, laptop ceremonies only) and the
governor key (`DEPLOYER_PK` on Calibration, a hardware wallet on mainnet).

The `.example` files only show the format (all-zero placeholders; zero is not a valid secp256k1
key). Never rename them into place. Dev runs (`scripts/smoke.sh`) generate throwaway anvil keys in a temp directory instead.
