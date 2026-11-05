// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPDPVerifier, Cid} from "../interfaces/IPDPVerifier.sol";

/// @notice In-memory PDPVerifier for tests and anvil. Unprotected by design: never deploy outside a dev chain.
/// @dev Mirrors the real contract's failure mode: pieceLive/getPieceCid/getDataSetLastProvenEpoch revert on dead sets.
contract MockPDPVerifier is IPDPVerifier {
    struct DataSet {
        bool live;
        address listener;
        address provider;
        uint256 lastProvenEpoch;
        uint256 nextChallengeEpoch;
        uint256 nextPieceId;
    }

    mapping(uint256 => DataSet) internal sets;
    mapping(uint256 => mapping(uint256 => bytes)) internal cids;
    mapping(uint256 => mapping(uint256 => bool)) internal live;

    event DataSetSet(uint256 indexed setId, bool live, address listener, address provider);
    event PieceAdded(uint256 indexed setId, uint256 indexed pieceId, bytes cid);
    event PieceRemoved(uint256 indexed setId, uint256 indexed pieceId);

    function setDataSet(uint256 setId, bool live_, address listener, address provider) external {
        DataSet storage d = sets[setId];
        d.live = live_;
        d.listener = listener;
        d.provider = provider;
        emit DataSetSet(setId, live_, listener, provider);
    }

    function addPiece(uint256 setId, bytes calldata cid) external returns (uint256 pieceId) {
        DataSet storage d = sets[setId];
        require(d.live, "DataSetNotLive");
        require(cid.length != 0, "EmptyCid");
        pieceId = d.nextPieceId++;
        cids[setId][pieceId] = cid;
        live[setId][pieceId] = true;
        emit PieceAdded(setId, pieceId, cid);
    }

    function removePiece(uint256 setId, uint256 pieceId) external {
        live[setId][pieceId] = false;
        emit PieceRemoved(setId, pieceId);
    }

    function killDataSet(uint256 setId) external {
        sets[setId].live = false;
        emit DataSetSet(setId, false, sets[setId].listener, sets[setId].provider);
    }

    function setProven(uint256 setId, uint256 lastProvenEpoch, uint256 nextChallengeEpoch) external {
        sets[setId].lastProvenEpoch = lastProvenEpoch;
        sets[setId].nextChallengeEpoch = nextChallengeEpoch;
    }

    // ---- IPDPVerifier
    function dataSetLive(uint256 setId) public view returns (bool) {
        return sets[setId].live;
    }

    function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool) {
        _requireLive(setId);
        return live[setId][pieceId];
    }

    function getPieceCid(uint256 setId, uint256 pieceId) external view returns (Cid memory) {
        _requireLive(setId);
        return Cid(cids[setId][pieceId]);
    }

    function findPieceIdsByCid(uint256 setId, Cid calldata cid, uint256 startPieceId, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        _requireLive(setId);
        uint256[] memory tmp = new uint256[](limit);
        uint256 n;
        bytes32 want = keccak256(cid.data);
        uint256 end = sets[setId].nextPieceId;
        for (uint256 i = startPieceId; i < end && n < limit; i++) {
            if (live[setId][i] && keccak256(cids[setId][i]) == want) tmp[n++] = i;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = tmp[i];
        }
    }

    function getDataSetListener(uint256 setId) external view returns (address) {
        return sets[setId].listener;
    }

    function getDataSetStorageProvider(uint256 setId) external view returns (address, address) {
        return (sets[setId].provider, address(0));
    }

    function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256) {
        _requireLive(setId);
        return sets[setId].lastProvenEpoch;
    }

    function getNextChallengeEpoch(uint256 setId) external view returns (uint256) {
        return sets[setId].nextChallengeEpoch;
    }

    function _requireLive(uint256 setId) internal view {
        require(sets[setId].live, "DataSetNotLive");
    }
}
