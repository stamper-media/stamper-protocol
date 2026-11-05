// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {IPDPVerifier} from "../src/interfaces/IPDPVerifier.sol";

/// @dev Test-only harness: pre-seeds stampByCode to force collisions.
contract CodeHarness is StampRegistry {
    constructor(IPDPVerifier pdp, address fwss, address gov) StampRegistry(pdp, fwss, gov) {}

    function seed(uint40 code, bytes32 stampId) external {
        stampByCode[code] = stampId;
    }
}

contract CodeTest is Fixtures {
    bytes internal constant ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U";
    CodeHarness internal h;

    function setUp() public override {
        super.setUp();
        h = new CodeHarness(IPDPVerifier(address(pdp)), address(fwss), gov);
    }

    function _display(uint40 code) internal pure returns (string memory) {
        bytes memory o = new bytes(11);
        for (uint256 i; i < 8; i++) {
            o[i < 4 ? i : i + 1] = ALPHA[uint256(code >> (35 - 5 * i)) & 31];
        }
        o[4] = "-";
        o[9] = "-";
        o[10] = ALPHA[code % 37];
        return string(o);
    }

    function test_frozenCodeVectors() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/codes.json"));
        uint256 n = vm.parseJsonUint(json, ".count");
        assertEq(n, 4);
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            bytes32 id = vm.parseJsonBytes32(json, string.concat(p, ".stampId"));
            (uint40 code, uint32 attempt) = reg.predictCode(id);
            assertEq(uint256(code), vm.parseJsonUint(json, string.concat(p, ".code")));
            assertEq(uint256(attempt), vm.parseJsonUint(json, string.concat(p, ".attempt")));
            assertEq(_display(code), vm.parseJsonString(json, string.concat(p, ".display")));
        }
        (uint40 c11,) = reg.predictCode(bytes32(0x1111111111111111111111111111111111111111111111111111111111111111));
        assertEq(_display(c11), "5VEB-TVRA-F");
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_codeProperties_andForcedCollision(bytes32 stampId) public {
        (uint40 code, uint32 attempt) = h.predictCode(stampId);
        assertLt(code % 37, 32);
        assertTrue((code >> 35) != 31, "first symbol Z");
        assertEq(code, uint40(uint256(keccak256(abi.encode(stampId, attempt)))));
        h.seed(code, bytes32(uint256(1)));
        (uint40 next, uint32 nextAttempt) = h.predictCode(stampId);
        assertTrue(next != code);
        assertGt(nextAttempt, attempt);
        assertLt(next % 37, 32);
        assertTrue((next >> 35) != 31);
    }

    function test_registerStamp_skipsSeededCode() public {
        vm.prank(gov);
        h.addRegistrar(registrar);
        vm.warp(block.timestamp + 48 hours);
        reg = h; // reuse fixtures against the harness
        bytes32 keyId = _enrolSecp(devicePk, 1);
        StampRegistry.CaptureClaim memory c = _claim(keyId, 1);
        bytes32 id = h.hashClaim(c);
        (uint40 first,) = h.predictCode(id);
        h.seed(first, bytes32(uint256(0xdead)));
        (bytes32 stampId, uint40 code) = h.registerStamp(c, _sign(devicePk, id), "", _countersig(1, id));
        assertTrue(code != first);
        assertEq(h.stampByCode(code), stampId);
        assertEq(h.stampByCode(first), bytes32(uint256(0xdead)));
    }
}
