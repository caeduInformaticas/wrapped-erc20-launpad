// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import "../interfaces/IWrapperFactory.sol";
import "../interfaces/IERC20Permit.sol";

/**
 * @title ERC20Wrapped
 * @notice Contrato wrapper que envuelve tokens ERC-20 existentes
 * @dev Implementa el core del sistema Launhpad según especificaciones del README
 * 
 * Funcionalidad:
 * - Recibe token subyacente y emite token envuelto
 * - Cobra fee en depósitos, no en retiros
 * - Mantiene invariante: 1 token envuelto ↔ 1 token subyacente en reserva
 * - Consulta factory para receptor actual de comisiones
 */
contract ERC20Wrapped is ERC20, ReentrancyGuard {
    // ====== IMMUTABLE STATE VARIABLES ======
    // Estos valores se fijan al desplegar y nunca cambian
    
    /// @notice Token ERC-20 subyacente que se envuelve
    IERC20 public immutable underlying;
    
    /// @notice Fee cobrado en depósitos (en basis points: 100 = 1%)
    uint256 public immutable depositFeeRate;
    
    /// @notice Dirección de la factory (para consultar receptor de fees)
    address public immutable factory;
    
    // ====== CONSTANTS ======
    
    /// @notice Máximo fee permitido (10% = 1000 basis points)
    uint256 public constant MAX_FEE_RATE = 1000;
    
    /// @notice Base para cálculos de porcentajes (100% = 10000 basis points)
    uint256 public constant FEE_BASE = 10000;
    
    // ====== EVENTS ======
    
    /// @notice Emitido cuando un usuario deposita tokens subyacentes
    event Deposit(
        address indexed user,
        uint256 underlyingAmount,
        uint256 wrappedAmount,
        uint256 feeAmount,
        address indexed feeRecipient
    );
    
    /// @notice Emitido cuando un usuario retira tokens subyacentes
    event Withdrawal(
        address indexed user,
        uint256 wrappedAmount,
        uint256 underlyingAmount
    );
    
    // ====== ERRORS ======
    
    error ZeroAddress();
    error ZeroAmount();
    error InvalidFeeRate();
    error TransferFailed();
    error InvalidFactory();
    error InsufficientReserves();
    error InvariantViolation();
    error InvalidRecipient();
// 
    // ====== CONSTRUCTOR ======
    
    /**
     * @dev Construye un nuevo wrapper para un token subyacente
     * @param _underlying Dirección del token ERC-20 a envolver
     * @param _depositFeeRate Fee en basis points (100 = 1%)
     * @param _factory Dirección de la factory (para consultar fee recipient)
     * @param _name Nombre del token wrapped (ej: "Wrapped USDC")
     * @param _symbol Símbolo del token wrapped (ej: "wUSDC")
     */
    constructor(
        address _underlying,
        uint256 _depositFeeRate,
        address _factory,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        // Validaciones
        if (_underlying == address(0)) revert ZeroAddress();
        if (_factory == address(0)) revert ZeroAddress();
        if (_depositFeeRate > MAX_FEE_RATE) revert InvalidFeeRate();
        
        // Asignar variables inmutables
        underlying = IERC20(_underlying);
        depositFeeRate = _depositFeeRate;
        factory = _factory;
    }
    
    // ====== VIEW FUNCTIONS ======
    
    /**
     * @notice Retorna información básica del wrapper
     * @return underlyingToken Dirección del token subyacente
     * @return feeRate Fee rate en basis points
     * @return factoryAddress Dirección de la factory
     */
    function getWrapperInfo() external view returns (
        address underlyingToken,
        uint256 feeRate,
        address factoryAddress
    ) {
        return (address(underlying), depositFeeRate, factory);
    }
    
    /**
     * @notice Retorna el balance de tokens subyacentes en reserva
     * @return reserves Cantidad de tokens subyacentes que respaldan los wrapped
     */
    function getReserves() external view returns (uint256 reserves) {
        return underlying.balanceOf(address(this));
    }
    
    /**
     * @notice Calcula cuántos tokens wrapped recibirá un usuario al depositar
     * @param underlyingAmount Cantidad de tokens subyacentes a depositar
     * @return wrappedAmount Tokens wrapped que recibirá (después de fee)
     * @return feeAmount Fee que se cobrará
     */
    function previewDeposit(uint256 underlyingAmount) external view returns (
        uint256 wrappedAmount,
        uint256 feeAmount
    ) {
        if (underlyingAmount == 0) return (0, 0);
        
        feeAmount = (underlyingAmount * depositFeeRate) / FEE_BASE;
        wrappedAmount = underlyingAmount - feeAmount;
    }
    
    /**
     * @notice Calcula cuántos tokens subyacentes recibirá un usuario al retirar
     * @param wrappedAmount Cantidad de tokens wrapped a quemar
     * @return underlyingAmount Tokens subyacentes que recibirá (1:1, sin fee)
     */
    function previewWithdraw(uint256 wrappedAmount) external pure returns (
        uint256 underlyingAmount
    ) {
        return wrappedAmount; // 1:1 ratio, no fee on withdrawal
    }
    
    /**
     * @notice Verifica que las reservas coincidan con el supply (invariante)
     * @return isHealthy True si el invariante se mantiene
     * @return reserves Reservas actuales
     * @return supply Supply actual de tokens wrapped
     */
    function checkInvariant() public view returns (
        bool isHealthy,
        uint256 reserves,
        uint256 supply
    ) {
        reserves = underlying.balanceOf(address(this));
        supply = totalSupply();
        isHealthy = (reserves >= supply); // Debe haber al menos igual reserva que supply
    }
    
    // ====== INTERNAL HELPER FUNCTIONS ======
    
    /**
     * @notice Obtiene el receptor actual de fees desde la factory
     * @return feeRecipient Dirección donde enviar las comisiones
     * @dev Consulta la factory para obtener el receptor vigente
     */
    function _getCurrentFeeRecipient() internal view returns (address feeRecipient) {
        // Si no hay factory configurada, devolver address(0)
        if (factory == address(0)) {
            return address(0);
        }
        
        // Verificar que factory sea un contrato
        address factoryAddr = factory;
        uint256 size;
        assembly {
            size := extcodesize(factoryAddr)
        }
        if (size == 0) {
            return address(0);
        }
        
        // Intentar obtener el fee recipient de la factory
        try IWrapperFactory(factory).getFeeRecipient() returns (address recipient) {
            return recipient;
        } catch {
            // Si falla la llamada, devolver address(0)
            return address(0);
        }
    }
    
    /**
     * @notice Valida que una cantidad no sea cero
     * @param amount Cantidad a validar
     */
    function _validateNonZeroAmount(uint256 amount) internal pure {
        if (amount == 0) revert ZeroAmount();
    }
    
    /**
     * @notice Valida que una dirección no sea cero
     * @param addr Dirección a validar
     */
    function _validateNonZeroAddress(address addr) internal pure {
        if (addr == address(0)) revert ZeroAddress();
    }
    
    // ====== CORE FUNCTIONALITY PLACEHOLDERS ======
    // Estas funciones se implementarán en las siguientes tasks
    
    /**
     * @notice Deposita tokens subyacentes y recibe tokens wrapped
     * @param amount Cantidad de tokens subyacentes a depositar
     * @return wrappedAmount Cantidad de tokens wrapped recibidos
     */
    function deposit(uint256 amount) external nonReentrant returns (uint256 wrappedAmount) {
        _validateNonZeroAmount(amount);
        _validateNonZeroAddress(msg.sender);
        
        // Verificar invariante antes de la operación
        (bool isHealthyBefore,,) = checkInvariant();
        if (!isHealthyBefore) revert InvariantViolation();
        
        // Calcular el fee y la cantidad wrapped con protección contra overflow
        uint256 feeAmount;
        unchecked {
            // Safe math: depositFeeRate <= MAX_FEE_RATE (1000) y amount es válido
            feeAmount = (amount * depositFeeRate) / FEE_BASE;
            wrappedAmount = amount - feeAmount;
        }
        
        // Validar que el resultado sea lógico
        if (wrappedAmount == 0 && amount > 0) revert ZeroAmount();
        
        // Obtener balance previo para verificar transferencia real
        uint256 balanceBefore = underlying.balanceOf(address(this));
        
        // Transferir tokens del usuario a este contrato
        try underlying.transferFrom(msg.sender, address(this), amount) returns (bool success) {
            if (!success) {
                revert TransferFailed();
            }
        } catch {
            revert TransferFailed();
        }
        
        // Verificar que realmente recibimos los tokens (protección contra deflationary tokens)
        uint256 balanceAfter = underlying.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived < amount) {
            // Para tokens deflacionarios, ajustar cálculos
            feeAmount = (actualReceived * depositFeeRate) / FEE_BASE;
            wrappedAmount = actualReceived - feeAmount;
        }
        
        // Mintear tokens wrapped al usuario
        _mint(msg.sender, wrappedAmount);
        
        // Transferir fee al recipient si hay fee y recipient válido
        address feeRecipient = address(0);
        if (feeAmount > 0) {
            feeRecipient = _getCurrentFeeRecipient();
            if (feeRecipient != address(0)) {
                _validateNonZeroAddress(feeRecipient);
                try underlying.transfer(feeRecipient, feeAmount) returns (bool success) {
                    if (!success) {
                        revert TransferFailed();
                    }
                } catch {
                    revert TransferFailed();
                }
            }
            // Si no hay fee recipient, el fee queda en el contrato como reserva adicional
        }
        
        // Verificar invariante después de la operación
        (bool isHealthyAfter,,) = checkInvariant();
        if (!isHealthyAfter) revert InvariantViolation();
        
        emit Deposit(msg.sender, actualReceived, wrappedAmount, feeAmount, feeRecipient);
    }
    
    /**
     * @notice Deposita usando permit (EIP-2612) en una sola transacción
     * @param amount Cantidad a depositar
     * @param deadline Timestamp límite para el permit
     * @param v Componente v de la firma
     * @param r Componente r de la firma
     * @param s Componente s de la firma
     * @return wrappedAmount Cantidad de tokens wrapped recibidos
     * @dev Implementación Task 2.4: permit + deposit en una transacción
     */
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 wrappedAmount) {
        _validateNonZeroAmount(amount);
        _validateNonZeroAddress(msg.sender);
        
        // Verificar invariante antes de la operación
        (bool isHealthyBefore,,) = checkInvariant();
        if (!isHealthyBefore) revert InvariantViolation();
        
        // Primero ejecutar permit para obtener autorización
        // Esto debe llamarse antes de transferFrom
        IERC20Permit(address(underlying)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        
        // Calcular el fee y la cantidad wrapped con protección contra overflow
        uint256 feeAmount;
        unchecked {
            // Safe math: depositFeeRate <= MAX_FEE_RATE (1000) y amount es válido
            feeAmount = (amount * depositFeeRate) / FEE_BASE;
            wrappedAmount = amount - feeAmount;
        }
        
        // Validar que el resultado sea lógico
        if (wrappedAmount == 0 && amount > 0) revert ZeroAmount();
        
        // Obtener balance previo para verificar transferencia real
        uint256 balanceBefore = underlying.balanceOf(address(this));
        
        // Transferir tokens del usuario a este contrato
        // Esto debe funcionar ahora que tenemos permit
        try underlying.transferFrom(msg.sender, address(this), amount) returns (bool success) {
            if (!success) {
                revert TransferFailed();
            }
        } catch {
            revert TransferFailed();
        }
        
        // Verificar que realmente recibimos los tokens (protección contra deflationary tokens)
        uint256 balanceAfter = underlying.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived < amount) {
            // Para tokens deflacionarios, ajustar cálculos
            feeAmount = (actualReceived * depositFeeRate) / FEE_BASE;
            wrappedAmount = actualReceived - feeAmount;
        }
        
        // Mintear tokens wrapped al usuario
        _mint(msg.sender, wrappedAmount);
        
        // Transferir fee al recipient si hay fee y recipient válido
        address feeRecipient = address(0);
        if (feeAmount > 0) {
            feeRecipient = _getCurrentFeeRecipient();
            if (feeRecipient != address(0)) {
                _validateNonZeroAddress(feeRecipient);
                try underlying.transfer(feeRecipient, feeAmount) returns (bool success) {
                    if (!success) {
                        revert TransferFailed();
                    }
                } catch {
                    revert TransferFailed();
                }
            }
            // Si no hay fee recipient, el fee queda en el contrato como reserva adicional
        }
        
        // Verificar invariante después de la operación
        (bool isHealthyAfter,,) = checkInvariant();
        if (!isHealthyAfter) revert InvariantViolation();
        
        emit Deposit(msg.sender, actualReceived, wrappedAmount, feeAmount, feeRecipient);
    }
    
    /**
     * @notice Quema tokens wrapped y recibe tokens subyacentes
     * @param wrappedAmount Cantidad de tokens wrapped a quemar
     * @return underlyingAmount Cantidad de tokens subyacentes recibidos
     */
    function withdraw(uint256 wrappedAmount) external nonReentrant returns (uint256 underlyingAmount) {
        _validateNonZeroAmount(wrappedAmount);
        _validateNonZeroAddress(msg.sender);
        
        // Verificar invariante antes de la operación
        (bool isHealthyBefore,,) = checkInvariant();
        if (!isHealthyBefore) revert InvariantViolation();
        
        // Withdrawal es 1:1, sin fee
        underlyingAmount = wrappedAmount;
        
        // Verificar que el usuario tiene suficientes tokens wrapped PRIMERO
        if (balanceOf(msg.sender) < wrappedAmount) {
            revert ERC20InsufficientBalance(msg.sender, balanceOf(msg.sender), wrappedAmount);
        }
        
        // Luego validar que hay suficientes reservas
        uint256 reserves = underlying.balanceOf(address(this));
        if (reserves < underlyingAmount) {
            revert InsufficientReserves();
        }
        
        // Quemar tokens wrapped del usuario
        _burn(msg.sender, wrappedAmount);
        
        // Transferir tokens subyacentes al usuario
        try underlying.transfer(msg.sender, underlyingAmount) returns (bool success) {
            if (!success) {
                revert TransferFailed();
            }
        } catch {
            revert TransferFailed();
        }
        
        // Verificar invariante después de la operación
        (bool isHealthyAfter,,) = checkInvariant();
        if (!isHealthyAfter) revert InvariantViolation();
        
        emit Withdrawal(msg.sender, wrappedAmount, underlyingAmount);
    }
}
