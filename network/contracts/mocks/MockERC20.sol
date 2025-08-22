// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/**
 * @title MockERC20
 * @notice Token ERC-20 básico para testing del sistema CRED Token
 * @dev Implementa funcionalidad estándar sin permit
 * Usado para probar flujos clásicos: approve + deposit
 */
contract MockERC20 {
    // ====== STATE VARIABLES ======
    
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    // ====== EVENTS ======
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    // ====== CONSTRUCTOR ======
    
    /**
     * @dev Crea un token ERC-20 básico para testing
     * @param _name Nombre del token (ej: "Test Token")
     * @param _symbol Símbolo del token (ej: "TEST")
     * @param _decimals Decimales del token (usualmente 18)
     * @param _initialSupply Supply inicial que se minta al deployer
     */
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
        
        emit Transfer(address(0), msg.sender, _initialSupply);
    }
    
    // ====== CORE ERC-20 FUNCTIONS ======
    
    /**
     * @dev Transfiere tokens a otra dirección
     * @param to Dirección destino
     * @param value Cantidad a transferir
     * @return success True si la transferencia fue exitosa
     */
    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }
    
    /**
     * @dev Aprueba a otra dirección para gastar tokens en tu nombre
     * @param spender Dirección autorizada a gastar
     * @param value Cantidad máxima autorizada
     * @return success True si la aprobación fue exitosa
     */
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    
    /**
     * @dev Transfiere tokens en nombre de otra dirección (requiere allowance)
     * @param from Dirección origen (debe tener allowance)
     * @param to Dirección destino
     * @param value Cantidad a transferir
     * @return success True si la transferencia fue exitosa
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        // Verificar allowance
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "MockERC20: insufficient allowance");
        
        // Actualizar allowance (excepto si es allowance máximo)
        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - value;
            emit Approval(from, msg.sender, currentAllowance - value);
        }
        
        return _transfer(from, to, value);
    }
    
    // ====== INTERNAL FUNCTIONS ======
    
    /**
     * @dev Lógica interna de transferencia
     * @param from Dirección origen
     * @param to Dirección destino
     * @param value Cantidad a transferir
     * @return success True si la transferencia fue exitosa
     */
    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "MockERC20: transfer to zero address");
        require(balanceOf[from] >= value, "MockERC20: insufficient balance");
        
        balanceOf[from] -= value;
        balanceOf[to] += value;
        
        emit Transfer(from, to, value);
        return true;
    }
    
    // ====== TESTING UTILITIES ======
    
    /**
     * @dev Minta tokens adicionales (solo para testing)
     * @param to Dirección que recibe los tokens
     * @param amount Cantidad a mintear
     */
    function mint(address to, uint256 amount) external {
        require(to != address(0), "MockERC20: mint to zero address");
        
        totalSupply += amount;
        balanceOf[to] += amount;
        
        emit Transfer(address(0), to, amount);
    }
    
    /**
     * @dev Quema tokens (solo para testing)
     * @param from Dirección de la cual quemar tokens
     * @param amount Cantidad a quemar
     */
    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance to burn");
        
        balanceOf[from] -= amount;
        totalSupply -= amount;
        
        emit Transfer(from, address(0), amount);
    }
}
