// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev ABI-identical to PDPVerifier's `Cids.Cid`.
struct Cid {
    bytes data;
}

/// @notice The eight PDPVerifier reads Stamper relies on (DESIGN §4.1).
/// mainnet 0xBADd0B92C1c71d02E7d520f64c0876538fa2557F / calibration 0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C
interface IPDPVerifier {
    function dataSetLive(uint256 setId) external view returns (bool);
    /// @dev reverts if !dataSetLive
    function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool);
    /// @dev reverts if !dataSetLive
    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cid memory);
    function findPieceIdsByCid(uint256 setId, Cid calldata cid, uint256 startPieceId, uint256 limit)
        external
        view
        returns (uint256[] memory);
    function getDataSetListener(uint256 setId) external view returns (address);
    function getDataSetStorageProvider(uint256 setId) external view returns (address, address);
    /// @dev reverts if !dataSetLive
    function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256);
    function getNextChallengeEpoch(uint256 setId) external view returns (uint256);
}
