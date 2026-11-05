// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {MockPDPVerifier} from "../src/mocks/MockPDPVerifier.sol";
import {MockFWSS} from "../src/mocks/MockFWSS.sol";
import {MockStateView} from "../src/mocks/MockStateView.sol";
import {IPDPVerifier} from "../src/interfaces/IPDPVerifier.sol";

/// @notice The integration test of WP-01: the whole on-chain life of one stamp on MockPDPVerifier.
contract FlowTest is Fixtures {
    event StorageUnbound(bytes32 indexed stampId, uint8 slot, uint256 setId, uint256 pieceId, string reason);

    function setUp() public override {
        // deliberately not calling Fixtures.setUp: the flow performs every step itself
        vm.warp(1_700_000_000);
        vm.roll(100);
        registrar = vm.addr(registrarPk);
        device = vm.addr(devicePk);
    }

    function test_flow() public {
        // deploy
        pdp = new MockPDPVerifier();
        stateView = new MockStateView();
        fwss = new MockFWSS(address(stateView));
        reg = new StampRegistry(IPDPVerifier(address(pdp)), address(fwss), gov);
        pdp.setDataSet(1, true, address(fwss), sp);
        pdp.setDataSet(2, true, address(fwss), makeAddr("sp2"));

        // add registrar/binder, warp 48 h
        vm.startPrank(gov);
        reg.addRegistrar(registrar);
        reg.addBinder(binder);
        vm.stopPrank();
        vm.warp(block.timestamp + 48 hours);

        // registerKey (secp256k1 + endorsement L1)
        bytes32 keyId = _enrolSecp(devicePk, 1);
        assertEq(reg.getKey(keyId).level, 1);

        // registerStamp with countersig => level 1
        StampRegistry.CaptureClaim memory c = _claim(keyId, 1);
        bytes32 h = reg.hashClaim(c);
        vm.prank(binder); // the relayer submits
        (bytes32 id, uint40 code) = reg.registerStamp(c, _sign(devicePk, h), "", _countersig(1, h));
        assertEq(reg.getStamp(id).level, 1);
        assertEq(reg.stampByCode(code), id);

        // attachDerivative
        StampRegistry.Derivative memory d = StampRegistry.Derivative(keccak256("marked"), "", 1, keccak256("params"));
        bytes32 dh =
            keccak256(abi.encode(reg.DERIV_TYPEHASH(), id, d.contentHash, keccak256(d.pieceCid), d.kind, d.paramsHash));
        reg.attachDerivative(id, d, _sign(registrarPk, _digest(dh)));
        assertEq(reg.stampByDerivativeHash(d.contentHash), id);

        // addPiece on sets 1 and 2 with the claim's CID; bind both as the trusted binder => slots 0 and 1
        uint256 p1 = pdp.addPiece(1, c.pieceCid);
        uint256 p2 = pdp.addPiece(2, c.pieceCid);
        StampRegistry.Binding[] memory bs = new StampRegistry.Binding[](2);
        bs[0] = StampRegistry.Binding(0, 1, p1);
        bs[1] = StampRegistry.Binding(0, 2, p2);
        vm.prank(binder);
        reg.bindStorage(id, bs);
        StampRegistry.StoredBinding[] memory stored = reg.getBindings(id);
        assertEq(stored[0].setId, 1);
        assertEq(stored[1].setId, 2);
        assertTrue(stored[0].trusted && stored[1].trusted);
        assertTrue(reg.bindingStatus(id, 0).cidMatches);

        // killDataSet(2) => a third party's bind reuses slot 1 and emits StorageUnbound
        pdp.killDataSet(2);
        uint256 p3 = pdp.addPiece(1, c.pieceCid);
        vm.expectEmit(true, false, false, true, address(reg));
        emit StorageUnbound(id, 1, 2, p2, "dead");
        vm.prank(stranger);
        reg.bindStorage(id, _bind(0, 1, p3));
        stored = reg.getBindings(id);
        assertEq(stored[1].setId, 1);
        assertEq(stored[1].pieceId, p3);
        assertEq(stored[1].boundBy, stranger);
        assertFalse(stored[1].trusted);
        assertTrue(reg.bindingStatus(id, 1).cidMatches);
        assertEq(reg.effectiveLevel(id), 1);
    }
}
