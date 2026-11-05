// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice FilecoinWarmStorageService proxy: only the StateView pointer is used.
interface IFWSS {
    function viewContractAddress() external view returns (address);
}
