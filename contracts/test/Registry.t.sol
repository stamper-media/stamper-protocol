// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {MockERC1271} from "../src/mocks/MockERC1271.sol";
import {Cids} from "../src/lib/Cids.sol";

contract RegistryTest is Fixtures {
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

    function test_frozenTypehashes() public view {
        assertEq(
            reg.CLAIM_TYPEHASH(),
            keccak256(
                "CaptureClaim(bytes32 contentHash,bytes pieceCid,uint64 contentLength,uint8 mediaKind,uint64 capturedAt,bytes32 recordHash,bytes32 keyId,uint64 nonce,uint8 flags,uint64 deadline)"
            )
        );
        assertEq(reg.CLAIM_TYPEHASH(), 0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d);
        assertEq(
            reg.ENROL_TYPEHASH(),
            keccak256(
                "KeyEnrolment(bytes32 keyId,uint8 keyType,uint8 platform,uint8 level,bytes32 x,bytes32 y,address addr,bytes32 rpIdHash,bytes32 attestationHash,uint64 expiresAt)"
            )
        );
        assertEq(reg.ENROL_TYPEHASH(), 0x7cb29957345ff6dd94fc3cb78ee4044ae8619ff8786f86bb6c77f22c441843e7);
        assertEq(
            reg.POP_TYPEHASH(),
            keccak256("KeyPossession(bytes32 keyId,uint8 keyType,uint8 platform,bytes32 x,bytes32 y,address addr)")
        );
        assertEq(reg.POP_TYPEHASH(), 0xfc0478f5a3dfeff23ec3fb1779f37df3143b281d435c0e0de41764917e479cd8);
        assertEq(reg.COUNTER_TYPEHASH(), keccak256("CaptureCountersignature(bytes32 stampId,uint8 level)"));
        assertEq(reg.COUNTER_TYPEHASH(), 0xf7fb5b96fbc4c59566fcca7f60f35138b0af22e784946255d4442bf44c788168);
        assertEq(reg.REVOKE_TYPEHASH(), keccak256("KeyRevocation(bytes32 keyId,uint64 effectiveEpoch,uint8 reason)"));
        assertEq(reg.REVOKE_TYPEHASH(), 0x169060174d2edeac658ea958ad9e96c24d210e733ea82d4211aa7de1653292da);
        assertEq(
            reg.DERIV_TYPEHASH(),
            keccak256(
                "DerivativeAttachment(bytes32 stampId,bytes32 contentHash,bytes pieceCid,uint8 kind,bytes32 paramsHash)"
            )
        );
        assertEq(reg.DERIV_TYPEHASH(), 0xa07110a54c833a87d3b59fba0bff52f23466711b8ae0691c319c8db808e704a8);
    }

    function test_hashClaimIsEip712Digest() public view {
        StampRegistry.CaptureClaim memory c = _claim(bytes32(uint256(1)), 1);
        bytes32 sh = keccak256(
            abi.encode(
                reg.CLAIM_TYPEHASH(),
                c.contentHash,
                keccak256(c.pieceCid),
                c.contentLength,
                c.mediaKind,
                c.capturedAt,
                c.recordHash,
                c.keyId,
                c.nonce,
                c.flags,
                c.deadline
            )
        );
        assertEq(reg.hashClaim(c), _digest(sh));
    }

    function test_registerStamp_countersigned_level1() public {
        bytes32 keyId = _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory c = _claim(keyId, 1);
        bytes32 id = reg.hashClaim(c);
        (uint40 predicted,) = reg.predictCode(id);
        bytes memory sig = _sign(devicePk, id);
        bytes memory cs = _countersig(1, id);
        vm.expectEmit(true, true, false, true, address(reg));
        emit Commit(stranger, string.concat("f", _lowerHex(c.pieceCid)), "");
        vm.prank(stranger);
        (bytes32 stampId, uint40 code) = reg.registerStamp(c, sig, "", cs);
        assertEq(stampId, id);
        assertEq(code, predicted);
        StampRegistry.Stamp memory s = reg.getStamp(stampId);
        assertEq(s.level, 1);
        assertEq(s.countersigner, registrar);
        assertEq(s.code, code);
        assertEq(s.registeredEpoch, block.number);
        assertEq(s.pieceCid, c.pieceCid);
        assertEq(s.sig.length, 65);
        assertEq(reg.stampByCode(code), stampId);
        assertEq(reg.firstStampOf(c.contentHash), stampId);
        assertEq(reg.effectiveLevel(stampId), 1);
        assertTrue(reg.verifyClaim(c, s.sig, ""));
    }

    function test_softwareKeyWithoutCountersig_isLevel0() public {
        _enrolSecp(devicePk, 2);
        (bytes32 id,,) = _stamp(devicePk, 1, 255);
        assertEq(reg.getStamp(id).level, 0);
        assertEq(reg.getStamp(id).countersigner, address(0));
    }

    function test_countersigLevelBelowKeyLevel() public {
        _enrolSecp(devicePk, 2);
        (bytes32 id,,) = _stamp(devicePk, 1, 1);
        assertEq(reg.getStamp(id).level, 1);
    }

    function test_revert_countersigAboveKeyLevel() public {
        _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        bytes32 id = reg.hashClaim(c);
        bytes memory sig = _sign(devicePk, id);
        bytes memory cs = _countersig(2, id);
        vm.expectRevert("CsLevel");
        reg.registerStamp(c, sig, "", cs);
    }

    function test_revert_countersigByStranger() public {
        _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        bytes32 id = reg.hashClaim(c);
        bytes memory sig = _sign(devicePk, id);
        bytes32 h = keccak256(abi.encode(reg.COUNTER_TYPEHASH(), id, uint8(1)));
        bytes memory cs = abi.encodePacked(uint8(1), _sign(0xBAD, _digest(h)));
        vm.expectRevert("NotRegistrar");
        reg.registerStamp(c, sig, "", cs);
        vm.expectRevert("CsLen");
        reg.registerStamp(c, sig, "", hex"01");
    }

    function test_revert_registerStamp_checks() public {
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        vm.expectRevert("NoKey");
        reg.registerStamp(c, "", "", "");

        _enrolSecp(devicePk, 1);
        c.deadline = uint64(block.timestamp - 1);
        vm.expectRevert("Expired");
        reg.registerStamp(c, "", "", "");

        c = _claim(_keyId(device), 1);
        c.mediaKind = 3;
        vm.expectRevert(bytes("Kind"));
        reg.registerStamp(c, "", "", "");

        c = _claim(_keyId(device), 1);
        c.pieceCid = hex"0170122022000a";
        vm.expectRevert(Cids.InvalidCommPv2Prefix.selector);
        reg.registerStamp(c, "", "", "");

        c = _claim(_keyId(device), 1);
        c.pieceCid = "";
        vm.expectRevert(Cids.CidTooShort.selector);
        reg.registerStamp(c, "", "", "");

        c = _claim(_keyId(device), 1);
        bytes memory wrong = _sign(0xBAD, reg.hashClaim(c));
        vm.expectRevert("BadSig");
        reg.registerStamp(c, wrong, "", "");
        vm.expectRevert("BadSig");
        reg.registerStamp(c, hex"00", "", "");
    }

    function test_revert_keyExpired() public {
        _enrolSecp(devicePk, 1);
        vm.warp(block.timestamp + 366 days);
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        bytes memory sig = _sign(devicePk, reg.hashClaim(c));
        vm.expectRevert("KeyExpired");
        reg.registerStamp(c, sig, "", "");
    }

    function test_nonceBitmap_orderIndependent_andDupClaim() public {
        bytes32 keyId = _enrolSecp(devicePk, 1);
        _stamp(devicePk, 300, 255);
        _stamp(devicePk, 5, 255);
        _stamp(devicePk, 256, 255);
        _stamp(devicePk, 255, 255);
        assertEq(reg.usedNonce(keyId, 0), (uint256(1) << 5) | (uint256(1) << 255));
        assertEq(reg.usedNonce(keyId, 1), (uint256(1) << 0) | (uint256(1) << 44));
        // replaying the identical claim (same id) is caught by its nonce bit
        StampRegistry.CaptureClaim memory c = _claim(keyId, 5);
        bytes memory sig = _sign(devicePk, reg.hashClaim(c));
        vm.expectRevert("NonceUsed");
        reg.registerStamp(c, sig, "", "");
    }

    function test_firstStampOf_keepsEarliest() public {
        _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory a = _claim(_keyId(device), 1);
        StampRegistry.CaptureClaim memory b = _claim(_keyId(device), 2);
        b.contentHash = a.contentHash;
        (bytes32 idA,) = reg.registerStamp(a, _sign(devicePk, reg.hashClaim(a)), "", "");
        (bytes32 idB,) = reg.registerStamp(b, _sign(devicePk, reg.hashClaim(b)), "", "");
        assertTrue(idA != idB);
        assertEq(reg.firstStampOf(a.contentHash), idA);
    }

    function test_verifyClaim_falseCases() public {
        StampRegistry.CaptureClaim memory c = _claim(_keyId(device), 1);
        assertFalse(reg.verifyClaim(c, "", ""));
        _enrolSecp(devicePk, 0);
        assertFalse(reg.verifyClaim(c, _sign(0xBAD, reg.hashClaim(c)), ""));
        assertTrue(reg.verifyClaim(c, _sign(devicePk, reg.hashClaim(c)), ""));
    }

    // ---- ERC-1271
    function _enrol1271() internal returns (MockERC1271 wallet, bytes32 keyId) {
        wallet = new MockERC1271(device);
        StampRegistry.KeyEnrolment memory e = _enrolment(address(wallet), 3, 0);
        reg.registerKey(e, _sign(devicePk, _digest(_popHash(e))), "");
        keyId = e.keyId;
    }

    function test_erc1271_path() public {
        (, bytes32 keyId) = _enrol1271();
        StampRegistry.CaptureClaim memory c = _claim(keyId, 1);
        (bytes32 id,) = reg.registerStamp(c, _sign(devicePk, reg.hashClaim(c)), "", "");
        assertEq(reg.getStamp(id).level, 0);
        StampRegistry.CaptureClaim memory c2 = _claim(keyId, 2);
        bytes memory bad = _sign(0xBAD, reg.hashClaim(c2));
        vm.expectRevert("BadSig");
        reg.registerStamp(c2, bad, "", "");
    }

    function test_erc1271_reentrancyAttemptReverts() public {
        (MockERC1271 wallet, bytes32 keyId) = _enrol1271();
        StampRegistry.CaptureClaim memory inner = _claim(keyId, 9);
        bytes memory innerSig = _sign(devicePk, reg.hashClaim(inner));
        wallet.setReenter(address(reg), abi.encodeCall(reg.registerStamp, (inner, innerSig, "", "")));
        StampRegistry.CaptureClaim memory c = _claim(keyId, 1);
        bytes memory sig = _sign(devicePk, reg.hashClaim(c));
        vm.expectRevert();
        reg.registerStamp(c, sig, "", "");
        assertEq(reg.getStamp(reg.hashClaim(inner)).registeredEpoch, 0);
    }

    // ---- derivatives
    function _derivSig(uint256 pk, bytes32 stampId, StampRegistry.Derivative memory d)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(
            abi.encode(reg.DERIV_TYPEHASH(), stampId, d.contentHash, keccak256(d.pieceCid), d.kind, d.paramsHash)
        );
        return _sign(pk, _digest(h));
    }

    function test_attachDerivative() public {
        _enrolSecp(devicePk, 1);
        (bytes32 id,,) = _stamp(devicePk, 1, 1);
        StampRegistry.Derivative memory d = StampRegistry.Derivative(keccak256("marked"), "", 1, keccak256("params"));
        vm.prank(stranger);
        reg.attachDerivative(id, d, _derivSig(registrarPk, id, d));
        assertEq(reg.getDerivatives(id).length, 1);
        assertEq(reg.stampByDerivativeHash(d.contentHash), id);

        bytes memory sig = _derivSig(registrarPk, id, d);
        vm.expectRevert("DupDerivative");
        reg.attachDerivative(id, d, sig);

        StampRegistry.Derivative memory d2 = StampRegistry.Derivative(keccak256("card"), "", 3, keccak256("p"));
        sig = _derivSig(0xBAD, id, d2);
        vm.expectRevert("NotRegistrar");
        reg.attachDerivative(id, d2, sig);

        sig = _derivSig(registrarPk, bytes32(uint256(7)), d2);
        vm.expectRevert("NoStamp");
        reg.attachDerivative(bytes32(uint256(7)), d2, sig);

        d2.kind = 0;
        sig = _derivSig(registrarPk, id, d2);
        vm.expectRevert(bytes("Kind"));
        reg.attachDerivative(id, d2, sig);
    }

    function _lowerHex(bytes memory b) internal pure returns (string memory) {
        bytes memory a = "0123456789abcdef";
        bytes memory o = new bytes(b.length * 2);
        for (uint256 i; i < b.length; i++) {
            o[2 * i] = a[uint8(b[i]) >> 4];
            o[2 * i + 1] = a[uint8(b[i]) & 15];
        }
        return string(o);
    }
}
