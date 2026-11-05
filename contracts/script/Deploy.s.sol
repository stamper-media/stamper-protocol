// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {StampResolver} from "../src/StampResolver.sol";
import {IPDPVerifier} from "../src/interfaces/IPDPVerifier.sol";
import {IFWSS} from "../src/interfaces/IFWSS.sol";

/// @notice Calibration / mainnet deployment; writes deployments/{calibration,mainnet}.json.
/// Calibration: DEPLOYER_PK=... forge script script/Deploy.s.sol --rpc-url calibration --broadcast --skip-simulation \
///   --slow --retries 10 --timeout 180 --verify --verifier blockscout --verifier-url $BLOCKSCOUT_URL
/// Mainnet: no DEPLOYER_PK; pass --ledger (or --trezor) --sender <governor>.
/// Env: RESOLVER_OWNER_ADDR (required), REGISTRAR_ADDR, BINDER_ADDR (optional; announced, active after 48 h),
/// PDP_VERIFIER, FWSS (default per chain).
contract Deploy is Script {
    function run() external {
        (string memory name, address defPdp, address defFwss) = _chain();
        address pdp = vm.envOr("PDP_VERIFIER", defPdp);
        address fwss = vm.envOr("FWSS", defFwss);
        address resolverOwner = vm.envAddress("RESOLVER_OWNER_ADDR");
        address registrar = vm.envOr("REGISTRAR_ADDR", address(0));
        address binder = vm.envOr("BINDER_ADDR", address(0));
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0));
        uint256 startBlock = block.number;

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        (, address governor,) = vm.readCallers();
        StampRegistry registry = new StampRegistry(IPDPVerifier(pdp), fwss, governor);
        StampResolver resolver = new StampResolver(resolverOwner);
        if (registrar != address(0)) registry.addRegistrar(registrar);
        if (binder != address(0)) registry.addBinder(binder);
        vm.stopBroadcast();

        address stateView = IFWSS(fwss).viewContractAddress();
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "registry", address(registry));
        vm.serializeAddress(k, "resolver", address(resolver));
        vm.serializeAddress(k, "pdpVerifier", pdp);
        vm.serializeAddress(k, "fwss", fwss);
        vm.serializeAddress(k, "stateView", stateView);
        vm.serializeAddress(k, "governor", governor);
        vm.serializeAddress(k, "resolverOwner", resolverOwner);
        vm.serializeAddress(k, "registrars", _one(registrar));
        vm.serializeAddress(k, "binders", _one(binder));
        string memory json = vm.serializeUint(k, "deployedAtBlock", startBlock);
        string memory out = string.concat("deployments/", name, ".json");
        vm.writeJson(json, out);
        console2.log("StampRegistry", address(registry));
        console2.log("wrote", out);
    }

    function _chain() internal view returns (string memory, address, address) {
        if (block.chainid == 314159) {
            return
                ("calibration", 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C, 0x02925630df557F957f70E112bA06e50965417CA0);
        }
        if (block.chainid == 314) {
            return ("mainnet", 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F, 0x8408502033C418E1bbC97cE9ac48E5528F371A9f);
        }
        revert("Deploy: unsupported chain (use DeployLocal on anvil)");
    }

    function _one(address a) internal pure returns (address[] memory xs) {
        xs = new address[](a == address(0) ? 0 : 1);
        if (a != address(0)) xs[0] = a;
    }
}
