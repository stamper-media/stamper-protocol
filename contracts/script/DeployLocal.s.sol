// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {StampResolver} from "../src/StampResolver.sol";
import {MockPDPVerifier} from "../src/mocks/MockPDPVerifier.sol";
import {MockFWSS} from "../src/mocks/MockFWSS.sol";
import {MockStateView} from "../src/mocks/MockStateView.sol";
import {IPDPVerifier} from "../src/interfaces/IPDPVerifier.sol";
import {IFWSSStateView} from "../src/interfaces/IFWSSStateView.sol";

/// @notice anvil-only deployment of the registry on mocks; writes deployments/anvil.json.
/// forge script script/DeployLocal.s.sol --rpc-url $ANVIL_RPC_URL --broadcast
/// Env (all optional; defaults are anvil's well-known dev accounts): DEPLOYER_PK (governor), REGISTRAR_ADDR,
/// BINDER_ADDR, RESOLVER_OWNER_ADDR, MOCK_SP_A, MOCK_SP_B, DEPLOYMENTS_OUT (default deployments/anvil.json).
/// Roles become active 48 h after deployment: advance anvil with evm_increaseTime 172800 + evm_mine.
contract DeployLocal is Script {
    uint256 internal constant ANVIL_PK0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        require(block.chainid == 31337, "DeployLocal is anvil-only");
        uint256 pk = vm.envOr("DEPLOYER_PK", ANVIL_PK0);
        address governor = vm.addr(pk);
        address registrar = vm.envOr("REGISTRAR_ADDR", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        address binder = vm.envOr("BINDER_ADDR", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        address resolverOwner = vm.envOr("RESOLVER_OWNER_ADDR", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906));
        address spA = vm.envOr("MOCK_SP_A", address(0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65));
        address spB = vm.envOr("MOCK_SP_B", address(0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc));
        uint256 startBlock = block.number;

        vm.startBroadcast(pk);
        MockPDPVerifier pdp = new MockPDPVerifier();
        MockStateView stateView = new MockStateView();
        MockFWSS fwss = new MockFWSS(address(stateView));
        StampRegistry registry = new StampRegistry(IPDPVerifier(address(pdp)), address(fwss), governor);
        StampResolver resolver = new StampResolver(resolverOwner);
        registry.addRegistrar(registrar);
        registry.addBinder(binder);
        pdp.setDataSet(1, true, address(fwss), spA);
        pdp.setDataSet(2, true, address(fwss), spB);
        IFWSSStateView.DataSetInfoView memory v;
        v.payer = governor;
        v.serviceProvider = spA;
        v.providerId = 1;
        v.dataSetId = 1;
        stateView.set(1, v, true, 0);
        v.serviceProvider = spB;
        v.providerId = 2;
        v.dataSetId = 2;
        stateView.set(2, v, true, 0);
        vm.stopBroadcast();

        string memory json = string.concat(
            "{\n  \"chainId\": 31337,\n  \"registry\": \"",
            vm.toString(address(registry)),
            "\",\n  \"resolver\": \"",
            vm.toString(address(resolver)),
            "\",\n  \"pdpVerifier\": \"",
            vm.toString(address(pdp)),
            "\",\n  \"fwss\": \"",
            vm.toString(address(fwss)),
            "\",\n  \"stateView\": \"",
            vm.toString(address(stateView))
        );
        json = string.concat(
            json,
            "\",\n  \"governor\": \"",
            vm.toString(governor),
            "\",\n  \"resolverOwner\": \"",
            vm.toString(resolverOwner),
            "\",\n  \"registrars\": [\"",
            vm.toString(registrar),
            "\"],\n  \"binders\": [\"",
            vm.toString(binder),
            "\"],\n  \"deployedAtBlock\": ",
            vm.toString(startBlock)
        );
        json = string.concat(
            json,
            ",\n  \"mockDataSets\": [\n    { \"id\": 1, \"provider\": \"",
            vm.toString(spA),
            "\" },\n    { \"id\": 2, \"provider\": \"",
            vm.toString(spB),
            "\" }\n  ]\n}\n"
        );
        string memory out = vm.envOr("DEPLOYMENTS_OUT", string("deployments/anvil.json"));
        vm.writeFile(out, json);
        console2.log("StampRegistry", address(registry));
        console2.log("wrote", out);
    }
}
