// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";

contract KeysTest is Fixtures {
    function test_registerKey_unendorsedIsLevel0() public {
        StampRegistry.KeyEnrolment memory e = _enrolment(device, 0, 2);
        reg.registerKey(e, _sign(devicePk, _digest(_popHash(e))), "");
        StampRegistry.DeviceKey memory k = reg.getKey(e.keyId);
        assertEq(k.level, 0);
        assertEq(k.registrar, address(0));
        assertEq(k.addr, device);
        assertEq(k.enrolledEpoch, block.number);
    }

    function test_registerKey_endorsed_andUpgradeInPlace() public {
        StampRegistry.KeyEnrolment memory e = _enrolment(device, 0, 1);
        bytes memory pop = _sign(devicePk, _digest(_popHash(e)));
        reg.registerKey(e, pop, "");
        vm.roll(block.number + 5);
        reg.registerKey(e, pop, _sign(registrarPk, _digest(_enrolHash(e))));
        StampRegistry.DeviceKey memory k = reg.getKey(e.keyId);
        assertEq(k.level, 1);
        assertEq(k.registrar, registrar);
        assertEq(k.enrolledEpoch, block.number - 5);
        bytes memory end = _sign(registrarPk, _digest(_enrolHash(e)));
        vm.expectRevert("KeyExists");
        reg.registerKey(e, pop, end);
    }

    function test_revert_registerKey_checks() public {
        StampRegistry.KeyEnrolment memory e = _enrolment(device, 0, 1);
        bytes memory pop = _sign(devicePk, _digest(_popHash(e)));
        reg.registerKey(e, pop, "");
        vm.expectRevert("KeyExists");
        reg.registerKey(e, pop, "");

        e = _enrolment(stranger, 0, 1);
        e.keyId = bytes32(uint256(1));
        vm.expectRevert("KeyId");
        reg.registerKey(e, "", "");

        e = _enrolment(stranger, 0, 1);
        bytes memory badPop = _sign(devicePk, _digest(_popHash(e)));
        vm.expectRevert("BadPoP");
        reg.registerKey(e, badPop, "");

        e.keyType = 4;
        vm.expectRevert("KeyType");
        reg.registerKey(e, "", "");

        e = _enrolment(stranger, 0, 1);
        e.platform = 3;
        vm.expectRevert("Platform");
        reg.registerKey(e, "", "");

        e = _enrolment(stranger, 0, 1);
        e.expiresAt = uint64(block.timestamp);
        vm.expectRevert("KeyExpired");
        reg.registerKey(e, "", "");
    }

    function test_revert_endorsementTamperedOrForeign() public {
        StampRegistry.KeyEnrolment memory e = _enrolment(device, 0, 1);
        bytes memory pop = _sign(devicePk, _digest(_popHash(e)));
        bytes memory end = _sign(registrarPk, _digest(_enrolHash(e)));
        e.level = 2; // L1 endorsement replayed as L2
        vm.expectRevert("NotRegistrar");
        reg.registerKey(e, pop, end);
        e.level = 1;
        bytes memory foreign = _sign(0xBAD, _digest(_enrolHash(e)));
        vm.expectRevert("NotRegistrar");
        reg.registerKey(e, pop, foreign);
    }

    function _revocation(uint64 epoch) internal view returns (StampRegistry.KeyRevocation memory r, bytes32 digest) {
        r = StampRegistry.KeyRevocation(_keyId(device), epoch, 2);
        digest = _digest(keccak256(abi.encode(reg.REVOKE_TYPEHASH(), r.keyId, r.effectiveEpoch, r.reason)));
    }

    function test_revokeKey_selfAndRegistrar_forwardOnly() public {
        _enrolSecp(devicePk, 1);
        (StampRegistry.KeyRevocation memory r, bytes32 h) = _revocation(uint64(block.number - 1));
        bytes memory sig = _sign(devicePk, h);
        vm.expectRevert("Retroactive");
        reg.revokeKey(r, sig, "");

        (r, h) = _revocation(uint64(block.number + 10));
        sig = _sign(0xBAD, h);
        vm.prank(stranger);
        vm.expectRevert("BadSig");
        reg.revokeKey(r, sig, "");

        vm.prank(stranger);
        reg.revokeKey(r, _sign(registrarPk, h), "");
        assertEq(reg.getKey(r.keyId).revokedEpoch, block.number + 10);

        // self-revocation may move it earlier, never later
        (r, h) = _revocation(uint64(block.number + 2));
        reg.revokeKey(r, _sign(devicePk, h), "");
        assertEq(reg.getKey(r.keyId).revokedEpoch, block.number + 2);
        (r, h) = _revocation(uint64(block.number + 5));
        sig = _sign(devicePk, h);
        vm.expectRevert("Revoked");
        reg.revokeKey(r, sig, "");

        vm.roll(block.number + 2);
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        sig = _sign(devicePk, reg.hashClaim(c));
        vm.expectRevert("KeyRevoked");
        reg.registerStamp(c, sig, "", "");
    }

    function test_effectiveLevel_retroactiveGovernorRevocation() public {
        _enrolSecp(devicePk, 1);
        (bytes32 early,,) = _stamp(devicePk, 1, 1);
        vm.roll(block.number + 10);
        (bytes32 late,,) = _stamp(devicePk, 2, 1);
        assertEq(reg.effectiveLevel(early), 1);

        // forward revocation leaves both stamps at their level
        (StampRegistry.KeyRevocation memory r,) = _revocation(uint64(block.number + 1));
        vm.prank(gov);
        reg.revokeKey(r, "", "");
        assertEq(reg.effectiveLevel(early), 1);
        assertEq(reg.effectiveLevel(late), 1);

        // retroactive (governor only) zeroes stamps registered at or after the effective epoch
        (r,) = _revocation(uint64(block.number - 5));
        vm.prank(gov);
        reg.revokeKey(r, "", "");
        assertEq(reg.effectiveLevel(early), 1);
        assertEq(reg.effectiveLevel(late), 0);
        assertEq(reg.getStamp(late).level, 1);
    }

    function test_revert_revokeUnknownKey() public {
        (StampRegistry.KeyRevocation memory r,) = _revocation(uint64(block.number + 1));
        vm.prank(gov);
        vm.expectRevert("NoKey");
        reg.revokeKey(r, "", "");
    }
}
