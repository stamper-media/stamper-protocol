// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StampRegistry} from "../src/StampRegistry.sol";

/// @notice Governor role changes. ACTION = addRegistrar | removeRegistrar | addBinder | removeBinder.
/// ACTION=addRegistrar REGISTRY=0x.. WHO=0x.. forge script script/Roles.s.sol --rpc-url calibration --broadcast \
///   (--private-key via DEPLOYER_PK, or --ledger on mainnet)
contract Roles is Script {
    function run() external {
        StampRegistry registry = StampRegistry(vm.envAddress("REGISTRY"));
        address who = vm.envAddress("WHO");
        bytes32 action = keccak256(bytes(vm.envString("ACTION")));
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        if (action == keccak256("addRegistrar")) registry.addRegistrar(who);
        else if (action == keccak256("removeRegistrar")) registry.removeRegistrar(who);
        else if (action == keccak256("addBinder")) registry.addBinder(who);
        else if (action == keccak256("removeBinder")) registry.removeBinder(who);
        else revert("Roles: unknown ACTION");
        vm.stopBroadcast();
        console2.log("registrar active from", registry.registrarActiveFrom(who));
        console2.log("binder active from", registry.binderActiveFrom(who));
    }
}
