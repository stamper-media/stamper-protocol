// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {MockStateView} from "../src/mocks/MockStateView.sol";

contract BindingTest is Fixtures {
    event StorageUnbound(bytes32 indexed stampId, uint8 slot, uint256 setId, uint256 pieceId, string reason);

    bytes32 internal id;
    bytes internal cid;

    function setUp() public override {
        super.setUp();
        _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory c;
        (id,, c) = _stamp(devicePk, 1, 1);
        cid = c.pieceCid;
        stateView.set(1, _info(address(0xFEE), 7, 9_999), true, 4_242);
        pdp.setProven(1, 90, 120);
    }

    function _piece(uint256 setId) internal returns (uint256) {
        return pdp.addPiece(setId, cid);
    }

    function test_trustedBind_slot0_andStatus() public {
        uint256 p = _piece(1);
        vm.prank(binder);
        reg.bindStorage(id, _bind(0, 1, p));
        StampRegistry.StoredBinding[] memory bs = reg.getBindings(id);
        assertEq(bs.length, 8);
        assertEq(bs[0].setId, 1);
        assertEq(bs[0].provider, sp);
        assertEq(bs[0].boundBy, binder);
        assertTrue(bs[0].trusted);

        StampRegistry.BindingStatus memory st = reg.bindingStatus(id, 0);
        assertTrue(st.dataSetLive && st.pieceLive && st.cidMatches && st.listenerIsFWSS && st.viewOk);
        assertTrue(st.provenThisPeriod);
        assertEq(st.lastProvenEpoch, 90);
        assertEq(st.nextChallengeEpoch, 120);
        assertEq(st.provingDeadline, 4_242);
        assertEq(st.pdpEndEpoch, 9_999);
        assertEq(st.payer, address(0xFEE));
        assertEq(st.providerId, 7);

        StampRegistry.BindingStatus memory empty = reg.bindingStatus(id, 5);
        assertFalse(empty.dataSetLive);
        vm.expectRevert(bytes("Slot"));
        reg.bindingStatus(id, 8);
    }

    function test_thirdPartyCannotTakeTrustedSlots() public {
        uint256 p = _piece(1);
        vm.prank(stranger);
        reg.bindStorage(id, _bind(0, 1, p));
        StampRegistry.StoredBinding[] memory bs = reg.getBindings(id);
        assertEq(bs[0].boundEpoch, 0);
        assertEq(bs[4].setId, 1);
        assertFalse(bs[4].trusted);
    }

    function test_revert_bindChecks() public {
        StampRegistry.Binding[] memory b = _bind(0, 1, 0);
        vm.expectRevert("NoStamp");
        reg.bindStorage(bytes32(uint256(1)), b);

        pdp.setDataSet(3, true, stranger, sp);
        pdp.addPiece(3, cid);
        b = _bind(0, 3, 0);
        vm.expectRevert("NotFWSS");
        reg.bindStorage(id, b);

        uint256 p = _piece(1);
        pdp.removePiece(1, p);
        b = _bind(0, 1, p);
        vm.expectRevert("PieceDead");
        reg.bindStorage(id, b);

        p = pdp.addPiece(1, _cid(keccak256("other")));
        b = _bind(0, 1, p);
        vm.expectRevert("CidMismatch");
        reg.bindStorage(id, b);

        b = _bind(1, 1, p);
        vm.expectRevert("NoAsset");
        reg.bindStorage(id, b);

        p = _piece(2);
        pdp.killDataSet(2);
        b = _bind(0, 2, p);
        vm.expectRevert("SetDead");
        reg.bindStorage(id, b);
    }

    function test_revert_derivativeWithoutCid() public {
        StampRegistry.Derivative memory d = StampRegistry.Derivative(keccak256("marked"), "", 1, bytes32(0));
        bytes32 h =
            keccak256(abi.encode(reg.DERIV_TYPEHASH(), id, d.contentHash, keccak256(d.pieceCid), d.kind, d.paramsHash));
        reg.attachDerivative(id, d, _sign(registrarPk, _digest(h)));
        StampRegistry.Binding[] memory b = _bind(1, 1, 0);
        vm.expectRevert("NoCid");
        reg.bindStorage(id, b);
    }

    function test_revert_dupBinding() public {
        uint256 p = _piece(1);
        vm.prank(binder);
        reg.bindStorage(id, _bind(0, 1, p));
        StampRegistry.Binding[] memory b = _bind(0, 1, p);
        vm.expectRevert("DupBinding");
        reg.bindStorage(id, b);
    }

    function test_caps_4plus4_andDeadSlotReuse() public {
        for (uint256 i; i < 4; i++) {
            uint256 p = _piece(1);
            vm.prank(binder);
            reg.bindStorage(id, _bind(0, 1, p));
            uint256 q = _piece(2);
            vm.prank(stranger);
            reg.bindStorage(id, _bind(0, 2, q));
        }
        StampRegistry.Binding[] memory b = _bind(0, 1, _piece(1));
        vm.prank(binder);
        vm.expectRevert("SlotsFull");
        reg.bindStorage(id, b);
        vm.prank(stranger);
        vm.expectRevert("SlotsFull");
        reg.bindStorage(id, b);

        // a removed piece frees its slot for anyone
        pdp.removePiece(1, 2); // slot 2 holds (set 1, piece 2)
        vm.expectEmit(true, false, false, true, address(reg));
        emit StorageUnbound(id, 2, 1, 2, "dead");
        vm.prank(stranger);
        reg.bindStorage(id, b);
        StampRegistry.StoredBinding[] memory bs = reg.getBindings(id);
        assertEq(bs[2].pieceId, b[0].pieceId);
        assertFalse(bs[2].trusted);
    }

    function test_bindingStatus_deadSet_replacedView_revertingView() public {
        uint256 p = _piece(1);
        vm.prank(binder);
        reg.bindStorage(id, _bind(0, 1, p));

        // reverting view: PDP fields still filled, viewOk false
        stateView.setReverting(true);
        StampRegistry.BindingStatus memory st = reg.bindingStatus(id, 0);
        assertTrue(st.dataSetLive && st.cidMatches);
        assertFalse(st.viewOk);
        assertEq(st.payer, address(0));
        stateView.setReverting(false);

        // replaced view is followed at call time
        MockStateView v2 = new MockStateView();
        v2.set(1, _info(address(0xBEEF), 9, 1), false, 77);
        fwss.setView(address(v2));
        st = reg.bindingStatus(id, 0);
        assertTrue(st.viewOk);
        assertEq(st.payer, address(0xBEEF));
        assertEq(st.provingDeadline, 77);

        // view pointer to an address without code
        fwss.setView(stranger);
        assertFalse(reg.bindingStatus(id, 0).viewOk);

        // dead set: zeros everywhere, never reverts
        pdp.killDataSet(1);
        st = reg.bindingStatus(id, 0);
        assertFalse(st.dataSetLive || st.pieceLive || st.cidMatches || st.listenerIsFWSS || st.viewOk);
        assertEq(st.lastProvenEpoch, 0);
    }
}
