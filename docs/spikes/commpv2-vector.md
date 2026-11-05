# Spike: PieceCID v2 bytes returned by PDPVerifier (FRC-0069 vector)

Run 2026-10-01, read-only, at Calibration block 4116466:
```
cast call 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C "getPieceCid(uint256,uint256)((bytes))" 1 0 \
  --rpc-url https://api.calibration.node.glif.io/rpc/v1
```
Result (`Cids.Cid.data`, 42 bytes):
`0x015591202586bdb70313ae7192454f8e556bf57b22b63b61a6313924334ed80f257e47291a377d351b3e`

| Part | Bytes | Value |
|---|---|---|
| CIDv1 / raw / fr32-sha256-trunc254 prefix | `01 55 91 20` | — |
| mhLen (uvarint) | `25` | 37 |
| padding (uvarint) | `86 bd b7 03` | 7,200,390 |
| height | `13` | 19 |
| root | 32 bytes | `ae7192…7d351b3e` |

Text form: `bafkzcibfq263oaytvzyzerkprzkwx5l3ek3dwyngge4sim2o3ahsk7shfendo7jvdm7a`. Raw piece size =
2^17·127 − 7,200,390 = 9,445,754 bytes. At the same block, `dataSetLive(1) = true`, `pieceLive(1,0) = true` and
`getDataSetListener(1)` = the FWSS proxy `0x02925630df557F957f70E112bA06e50965417CA0`.

Pinned in `contracts/test/vectors/commpv2.json`, used by `test/Cids.t.sol` (validator vector) and
`test/fork/Calibration.t.sol` (drift check). The fork suite passed against the public Glif RPC, including
`bindingStatus` resolving the live StateView (`viewOk = true`). Re-read before the mainnet deploy, because
FRC-0069 is still a Draft.
