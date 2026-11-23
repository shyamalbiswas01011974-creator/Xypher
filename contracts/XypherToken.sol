// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Xypher Token (XYPH)
 * @notice Standard EIP-20 (ERC-20) smart contract for Xypher (XYPH).
 *         Deployable on any EVM-compatible global network (Polygon, BNB Smart Chain,
 *         Base, Arbitrum, Ethereum, Sepolia, or Xypher Network) and directly
 *         compatible with MetaMask wallets worldwide.
 */
contract XypherToken {
    string public constant name = "Xypher";
    string public constant symbol = "XYPH";
    uint8 public constant decimals = 4;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "XYPH: caller is not owner");
        _;
    }

    /**
     * @param initialSupplyWholeTokens Whole-token initial supply (e.g. 60000000 for 60,000,000 XYPH).
     *        Scaled internally by 10**decimals (10,000).
     */
    constructor(uint256 initialSupplyWholeTokens) {
        require(initialSupplyWholeTokens > 0, "XYPH: initial supply must be > 0");
        require(initialSupplyWholeTokens <= 100_000_000_000, "XYPH: supply exceeds max cap");

        owner = msg.sender;
        uint256 scaledSupply = initialSupplyWholeTokens * (10 ** uint256(decimals));
        totalSupply = scaledSupply;
        balanceOf[msg.sender] = scaledSupply;

        emit OwnershipTransferred(address(0), msg.sender);
        emit Transfer(address(0), msg.sender, scaledSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        require(spender != address(0), "XYPH: approve to zero address");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "XYPH: insufficient allowance");
        unchecked {
            allowance[from][msg.sender] = currentAllowance - value;
        }
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        _transfer(from, to, value);
        return true;
    }

    function burn(uint256 value) external returns (bool) {
        uint256 senderBalance = balanceOf[msg.sender];
        require(senderBalance >= value, "XYPH: burn exceeds balance");
        unchecked {
            balanceOf[msg.sender] = senderBalance - value;
            totalSupply -= value;
        }
        emit Transfer(msg.sender, address(0), value);
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner returns (bool) {
        require(newOwner != address(0), "XYPH: new owner is zero address");
        address prev = owner;
        owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "XYPH: transfer from zero address");
        require(to != address(0), "XYPH: transfer to zero address");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "XYPH: transfer exceeds balance");
        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
