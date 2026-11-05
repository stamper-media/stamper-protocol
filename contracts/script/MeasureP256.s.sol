// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Measures the gas a contract pays around a P256VERIFY (0x0100) staticcall on FEVM.
contract P256GasProbe {
    event Measured(uint256 gasUsed, bool ok, uint256 outLength);

    function measure(bytes calldata input) external returns (uint256 used, bool valid) {
        uint256 g = gasleft();
        (bool ok, bytes memory out) = address(0x100).staticcall(input);
        used = g - gasleft();
        valid = ok && out.length == 32 && out[31] == 0x01;
        emit Measured(used, valid, out.length);
    }
}

/// @notice Week-1 spike (ADR-005): record, do not act on. Needs a funded Calibration key:
/// DEPLOYER_PK=... forge script script/MeasureP256.s.sol --rpc-url calibration --broadcast --skip-simulation --slow
/// then read the Measured events / receipts and record them in docs/spikes/p256-gas.md.
contract MeasureP256 is Script {
    function run() external {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/p256.json"));
        uint256 pk = vm.envUint("DEPLOYER_PK");
        vm.startBroadcast(pk);
        P256GasProbe probe = new P256GasProbe();
        for (uint256 i; i < 2; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i == 0 ? 0 : 3), "]");
            bytes memory input = abi.encodePacked(
                vm.parseJsonBytes32(json, string.concat(p, ".hash")),
                vm.parseJsonBytes32(json, string.concat(p, ".r")),
                vm.parseJsonBytes32(json, string.concat(p, ".s")),
                vm.parseJsonBytes32(json, string.concat(p, ".x")),
                vm.parseJsonBytes32(json, string.concat(p, ".y"))
            );
            (uint256 used, bool valid) = probe.measure(input);
            console2.log(i == 0 ? "valid vector" : "invalid vector", used, valid);
        }
        vm.stopBroadcast();
        console2.log("probe", address(probe));
    }
}
