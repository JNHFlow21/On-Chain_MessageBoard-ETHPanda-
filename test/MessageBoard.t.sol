// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "lib/forge-std/src/Test.sol";
import {Deploy} from "script/Deploy.s.sol";
import {MessageBoard} from "src/MessageBoard.sol";

contract MessageBoardTest is Test {
    Deploy private deployer;
    MessageBoard private board;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);

    function setUp() public {
        deployer = new Deploy();
        // 直接调用部署方法（不广播）
        board = deployer.deployMessageBoardWithConfig(0, 0, 280);
    }

    function test_PostAndRead() public {
        vm.prank(alice);
        uint256 id = board.post("hello world", 0);
        assertEq(id, 0);

        MessageBoard.Message memory m0 = board.getMessage(0);
        assertEq(m0.id, 0);
        assertEq(m0.author, alice);
        assertEq(m0.content, "hello world");
        assertGt(m0.createdAt, 0);
        assertEq(m0.editedAt, 0);
        assertEq(m0.isDeleted, false);
        assertEq(m0.parentId, 0);

        MessageBoard.Message[] memory latest = board.getLatest(10);
        assertEq(latest.length, 1);
        assertEq(latest[0].content, "hello world");
    }

    function test_EditAndSoftDelete() public {
        vm.startPrank(alice);
        uint256 id = board.post("hi", 0);
        board.edit(id, "hi edited");
        vm.stopPrank();

        MessageBoard.Message memory m = board.getLatest(1)[0];
        assertEq(m.content, "hi edited");
        assertGt(m.editedAt, 0);

        // 非作者不可编辑
        vm.prank(bob);
        vm.expectRevert(bytes("NotAuthor"));
        board.edit(id, "hack");

        // 作者软删除
        vm.prank(alice);
        board.softDelete(id);
        m = board.getMessage(id);
        assertTrue(m.isDeleted);
    }

    function test_PaginationAndRange() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 5; i++) {
            board.post(string(abi.encodePacked("m", vm.toString(i))), 0);
        }
        vm.stopPrank();

        MessageBoard.Message[] memory latest3 = board.getLatest(3);
        assertEq(latest3.length, 3);
        assertEq(board.getRange(0, 2).length, 2);
        assertEq(board.getRange(4, 10).length, 1);
        assertEq(board.getRange(5, 10).length, 0);
    }

    function test_FeeAndRateLimit() public {
        // 重新部署，设置费用与限速
        board = deployer.deployMessageBoardWithConfig(1 wei, 10, 280);

        vm.deal(alice, 1 ether);

        // 缺少费用
        vm.prank(alice);
        vm.expectRevert(bytes("BadFee"));
        board.post("x", 0);

        // 正确支付
        vm.prank(alice);
        board.post{value: 1 wei}("y", 0);

        // 限速生效
        vm.prank(alice);
        vm.expectRevert(bytes("RateLimited"));
        board.post{value: 1 wei}("z", 0);

        // 时间快进
        vm.warp(block.timestamp + 11);
        vm.prank(alice);
        board.post{value: 1 wei}("w", 0);

        // 提现
        uint256 beforeBal = bob.balance;
        vm.prank(address(deployer));
        board.transferOwnership(address(this));
        board.withdraw(payable(bob));
        assertGt(bob.balance, beforeBal);
    }
}


