// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "lib/forge-std/src/Script.sol";
import {console2} from "lib/forge-std/src/console2.sol";
import {MessageBoard} from "src/MessageBoard.sol";
import {HelperConfig, ChainConfig} from "script/HelperConfig.s.sol";

contract Deploy is Script {
    /// @notice 使用默认配置部署，供测试直接调用，不进行广播
    function deployMessageBoard() public returns (MessageBoard board) {
        board = new MessageBoard({
            initialPostFee: 0,
            initialRateLimitSeconds: 0,
            initialMaxContentLengthBytes: 280
        });
    }

    /// @notice 使用自定义配置部署，供测试/脚本调用（不广播）
    function deployMessageBoardWithConfig(
        uint256 postFee,
        uint64 rateLimitSeconds,
        uint256 maxContentLengthBytes
    ) public returns (MessageBoard board) {
        board = new MessageBoard(postFee, rateLimitSeconds, maxContentLengthBytes);
    }

    /// @notice 脚本入口：根据 HelperConfig 读取私钥并广播部署，返回地址
    function run() external returns (MessageBoard board) {
        HelperConfig helper = new HelperConfig();
        ChainConfig memory cfg = helper.getActiveChainConfig();

        vm.startBroadcast(cfg.deployerPrivateKey);
        board = deployMessageBoard();
        vm.stopBroadcast();

        console2.log("MessageBoard deployed at:", address(board));
    }
}


