// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {TroveAccount} from "./TroveAccount.sol";

/// @title TrovePositions
/// @notice One NFT per transferable MUSD Trove. Token #n controls the Trove
///         owned by `accountOf(n)`; whoever holds the token is its borrower.
contract TrovePositions is ERC721 {
    /// @notice The TroveAccount every position clones.
    address public immutable implementation;

    uint256 public nextId = 1;
    mapping(uint256 => TroveAccount) public accountOf;
    mapping(address => uint256) public tokenOfAccount;

    event PositionCreated(uint256 indexed tokenId, address indexed account, address indexed owner);

    constructor(address implementation_) ERC721("MUSD Trove Position", "TROVE") {
        implementation = implementation_;
    }

    /// @notice Mints a position and opens its Trove in one transaction:
    ///         the BTC sent is the collateral, and `debt` MUSD goes to the caller.
    function openPosition(uint256 debt, address upperHint, address lowerHint)
        external
        payable
        returns (uint256 tokenId, TroveAccount account)
    {
        (tokenId, account) = _create(msg.sender);
        account.open{value: msg.value}(debt, upperHint, lowerHint);
    }

    /// @notice Mints an empty position; open its Trove later through the account.
    function createPosition() external returns (uint256 tokenId, TroveAccount account) {
        return _create(msg.sender);
    }

    function _create(address owner) internal returns (uint256 tokenId, TroveAccount account) {
        tokenId = nextId++;
        account = TroveAccount(payable(Clones.cloneDeterministic(implementation, bytes32(tokenId))));
        account.initialize(this, tokenId);
        accountOf[tokenId] = account;
        tokenOfAccount[address(account)] = tokenId;
        // Minted before the Trove opens: the account takes orders from the
        // holder, and during `openPosition` that has to be the caller.
        _mint(owner, tokenId);
        emit PositionCreated(tokenId, address(account), owner);
    }
}
