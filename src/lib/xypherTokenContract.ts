// Auto-compiled from contracts/XypherToken.sol via solc 0.8.39+commit.ce47f2c8.Emscripten.clang
// Optimizer: enabled (200 runs), EVM target: paris (compatible with all public EVM networks)

export interface PublicEvmDeployNetwork {
  id: string;
  name: string;
  shortName: string;
  chainId: number;
  chainIdHex: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  rpcPath?: string;
  explorerUrl: string;
  faucetUrl?: string;
  faucetLabel?: string;
  category: 'mainnet' | 'testnet' | 'xypher';
  gasNote: string;
  isZeroFeeHosted?: boolean;
  isFreeRealPublic?: boolean;
  recommended?: boolean;
}

export const XYPHER_SOLC_VERSION = "0.8.39+commit.ce47f2c8.Emscripten.clang";
export const XYPHER_DEFAULT_SUPPLY_WHOLE = 60_000_000;

export const XYPHER_TOKEN_SOURCE = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n/**\n * @title Xypher Token (XYPH)\n * @notice Standard EIP-20 (ERC-20) smart contract for Xypher (XYPH).\n *         Deployable on any EVM-compatible global network (Polygon, BNB Smart Chain,\n *         Base, Arbitrum, Ethereum, Sepolia, or Xypher Network) and directly\n *         compatible with MetaMask wallets worldwide.\n */\ncontract XypherToken {\n    string public constant name = \"Xypher\";\n    string public constant symbol = \"XYPH\";\n    uint8 public constant decimals = 4;\n\n    uint256 public totalSupply;\n    address public owner;\n\n    mapping(address => uint256) public balanceOf;\n    mapping(address => mapping(address => uint256)) public allowance;\n\n    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);\n\n    modifier onlyOwner() {\n        require(msg.sender == owner, \"XYPH: caller is not owner\");\n        _;\n    }\n\n    /**\n     * @param initialSupplyWholeTokens Whole-token initial supply (e.g. 60000000 for 60,000,000 XYPH).\n     *        Scaled internally by 10**decimals (10,000).\n     */\n    constructor(uint256 initialSupplyWholeTokens) {\n        require(initialSupplyWholeTokens > 0, \"XYPH: initial supply must be > 0\");\n        require(initialSupplyWholeTokens <= 100_000_000_000, \"XYPH: supply exceeds max cap\");\n\n        owner = msg.sender;\n        uint256 scaledSupply = initialSupplyWholeTokens * (10 ** uint256(decimals));\n        totalSupply = scaledSupply;\n        balanceOf[msg.sender] = scaledSupply;\n\n        emit OwnershipTransferred(address(0), msg.sender);\n        emit Transfer(address(0), msg.sender, scaledSupply);\n    }\n\n    function transfer(address to, uint256 value) external returns (bool) {\n        _transfer(msg.sender, to, value);\n        return true;\n    }\n\n    function approve(address spender, uint256 value) external returns (bool) {\n        require(spender != address(0), \"XYPH: approve to zero address\");\n        allowance[msg.sender][spender] = value;\n        emit Approval(msg.sender, spender, value);\n        return true;\n    }\n\n    function transferFrom(address from, address to, uint256 value) external returns (bool) {\n        uint256 currentAllowance = allowance[from][msg.sender];\n        require(currentAllowance >= value, \"XYPH: insufficient allowance\");\n        unchecked {\n            allowance[from][msg.sender] = currentAllowance - value;\n        }\n        emit Approval(from, msg.sender, allowance[from][msg.sender]);\n        _transfer(from, to, value);\n        return true;\n    }\n\n    function burn(uint256 value) external returns (bool) {\n        uint256 senderBalance = balanceOf[msg.sender];\n        require(senderBalance >= value, \"XYPH: burn exceeds balance\");\n        unchecked {\n            balanceOf[msg.sender] = senderBalance - value;\n            totalSupply -= value;\n        }\n        emit Transfer(msg.sender, address(0), value);\n        return true;\n    }\n\n    function transferOwnership(address newOwner) external onlyOwner returns (bool) {\n        require(newOwner != address(0), \"XYPH: new owner is zero address\");\n        address prev = owner;\n        owner = newOwner;\n        emit OwnershipTransferred(prev, newOwner);\n        return true;\n    }\n\n    function _transfer(address from, address to, uint256 value) internal {\n        require(from != address(0), \"XYPH: transfer from zero address\");\n        require(to != address(0), \"XYPH: transfer to zero address\");\n        uint256 fromBalance = balanceOf[from];\n        require(fromBalance >= value, \"XYPH: transfer exceeds balance\");\n        unchecked {\n            balanceOf[from] = fromBalance - value;\n            balanceOf[to] += value;\n        }\n        emit Transfer(from, to, value);\n    }\n}\n";

export const XYPHER_TOKEN_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "initialSupplyWholeTokens",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "burn",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const XYPHER_TOKEN_BYTECODE = "0x608060405234801561001057600080fd5b50604051610b6e380380610b6e83398101604081905261002f91610182565b600081116100845760405162461bcd60e51b815260206004820181905260248201527f585950483a20696e697469616c20737570706c79206d757374206265203e203060448201526064015b60405180910390fd5b64174876e8008111156100d95760405162461bcd60e51b815260206004820152601c60248201527f585950483a20737570706c792065786365656473206d61782063617000000000604482015260640161007b565b600180546001600160a01b0319163317905560006100f96004600a61029a565b61010390836102ad565b6000818155338082526002602052604080832084905551929350917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0908290a360405181815233906000907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9060200160405180910390a350506102c4565b60006020828403121561019457600080fd5b5051919050565b634e487b7160e01b600052601160045260246000fd5b6001815b60018411156101ec578085048111156101d0576101d061019b565b60018416156101de57908102905b60019390931c9280026101b5565b935093915050565b60008261020357506001610294565b8161021057506000610294565b816001811461022657600281146102305761024c565b6001915050610294565b60ff8411156102415761024161019b565b50506001821b610294565b5060208310610133831016604e8410600b841016171561026f575081810a610294565b61027c60001984846101b1565b80600019048211156102905761029061019b565b0290505b92915050565b60006102a683836101f4565b9392505050565b80820281158282048414176102945761029461019b565b61089b806102d36000396000f3fe608060405234801561001057600080fd5b50600436106100b45760003560e01c806370a082311161007157806370a082311461016e5780638da5cb5b1461018e57806395d89b41146101b9578063a9059cbb146101dc578063dd62ed3e146101ef578063f2fde38b1461021a57600080fd5b806306fdde03146100b9578063095ea7b3146100f457806318160ddd1461011757806323b872dd1461012e578063313ce5671461014157806342966c681461015b575b600080fd5b6100de604051806040016040528060068152602001652c3cb83432b960d11b81525081565b6040516100eb919061072b565b60405180910390f35b610107610102366004610790565b61022d565b60405190151581526020016100eb565b61012060005481565b6040519081526020016100eb565b61010761013c3660046107ba565b6102ef565b610149600481565b60405160ff90911681526020016100eb565b6101076101693660046107f7565b6103d9565b61012061017c366004610810565b60026020526000908152604090205481565b6001546101a1906001600160a01b031681565b6040516001600160a01b0390911681526020016100eb565b6100de604051806040016040528060048152602001630b0b2a0960e31b81525081565b6101076101ea366004610790565b610486565b6101206101fd366004610832565b600360209081526000928352604080842090915290825290205481565b610107610228366004610810565b61049c565b60006001600160a01b03831661028a5760405162461bcd60e51b815260206004820152601d60248201527f585950483a20617070726f766520746f207a65726f206164647265737300000060448201526064015b60405180910390fd5b3360008181526003602090815260408083206001600160a01b03881680855290835292819020869055518581529192917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92591015b60405180910390a350600192915050565b6001600160a01b0383166000908152600360209081526040808320338452909152812054828110156103635760405162461bcd60e51b815260206004820152601c60248201527f585950483a20696e73756666696369656e7420616c6c6f77616e6365000000006044820152606401610281565b6001600160a01b038516600081815260036020908152604080832033808552908352928190208786039081905590519081529192917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925910160405180910390a36103ce8585856105a8565b506001949350505050565b33600090815260026020526040812054828110156104395760405162461bcd60e51b815260206004820152601a60248201527f585950483a206275726e20657863656564732062616c616e63650000000000006044820152606401610281565b336000818152600260209081526040808320878603905582548790038355518681529192917fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef91016102de565b60006104933384846105a8565b50600192915050565b6001546000906001600160a01b031633146104f95760405162461bcd60e51b815260206004820152601960248201527f585950483a2063616c6c6572206973206e6f74206f776e6572000000000000006044820152606401610281565b6001600160a01b03821661054f5760405162461bcd60e51b815260206004820152601f60248201527f585950483a206e6577206f776e6572206973207a65726f2061646472657373006044820152606401610281565b600180546001600160a01b038481166001600160a01b0319831681179093556040519116919082907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e090600090a360019150505b919050565b6001600160a01b0383166105fe5760405162461bcd60e51b815260206004820181905260248201527f585950483a207472616e736665722066726f6d207a65726f20616464726573736044820152606401610281565b6001600160a01b0382166106545760405162461bcd60e51b815260206004820152601e60248201527f585950483a207472616e7366657220746f207a65726f206164647265737300006044820152606401610281565b6001600160a01b038316600090815260026020526040902054818110156106bd5760405162461bcd60e51b815260206004820152601e60248201527f585950483a207472616e7366657220657863656564732062616c616e636500006044820152606401610281565b6001600160a01b0380851660008181526002602052604080822086860390559286168082529083902080548601905591517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9061071d9086815260200190565b60405180910390a350505050565b602081526000825180602084015260005b81811015610759576020818601810151604086840101520161073c565b506000604082850101526040601f19601f83011684010191505092915050565b80356001600160a01b03811681146105a357600080fd5b600080604083850312156107a357600080fd5b6107ac83610779565b946020939093013593505050565b6000806000606084860312156107cf57600080fd5b6107d884610779565b92506107e660208501610779565b929592945050506040919091013590565b60006020828403121561080957600080fd5b5035919050565b60006020828403121561082257600080fd5b61082b82610779565b9392505050565b6000806040838503121561084557600080fd5b61084e83610779565b915061085c60208401610779565b9050925092905056fea2646970667358221220f8f232b248b61494f2f3ab02317115ebb8772d17e632909bc46d3c206d5ee98064736f6c63430008270033";

export const XYPHER_TOKEN_DEPLOYED_BYTECODE = "0x608060405234801561001057600080fd5b50600436106100b45760003560e01c806370a082311161007157806370a082311461016e5780638da5cb5b1461018e57806395d89b41146101b9578063a9059cbb146101dc578063dd62ed3e146101ef578063f2fde38b1461021a57600080fd5b806306fdde03146100b9578063095ea7b3146100f457806318160ddd1461011757806323b872dd1461012e578063313ce5671461014157806342966c681461015b575b600080fd5b6100de604051806040016040528060068152602001652c3cb83432b960d11b81525081565b6040516100eb919061072b565b60405180910390f35b610107610102366004610790565b61022d565b60405190151581526020016100eb565b61012060005481565b6040519081526020016100eb565b61010761013c3660046107ba565b6102ef565b610149600481565b60405160ff90911681526020016100eb565b6101076101693660046107f7565b6103d9565b61012061017c366004610810565b60026020526000908152604090205481565b6001546101a1906001600160a01b031681565b6040516001600160a01b0390911681526020016100eb565b6100de604051806040016040528060048152602001630b0b2a0960e31b81525081565b6101076101ea366004610790565b610486565b6101206101fd366004610832565b600360209081526000928352604080842090915290825290205481565b610107610228366004610810565b61049c565b60006001600160a01b03831661028a5760405162461bcd60e51b815260206004820152601d60248201527f585950483a20617070726f766520746f207a65726f206164647265737300000060448201526064015b60405180910390fd5b3360008181526003602090815260408083206001600160a01b03881680855290835292819020869055518581529192917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92591015b60405180910390a350600192915050565b6001600160a01b0383166000908152600360209081526040808320338452909152812054828110156103635760405162461bcd60e51b815260206004820152601c60248201527f585950483a20696e73756666696369656e7420616c6c6f77616e6365000000006044820152606401610281565b6001600160a01b038516600081815260036020908152604080832033808552908352928190208786039081905590519081529192917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925910160405180910390a36103ce8585856105a8565b506001949350505050565b33600090815260026020526040812054828110156104395760405162461bcd60e51b815260206004820152601a60248201527f585950483a206275726e20657863656564732062616c616e63650000000000006044820152606401610281565b336000818152600260209081526040808320878603905582548790038355518681529192917fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef91016102de565b60006104933384846105a8565b50600192915050565b6001546000906001600160a01b031633146104f95760405162461bcd60e51b815260206004820152601960248201527f585950483a2063616c6c6572206973206e6f74206f776e6572000000000000006044820152606401610281565b6001600160a01b03821661054f5760405162461bcd60e51b815260206004820152601f60248201527f585950483a206e6577206f776e6572206973207a65726f2061646472657373006044820152606401610281565b600180546001600160a01b038481166001600160a01b0319831681179093556040519116919082907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e090600090a360019150505b919050565b6001600160a01b0383166105fe5760405162461bcd60e51b815260206004820181905260248201527f585950483a207472616e736665722066726f6d207a65726f20616464726573736044820152606401610281565b6001600160a01b0382166106545760405162461bcd60e51b815260206004820152601e60248201527f585950483a207472616e7366657220746f207a65726f206164647265737300006044820152606401610281565b6001600160a01b038316600090815260026020526040902054818110156106bd5760405162461bcd60e51b815260206004820152601e60248201527f585950483a207472616e7366657220657863656564732062616c616e636500006044820152606401610281565b6001600160a01b0380851660008181526002602052604080822086860390559286168082529083902080548601905591517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9061071d9086815260200190565b60405180910390a350505050565b602081526000825180602084015260005b81811015610759576020818601810151604086840101520161073c565b506000604082850101526040601f19601f83011684010191505092915050565b80356001600160a01b03811681146105a357600080fd5b600080604083850312156107a357600080fd5b6107ac83610779565b946020939093013593505050565b6000806000606084860312156107cf57600080fd5b6107d884610779565b92506107e660208501610779565b929592945050506040919091013590565b60006020828403121561080957600080fd5b5035919050565b60006020828403121561082257600080fd5b61082b82610779565b9392505050565b6000806040838503121561084557600080fd5b61084e83610779565b915061085c60208401610779565b9050925092905056fea2646970667358221220f8f232b248b61494f2f3ab02317115ebb8772d17e632909bc46d3c206d5ee98064736f6c63430008270033";

export const PUBLIC_DEPLOY_NETWORKS: PublicEvmDeployNetwork[] = [
  {
    id: 'xypher',
    name: 'XYPH Network',
    shortName: 'XYPH Network',
    chainId: 5790032,
    chainIdHex: '0x585950',
    nativeCurrency: { name: 'XYPH', symbol: 'XYPH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 XYPH network fee (100% Free · Zero Gas) · 24M blocks',
    isZeroFeeHosted: true,
    recommended: true,
  },
  {
    id: 'polygon',
    name: 'Polygon (XYPH Zero-Fee)',
    shortName: 'Polygon',
    chainId: 5790137,
    chainIdHex: '0x5859b9',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/polygon',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 POL network fee (100% Free · Zero Gas like XYPH Network)',
    isZeroFeeHosted: true,
  },
  {
    id: 'bsc',
    name: 'BNB Chain (XYPH Zero-Fee)',
    shortName: 'BNB Chain',
    chainId: 5790056,
    chainIdHex: '0x585968',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/bsc',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 BNB network fee (100% Free · Zero Gas like XYPH Network)',
    isZeroFeeHosted: true,
  },
  {
    id: 'base',
    name: 'Base (XYPH Zero-Fee)',
    shortName: 'Base',
    chainId: 5798453,
    chainIdHex: '0x587a35',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/base',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 ETH network fee (100% Free · Zero Gas like XYPH Network)',
    isZeroFeeHosted: true,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum (XYPH Zero-Fee)',
    shortName: 'Arbitrum',
    chainId: 5794216,
    chainIdHex: '0x5869a8',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/arbitrum',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 ETH network fee (100% Free · Zero Gas like XYPH Network)',
    isZeroFeeHosted: true,
  },
  {
    id: 'ethereum',
    name: 'Ethereum (XYPH Zero-Fee)',
    shortName: 'Ethereum',
    chainId: 5790001,
    chainIdHex: '0x585931',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/ethereum',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 ETH network fee (100% Free · Zero Gas like XYPH Network)',
    isZeroFeeHosted: true,
  },
  {
    id: 'sepolia',
    name: 'Sepolia (XYPH Zero-Fee)',
    shortName: 'Sepolia',
    chainId: 5791111,
    chainIdHex: '0x585d87',
    nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc/sepolia',
    explorerUrl: '',
    category: 'testnet',
    gasNote: '0 ETH network fee (100% Free · Zero Gas Testnet)',
    isZeroFeeHosted: true,
  },
];

/**
 * Real, live, globally verifiable PRODUCTION MAINNETS (ZERO testnets) where deploying real Solidity
 * smart contracts costs $0 real money (XYPH Network Mainnet + 4 live SKALE Zero-Gas Production Mainnets).
 */
export const FREE_REAL_PUBLIC_NETWORKS: PublicEvmDeployNetwork[] = [
  {
    id: 'real-xypher',
    name: 'XYPH Network Mainnet',
    shortName: 'XYPH Mainnet',
    chainId: 5790032,
    chainIdHex: '0x585950',
    nativeCurrency: { name: 'XYPH', symbol: 'XYPH', decimals: 18 },
    rpcUrls: [],
    rpcPath: '/evm-rpc',
    explorerUrl: '',
    category: 'mainnet',
    gasNote: '0 XYPH gas · Real production mainnet (instant deploy, no faucet needed)',
    isZeroFeeHosted: true,
    isFreeRealPublic: true,
    recommended: true,
  },
  {
    id: 'real-skale-europa',
    name: 'SKALE Europa DeFi Hub Mainnet',
    shortName: 'SKALE Europa',
    chainId: 2046399126,
    chainIdHex: '0x79f99296',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: ['https://mainnet.skalenodes.com/v1/elated-tan-skat'],
    explorerUrl: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
    faucetUrl: 'https://www.sfuelstation.com/',
    faucetLabel: 'Claim Free sFUEL ($0)',
    category: 'mainnet',
    gasNote: 'Real global Zero-Gas EVM Mainnet · $0 sFUEL gas · Live Mainnet Explorer',
    isZeroFeeHosted: false,
    isFreeRealPublic: true,
    recommended: true,
  },
  {
    id: 'real-skale-nebula',
    name: 'SKALE Nebula Hub Mainnet',
    shortName: 'SKALE Nebula',
    chainId: 1482601649,
    chainIdHex: '0x585eb4b1',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: ['https://mainnet.skalenodes.com/v1/green-giddy-denebola'],
    explorerUrl: 'https://green-giddy-denebola.explorer.mainnet.skalenodes.com',
    faucetUrl: 'https://www.sfuelstation.com/',
    faucetLabel: 'Claim Free sFUEL ($0)',
    category: 'mainnet',
    gasNote: 'Real global Zero-Gas EVM Mainnet · $0 sFUEL gas · Live Mainnet Explorer',
    isZeroFeeHosted: false,
    isFreeRealPublic: true,
  },
  {
    id: 'real-skale-calypso',
    name: 'SKALE Calypso Innovation Hub Mainnet',
    shortName: 'SKALE Calypso',
    chainId: 1564830818,
    chainIdHex: '0x5d456c62',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: ['https://mainnet.skalenodes.com/v1/honorable-steel-rasalhague'],
    explorerUrl: 'https://honorable-steel-rasalhague.explorer.mainnet.skalenodes.com',
    faucetUrl: 'https://www.sfuelstation.com/',
    faucetLabel: 'Claim Free sFUEL ($0)',
    category: 'mainnet',
    gasNote: 'Real global Zero-Gas EVM Mainnet · $0 sFUEL gas · Live Mainnet Explorer',
    isZeroFeeHosted: false,
    isFreeRealPublic: true,
  },
  {
    id: 'real-skale-titan',
    name: 'SKALE Titan AI Hub Mainnet',
    shortName: 'SKALE Titan',
    chainId: 1350216234,
    chainIdHex: '0x507aaa2a',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: ['https://mainnet.skalenodes.com/v1/parallel-stormy-spica'],
    explorerUrl: 'https://parallel-stormy-spica.explorer.mainnet.skalenodes.com',
    faucetUrl: 'https://www.sfuelstation.com/',
    faucetLabel: 'Claim Free sFUEL ($0)',
    category: 'mainnet',
    gasNote: 'Real global Zero-Gas EVM Mainnet · $0 sFUEL gas · Live Mainnet Explorer',
    isZeroFeeHosted: false,
    isFreeRealPublic: true,
  },
];

/** Optional external third-party paid public mainnets (enforced by external validators — require native gas) */
export const EXTERNAL_PAID_DEPLOY_NETWORKS: PublicEvmDeployNetwork[] = [
  {
    id: 'ext-polygon',
    name: 'Polygon PoS Mainnet (External)',
    shortName: 'Polygon Mainnet',
    chainId: 137,
    chainIdHex: '0x89',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'],
    explorerUrl: 'https://polygonscan.com',
    category: 'mainnet',
    gasNote: 'Paid external mainnet · requires real POL gas (~$0.01)',
    isZeroFeeHosted: false,
  },
  {
    id: 'ext-bsc',
    name: 'BNB Smart Chain Mainnet (External)',
    shortName: 'BNB Mainnet',
    chainId: 56,
    chainIdHex: '0x38',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
    explorerUrl: 'https://bscscan.com',
    category: 'mainnet',
    gasNote: 'Paid external mainnet · requires real BNB gas (~$0.10)',
    isZeroFeeHosted: false,
  },
  {
    id: 'ext-base',
    name: 'Base Mainnet (External)',
    shortName: 'Base Mainnet',
    chainId: 8453,
    chainIdHex: '0x2105',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    explorerUrl: 'https://basescan.org',
    category: 'mainnet',
    gasNote: 'Paid external mainnet · requires real ETH gas (<$0.02)',
    isZeroFeeHosted: false,
  },
  {
    id: 'ext-arbitrum',
    name: 'Arbitrum One Mainnet (External)',
    shortName: 'Arbitrum Mainnet',
    chainId: 42161,
    chainIdHex: '0xa4b1',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    explorerUrl: 'https://arbiscan.io',
    category: 'mainnet',
    gasNote: 'Paid external mainnet · requires real ETH gas (<$0.05)',
    isZeroFeeHosted: false,
  },
  {
    id: 'ext-ethereum',
    name: 'Ethereum Mainnet (External)',
    shortName: 'Ethereum Mainnet',
    chainId: 1,
    chainIdHex: '0x1',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    explorerUrl: 'https://etherscan.io',
    category: 'mainnet',
    gasNote: 'Paid external L1 mainnet · requires real ETH gas',
    isZeroFeeHosted: false,
  },
];

export const ZERO_FEE_HOSTED_CHAIN_IDS: ReadonlySet<number> = new Set(
  PUBLIC_DEPLOY_NETWORKS.filter((n) => n.isZeroFeeHosted).map((n) => n.chainId)
);

export const ZERO_FEE_RPC_BY_SLUG: Record<string, { chainId: number; chainIdHex: string; name: string }> =
  Object.fromEntries(
    PUBLIC_DEPLOY_NETWORKS.filter((n) => n.isZeroFeeHosted).map((n) => [
      n.id,
      { chainId: n.chainId, chainIdHex: n.chainIdHex, name: n.name },
    ])
  );

export function findDeployNetworkByChainId(chainId: number): PublicEvmDeployNetwork | undefined {
  return (
    FREE_REAL_PUBLIC_NETWORKS.find((n) => n.chainId === chainId) ||
    PUBLIC_DEPLOY_NETWORKS.find((n) => n.chainId === chainId) ||
    EXTERNAL_PAID_DEPLOY_NETWORKS.find((n) => n.chainId === chainId)
  );
}
