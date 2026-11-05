// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StampRegistry} from "../../src/StampRegistry.sol";
import {MockPDPVerifier} from "../../src/mocks/MockPDPVerifier.sol";
import {MockFWSS} from "../../src/mocks/MockFWSS.sol";
import {MockStateView} from "../../src/mocks/MockStateView.sol";
import {IFWSSStateView} from "../../src/interfaces/IFWSSStateView.sol";
import {IPDPVerifier} from "../../src/interfaces/IPDPVerifier.sol";

/// @notice Shared deployment, EIP-712 signing helpers (vm.sign) and canonical fixtures.
abstract contract Fixtures is Test {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    StampRegistry internal reg;
    MockPDPVerifier internal pdp;
    MockFWSS internal fwss;
    MockStateView internal stateView;

    address internal gov = makeAddr("governor");
    uint256 internal registrarPk = 0xA11CE;
    address internal registrar;
    address internal binder = makeAddr("binder");
    address internal sp = makeAddr("sp");
    address internal stranger = makeAddr("stranger");
    uint256 internal devicePk = 0xD3F1CE;
    address internal device;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.roll(100);
        registrar = vm.addr(registrarPk);
        device = vm.addr(devicePk);
        pdp = new MockPDPVerifier();
        stateView = new MockStateView();
        fwss = new MockFWSS(address(stateView));
        reg = new StampRegistry(IPDPVerifier(address(pdp)), address(fwss), gov);
        vm.startPrank(gov);
        reg.addRegistrar(registrar);
        reg.addBinder(binder);
        vm.stopPrank();
        vm.warp(block.timestamp + 48 hours);
        pdp.setDataSet(1, true, address(fwss), sp);
        pdp.setDataSet(2, true, address(fwss), sp);
    }

    // ---- EIP-712
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Stamper"), keccak256("1"), block.chainid, address(reg)));
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---- fixtures
    function _cid(bytes32 root) internal pure returns (bytes memory) {
        // 0x01 0x55 0x91 0x20 | mhLen 34 | padding 0 | height 10 | root
        return abi.encodePacked(hex"0155912022000a", root);
    }

    function _keyId(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _enrolment(address a, uint8 keyType, uint8 level)
        internal
        view
        returns (StampRegistry.KeyEnrolment memory e)
    {
        e.keyId = _keyId(a);
        e.keyType = keyType;
        e.platform = 1;
        e.level = level;
        e.addr = a;
        e.attestationHash = keccak256("attestation");
        e.expiresAt = uint64(block.timestamp + 365 days);
    }

    function _enrolHash(StampRegistry.KeyEnrolment memory e) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                reg_ENROL(),
                e.keyId,
                e.keyType,
                e.platform,
                e.level,
                e.x,
                e.y,
                e.addr,
                e.rpIdHash,
                e.attestationHash,
                e.expiresAt
            )
        );
    }

    function _popHash(StampRegistry.KeyEnrolment memory e) internal pure returns (bytes32) {
        return keccak256(abi.encode(reg_POP(), e.keyId, e.keyType, e.platform, e.x, e.y, e.addr));
    }

    function reg_ENROL() internal pure returns (bytes32) {
        return 0x7cb29957345ff6dd94fc3cb78ee4044ae8619ff8786f86bb6c77f22c441843e7;
    }

    function reg_POP() internal pure returns (bytes32) {
        return 0xfc0478f5a3dfeff23ec3fb1779f37df3143b281d435c0e0de41764917e479cd8;
    }

    /// @dev Enrols a secp256k1 key; level > 0 adds a registrar endorsement.
    function _enrolSecp(uint256 pk, uint8 level) internal returns (bytes32 keyId) {
        address a = vm.addr(pk);
        StampRegistry.KeyEnrolment memory e = _enrolment(a, 0, level);
        bytes memory pop = _sign(pk, _digest(_popHash(e)));
        bytes memory end = level == 0 ? bytes("") : _sign(registrarPk, _digest(_enrolHash(e)));
        reg.registerKey(e, pop, end);
        return e.keyId;
    }

    function _claim(bytes32 keyId, uint64 nonce) internal view returns (StampRegistry.CaptureClaim memory c) {
        c.contentHash = keccak256(abi.encode("content", nonce));
        c.pieceCid = _cid(keccak256(abi.encode("root", nonce)));
        c.contentLength = 1234;
        c.mediaKind = 1;
        c.capturedAt = uint64(block.timestamp * 1000);
        c.recordHash = keccak256(abi.encode("record", nonce));
        c.keyId = keyId;
        c.nonce = nonce;
        c.flags = 0;
        c.deadline = uint64(block.timestamp + 1 hours);
    }

    function _countersig(uint8 level, bytes32 stampId) internal view returns (bytes memory) {
        bytes32 h = keccak256(abi.encode(reg.COUNTER_TYPEHASH(), stampId, level));
        return abi.encodePacked(level, _sign(registrarPk, _digest(h)));
    }

    /// @dev Registers a claim signed by `pk`, optionally countersigned at `csLevel` (255 = none).
    function _stamp(uint256 pk, uint64 nonce, uint8 csLevel)
        internal
        returns (bytes32 stampId, uint40 code, StampRegistry.CaptureClaim memory c)
    {
        c = _claim(_keyId(vm.addr(pk)), nonce);
        bytes32 id = reg.hashClaim(c);
        bytes memory cs = csLevel == 255 ? bytes("") : _countersig(csLevel, id);
        (stampId, code) = reg.registerStamp(c, _sign(pk, id), "", cs);
    }

    function _info(address payer, uint256 providerId, uint256 endEpoch)
        internal
        pure
        returns (IFWSSStateView.DataSetInfoView memory v)
    {
        v.payer = payer;
        v.providerId = providerId;
        v.pdpEndEpoch = endEpoch;
    }

    function _bind(uint8 asset, uint256 setId, uint256 pieceId)
        internal
        pure
        returns (StampRegistry.Binding[] memory bs)
    {
        bs = new StampRegistry.Binding[](1);
        bs[0] = StampRegistry.Binding(asset, setId, pieceId);
    }
}
