// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StampRegistry} from "../../src/StampRegistry.sol";
import {IPDPVerifier, Cid} from "../../src/interfaces/IPDPVerifier.sol";
import {IFWSS} from "../../src/interfaces/IFWSS.sol";

/// @notice Calibration fork reads. Skipped unless CALIBRATION_RPC_URL is set.
contract CalibrationForkTest is Test {
    IPDPVerifier internal constant PDP = IPDPVerifier(0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C);
    address internal constant FWSS = 0x02925630df557F957f70E112bA06e50965417CA0;
    bytes internal vector;

    function setUp() public {
        string memory rpc = vm.envOr("CALIBRATION_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "CALIBRATION_RPC_URL not set");
            return;
        }
        vm.createSelectFork(rpc);
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/commpv2.json"));
        vector = vm.parseJsonBytes(json, ".data");
    }

    function test_pdpReads_andPinnedVector() public view {
        assertEq(PDP.getDataSetListener(1), FWSS);
        assertTrue(PDP.dataSetLive(1));
        assertEq(PDP.getPieceCid(1, 0).data, vector, "FRC-0069 vector drifted: update test/vectors/commpv2.json");
        address v = IFWSS(FWSS).viewContractAddress();
        assertTrue(v.code.length > 0);
    }

    function test_bindingStatus_throughRealView() public {
        StampRegistry reg = new StampRegistry(PDP, FWSS, address(this));
        uint256 pk = 0xD3F1CE;
        address dev = vm.addr(pk);
        StampRegistry.KeyEnrolment memory e;
        e.keyId = bytes32(uint256(uint160(dev)));
        e.addr = dev;
        e.expiresAt = uint64(block.timestamp + 1 days);
        bytes32 pop = keccak256(abi.encode(reg.POP_TYPEHASH(), e.keyId, e.keyType, e.platform, e.x, e.y, e.addr));
        reg.registerKey(e, _sig(pk, _digest(reg, pop)), "");
        StampRegistry.CaptureClaim memory c;
        c.pieceCid = vector;
        c.mediaKind = 1;
        c.keyId = e.keyId;
        c.deadline = uint64(block.timestamp + 1 hours);
        (bytes32 id,) = reg.registerStamp(c, _sig(pk, reg.hashClaim(c)), "", "");
        StampRegistry.Binding[] memory bs = new StampRegistry.Binding[](1);
        bs[0] = StampRegistry.Binding(0, 1, 0);
        reg.bindStorage(id, bs);
        StampRegistry.BindingStatus memory st = reg.bindingStatus(id, 4);
        assertTrue(st.dataSetLive && st.pieceLive && st.cidMatches && st.listenerIsFWSS);
        assertTrue(st.viewOk, "StateView resolution failed");
    }

    function _digest(StampRegistry reg, bytes32 sh) internal view returns (bytes32) {
        bytes32 ds = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Stamper"),
                keccak256("1"),
                block.chainid,
                address(reg)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", ds, sh));
    }

    function _sig(uint256 pk, bytes32 h) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        return abi.encodePacked(r, s, v);
    }
}
