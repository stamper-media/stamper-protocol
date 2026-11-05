// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice ERC-1271 wallet stand-in for the KT_ERC1271 path: valid when `signer` signed the digest.
/// @dev Deliberately not `view`, so tests can make it attempt a re-entrant call (`setReenter`); the registry
/// invokes it through STATICCALL, so any such attempt fails and the outer call reverts.
contract MockERC1271 {
    address public immutable signer;
    address public reenterTarget;
    bytes public reenterData;

    constructor(address signer_) {
        signer = signer_;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external returns (bytes4) {
        if (reenterTarget != address(0)) {
            (bool ok,) = reenterTarget.call(reenterData);
            require(ok, "ReenterFailed");
        }
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hash, sig);
        return err == ECDSA.RecoverError.NoError && got == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
