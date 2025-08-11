// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "lib/forge-std/src/Script.sol";

struct ChainConfig {
    // Deployer
    uint256 deployerPrivateKey;
}

contract HelperConfig is Script {
    // Active Chain Config
    ChainConfig public activeChainConfig;

    // Environment Variables
    // RPC_URL
    string constant SEPOLIA_RPC_URL = "SEPOLIA_RPC_URL";
    string constant MAINNET_RPC_URL = "MAINNET_RPC_URL";
    string constant ANVIL_RPC_URL = "ANVIL_RPC_URL";
    // Private Key
    string constant SEPOLIA_PRIVATE_KEY = "SEPOLIA_PRIVATE_KEY";
    string constant MAINNET_PRIVATE_KEY = "MAINNET_PRIVATE_KEY";
    string constant ANVIL_PRIVATE_KEY = "ANVIL_PRIVATE_KEY";

    /**
     * @notice 根据当前网络自动选择链上配置
     * @dev 31337/1337 -> Anvil，本地；11155111 -> Sepolia；1 -> Mainnet
     */
    constructor() {
        uint256 chainId = block.chainid;
        if (chainId == 31337 || chainId == 1337) {
            activeChainConfig = getOrCreateAnvilConfig();
        } else if (chainId == 11155111) {
            activeChainConfig = getSepoliaConfig();
        } else if (chainId == 1) {
            activeChainConfig = getMainnetConfig();
        } else {
            revert("Chain not supported");
        }
    }

    /**
     * @notice 获取当前激活的链配置
     * @dev 要想在部署脚本中可见，必须使用 external
     */
    function getActiveChainConfig() external view returns (ChainConfig memory) {
        return activeChainConfig;
    }

    /**
     * @notice 获取（或在需要时创建）本地 Anvil 配置
     */
    function getOrCreateAnvilConfig() public view returns (ChainConfig memory AnvilConfig) {
        AnvilConfig = ChainConfig({deployerPrivateKey: vm.envUint(ANVIL_PRIVATE_KEY)});
        return AnvilConfig;
    }

    /**
     * @notice 获取 Sepolia 配置
     */
    function getSepoliaConfig() public view returns (ChainConfig memory SepoliaConfig) {
        SepoliaConfig = ChainConfig({deployerPrivateKey: vm.envUint(SEPOLIA_PRIVATE_KEY)});
        return SepoliaConfig;
    }

    /**
     * @notice 获取 Mainnet 配置（占位）
     */
    function getMainnetConfig() public pure returns (ChainConfig memory MainnetConfig) {
        return MainnetConfig;
    }
}
