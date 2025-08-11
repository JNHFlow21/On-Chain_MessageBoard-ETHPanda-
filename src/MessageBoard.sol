// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MessageBoard - 简易链上留言板
/// @notice 支持发帖、编辑、软删除、分页查询，含付费和限速可配置
contract MessageBoard {
    // ----------------------
    // 权限：简易 Ownable
    // ----------------------
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "NotOwner");
        _;
    }

    // ----------------------
    // 数据结构
    // ----------------------
    struct Message {
        uint256 id;
        address author;
        string content;
        uint64 createdAt;
        uint64 editedAt;
        bool isDeleted;
        uint256 parentId; // 0 表示主贴
    }

    Message[] private _messages;

    // 防垃圾
    mapping(address => uint64) public lastPostAt;

    // ----------------------
    // 配置
    // ----------------------
    uint256 public postFee; // 发帖费用（可为 0）
    uint64 public rateLimitSeconds; // 限速窗口（可为 0）
    uint256 public maxContentLengthBytes; // 内容最大字节数

    // ----------------------
    // 事件
    // ----------------------
    event MessagePosted(uint256 indexed id, address indexed author, uint256 indexed parentId, string content);
    event MessageEdited(uint256 indexed id, address indexed author, string newContent);
    event MessageDeleted(uint256 indexed id, address indexed author);
    event ConfigChanged(uint256 postFee, uint64 rateLimitSeconds, uint256 maxContentLengthBytes);

    // ----------------------
    // 构造
    // ----------------------
    constructor(uint256 initialPostFee, uint64 initialRateLimitSeconds, uint256 initialMaxContentLengthBytes) {
        owner = msg.sender;
        postFee = initialPostFee;
        rateLimitSeconds = initialRateLimitSeconds;
        maxContentLengthBytes = initialMaxContentLengthBytes == 0 ? 280 : initialMaxContentLengthBytes;
        emit ConfigChanged(postFee, rateLimitSeconds, maxContentLengthBytes);
    }

    // ----------------------
    // 对外方法
    // ----------------------
    function total() external view returns (uint256) {
        return _messages.length;
    }

    function getMessage(uint256 id) external view returns (Message memory) {
        require(id < _messages.length, "InvalidId");
        return _messages[id];
    }

    function getLatest(uint256 count) external view returns (Message[] memory) {
        require(count > 0, "ZeroCount");
        if (count > 100) count = 100;
        uint256 len = _messages.length;
        if (len == 0) return new Message[](0);
        uint256 start = len > count ? len - count : 0;
        uint256 size = len - start;
        Message[] memory result = new Message[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _messages[start + i];
        }
        return result;
    }

    /// @notice 从 start 开始，返回最多 count 条（start 为索引，非 id）
    function getRange(uint256 start, uint256 count) external view returns (Message[] memory) {
        require(count > 0, "ZeroCount");
        if (count > 100) count = 100;
        uint256 len = _messages.length;
        if (start >= len) return new Message[](0);
        uint256 endExclusive = start + count;
        if (endExclusive > len) endExclusive = len;
        uint256 size = endExclusive - start;
        Message[] memory result = new Message[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _messages[start + i];
        }
        return result;
    }

    function post(string calldata content, uint256 parentId) external payable returns (uint256 id) {
        _validateContent(content);
        _enforceFee();
        _enforceRateLimit();

        if (parentId != 0) {
            require(parentId < _messages.length, "InvalidParent");
        }

        id = _messages.length;
        _messages.push(
            Message({
                id: id,
                author: msg.sender,
                content: content,
                createdAt: uint64(block.timestamp),
                editedAt: 0,
                isDeleted: false,
                parentId: parentId
            })
        );

        lastPostAt[msg.sender] = uint64(block.timestamp);
        emit MessagePosted(id, msg.sender, parentId, content);
    }

    function edit(uint256 id, string calldata newContent) external {
        require(id < _messages.length, "InvalidId");
        Message storage m = _messages[id];
        require(!m.isDeleted, "Deleted");
        require(m.author == msg.sender, "NotAuthor");
        _validateContent(newContent);
        m.content = newContent;
        m.editedAt = uint64(block.timestamp);
        emit MessageEdited(id, msg.sender, newContent);
    }

    function softDelete(uint256 id) external {
        require(id < _messages.length, "InvalidId");
        Message storage m = _messages[id];
        require(!m.isDeleted, "Deleted");
        require(m.author == msg.sender || msg.sender == owner, "NotAllowed");
        m.isDeleted = true;
        emit MessageDeleted(id, msg.sender);
    }

    function setPostFee(uint256 newFee) external onlyOwner {
        postFee = newFee;
        emit ConfigChanged(postFee, rateLimitSeconds, maxContentLengthBytes);
    }

    function setRateLimit(uint64 newSeconds) external onlyOwner {
        rateLimitSeconds = newSeconds;
        emit ConfigChanged(postFee, rateLimitSeconds, maxContentLengthBytes);
    }

    function setMaxContentLength(uint256 newMaxBytes) external onlyOwner {
        require(newMaxBytes > 0 && newMaxBytes <= 4096, "BadMax");
        maxContentLengthBytes = newMaxBytes;
        emit ConfigChanged(postFee, rateLimitSeconds, maxContentLengthBytes);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZeroAddr");
        owner = newOwner;
    }

    function withdraw(address payable to) external onlyOwner {
        require(to != address(0), "ZeroAddr");
        uint256 bal = address(this).balance;
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "WithdrawFail");
    }

    // ----------------------
    // 内部方法
    // ----------------------
    function _validateContent(string calldata content) internal view {
        uint256 len = bytes(content).length;
        require(len > 0, "Empty");
        require(len <= maxContentLengthBytes, "TooLong");
    }

    function _enforceFee() internal view {
        require(msg.value == postFee, "BadFee");
    }

    function _enforceRateLimit() internal view {
        if (rateLimitSeconds == 0) return;
        uint64 last = lastPostAt[msg.sender];
        if (last == 0) return; // 首次发帖不受限速约束
        require(uint64(block.timestamp) >= last + rateLimitSeconds, "RateLimited");
    }
}


