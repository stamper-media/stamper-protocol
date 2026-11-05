// SPDX-License-Identifier: Apache-2.0 OR MIT
pragma solidity 0.8.30;

/// @notice PieceCID v2 (FRC-0069) validation.
/// @dev Copied from FilOzone/pdp src/Cids.sol (main, fetched 2026-10-01): validateCommPv2, rawPieceSize,
/// _readUvarint and _uvarintLength are unchanged apart from taking `bytes calldata` instead of `Cid calldata`.
/// pieceSizeBounds is Stamper's addition for the off-chain contentLength cross-check.
library Cids {
    bytes4 internal constant COMMP_V2_PREFIX = hex"01559120";

    error CidTooShort();
    error InvalidCommPv2Prefix();
    error NonMinimalUvarint();
    error InvalidCommPv2MultihashLength();
    error InvalidCommPv2DigestLength();
    error UnterminatedUvarint();
    error UvarintOverflow();

    function validateCommPv2(bytes calldata data) internal pure returns (uint256 padding, uint8 height, bytes32 root) {
        require(data.length >= 4, CidTooShort());
        for (uint256 i = 0; i < 4; i++) {
            if (data[i] != COMMP_V2_PREFIX[i]) revert InvalidCommPv2Prefix();
        }
        uint256 offset = 4;
        (uint256 mhLength, uint256 multihashOffset) = _readUvarint(data, offset);
        require(multihashOffset - offset == _uvarintLength(mhLength), NonMinimalUvarint());
        require(mhLength >= 34, InvalidCommPv2MultihashLength());
        if (mhLength != data.length - multihashOffset) revert InvalidCommPv2MultihashLength();

        offset = multihashOffset;
        uint256 paddingOffset;
        (padding, paddingOffset) = _readUvarint(data, offset);
        require(paddingOffset - offset == _uvarintLength(padding), NonMinimalUvarint());

        offset = paddingOffset;
        require(offset < data.length, InvalidCommPv2DigestLength());
        height = uint8(data[offset++]);
        require(offset <= data.length - 32, InvalidCommPv2DigestLength());
        require(offset == data.length - 32, InvalidCommPv2DigestLength());
        assembly ("memory-safe") {
            root := calldataload(add(data.offset, offset))
        }
    }

    /// @notice Exact raw byte size behind a PieceCIDv2: 2^(height-2) * 127 - padding.
    function rawPieceSize(uint256 padding, uint8 height) internal pure returns (uint256) {
        return (1 << (uint256(height) - 2)) * 127 - padding;
    }

    /// @notice Inclusive bounds on the payload length a (padding, height) pair can describe.
    /// @dev FRC-0069 padding is exact, so min == max == rawPieceSize; kept as a pair so callers do not
    /// depend on that detail. Reverts on height < 2 or padding larger than the tree.
    function pieceSizeBounds(uint256 padding, uint8 height) internal pure returns (uint256 min, uint256 max) {
        uint256 raw = rawPieceSize(padding, height);
        return (raw, raw);
    }

    function _uvarintLength(uint256 value) internal pure returns (uint256 length) {
        length = 1;
        while (value >= 0x80) {
            value >>= 7;
            length++;
        }
    }

    function _readUvarint(bytes calldata data, uint256 offset)
        internal
        pure
        returns (uint256 value, uint256 newOffset)
    {
        uint256 i;
        while (true) {
            require(offset + i < data.length, UnterminatedUvarint());
            uint8 byteValue = uint8(data[offset + i]);
            uint8 payload = byteValue & 0x7F;
            if (i == 36) require(payload <= 0x0F && byteValue < 0x80, UvarintOverflow());
            value |= uint256(payload) << (i * 7);
            i++;
            if (byteValue < 0x80) return (value, offset + i);
        }
    }
}
