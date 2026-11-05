// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StampResolver} from "../src/StampResolver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ResolverTest is Test {
    event FlagSet(bytes32 indexed stampId, StampResolver.Flag flag, string reasonUri);
    event VerifierReleased(string release, bytes32 hash);

    address internal ops = makeAddr("resolverOwner");
    StampResolver internal r = new StampResolver(ops);

    function test_flags() public {
        bytes32 id = keccak256("stamp");
        vm.expectEmit(true, false, false, true, address(r));
        emit FlagSet(id, StampResolver.Flag.Disputed, "https://example.invalid/r/1");
        vm.prank(ops);
        r.setFlag(id, StampResolver.Flag.Disputed, "https://example.invalid/r/1");
        assertEq(uint8(r.flag(id)), uint8(StampResolver.Flag.Disputed));
        vm.prank(ops);
        r.setFlag(id, StampResolver.Flag.None, "");
        assertEq(uint8(r.flag(id)), 0);
        vm.prank(ops);
        vm.expectRevert("NoStamp");
        r.setFlag(bytes32(0), StampResolver.Flag.Disputed, "");
    }

    function test_verifierHash() public {
        vm.expectEmit(false, false, false, true, address(r));
        emit VerifierReleased("web-1.0.0", bytes32(uint256(42)));
        vm.prank(ops);
        r.setVerifierHash("web-1.0.0", bytes32(uint256(42)));
        assertEq(r.verifierHash("web-1.0.0"), bytes32(uint256(42)));
        vm.prank(ops);
        vm.expectRevert("Release");
        r.setVerifierHash("", bytes32(0));
    }

    function test_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        r.setFlag(keccak256("x"), StampResolver.Flag.TakedownLegal, "");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        r.setVerifierHash("cli-1", bytes32(0));
    }
}
