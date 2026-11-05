// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IFWSS} from "../interfaces/IFWSS.sol";

/// @notice FWSS proxy stand-in: only the StateView pointer. Unprotected; dev chains only.
contract MockFWSS is IFWSS {
    address public viewContractAddress;

    event ViewSet(address view_);

    constructor(address view_) {
        viewContractAddress = view_;
    }

    function setView(address view_) external {
        viewContractAddress = view_;
        emit ViewSet(view_);
    }
}
