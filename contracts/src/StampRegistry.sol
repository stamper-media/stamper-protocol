// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IPDPVerifier, Cid} from "./interfaces/IPDPVerifier.sol";
import {IFWSS} from "./interfaces/IFWSS.sol";
import {IFWSSStateView} from "./interfaces/IFWSSStateView.sol";
import {Cids} from "./lib/Cids.sol";
import {P256} from "./lib/P256.sol";

/// @title StampRegistry — immutable media-provenance registry (DESIGN §4).
/// @notice No proxy, no pause, no upgrade. The owner (governor) only manages registrar/binder membership;
/// it can never create, alter, re-point or delete a stamp.
contract StampRegistry is EIP712("Stamper", "1"), Ownable2Step, ReentrancyGuardTransient {
    // ---- constants
    address internal constant P256VERIFY = P256.P256VERIFY;
    uint256 internal constant P256_N_HALF = P256.N_HALF;
    bytes32 public constant CLAIM_TYPEHASH = 0xe768d8433c9f9a1f6a4b35ee02435838088f38c938fc215e2ce68b78116c010d;
    bytes32 public constant ENROL_TYPEHASH = 0x7cb29957345ff6dd94fc3cb78ee4044ae8619ff8786f86bb6c77f22c441843e7;
    bytes32 public constant POP_TYPEHASH = 0xfc0478f5a3dfeff23ec3fb1779f37df3143b281d435c0e0de41764917e479cd8;
    bytes32 public constant COUNTER_TYPEHASH = 0xf7fb5b96fbc4c59566fcca7f60f35138b0af22e784946255d4442bf44c788168;
    bytes32 public constant REVOKE_TYPEHASH = 0x169060174d2edeac658ea958ad9e96c24d210e733ea82d4211aa7de1653292da;
    bytes32 public constant DERIV_TYPEHASH = 0xa07110a54c833a87d3b59fba0bff52f23466711b8ae0691c319c8db808e704a8;
    uint8 internal constant KT_SECP256K1 = 0;
    uint8 internal constant KT_P256_RAW = 1;
    uint8 internal constant KT_P256_APPATTEST = 2;
    uint8 internal constant KT_ERC1271 = 3;
    uint8 internal constant PF_WEB = 0;
    uint8 internal constant PF_IOS = 1;
    uint8 internal constant PF_ANDROID = 2;
    uint8 internal constant MAX_TRUSTED_BINDINGS = 4;
    uint8 internal constant MAX_THIRD_PARTY_BINDINGS = 4;
    uint8 internal constant SLOTS = MAX_TRUSTED_BINDINGS + MAX_THIRD_PARTY_BINDINGS;
    uint64 internal constant ROLE_DELAY = 48 hours;
    bytes32 internal constant ROLE_REGISTRAR = "REGISTRAR";
    bytes32 internal constant ROLE_BINDER = "BINDER";

    IPDPVerifier public immutable PDP;
    address public immutable FWSS;

    // ---- types
    struct CaptureClaim {
        bytes32 contentHash;
        bytes pieceCid;
        uint64 contentLength;
        uint8 mediaKind;
        uint64 capturedAt;
        bytes32 recordHash;
        bytes32 keyId;
        uint64 nonce;
        uint8 flags;
        uint64 deadline;
    }

    struct KeyEnrolment {
        bytes32 keyId;
        uint8 keyType;
        uint8 platform;
        uint8 level;
        bytes32 x;
        bytes32 y;
        address addr;
        bytes32 rpIdHash;
        bytes32 attestationHash;
        uint64 expiresAt;
    }

    struct DeviceKey {
        uint8 keyType;
        uint8 platform;
        uint8 level;
        bytes32 x;
        bytes32 y;
        address addr;
        bytes32 rpIdHash;
        bytes32 attestationHash;
        address registrar;
        uint64 enrolledEpoch;
        uint64 expiresAt;
        uint64 revokedEpoch;
        uint8 revokeReason;
    }

    struct Stamp {
        bytes32 contentHash;
        bytes pieceCid;
        uint64 contentLength;
        uint8 mediaKind;
        uint64 capturedAt;
        bytes32 recordHash;
        bytes32 keyId;
        uint64 nonce;
        uint8 flags;
        uint8 level;
        address countersigner;
        uint64 registeredEpoch;
        uint40 code;
        bytes sig;
        bytes authData;
    }

    struct Binding {
        uint8 asset;
        uint256 setId;
        uint256 pieceId;
    }

    struct StoredBinding {
        uint8 asset;
        uint256 setId;
        uint256 pieceId;
        address provider;
        address boundBy;
        uint64 boundEpoch;
        bool trusted;
    }

    struct Derivative {
        bytes32 contentHash;
        bytes pieceCid;
        uint8 kind;
        bytes32 paramsHash;
    }

    struct KeyRevocation {
        bytes32 keyId;
        uint64 effectiveEpoch;
        uint8 reason;
    }

    struct BindingStatus {
        bool dataSetLive;
        bool pieceLive;
        bool cidMatches;
        bool listenerIsFWSS;
        uint256 lastProvenEpoch;
        uint256 nextChallengeEpoch;
        bool viewOk;
        bool provenThisPeriod;
        uint256 provingDeadline;
        uint256 pdpEndEpoch;
        address payer;
        uint256 providerId;
    }

    // ---- storage
    mapping(bytes32 keyId => DeviceKey) internal keys;
    mapping(bytes32 stampId => Stamp) internal stamps;
    mapping(uint40 code => bytes32) public stampByCode;
    mapping(bytes32 hash => bytes32) public firstStampOf;
    mapping(bytes32 hash => bytes32) public stampByDerivativeHash;
    mapping(bytes32 keyId => mapping(uint256 word => uint256)) public usedNonce;
    mapping(bytes32 stampId => StoredBinding[]) internal bindings;
    mapping(bytes32 stampId => Derivative[]) internal derivatives;
    mapping(address => uint64) public registrarActiveFrom;
    mapping(address => uint64) public binderActiveFrom;

    // ---- events
    event KeyRegistered(
        bytes32 indexed keyId,
        uint8 keyType,
        uint8 platform,
        uint8 level,
        address indexed registrar,
        bytes32 attestationHash,
        uint64 expiresAt
    );
    event KeyRevoked(bytes32 indexed keyId, uint64 effectiveEpoch, uint8 reason, address by, bool retroactive);
    event StampRegistered(
        bytes32 indexed stampId,
        uint40 indexed code,
        bytes32 indexed contentHash,
        bytes32 keyId,
        uint8 level,
        address countersigner,
        bytes pieceCid,
        uint64 contentLength,
        uint8 mediaKind,
        uint64 capturedAt,
        bytes32 recordHash,
        uint64 nonce,
        uint8 flags,
        address submitter
    );
    event DerivativeAttached(
        bytes32 indexed stampId, bytes32 indexed contentHash, uint8 kind, bytes pieceCid, bytes32 paramsHash, address by
    );
    event StorageBound(
        bytes32 indexed stampId,
        uint8 asset,
        uint256 indexed setId,
        uint256 pieceId,
        address provider,
        address boundBy,
        bool trusted,
        uint8 slot
    );
    event StorageUnbound(bytes32 indexed stampId, uint8 slot, uint256 setId, uint256 pieceId, string reason);
    event RoleAnnounced(address indexed who, bytes32 role, uint64 activeFrom);
    event RoleRemoved(address indexed who, bytes32 role, address by);
    /// @dev ERC-7053 interop; assetCid = multibase "f" + lower-case hex(pieceCid).
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

    constructor(IPDPVerifier pdp, address fwss, address governor) Ownable(governor) {
        require(address(pdp) != address(0) && fwss != address(0), "ZeroAddr");
        PDP = pdp;
        FWSS = fwss;
    }

    // =====================================================================================================
    // governance (membership only; asymmetric: slow to add, immediate to remove)
    // =====================================================================================================

    function addRegistrar(address r) external onlyOwner {
        registrarActiveFrom[r] = _announce(r, registrarActiveFrom[r], ROLE_REGISTRAR);
    }

    function removeRegistrar(address r) external {
        _checkRemove(r, registrarActiveFrom[r]);
        delete registrarActiveFrom[r];
        emit RoleRemoved(r, ROLE_REGISTRAR, msg.sender);
    }

    function addBinder(address b) external onlyOwner {
        binderActiveFrom[b] = _announce(b, binderActiveFrom[b], ROLE_BINDER);
    }

    function removeBinder(address b) external {
        _checkRemove(b, binderActiveFrom[b]);
        delete binderActiveFrom[b];
        emit RoleRemoved(b, ROLE_BINDER, msg.sender);
    }

    function isActiveRegistrar(address a) external view returns (bool) {
        return _isActiveRegistrar(a);
    }

    function isActiveBinder(address a) external view returns (bool) {
        return _isActiveBinder(a);
    }

    // =====================================================================================================
    // keys
    // =====================================================================================================

    /// @notice Enrol a device key (or upgrade an un-endorsed level-0 key in place).
    /// @param popSig proof of possession over KeyPossession, in the key's own scheme. For App Attest keys it is
    ///        `authData (37 bytes, counter 0) ‖ r ‖ s` (101 bytes); otherwise exactly what a capture `sig` is.
    /// @param endorsement 65-byte registrar ECDSA signature over the whole KeyEnrolment, or empty (level 0).
    function registerKey(KeyEnrolment calldata e, bytes calldata popSig, bytes calldata endorsement) external {
        require(e.keyType <= KT_ERC1271, "KeyType");
        require(e.platform <= PF_ANDROID, "Platform");
        require(e.expiresAt > block.timestamp, "KeyExpired");
        if (e.keyType == KT_SECP256K1 || e.keyType == KT_ERC1271) {
            require(e.addr != address(0) && e.keyId == bytes32(uint256(uint160(e.addr))), "KeyId");
        } else {
            require(e.keyId == sha256(abi.encodePacked(bytes1(0x04), e.x, e.y)), "KeyId");
        }

        DeviceKey storage k = keys[e.keyId];
        if (k.enrolledEpoch != 0) {
            // only an un-endorsed, unrevoked level-0 key may be upgraded, and only by an endorsement
            require(
                k.registrar == address(0) && k.level == 0 && k.revokedEpoch == 0 && endorsement.length != 0
                    && k.keyType == e.keyType,
                "KeyExists"
            );
        }

        address registrar;
        uint8 level;
        if (endorsement.length != 0) {
            require(endorsement.length == 65, "EndLen");
            registrar = ECDSA.recoverCalldata(_hashTypedDataV4(_hashEnrolment(e)), endorsement);
            require(_isActiveRegistrar(registrar), "NotRegistrar");
            level = e.level;
        }

        k.keyType = e.keyType;
        k.platform = e.platform;
        k.level = level;
        k.x = e.x;
        k.y = e.y;
        k.addr = e.addr;
        k.rpIdHash = e.rpIdHash;
        k.attestationHash = e.attestationHash;
        k.registrar = registrar;
        if (k.enrolledEpoch == 0) k.enrolledEpoch = uint64(block.number);
        k.expiresAt = e.expiresAt;

        // proof of possession last: the ERC-1271 path makes an external (static) call
        bytes32 popDigest =
            _hashTypedDataV4(keccak256(abi.encode(POP_TYPEHASH, e.keyId, e.keyType, e.platform, e.x, e.y, e.addr)));
        bool ok;
        if (e.keyType == KT_P256_APPATTEST) {
            require(popSig.length == 101, "SigLen");
            ok = _verifyDevice(k, popDigest, popSig[37:], popSig[:37], 0);
        } else {
            ok = _verifyDevice(k, popDigest, popSig, popSig[0:0], 0);
        }
        require(ok, "BadPoP");
        emit KeyRegistered(e.keyId, e.keyType, e.platform, level, registrar, e.attestationHash, e.expiresAt);
    }

    /// @notice Revoke a key: by the key itself, by its (active) registrar, or by the governor (any epoch).
    /// @dev Non-governor paths require effectiveEpoch >= block.number. An existing revocation can only be moved
    /// earlier. For App Attest self-revocation `authData` is the assertion's 37-byte authenticator data (any counter).
    function revokeKey(KeyRevocation calldata r, bytes calldata sig, bytes calldata authData) external {
        DeviceKey storage k = keys[r.keyId];
        require(k.enrolledEpoch != 0, "NoKey");
        require(r.effectiveEpoch != 0, "Epoch");
        require(k.revokedEpoch == 0 || r.effectiveEpoch < k.revokedEpoch, "Revoked");
        if (msg.sender != owner()) {
            require(r.effectiveEpoch >= block.number, "Retroactive");
            bytes32 digest =
                _hashTypedDataV4(keccak256(abi.encode(REVOKE_TYPEHASH, r.keyId, r.effectiveEpoch, r.reason)));
            bool byRegistrar;
            if (sig.length == 65 && k.registrar != address(0)) {
                (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
                byRegistrar = err == ECDSA.RecoverError.NoError && signer == k.registrar && _isActiveRegistrar(signer);
            }
            if (!byRegistrar) {
                uint64 counter = authData.length == 37 ? uint64(uint32(bytes4(authData[33:37]))) : 0;
                require(_verifyDevice(k, digest, sig, authData, counter), "BadSig");
            }
        }
        k.revokedEpoch = r.effectiveEpoch;
        k.revokeReason = r.reason;
        emit KeyRevoked(r.keyId, r.effectiveEpoch, r.reason, msg.sender, r.effectiveEpoch < block.number);
    }

    // =====================================================================================================
    // stamps (permissionless submission)
    // =====================================================================================================

    /// @notice Register a capture claim (DESIGN §4.3, normative).
    /// @param countersig empty, or `uint8 level ‖ 65-byte registrar ECDSA over CaptureCountersignature` (66 bytes).
    function registerStamp(
        CaptureClaim calldata c,
        bytes calldata sig,
        bytes calldata authData,
        bytes calldata countersig
    ) external nonReentrant returns (bytes32 stampId, uint40 code) {
        DeviceKey storage k = keys[c.keyId];
        require(k.enrolledEpoch != 0, "NoKey");
        require(k.revokedEpoch == 0 || block.number < k.revokedEpoch, "KeyRevoked");
        require(block.timestamp < k.expiresAt, "KeyExpired");
        require(block.timestamp <= c.deadline, "Expired");
        require(c.mediaKind == 1 || c.mediaKind == 2, "Kind");
        Cids.validateCommPv2(c.pieceCid);
        (uint256 w, uint256 bit) = (c.nonce >> 8, 1 << (c.nonce & 255));
        require(usedNonce[c.keyId][w] & bit == 0, "NonceUsed");
        stampId = _hashTypedDataV4(_hashClaim(c));
        require(stamps[stampId].registeredEpoch == 0, "Dup");

        // ---- effects first (checks-effects-interactions; the ERC-1271 path makes an external call)
        usedNonce[c.keyId][w] |= bit;
        (code,) = _deriveCode(stampId);
        uint8 level = 0;
        address cs;
        if (countersig.length != 0) {
            require(countersig.length == 66, "CsLen");
            uint8 csLevel = uint8(countersig[0]);
            require(csLevel <= k.level, "CsLevel");
            cs = ECDSA.recoverCalldata(
                _hashTypedDataV4(keccak256(abi.encode(COUNTER_TYPEHASH, stampId, csLevel))), countersig[1:]
            );
            require(_isActiveRegistrar(cs), "NotRegistrar");
            level = csLevel;
        } else if (k.keyType == KT_P256_RAW || k.keyType == KT_P256_APPATTEST) {
            level = k.level;
        }

        Stamp storage s = stamps[stampId];
        s.contentHash = c.contentHash;
        s.pieceCid = c.pieceCid;
        s.contentLength = c.contentLength;
        s.mediaKind = c.mediaKind;
        s.capturedAt = c.capturedAt;
        s.recordHash = c.recordHash;
        s.keyId = c.keyId;
        s.nonce = c.nonce;
        s.flags = c.flags;
        s.level = level;
        s.countersigner = cs;
        s.registeredEpoch = uint64(block.number);
        s.code = code;
        s.sig = sig;
        s.authData = authData;
        stampByCode[code] = stampId;
        if (firstStampOf[c.contentHash] == 0) firstStampOf[c.contentHash] = stampId;

        // ---- interaction last; a failure reverts every effect above
        require(_verifyDevice(k, stampId, sig, authData, c.nonce), "BadSig");
        _emitRegistered(stampId, code, c, level, cs);
    }

    /// @notice Attach a Stamper-rendered derivative under an active registrar's DerivativeAttachment signature.
    function attachDerivative(bytes32 stampId, Derivative calldata d, bytes calldata registrarSig) external {
        require(stamps[stampId].registeredEpoch != 0, "NoStamp");
        require(d.kind != 0, "Kind");
        if (d.pieceCid.length != 0) Cids.validateCommPv2(d.pieceCid);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(DERIV_TYPEHASH, stampId, d.contentHash, keccak256(d.pieceCid), d.kind, d.paramsHash))
        );
        require(registrarSig.length == 65, "SigLen");
        address signer = ECDSA.recoverCalldata(digest, registrarSig);
        require(_isActiveRegistrar(signer), "NotRegistrar");
        Derivative[] storage ds = derivatives[stampId];
        uint256 n = ds.length;
        require(n < type(uint8).max, "TooMany"); // binding asset index n is a uint8
        for (uint256 i; i < n; i++) {
            require(ds[i].contentHash != d.contentHash, "DupDerivative");
        }
        ds.push(d);
        if (stampByDerivativeHash[d.contentHash] == 0) stampByDerivativeHash[d.contentHash] = stampId;
        emit DerivativeAttached(stampId, d.contentHash, d.kind, d.pieceCid, d.paramsHash, signer);
    }

    /// @notice Bind live FWSS-managed PDP pieces to a stamp asset (DESIGN §4.4, normative). Permissionless;
    /// active binders get the trusted slots 0-3, everyone else slots 4-7; dead slots are reusable by anyone.
    function bindStorage(bytes32 stampId, Binding[] calldata bs) external {
        Stamp storage s = stamps[stampId];
        require(s.registeredEpoch != 0, "NoStamp");
        bool trusted = _isActiveBinder(msg.sender);
        StoredBinding[] storage slots = bindings[stampId];
        if (slots.length == 0) {
            for (uint256 i; i < SLOTS; i++) {
                slots.push();
            }
        }
        for (uint256 i; i < bs.length; i++) {
            Binding calldata b = bs[i];
            require(b.asset <= derivatives[stampId].length, "NoAsset");
            bytes memory want = b.asset == 0 ? s.pieceCid : derivatives[stampId][b.asset - 1].pieceCid;
            require(want.length != 0, "NoCid");
            require(PDP.getDataSetListener(b.setId) == FWSS, "NotFWSS");
            require(PDP.dataSetLive(b.setId), "SetDead");
            require(PDP.pieceLive(b.setId, b.pieceId), "PieceDead");
            require(keccak256(PDP.getPieceCid(b.setId, b.pieceId).data) == keccak256(want), "CidMismatch");
            (address sp,) = PDP.getDataSetStorageProvider(b.setId);
            uint8 slot = _allocateSlot(stampId, b, trusted);
            slots[slot] = StoredBinding(b.asset, b.setId, b.pieceId, sp, msg.sender, uint64(block.number), trusted);
            emit StorageBound(stampId, b.asset, b.setId, b.pieceId, sp, msg.sender, trusted, slot);
        }
    }

    // =====================================================================================================
    // views
    // =====================================================================================================

    function hashClaim(CaptureClaim calldata c) external view returns (bytes32) {
        return _hashTypedDataV4(_hashClaim(c));
    }

    function predictCode(bytes32 stampId) external view returns (uint40 code, uint32 attempt) {
        return _deriveCode(stampId);
    }

    /// @notice Signature check of a claim against its enrolled key (no freshness, nonce or level checks).
    function verifyClaim(CaptureClaim calldata c, bytes calldata sig, bytes calldata authData)
        external
        view
        returns (bool)
    {
        DeviceKey storage k = keys[c.keyId];
        if (k.enrolledEpoch == 0) return false;
        return _verifyDevice(k, _hashTypedDataV4(_hashClaim(c)), sig, authData, c.nonce);
    }

    function getStamp(bytes32 stampId) external view returns (Stamp memory) {
        return stamps[stampId];
    }

    function getKey(bytes32 keyId) external view returns (DeviceKey memory) {
        return keys[keyId];
    }

    function getBindings(bytes32 stampId) external view returns (StoredBinding[] memory) {
        return bindings[stampId];
    }

    function getDerivatives(bytes32 stampId) external view returns (Derivative[] memory) {
        return derivatives[stampId];
    }

    /// @notice Per-binding health. Never reverts for a registered stamp and slot < 8; empty slots return zeros.
    function bindingStatus(bytes32 stampId, uint8 slot) external view returns (BindingStatus memory st) {
        Stamp storage s = stamps[stampId];
        require(s.registeredEpoch != 0, "NoStamp");
        require(slot < SLOTS, "Slot");
        StoredBinding[] storage slots = bindings[stampId];
        if (slots.length == 0) return st;
        StoredBinding storage b = slots[slot];
        if (b.boundEpoch == 0) return st;
        uint256 setId = b.setId;

        try PDP.dataSetLive(setId) returns (bool live) {
            st.dataSetLive = live;
        } catch {}
        if (!st.dataSetLive) return st;
        try PDP.pieceLive(setId, b.pieceId) returns (bool live) {
            st.pieceLive = live;
        } catch {}
        bytes memory want = b.asset == 0 ? s.pieceCid : derivatives[stampId][b.asset - 1].pieceCid;
        try PDP.getPieceCid(setId, b.pieceId) returns (Cid memory got) {
            st.cidMatches = keccak256(got.data) == keccak256(want);
        } catch {}
        try PDP.getDataSetListener(setId) returns (address l) {
            st.listenerIsFWSS = l == FWSS;
        } catch {}
        try PDP.getDataSetLastProvenEpoch(setId) returns (uint256 e) {
            st.lastProvenEpoch = e;
        } catch {}
        try PDP.getNextChallengeEpoch(setId) returns (uint256 e) {
            st.nextChallengeEpoch = e;
        } catch {}
        _fillView(st, setId);
    }

    function effectiveLevel(bytes32 stampId) external view returns (uint8) {
        Stamp storage s = stamps[stampId];
        DeviceKey storage k = keys[s.keyId];
        return k.revokedEpoch != 0 && k.revokedEpoch <= s.registeredEpoch ? 0 : s.level;
    }

    // =====================================================================================================
    // internals
    // =====================================================================================================

    function _verifyDevice(
        DeviceKey storage k,
        bytes32 digest,
        bytes calldata sig,
        bytes calldata authData,
        uint64 nonce
    ) internal view returns (bool) {
        uint8 kt = k.keyType;
        if (kt == KT_SECP256K1) {
            if (sig.length != 65) return false;
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig); // OZ enforces low-s
            return err == ECDSA.RecoverError.NoError && signer == k.addr;
        }
        if (kt == KT_ERC1271) return IERC1271(k.addr).isValidSignature(digest, sig) == 0x1626ba7e;
        bytes32 h;
        if (kt == KT_P256_RAW) {
            h = sha256(abi.encodePacked(digest));
        } else {
            require(authData.length == 37 && bytes32(authData[0:32]) == k.rpIdHash, "RpId");
            require(uint32(bytes4(authData[33:37])) == uint32(nonce), "Counter");
            h = sha256(abi.encodePacked(authData, sha256(abi.encodePacked(digest))));
        }
        require(sig.length == 64, "SigLen");
        return P256.verify(h, bytes32(sig[0:32]), bytes32(sig[32:64]), k.x, k.y);
    }

    function _deriveCode(bytes32 stampId) internal view returns (uint40 code, uint32 attempt) {
        for (;; attempt++) {
            code = uint40(uint256(keccak256(abi.encode(stampId, attempt))));
            if (code % 37 < 32 && stampByCode[code] == 0 && (code >> 35) != 31) return (code, attempt);
        }
    }

    /// @dev DESIGN §4.4 slot policy. Assumes `b` was just checked live.
    function _allocateSlot(bytes32 stampId, Binding calldata b, bool trusted) internal returns (uint8) {
        StoredBinding[] storage slots = bindings[stampId];
        // (1) dedupe live (setId, pieceId)
        for (uint8 i; i < SLOTS; i++) {
            StoredBinding storage x = slots[i];
            if (x.boundEpoch != 0 && x.setId == b.setId && x.pieceId == b.pieceId) revert("DupBinding");
        }
        // (2) reuse the first dead slot
        for (uint8 i; i < SLOTS; i++) {
            StoredBinding storage x = slots[i];
            if (x.boundEpoch != 0 && !_isLive(x.setId, x.pieceId)) {
                emit StorageUnbound(stampId, i, x.setId, x.pieceId, "dead");
                return i;
            }
        }
        // (3) append inside the caller's partition
        uint8 count;
        uint8 lo = trusted ? 0 : MAX_TRUSTED_BINDINGS;
        uint8 cap = trusted ? MAX_TRUSTED_BINDINGS : MAX_THIRD_PARTY_BINDINGS;
        for (uint8 i; i < SLOTS; i++) {
            if (slots[i].boundEpoch != 0 && slots[i].trusted == trusted) count++;
        }
        if (count < cap) {
            for (uint8 i = lo; i < lo + cap; i++) {
                if (slots[i].boundEpoch == 0) return i;
            }
        }
        revert("SlotsFull");
    }

    function _isLive(uint256 setId, uint256 pieceId) internal view returns (bool) {
        if (!PDP.dataSetLive(setId)) return false;
        try PDP.pieceLive(setId, pieceId) returns (bool live) {
            return live;
        } catch {
            return false;
        }
    }

    /// @dev StateView reads through low-level static calls so a replaced, missing or malformed view only clears viewOk.
    function _fillView(BindingStatus memory st, uint256 setId) internal view {
        (bool ok, bytes memory ret) = FWSS.staticcall(abi.encodeCall(IFWSS.viewContractAddress, ()));
        if (!ok || ret.length < 32) return;
        address v = address(uint160(uint256(bytes32(ret))));
        if (v.code.length == 0) return;
        (ok, ret) = v.staticcall(abi.encodeCall(IFWSSStateView.getDataSet, (setId)));
        if (!ok || ret.length < 13 * 32) return;
        uint256 payer;
        uint256 pdpEndEpoch;
        uint256 providerId;
        assembly ("memory-safe") {
            // DataSetInfoView is a static 13-word tuple: payer = word 3, pdpEndEpoch = word 8, providerId = word 9
            payer := and(mload(add(ret, 128)), 0xffffffffffffffffffffffffffffffffffffffff)
            pdpEndEpoch := mload(add(ret, 288))
            providerId := mload(add(ret, 320))
        }
        (bool ok2, bytes memory r2) = v.staticcall(abi.encodeCall(IFWSSStateView.provenThisPeriod, (setId)));
        (bool ok3, bytes memory r3) = v.staticcall(abi.encodeCall(IFWSSStateView.provingDeadline, (setId)));
        if (!ok2 || r2.length < 32 || !ok3 || r3.length < 32) return;
        st.viewOk = true;
        st.pdpEndEpoch = pdpEndEpoch;
        st.payer = address(uint160(payer));
        st.providerId = providerId;
        st.provenThisPeriod = uint256(bytes32(r2)) != 0;
        st.provingDeadline = uint256(bytes32(r3));
    }

    function _hashClaim(CaptureClaim calldata c) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                c.contentHash,
                keccak256(c.pieceCid),
                c.contentLength,
                c.mediaKind,
                c.capturedAt,
                c.recordHash,
                c.keyId,
                c.nonce,
                c.flags,
                c.deadline
            )
        );
    }

    function _hashEnrolment(KeyEnrolment calldata e) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ENROL_TYPEHASH,
                e.keyId,
                e.keyType,
                e.platform,
                e.level,
                e.x,
                e.y,
                e.addr,
                e.rpIdHash,
                e.attestationHash,
                e.expiresAt
            )
        );
    }

    function _emitRegistered(bytes32 stampId, uint40 code, CaptureClaim calldata c, uint8 level, address cs) internal {
        emit StampRegistered(
            stampId,
            code,
            c.contentHash,
            c.keyId,
            level,
            cs,
            c.pieceCid,
            c.contentLength,
            c.mediaKind,
            c.capturedAt,
            c.recordHash,
            c.nonce,
            c.flags,
            msg.sender
        );
        emit Commit(msg.sender, string.concat("f", _hex(c.pieceCid)), "");
    }

    function _announce(address who, uint64 current, bytes32 role) internal returns (uint64 activeFrom) {
        require(who != address(0), "ZeroAddr");
        require(current == 0, "RoleExists");
        activeFrom = uint64(block.timestamp) + ROLE_DELAY;
        emit RoleAnnounced(who, role, activeFrom);
    }

    function _checkRemove(address who, uint64 current) internal view {
        require(msg.sender == owner() || msg.sender == who, "Auth");
        require(current != 0, "NoRole");
    }

    function _isActiveRegistrar(address a) internal view returns (bool) {
        uint64 f = registrarActiveFrom[a];
        return a != address(0) && f != 0 && f <= block.timestamp;
    }

    function _isActiveBinder(address a) internal view returns (bool) {
        uint64 f = binderActiveFrom[a];
        return a != address(0) && f != 0 && f <= block.timestamp;
    }

    function _hex(bytes calldata data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(data.length * 2);
        for (uint256 i; i < data.length; i++) {
            out[2 * i] = alphabet[uint8(data[i]) >> 4];
            out[2 * i + 1] = alphabet[uint8(data[i]) & 0x0f];
        }
        return string(out);
    }
}
