# Runbook: registrar removal

The registrar key (`infra/secrets/registrar_pk`, api only) endorses device keys at enrolment.
`removeRegistrar` is **immediate** and may be called by the governor **or by the registrar itself**
(adding a registrar takes 48 h; removing one never waits).

## Fastest path (VPS, registrar removes itself)
```sh
REG=$(grep ^REGISTRY_ADDRESS= infra/.env | cut -d= -f2)
R=$(cast wallet address --private-key "$(cat infra/secrets/registrar_pk)")
cast send "$REG" "removeRegistrar(address)" "$R" --rpc-url "$RPC" --private-key "$(cat infra/secrets/registrar_pk)"
```
(The registrar address needs a little FIL for gas; the relayer can send it.)

## Governor path
Calibration: `REGISTRY=0x… WHO=<registrar> ACTION=removeRegistrar DEPLOYER_PK=0x… forge script script/Roles.s.sol --root contracts --rpc-url calibration --broadcast`
Mainnet: the same with `--ledger --sender <governor>` and no `DEPLOYER_PK`.

## After removal
1. Enrolments fail closed until a new registrar is active: generate a new key into
   `infra/secrets/registrar_pk`, announce it (`EXTRA_REGISTRARS=<addr>` with the deploy script's roles
   step, or `Roles.s.sol ACTION=addRegistrar`), wait 48 h, then `docker compose up -d --force-recreate api`.
2. Stamps already made keep their record; the verify page shows the *Registrar removed* state where the
   registry reports it. Optionally mark affected stamps with the resolver flag `RegistrarRemoved` (5):
   `cast send $RESOLVER "setFlag(bytes32,uint8,string)" <stampId> 5 <reasonUri>` with the resolver owner key.
3. If the key was compromised, continue with [registrar-compromise.md](registrar-compromise.md).
