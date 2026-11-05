// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice FWSS StateView, resolved at call time through IFWSS.viewContractAddress(); never pinned.
interface IFWSSStateView {
    struct DataSetInfoView {
        uint256 pdpRailId;
        uint256 cacheMissRailId;
        uint256 cdnRailId;
        address payer;
        address payee;
        address serviceProvider;
        uint256 commissionBps;
        uint256 clientDataSetId;
        uint256 pdpEndEpoch;
        uint256 providerId;
        uint96 pendingOneTimePayments;
        uint96 lifecycleReserveBalance;
        uint256 dataSetId;
    }

    function getDataSet(uint256 id) external view returns (DataSetInfoView memory);
    function provenThisPeriod(uint256 id) external view returns (bool);
    function provingDeadline(uint256 id) external view returns (uint256);
}
