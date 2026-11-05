// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixtures} from "./helpers/Fixtures.sol";
import {StampRegistry} from "../src/StampRegistry.sol";
import {P256} from "../src/lib/P256.sol";

/// @notice P-256 paths. Oracle A: the 0x0100 precompile (`forge test --odyssey`). Oracle B: daimo-eth/p256-verifier
/// runtime code (test/vectors/daimo-p256-verifier.hex, built from test/vendor/P256Verifier.sol), etched at 0x0100
/// when the precompile is absent and always at DAIMO for the vector cross-check.
contract P256Test is Fixtures {
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    address internal constant DAIMO = address(0xDA1);
    bool internal precompile;
    string internal vectors;

    function setUp() public override {
        super.setUp();
        vectors = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/p256.json"));
        bytes memory daimo = vm.parseBytes(
            vm.trim(vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/daimo-p256-verifier.hex")))
        );
        vm.etch(DAIMO, daimo);
        precompile = _raw(P256.P256VERIFY, 0);
        if (!precompile) vm.etch(P256.P256VERIFY, daimo);
    }

    function _input(uint256 i) internal view returns (bytes memory) {
        string memory p = string.concat(".vectors[", vm.toString(i), "]");
        return abi.encodePacked(
            vm.parseJsonBytes32(vectors, string.concat(p, ".hash")),
            vm.parseJsonBytes32(vectors, string.concat(p, ".r")),
            vm.parseJsonBytes32(vectors, string.concat(p, ".s")),
            vm.parseJsonBytes32(vectors, string.concat(p, ".x")),
            vm.parseJsonBytes32(vectors, string.concat(p, ".y"))
        );
    }

    function _raw(address oracle, uint256 i) internal view returns (bool) {
        (bool ok, bytes memory out) = oracle.staticcall(_input(i));
        return ok && out.length == 32 && out[31] == 0x01;
    }

    function test_vectors_bothOracles() public view {
        uint256 n = vm.parseJsonUint(vectors, ".count");
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            bool valid = vm.parseJsonBool(vectors, string.concat(p, ".valid"));
            bool lowS = vm.parseJsonBool(vectors, string.concat(p, ".lowS"));
            string memory name = vm.parseJsonString(vectors, string.concat(p, ".name"));
            assertEq(_raw(DAIMO, i), valid, string.concat("daimo: ", name));
            if (precompile) assertEq(_raw(P256.P256VERIFY, i), valid, string.concat("precompile: ", name));
            bytes memory inp = _input(i);
            (bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) =
                abi.decode(inp, (bytes32, bytes32, bytes32, bytes32, bytes32));
            assertEq(P256.verify(h, r, s, x, y), valid && lowS, string.concat("lib: ", name));
        }
    }

    /// @dev Set REQUIRE_P256_PRECOMPILE=1 with --odyssey to prove oracle A really ran.
    function test_oracleSelection() public view {
        if (vm.envOr("REQUIRE_P256_PRECOMPILE", false)) assertTrue(precompile, "0x0100 precompile not active");
    }

    function test_precompile_malformedInput() public view {
        if (!precompile) return;
        (bool ok, bytes memory out) = P256.P256VERIFY.staticcall(hex"00");
        assertTrue(ok);
        assertEq(out.length, 0);
    }

    // ---- registry paths
    function _sigP256(uint256 pk, bytes32 h) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));
        return abi.encodePacked(r, s);
    }

    function _p256Enrolment(uint256 pk, uint8 keyType, uint8 level, bytes32 rpIdHash)
        internal
        view
        returns (StampRegistry.KeyEnrolment memory e)
    {
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        e.x = bytes32(x);
        e.y = bytes32(y);
        e.keyId = sha256(abi.encodePacked(bytes1(0x04), e.x, e.y));
        e.keyType = keyType;
        e.platform = keyType == 2 ? 1 : 2;
        e.level = level;
        e.rpIdHash = rpIdHash;
        e.attestationHash = keccak256("attestation");
        e.expiresAt = uint64(block.timestamp + 365 days);
    }

    function _authData(bytes32 rpIdHash, uint32 counter) internal pure returns (bytes memory) {
        return abi.encodePacked(rpIdHash, bytes1(0x40), bytes4(counter));
    }

    function test_p256Raw_keyCarriesLevel() public {
        uint256 pk = 0xA11D;
        StampRegistry.KeyEnrolment memory e = _p256Enrolment(pk, 1, 2, bytes32(0));
        bytes memory pop = _sigP256(pk, sha256(abi.encodePacked(_digest(_popHash(e)))));
        reg.registerKey(e, pop, _sign(registrarPk, _digest(_enrolHash(e))));

        StampRegistry.CaptureClaim memory c = _claim(e.keyId, 1);
        bytes32 id = reg.hashClaim(c);
        bytes memory sig = _sigP256(pk, sha256(abi.encodePacked(id)));
        assertTrue(reg.verifyClaim(c, sig, ""));

        // high-s twin of a valid signature is rejected
        (bytes32 r, bytes32 s) = abi.decode(sig, (bytes32, bytes32));
        bytes memory high = abi.encodePacked(r, bytes32(N - uint256(s)));
        vm.expectRevert("BadSig");
        reg.registerStamp(c, high, "", "");

        (bytes32 stampId,) = reg.registerStamp(c, sig, "", "");
        assertEq(reg.getStamp(stampId).level, 2);
        assertEq(reg.effectiveLevel(stampId), 2);

        StampRegistry.CaptureClaim memory c2 = _claim(e.keyId, 2);
        bytes memory wrong = _sigP256(pk, reg.hashClaim(c2)); // signed the digest without sha256
        vm.expectRevert("BadSig");
        reg.registerStamp(c2, wrong, "", "");
        vm.expectRevert("SigLen");
        reg.registerStamp(c2, hex"00", "", "");
    }

    function test_p256AppAttest_counterAndRpId() public {
        uint256 pk = 0xA77E57;
        bytes32 rpId = sha256("ABCDE12345.media.stamper.app");
        StampRegistry.KeyEnrolment memory e = _p256Enrolment(pk, 2, 2, rpId);
        bytes memory ad0 = _authData(rpId, 0);
        bytes memory popSig =
            _sigP256(pk, sha256(abi.encodePacked(ad0, sha256(abi.encodePacked(_digest(_popHash(e)))))));
        reg.registerKey(e, abi.encodePacked(ad0, popSig), _sign(registrarPk, _digest(_enrolHash(e))));
        assertEq(reg.getKey(e.keyId).level, 2);

        StampRegistry.CaptureClaim memory c = _claim(e.keyId, 7);
        bytes32 id = reg.hashClaim(c);
        bytes memory ad7 = _authData(rpId, 7);
        bytes memory sig = _sigP256(pk, sha256(abi.encodePacked(ad7, sha256(abi.encodePacked(id)))));

        bytes memory ad8 = _authData(rpId, 8);
        vm.expectRevert("Counter");
        reg.registerStamp(c, sig, ad8, "");
        bytes memory badRp = _authData(sha256("other.app"), 7);
        vm.expectRevert(bytes("RpId"));
        reg.registerStamp(c, sig, badRp, "");

        (bytes32 stampId,) = reg.registerStamp(c, sig, ad7, "");
        assertEq(reg.getStamp(stampId).level, 2);
        assertEq(reg.getStamp(stampId).authData, ad7);
    }

    function test_p256_popRequired() public {
        uint256 pk = 0xA11D;
        StampRegistry.KeyEnrolment memory e = _p256Enrolment(pk, 1, 0, bytes32(0));
        bytes memory pop = _sigP256(0xB0B, sha256(abi.encodePacked(_digest(_popHash(e)))));
        vm.expectRevert("BadPoP");
        reg.registerKey(e, pop, "");
        e.keyId = bytes32(uint256(e.keyId) ^ 1);
        vm.expectRevert("KeyId");
        reg.registerKey(e, pop, "");
    }
}
