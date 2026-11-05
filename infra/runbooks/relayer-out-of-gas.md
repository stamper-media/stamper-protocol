# Runbook: relayer out of gas

Symptoms: queue age alert on `register`/`bind` jobs, api logs `insufficient funds`, tx latency alert.

1. Relayer address: `cast wallet address --private-key "$(cat infra/secrets/relayer_pk)"` (VPS).
2. Balance: `cast balance <addr> --rpc-url $RPC --ether`.
3. Top up from the treasury (laptop). Keep ≥ 30 days of gas at current volume; registrations retry
   automatically, nothing is lost while the relayer is dry (claims stay queued, codes are predicted).
4. If the nonce is stuck (a low-fee tx pending), the relayer replaces it on the next retry; otherwise
   `cast send --nonce <n> --gas-price <higher> <addr> --value 0` with the relayer key clears it.
5. Add a balance metric threshold to `healthcheck.sh` if this recurs.
