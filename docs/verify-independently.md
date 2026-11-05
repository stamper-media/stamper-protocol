# Check a Stamper stamp yourself (chain + Filecoin only)

You do not need Stamper's servers, website or app to check a stamp. Everything below reads public chain
state with [`cast`](https://book.getfoundry.sh/cast/) (Foundry), fetches the original from a Filecoin
storage provider with `curl`, and re-hashes it locally. Every step is executed, line for line, by
[`e2e/verify-independently.sh`](../e2e/verify-independently.sh), which runs in `e2e/run-local.sh`
against a local anvil deployment on every e2e run, and in `e2e/run-calibration.sh` against Calibration.

What a passing check tells you: the bytes you hold were registered under that code by a key enrolled
by the named registrar, at the stated time, and are kept by the listed storage deals. It does not tell
you what the picture shows or whether the scene was staged.

## 0. Parameters

| | Filecoin mainnet (314) | Calibration (314159) |
|---|---|---|
| `RPC` | `https://api.node.glif.io/rpc/v1` (compare with a second RPC, e.g. Ankr) | `https://api.calibration.node.glif.io/rpc/v1` |
| `REG` (StampRegistry) | published per chain in `contracts/deployments/mainnet.json` | `contracts/deployments/calibration.json` |
| `PDP` (PDPVerifier) | `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F` | `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` |
| `FWSS` (FilecoinWarmStorageService proxy) | `0x8408502033C418E1bbC97cE9ac48E5528F371A9f` | `0x02925630df557F957f70E112bA06e50965417CA0` |
| ServiceProviderRegistry | `0xf55dDbf63F1b55c3F1D4FA7e339a68AB7b64A5eB` | `0x839e5c9988e4e9977d40708d0094103c0839Ac9D` |
| Genesis (`block.timestamp = genesis + 30·epoch`) | `1598306400` | `1667326380` |

```sh
RPC=https://api.node.glif.io/rpc/v1
REG=0x…          # StampRegistry
PDP=0xBADd0B92C1c71d02E7d520f64c0876538fa2557F
FWSS=0x8408502033C418E1bbC97cE9ac48E5528F371A9f
CODE=7T00-894W-P # the 9-symbol code printed on the badge
c() { cast call --rpc-url "$RPC" "$@"; }
```

## 1. Code → stampId

The code is 8 symbols of the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (5 bits each, a 40-bit value)
plus a check symbol from `0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U` at index `value mod 37`. Read
`I`/`L` as `1` and `O` as `0`; ignore dashes and spaces.

```sh
VAL=<40-bit value of the first 8 symbols>
ID=$(c $REG "stampByCode(uint40)(bytes32)" $VAL)          # 0x00…00 = not registered
```

## 2. Stamp, key and bindings

```sh
c $REG "getStamp(bytes32)((bytes32,bytes,uint64,uint8,uint64,bytes32,bytes32,uint64,uint8,uint8,address,uint64,uint40,bytes,bytes))" $ID
#   contentHash, pieceCid, contentLength, mediaKind, capturedAt(ms), recordHash, keyId, nonce, flags,
#   level, countersigner, registeredEpoch, code, sig, authData
c $REG "getKey(bytes32)((uint8,uint8,uint8,bytes32,bytes32,address,bytes32,bytes32,address,uint64,uint64,uint64,uint8))" $KEYID
#   keyType, platform, level, x, y, addr, rpIdHash, attestationHash, registrar, enrolledEpoch, expiresAt,
#   revokedEpoch, revokeReason
c $REG "getBindings(bytes32)((uint8,uint256,uint256,address,address,uint64,bool)[])" $ID
#   per slot: asset, setId, pieceId, provider, boundBy, boundEpoch, trusted   (setId 0 = empty slot)
```

## 3. Rebuild the signed claim and check the device signature

The stamp id *is* the EIP-712 digest of the claim, with domain `{ name: "Stamper", version: "1", chainId,
verifyingContract: REG }`. `deadline` is not stored: it is `capturedAt/1000 + 3600`, or `+ 259200` when
flag bit 1 (OFFLINE) is set.

```sh
DOMAIN_TH=$(cast keccak "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
CLAIM_TH=$(cast keccak "CaptureClaim(bytes32 contentHash,bytes pieceCid,uint64 contentLength,uint8 mediaKind,uint64 capturedAt,bytes32 recordHash,bytes32 keyId,uint64 nonce,uint8 flags,uint64 deadline)")
#   == 0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d
DEADLINE=$(( CAPTUREDAT / 1000 + 3600 ))
DOMSEP=$(cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" $DOMAIN_TH $(cast keccak Stamper) $(cast keccak 1) $(cast chain-id --rpc-url $RPC) $REG))
STRUCT=$(cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint64,uint8,uint64,bytes32,bytes32,uint64,uint8,uint64)" \
  $CLAIM_TH $CONTENTHASH $(cast keccak $PIECECID) $CONTENTLENGTH $MEDIAKIND $CAPTUREDAT $RECORDHASH $KEYID $NONCE $FLAGS $DEADLINE))
DIGEST=$(cast keccak 0x1901${DOMSEP:2}${STRUCT:2})          # must equal $ID
```

* **keyType 0 (secp256k1)**: `sig` is `r ‖ s ‖ v` over the raw `DIGEST` (no EIP-191 prefix, so not
  `cast wallet verify`). Recover it with any secp256k1 library (e.g. viem `recoverAddress({ hash: DIGEST, signature: SIG })`)
  and compare with the key's `addr`. Do not `eth_call` the ecrecover precompile at `0x01`: FEVM answers a direct
  call to a precompile with empty data (it is reachable only from contracts), although anvil answers it.
* **keyType 1 (P-256 raw)**: verify `sig` (`r ‖ s`) over `sha256(DIGEST)` against `(x, y)` with any P-256
  library (e.g. `@noble/curves` `p256.verify`).
* **keyType 2 (App Attest)**: verify over `sha256(authData ‖ sha256(DIGEST))`; `authData[0:32]` must equal
  the key's `rpIdHash` and `authData[33:37]` the low 32 bits of `NONCE`.
  For key types 0, 1 and 2 `e2e/verify-independently.sh` runs `verifyDeviceSignature` from `@stamper/core`
  (noble secp256k1 or P-256) on the `getKey` fields `addr` (type 0) or `x`, `y`, `rpIdHash`, and the `getStamp` fields `sig`, `authData`, `nonce`.
* **keyType 3 (ERC-1271 contract wallet)**: ask the wallet itself:
  `c $KEY_ADDR "isValidSignature(bytes32,bytes)(bytes4)" $DIGEST $SIG` must return `0x1626ba7e`.

The `countersigner` must be the key's `registrar`, and `level` tells you what the registrar checked at
enrolment (see the level table on the verify page).

## 4. Storage bindings (per non-empty slot)

```sh
c $PDP "dataSetLive(uint256)(bool)" $SET                         # true
c $PDP "pieceLive(uint256,uint256)(bool)" $SET $PIECE            # true
c $PDP "getPieceCid(uint256,uint256)((bytes))" $SET $PIECE      # == pieceCid from getStamp
c $PDP "getDataSetListener(uint256)(address)" $SET              # == $FWSS
VIEW=$(c $FWSS "viewContractAddress()(address)")                # never pin the view address
c $VIEW "provenThisPeriod(uint256)(bool)" $SET
c $VIEW "provingDeadline(uint256)(uint256)" $SET
c $VIEW "getDataSet(uint256)" $SET                               # payer, payee, providerId, pdpEndEpoch, …
```

`c $REG "bindingStatus(bytes32,uint8)" $ID $SLOT` bundles these checks into one call (dataSetLive,
pieceLive, cidMatches, listenerIsFWSS, proving state); the steps above do not rely on it.

## 5. Fetch the original

The provider's `serviceURL` comes from the ServiceProviderRegistry entry of the data set's `providerId`
(`getDataSet(...).providerId`, then the provider's PDP product in the registry; the Synapse SDK does this
lookup). Then, with the PieceCID in text form (`bafkzcib…`):

```sh
curl -o original.bin "$SERVICE_URL/piece/$PIECECID_TEXT"
#   or, when the stamp is served through FilBeam:  curl -o original.bin "https://<payer>.filbeam.io/$PIECECID_TEXT"
```

To turn the `pieceCid` bytes from `getStamp` into text: `CID.decode(bytes).toString()` with the
`multiformats` package, or `pieceCidString(parsePieceCid(hex))` from `@stamper/core`.

## 6. Re-hash

```sh
sha256sum original.bin                                           # == contentHash
node --input-type=module -e "import * as P from '@filoz/synapse-core/piece'; import {readFileSync} from 'node:fs';
  console.log(String(P.calculate(new Uint8Array(readFileSync('original.bin')))))"   # == pieceCid
wc -c < original.bin                                             # == contentLength
```

If both hashes agree with the chain, the file is the ORIGINAL of that stamp.

## 7. Time and finality

```sh
date -u -d @$((1598306400 + 30*REGISTEREDEPOCH))     # mainnet; Calibration: 1667326380
cast block finalized -f number --rpc-url $RPC          # registeredEpoch <= this ⇒ final
```

`capturedAt` is the device's clock (milliseconds); the chain time above is the earliest time the stamp
provably existed.

## Running the script

```sh
RPC=… REG=… PDP=… FWSS=… CODE=7T00-894W-P PROVIDER_URL=https://sp.example e2e/verify-independently.sh
# or FILBEAM_BASE=https://<payer>.filbeam.io instead of PROVIDER_URL
```

It prints one `ok`/`FAIL` line per check and exits non-zero when any check fails. On anvil
(`e2e/run-local.sh`) the PDP verifier and FWSS are the mocks from `DeployLocal`, the provider is the
local mock SP, and step 7 prints the block timestamp because anvil has no Filecoin genesis.
