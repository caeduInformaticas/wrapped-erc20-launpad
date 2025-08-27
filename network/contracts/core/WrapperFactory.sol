// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ERC20Wrapped.sol";
import "../interfaces/IWrapperFactory.sol";

/**
 * @title WrapperFactory
 * @notice Fábrica para crear y gestionar wrappers ERC20
 * @dev Implementa sistema de roles y gobernanza según especificaciones del README
 * 
 * Funcionalidad:
 * - Administrator: gestiona roles Operator y Treasurer
 * - Treasurer: puede cambiar receptor de comisiones
 * - Operator: puede cambiar tasa de fee para futuros wrappers
 * - Cualquiera puede crear wrappers para tokens subyacentes
 * - Garantiza unicidad: un wrapper por token subyacente
 */
contract WrapperFactory is AccessControlEnumerable, Pausable, IWrapperFactory {
    // ====== ROLES ======
    
    /// @notice Rol administrador - puede gestionar otros roles
    bytes32 public constant ADMINISTRATOR_ROLE = keccak256("ADMINISTRATOR_ROLE");
    
    /// @notice Rol tesorero - puede cambiar receptor de comisiones
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    
    /// @notice Rol operador - puede cambiar tasa de fee para futuros wrappers
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    // ====== STATE VARIABLES ======
    
    /// @notice Receptor actual de comisiones - donde van las fees de todos los wrappers
    address public feeRecipient;
    
    /// @notice Tasa de fee global para nuevos wrappers (en basis points: 100 = 1%)
    uint256 public depositFeeRate;
    
    /// @notice Mapping de token subyacente -> wrapper (para garantizar unicidad)
    mapping(address => address) public wrapperForUnderlying;
    
    /// @notice Array de todos los wrappers creados (para enumerar)
    address[] public allWrappers;
    
    // ====== CONSTANTS ======
    
    /// @notice Máximo fee permitido (10% = 1000 basis points)
    uint256 public constant MAX_FEE_RATE = 1000;
    
    /// @notice Base para cálculos de porcentajes (100% = 10000 basis points)
    uint256 public constant FEE_BASE = 10000;
    
    // ====== EVENTS ======
    
    /// @notice Emitido cuando se crea un nuevo wrapper
    event WrapperCreated(
        address indexed underlying,
        address indexed wrapper,
        uint256 feeRate,
        address indexed creator
    );
    
    /// @notice Emitido cuando cambia el receptor de fees
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    
    /// @notice Emitido cuando cambia la tasa de fee global
    event DepositFeeRateUpdated(uint256 oldRate, uint256 newRate);
    
    /// @notice Emitido cuando cambian los roles
    event AdministratorUpdated(address indexed oldAdmin, address indexed newAdmin);
    event TreasurerUpdated(address indexed oldTreasurer, address indexed newTreasurer);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    
    // ====== ERRORS ======
    
    error ZeroAddress();
    error InvalidFeeRate();
    error InvalidFeeRecipient();
    error FeeRateTooHigh();
    error WrapperAlreadyExists();
    error UnauthorizedRole();
    error InvalidUnderlyingToken();
    
    // ====== CONSTRUCTOR ======
    
    /**
     * @dev Inicializa la factory con configuración y roles iniciales
     * @param _initialAdmin Dirección del administrador inicial
     * @param _initialTreasurer Dirección del tesorero inicial
     * @param _initialOperator Dirección del operador inicial
     * @param _feeRecipient Receptor inicial de comisiones
     * @param _depositFeeRate Tasa de fee inicial (en basis points)
     */
    constructor(
        address _initialAdmin,
        address _initialTreasurer,
        address _initialOperator,
        address _feeRecipient,
        uint256 _depositFeeRate
    ) {
        // Validaciones
        if (_initialAdmin == address(0)) revert ZeroAddress();
        if (_initialTreasurer == address(0)) revert ZeroAddress();
        if (_initialOperator == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_depositFeeRate > MAX_FEE_RATE) revert InvalidFeeRate();
        
        // Configurar variables de estado
        feeRecipient = _feeRecipient;
        depositFeeRate = _depositFeeRate;
        
        // Configurar roles iniciales
        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(ADMINISTRATOR_ROLE, _initialAdmin);
        _grantRole(TREASURER_ROLE, _initialTreasurer);
        _grantRole(OPERATOR_ROLE, _initialOperator);
        
        // El ADMINISTRATOR_ROLE es admin de los otros roles
        _setRoleAdmin(TREASURER_ROLE, ADMINISTRATOR_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, ADMINISTRATOR_ROLE);
    }
    
    // ====== VIEW FUNCTIONS ======
    
    /**
     * @notice Retorna el receptor actual de comisiones
     * @return Dirección del receptor de fees
     * @dev Esta función es llamada por los wrappers en cada depósito
     */
    function getFeeRecipient() external view override returns (address) {
        return feeRecipient;
    }
    
    /**
     * @notice Retorna información general de la factory
     * @return currentFeeRecipient Receptor actual de comisiones
     * @return currentFeeRate Tasa de fee actual para nuevos wrappers
     * @return totalWrappers Número total de wrappers creados
     */
    function getFactoryInfo() external view returns (
        address currentFeeRecipient,
        uint256 currentFeeRate,
        uint256 totalWrappers
    ) {
        return (feeRecipient, depositFeeRate, allWrappers.length);
    }
    
    /**
     * @notice Verifica si existe wrapper para un token subyacente
     * @param underlying Dirección del token subyacente
     * @return exists True si ya existe wrapper
     * @return wrapper Dirección del wrapper (address(0) si no existe)
     */
    function hasWrapper(address underlying) external view returns (bool exists, address wrapper) {
        wrapper = wrapperForUnderlying[underlying];
        exists = wrapper != address(0);
    }
    
    /**
     * @notice Retorna wrapper en posición específica del array
     * @param index Índice en el array de wrappers
     * @return wrapper Dirección del wrapper
     */
    function getWrapperAt(uint256 index) external view returns (address wrapper) {
        require(index < allWrappers.length, "WrapperFactory: index out of bounds");
        return allWrappers[index];
    }
    
    // ====== CORE FUNCTIONALITY ======
    
    /**
     * @notice Crea un nuevo wrapper para un token subyacente
     * @param underlying Dirección del token ERC-20 a envolver
     * @param wrappedName Nombre del token wrapped (ej: "Wrapped USDC")
     * @param wrappedSymbol Símbolo del token wrapped (ej: "wUSDC")
     * @return wrapper Dirección del nuevo wrapper creado
     * @dev Cualquiera puede llamar esta función - no requiere roles
     */
    function createWrapper(
        address underlying,
        string memory wrappedName,
        string memory wrappedSymbol
    ) external whenNotPaused returns (address wrapper) {
        // Validaciones
        if (underlying == address(0)) revert InvalidUnderlyingToken();
        if (wrapperForUnderlying[underlying] != address(0)) revert WrapperAlreadyExists();
        
        // Crear nuevo wrapper con parámetros actuales de la factory
        wrapper = address(new ERC20Wrapped(
            underlying,
            depositFeeRate,
            address(this),
            wrappedName,
            wrappedSymbol
        ));
        
        // Registrar wrapper
        wrapperForUnderlying[underlying] = wrapper;
        allWrappers.push(wrapper);
        
        // Emitir evento
        emit WrapperCreated(underlying, wrapper, depositFeeRate, msg.sender);
    }
    
    // ====== GOVERNANCE FUNCTIONS ======
    
    /**
     * @notice Cambia el receptor de comisiones
     * @param newFeeRecipient Nueva dirección para recibir comisiones
     * @dev Solo puede ser llamada por TREASURER_ROLE
     */
    function setFeeRecipient(address newFeeRecipient) external onlyRole(TREASURER_ROLE) {
        if (newFeeRecipient == address(0) || newFeeRecipient == feeRecipient) {
            revert InvalidFeeRecipient();
        }
        
        address oldRecipient = feeRecipient;
        feeRecipient = newFeeRecipient;
        
        emit FeeRecipientUpdated(oldRecipient, newFeeRecipient);
    }
    
    /**
     * @notice Cambia la tasa de fee para futuros wrappers
     * @param newFeeRate Nueva tasa de fee (en basis points)
     * @dev Solo puede ser llamada por OPERATOR_ROLE o DEFAULT_ADMIN_ROLE
     * @dev No afecta wrappers ya creados, solo los futuros
     */
    function setDepositFeeRate(uint256 newFeeRate) external {
        // Verificar que el caller tenga uno de los roles autorizados
        if (!hasRole(OPERATOR_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, OPERATOR_ROLE);
        }
        
        if (newFeeRate > MAX_FEE_RATE) revert FeeRateTooHigh();
        
        uint256 oldRate = depositFeeRate;
        depositFeeRate = newFeeRate;
        
        emit DepositFeeRateUpdated(oldRate, newFeeRate);
    }
    
    // ====== ROLE MANAGEMENT ======
    
    /**
     * @notice Actualiza el rol de administrador
     * @param newAdmin Nueva dirección para ADMINISTRATOR_ROLE
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE actual
     */
    function updateAdministrator(address newAdmin) external onlyRole(ADMINISTRATOR_ROLE) {
        if (newAdmin == address(0)) revert ZeroAddress();
        
        address oldAdmin = _getFirstRoleHolder(ADMINISTRATOR_ROLE);
        
        _revokeRole(ADMINISTRATOR_ROLE, oldAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, oldAdmin);
        
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(ADMINISTRATOR_ROLE, newAdmin);
        
        emit AdministratorUpdated(oldAdmin, newAdmin);
    }
    
    /**
     * @notice Actualiza el rol de tesorero
     * @param newTreasurer Nueva dirección para TREASURER_ROLE
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE
     */
    function updateTreasurer(address newTreasurer) external onlyRole(ADMINISTRATOR_ROLE) {
        if (newTreasurer == address(0)) revert ZeroAddress();
        
        address oldTreasurer = _getFirstRoleHolder(TREASURER_ROLE);
        
        _revokeRole(TREASURER_ROLE, oldTreasurer);
        _grantRole(TREASURER_ROLE, newTreasurer);
        
        emit TreasurerUpdated(oldTreasurer, newTreasurer);
    }
    
    /**
     * @notice Actualiza el rol de operador
     * @param newOperator Nueva dirección para OPERATOR_ROLE
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE
     */
    function updateOperator(address newOperator) external onlyRole(ADMINISTRATOR_ROLE) {
        if (newOperator == address(0)) revert ZeroAddress();
        
        address oldOperator = _getFirstRoleHolder(OPERATOR_ROLE);
        
        _revokeRole(OPERATOR_ROLE, oldOperator);
        _grantRole(OPERATOR_ROLE, newOperator);
        
        emit OperatorUpdated(oldOperator, newOperator);
    }
    
    // ====== EMERGENCY FUNCTIONS ======
    
    /**
     * @notice Pausa la creación de nuevos wrappers
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE
     */
    function pause() external onlyRole(ADMINISTRATOR_ROLE) {
        _pause();
    }
    
    /**
     * @notice Despausa la creación de nuevos wrappers
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE
     */
    function unpause() external onlyRole(ADMINISTRATOR_ROLE) {
        _unpause();
    }
    
    // ====== INTERNAL HELPER FUNCTIONS ======
    
    /**
     * @notice Obtiene el primer holder de un rol (helper para updates)
     * @param role El rol del cual obtener el primer holder
     * @return holder Dirección del primer holder del rol
     */
    function _getFirstRoleHolder(bytes32 role) internal view returns (address holder) {
        uint256 memberCount = getRoleMemberCount(role);
        if (memberCount > 0) {
            holder = getRoleMember(role, 0);
        }
        return holder;
    }
}
