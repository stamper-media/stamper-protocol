// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";

/// @notice Gas reference points recorded in .gas-snapshot (`forge snapshot --match-path test/Gas.t.sol`).
contract GasTest is Fixtures {
    StampRegistry.CaptureClaim internal c;
    bytes internal sig;
    bytes internal cs;
    bytes32 internal id;

    function setUp() public override {
        super.setUp();
        _enrolSecp(devicePk, 1);
        c = _claim(_keyId(device), 1);
        id = reg.hashClaim(c);
        sig = _sign(devicePk, id);
        cs = _countersig(1, id);
    }

    function test_gas_registerStamp_secp256k1_countersig() public {
        vm.startSnapshotGas("registerStamp_secp256k1_countersig");
        reg.registerStamp(c, sig, "", cs);
        vm.stopSnapshotGas();
    }

    function test_gas_bindStorage_two() public {
        reg.registerStamp(c, sig, "", cs);
        pdp.addPiece(1, c.pieceCid);
        pdp.addPiece(2, c.pieceCid);
        StampRegistry.Binding[] memory bs = new StampRegistry.Binding[](2);
        bs[0] = StampRegistry.Binding(0, 1, 0);
        bs[1] = StampRegistry.Binding(0, 2, 0);
        vm.prank(binder);
        vm.startSnapshotGas("bindStorage_two");
        reg.bindStorage(id, bs);
        vm.stopSnapshotGas();
    }
}
