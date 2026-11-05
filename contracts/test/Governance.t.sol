// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceTest is Fixtures {
    event RoleAnnounced(address indexed who, bytes32 role, uint64 activeFrom);
    event RoleRemoved(address indexed who, bytes32 role, address by);

    uint256 internal newPk = 0x2E6;

    function test_addRegistrar_48hDelay() public {
        address r = vm.addr(newPk);
        vm.expectEmit(true, false, false, true, address(reg));
        emit RoleAnnounced(r, "REGISTRAR", uint64(block.timestamp + 48 hours));
        vm.prank(gov);
        reg.addRegistrar(r);
        assertEq(reg.registrarActiveFrom(r), block.timestamp + 48 hours);
        assertFalse(reg.isActiveRegistrar(r));

        // endorsement from a not-yet-active registrar is rejected
        StampRegistry.KeyEnrolment memory e = _enrolment(device, 0, 1);
        bytes memory pop = _sign(devicePk, _digest(_popHash(e)));
        bytes memory end = _sign(newPk, _digest(_enrolHash(e)));
        vm.expectRevert("NotRegistrar");
        reg.registerKey(e, pop, end);

        vm.warp(block.timestamp + 48 hours - 1);
        assertFalse(reg.isActiveRegistrar(r));
        vm.warp(block.timestamp + 1);
        assertTrue(reg.isActiveRegistrar(r));
        reg.registerKey(e, pop, end);
        assertEq(reg.getKey(e.keyId).registrar, r);

        vm.prank(gov);
        vm.expectRevert("RoleExists");
        reg.addRegistrar(r);
    }

    function test_onlyOwnerAdds() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reg.addRegistrar(stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reg.addBinder(stranger);
        vm.prank(gov);
        vm.expectRevert("ZeroAddr");
        reg.addRegistrar(address(0));
    }

    function test_removal_immediate_byOwnerOrSelf() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Auth"));
        reg.removeRegistrar(registrar);

        vm.expectEmit(true, false, false, true, address(reg));
        emit RoleRemoved(registrar, "REGISTRAR", registrar);
        vm.prank(registrar);
        reg.removeRegistrar(registrar);
        assertFalse(reg.isActiveRegistrar(registrar));
        vm.prank(gov);
        vm.expectRevert("NoRole");
        reg.removeRegistrar(registrar);

        vm.prank(gov);
        reg.removeBinder(binder);
        assertFalse(reg.isActiveBinder(binder));
    }

    function test_removedRegistrar_cannotCountersign_butStampsKeepLevel() public {
        _enrolSecp(devicePk, 1);
        (bytes32 kept,,) = _stamp(devicePk, 1, 1);
        vm.prank(gov);
        reg.removeRegistrar(registrar);
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 2);
        bytes32 h = reg.hashClaim(c);
        bytes memory sig = _sign(devicePk, h);
        bytes memory cs = _countersig(1, h);
        vm.expectRevert("NotRegistrar");
        reg.registerStamp(c, sig, "", cs);
        assertEq(reg.effectiveLevel(kept), 1);
    }

    function test_pendingBinderIsThirdParty() public {
        address b2 = makeAddr("b2");
        vm.prank(gov);
        reg.addBinder(b2);
        assertFalse(reg.isActiveBinder(b2));
        _enrolSecp(devicePk, 1);
        (bytes32 id,, StampRegistry.CaptureClaim memory c) = _stamp(devicePk, 1, 1);
        uint256 p = pdp.addPiece(1, c.pieceCid);
        vm.prank(b2);
        reg.bindStorage(id, _bind(0, 1, p));
        assertFalse(reg.getBindings(id)[4].trusted);
    }

    function test_ownable2Step() public {
        vm.prank(gov);
        reg.transferOwnership(stranger);
        assertEq(reg.owner(), gov);
        vm.prank(stranger);
        reg.acceptOwnership();
        assertEq(reg.owner(), stranger);
    }
}
