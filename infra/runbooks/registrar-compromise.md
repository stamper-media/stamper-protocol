# Runbook: registrar key compromise

1. **Remove it now** — [registrar-removal.md](registrar-removal.md) (self-removal from the VPS is fastest;
   if the VPS itself is compromised, use the governor path from the laptop).
2. **Find suspicious endorsements:** list `KeyRegistered` events endorsed by the removed registrar since
   the suspected time (`cast logs --address $REGISTRY …`) and compare with `devices` rows in Postgres.
   Keys with no matching enrolment row were not enrolled by Stamper.
3. **Revoke them** with the governor (`revokeKey`, owner path) — `effectiveLevel` is retroactive, so stamps
   from those keys drop to level 0 from the revocation epoch on.
4. **Flag** affected stamps in the resolver (`setFlag(stampId, 5 /* RegistrarRemoved */, reasonUri)`).
5. Rotate every other api secret if the host was the leak source (relayer, session key — see
   [session-key-revoke.md](session-key-revoke.md) — record wrap key, resolver owner) and rebuild the VPS
   from `vps-bootstrap.sh` + backups.
6. Publish an incident note linked from `/status`.
