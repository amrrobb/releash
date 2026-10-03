// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Chainlink-shaped feed (8 decimals) driven by a keeper. Not updating it is how the demo
/// models a weekend: stock feeds run 24/5, so the last Friday price simply stays.
contract MockPriceFeed is AggregatorV3Interface {
    address public immutable owner;
    address public keeper;
    string public description;

    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _updatedAt;

    event PriceSet(uint80 indexed roundId, int256 answer, uint256 updatedAt);
    event KeeperSet(address keeper);

    error NotKeeper();
    error NotOwner();
    error BadPrice();

    constructor(string memory description_, int256 initial, address keeper_) {
        owner = msg.sender;
        description = description_;
        keeper = keeper_;
        _set(initial);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function setKeeper(address keeper_) external {
        require(msg.sender == owner, NotOwner());
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setPrice(int256 answer) external {
        require(msg.sender == keeper, NotKeeper());
        _set(answer);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }

    function _set(int256 answer) internal {
        require(answer > 0, BadPrice());
        _roundId++;
        _answer = answer;
        _updatedAt = block.timestamp;
        emit PriceSet(_roundId, answer, block.timestamp);
    }
}
