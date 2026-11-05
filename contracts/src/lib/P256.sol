// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice secp256r1 verification through the P256VERIFY precompile at 0x0100 (FIP-0113, EIP-7951 semantics).
library P256 {
    address internal constant P256VERIFY = 0x0000000000000000000000000000000000000100;
    /// @dev n / 2; signatures with s above it are rejected (the precompile accepts both s and n - s).
    uint256 internal constant N_HALF = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;

    /// @return true only for a low-s signature the precompile accepts (32-byte output ending in 0x01).
    function verify(bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal view returns (bool) {
        if (uint256(s) > N_HALF) return false;
        (bool ok, bytes memory out) = P256VERIFY.staticcall(abi.encodePacked(h, r, s, x, y));
        return ok && out.length == 32 && out[31] == 0x01;
    }
}
