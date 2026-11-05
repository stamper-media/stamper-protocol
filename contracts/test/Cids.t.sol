// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Cids} from "../src/lib/Cids.sol";

contract CidsHarness {
    function validate(bytes calldata d) external pure returns (uint256 padding, uint8 height, bytes32 root) {
        return Cids.validateCommPv2(d);
    }

    function bounds(uint256 padding, uint8 height) external pure returns (uint256, uint256) {
        return Cids.pieceSizeBounds(padding, height);
    }
}

contract CidsTest is Test {
    CidsHarness internal h = new CidsHarness();
    bytes32 internal constant ROOT = keccak256("root");

    function test_calibrationVector() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/commpv2.json"));
        bytes memory data = vm.parseJsonBytes(json, ".data");
        (uint256 padding, uint8 height, bytes32 root) = h.validate(data);
        assertEq(padding, vm.parseJsonUint(json, ".padding"));
        assertEq(uint256(height), vm.parseJsonUint(json, ".height"));
        assertEq(root, vm.parseJsonBytes32(json, ".root"));
        (uint256 lo, uint256 hi) = h.bounds(padding, height);
        assertEq(lo, vm.parseJsonUint(json, ".rawPieceSize"));
        assertEq(hi, lo);
    }

    function test_validMinimal() public view {
        (uint256 padding, uint8 height, bytes32 root) = h.validate(abi.encodePacked(hex"0155912022000a", ROOT));
        assertEq(padding, 0);
        assertEq(height, 10);
        assertEq(root, ROOT);
    }

    function test_revert_badPrefix() public {
        vm.expectRevert(Cids.InvalidCommPv2Prefix.selector);
        h.validate(abi.encodePacked(hex"0170912022000a", ROOT));
    }

    function test_revert_nonMinimalUvarint() public {
        // mhLen 34 encoded as 0xa2 0x00
        vm.expectRevert(Cids.NonMinimalUvarint.selector);
        h.validate(abi.encodePacked(hex"01559120a200000a", ROOT));
        // padding 0 encoded as 0x80 0x00 (mhLen 35)
        vm.expectRevert(Cids.NonMinimalUvarint.selector);
        h.validate(abi.encodePacked(hex"015591202380000a", ROOT));
    }

    function test_revert_mhLen33() public {
        vm.expectRevert(Cids.InvalidCommPv2MultihashLength.selector);
        h.validate(abi.encodePacked(hex"015591202100", bytes32(ROOT)));
    }

    function test_revert_truncatedRoot() public {
        vm.expectRevert(Cids.InvalidCommPv2MultihashLength.selector);
        h.validate(abi.encodePacked(hex"0155912022000a", bytes31(ROOT)));
        vm.expectRevert(Cids.CidTooShort.selector);
        h.validate(hex"015591");
        vm.expectRevert(Cids.UnterminatedUvarint.selector);
        h.validate(hex"01559120");
    }
}
