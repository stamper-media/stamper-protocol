// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title StampResolver — advisory, replaceable moderation flags and verifier release hashes (DESIGN §4.8).
/// @notice The registry never reads this contract. Flags delete nothing; third parties may ignore them.
contract StampResolver is Ownable2Step {
    enum Flag {
        None,
        WithdrawnByAuthor,
        TakedownLegal,
        Disputed,
        RejectedPrePublication,
        RegistrarRemoved
    }

    mapping(bytes32 stampId => Flag) public flag;
    /// @dev sha256 of published verifier bundles (web, CLI)
    mapping(string release => bytes32) public verifierHash;

    event FlagSet(bytes32 indexed stampId, Flag flag, string reasonUri);
    event VerifierReleased(string release, bytes32 hash);

    constructor(address owner_) Ownable(owner_) {}

    function setFlag(bytes32 stampId, Flag f, string calldata reasonUri) external onlyOwner {
        require(stampId != 0, "NoStamp");
        flag[stampId] = f;
        emit FlagSet(stampId, f, reasonUri);
    }

    function setVerifierHash(string calldata release, bytes32 h) external onlyOwner {
        require(bytes(release).length != 0, "Release");
        verifierHash[release] = h;
        emit VerifierReleased(release, h);
    }
}
