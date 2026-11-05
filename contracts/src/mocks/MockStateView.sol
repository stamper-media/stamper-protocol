// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IFWSSStateView} from "../interfaces/IFWSSStateView.sol";

/// @notice FWSS StateView stand-in. `setReverting(true)` makes every read revert. Unprotected; dev chains only.
contract MockStateView is IFWSSStateView {
    mapping(uint256 => DataSetInfoView) internal infos;
    mapping(uint256 => bool) internal proven;
    mapping(uint256 => uint256) internal deadlines;
    bool public reverting;

    function set(uint256 id, DataSetInfoView calldata v, bool proven_, uint256 deadline) external {
        infos[id] = v;
        proven[id] = proven_;
        deadlines[id] = deadline;
    }

    function setReverting(bool r) external {
        reverting = r;
    }

    function getDataSet(uint256 id) external view returns (DataSetInfoView memory) {
        require(!reverting, "ViewReverts");
        return infos[id];
    }

    function provenThisPeriod(uint256 id) external view returns (bool) {
        require(!reverting, "ViewReverts");
        return proven[id];
    }

    function provingDeadline(uint256 id) external view returns (uint256) {
        require(!reverting, "ViewReverts");
        return deadlines[id];
    }
}
