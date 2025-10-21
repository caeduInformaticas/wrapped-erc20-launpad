// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/**
 * @title MockERC20WithPermit
 * @notice Token ERC-20 con soporte EIP-2612 (permit) para testing del sistema CRED Token
 * @dev Extiende MockERC20 agregando funcionalidad permit para mejor UX
 * Usado para probar flujos optimizados: permit + deposit en 1 transacción
 */
contract MockERC20WithPermit {
    // ====== STATE VARIABLES ======
    
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    // EIP-2612 permit variables
    mapping(address => uint256) public nonces;
    
    // EIP-712 Domain Separator
    bytes32 public DOMAIN_SEPARATOR;
    
    // EIP-2612 Permit typehash
    bytes32 public constant PERMIT_TYPEHASH = 
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    
    // ====== EVENTS ======
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    // ====== CONSTRUCTOR ======
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _initialSupply
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        
        // Mintear supply inicial al deployer
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
        
        // Configurar EIP-712 Domain Separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_name)),
                keccak256(bytes("1")), // version
                block.chainid,
                address(this)
            )
        );
        
        emit Transfer(address(0), msg.sender, _initialSupply);
    }
    
    // ====== CORE ERC-20 FUNCTIONS ======
    
    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }
    
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "MockERC20WithPermit: insufficient allowance");
        
        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - value;
            emit Approval(from, msg.sender, currentAllowance - value);
        }
        
        return _transfer(from, to, value);
    }
    
    // ====== EIP-2612 PERMIT FUNCTION ======
    
    /**
     * @dev Implementa EIP-2612 permit para autorización sin transacción
     * @param owner Propietario de los tokens
     * @param spender Dirección autorizada a gastar
     * @param value Cantidad autorizada
     * @param deadline Timestamp límite para usar el permit
     * @param v Componente v de la firma
     * @param r Componente r de la firma  
     * @param s Componente s de la firma
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(deadline >= block.timestamp, "MockERC20WithPermit: permit expired");
        
        // Construir el hash del mensaje según EIP-712
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                owner,
                spender,
                value,
                nonces[owner]++, // Incrementar nonce
                deadline
            )
        );
        
        bytes32 hash = keccak256(
            abi.encodePacked(
                "\x19\x01", // EIP-191 prefix
                DOMAIN_SEPARATOR,
                structHash
            )
        );
        
        // Recuperar dirección del firmante
        address signer = ecrecover(hash, v, r, s);
        require(signer == owner, "MockERC20WithPermit: invalid signature");
        require(signer != address(0), "MockERC20WithPermit: invalid signature");
        
        // Establecer allowance
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }
    
    // ====== INTERNAL FUNCTIONS ======
    
    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "MockERC20WithPermit: transfer to zero address");
        require(balanceOf[from] >= value, "MockERC20WithPermit: insufficient balance");
        
        balanceOf[from] -= value;
        balanceOf[to] += value;
        
        emit Transfer(from, to, value);
        return true;
    }
    
    // ====== TESTING UTILITIES ======
    
    function mint(address to, uint256 amount) external {
        require(to != address(0), "MockERC20WithPermit: mint to zero address");
        
        totalSupply += amount;
        balanceOf[to] += amount;
        
        emit Transfer(address(0), to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "MockERC20WithPermit: insufficient balance to burn");
        
        balanceOf[from] -= amount;
        totalSupply -= amount;
        
        emit Transfer(from, address(0), amount);
    }
}
