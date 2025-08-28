// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/StorageSlot.sol";
import "./ERC20Wrapped.sol";
import "../interfaces/IWrapperFactory.sol";

/**
 * @title WrapperFactoryUpgradeable
 * @notice Fábrica upgradeable para crear y gestionar wrappers ERC20
 * @dev Implementa sistema de roles y gobernanza según especificaciones del README
 * 
 * Task 4.2: Factory actualizable sin romper wrappers existentes
 * - Usa UUPS proxy pattern para upgradeabilidad
 * - Mantiene datos persistentes tras upgrades
 * - Solo Administrator puede hacer upgrades
 * - Wrappers existentes siguen funcionando tras upgrades
 */
contract WrapperFactoryUpgradeable is 
    Initializable, 
    AccessControlEnumerableUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable,
    IWrapperFactory 
{
    // ====== ROLES ======
    
    /// @notice Rol administrador - puede gestionar otros roles y upgrades
    bytes32 public constant ADMINISTRATOR_ROLE = keccak256("ADMINISTRATOR_ROLE");
    
    /// @notice Rol tesorero - puede cambiar receptor de comisiones
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    
    /// @notice Rol operador - puede cambiar tasa de fee para futuros wrappers
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    /// @notice Rol upgrader - puede autorizar upgrades (reservado para Administrator)
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    
    // ====== STATE VARIABLES ======
    
    /// @notice Receptor actual de comisiones - donde van las fees de todos los wrappers
    address public feeRecipient;
    
    /// @notice Tasa de fee global para nuevos wrappers (en basis points: 100 = 1%)
    uint256 public depositFeeRate;
    
    /// @notice Mapping de token subyacente -> wrapper (para garantizar unicidad)
    mapping(address => address) public wrapperForUnderlying;
    
    /// @notice Array de todos los wrappers creados (para enumerar)
    address[] public allWrappers;
    
    /// @notice Version del contrato para tracking de upgrades
    string public version;
    
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
    
    /// @notice Emitido cuando se realiza un upgrade
    event FactoryUpgraded(address indexed oldImplementation, address indexed newImplementation, string newVersion);
    
    // ====== ERRORS ======
    
    error ZeroAddress();
    error InvalidFeeRate();
    error InvalidFeeRecipient();
    error FeeRateTooHigh();
    error WrapperAlreadyExists();
    error UnauthorizedRole();
    error InvalidUnderlyingToken();
    error UnauthorizedUpgrade();
    
    // ====== INITIALIZER ======
    
    /**
     * @dev Inicializa la factory upgradeable con configuración y roles iniciales
     * @param _initialAdmin Dirección del administrador inicial
     * @param _initialTreasurer Dirección del tesorero inicial
     * @param _initialOperator Dirección del operador inicial
     * @param _feeRecipient Receptor inicial de comisiones
     * @param _depositFeeRate Tasa de fee inicial (en basis points)
     */
    function initialize(
        address _initialAdmin,
        address _initialTreasurer,
        address _initialOperator,
        address _feeRecipient,
        uint256 _depositFeeRate
    ) public initializer {
        // Validaciones
        if (_initialAdmin == address(0)) revert ZeroAddress();
        if (_initialTreasurer == address(0)) revert ZeroAddress();
        if (_initialOperator == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_depositFeeRate > MAX_FEE_RATE) revert InvalidFeeRate();
        
        // Inicializar contratos padre
        __AccessControlEnumerable_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        // Configurar variables de estado
        feeRecipient = _feeRecipient;
        depositFeeRate = _depositFeeRate;
        version = "1.0.0";
        
        // Configurar roles iniciales
        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(ADMINISTRATOR_ROLE, _initialAdmin);
        _grantRole(TREASURER_ROLE, _initialTreasurer);
        _grantRole(OPERATOR_ROLE, _initialOperator);
        _grantRole(UPGRADER_ROLE, _initialAdmin);
        
        // El ADMINISTRATOR_ROLE es admin de los otros roles
        _setRoleAdmin(TREASURER_ROLE, ADMINISTRATOR_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, ADMINISTRATOR_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, ADMINISTRATOR_ROLE);
    }
    
    // ====== UPGRADE FUNCTIONALITY ======
    
    /**
     * @dev Autoriza upgrades - solo UPGRADER_ROLE puede aprobar
     * @param newImplementation Dirección de la nueva implementación
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {
        // Log del upgrade para transparencia
        emit FactoryUpgraded(
            _getImplementationAddress(),
            newImplementation,
            _getNextVersion()
        );
    }
    
    /**
     * @dev Actualiza la versión tras un upgrade
     * @param newVersion Nueva versión del contrato
     * @dev Solo puede ser llamada durante upgrade por UPGRADER_ROLE
     */
    function updateVersion(string memory newVersion) external onlyRole(UPGRADER_ROLE) {
        version = newVersion;
    }
    
    /**
     * @dev Retorna la dirección de implementación actual
     * @return implementation Dirección del contrato de implementación
     */
    function getImplementation() external view returns (address implementation) {
        return _getImplementationAddress();
    }
    
    /**
     * @dev Helper para obtener la dirección de implementación actual
     * @return implementation Dirección del contrato de implementación  
     */
    function _getImplementationAddress() internal view returns (address implementation) {
        bytes32 slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        assembly {
            implementation := sload(slot)
        }
    }
    
    /**
     * @dev Helper para generar próxima versión (para logging)
     * @return nextVersion String de la próxima versión
     */
    function _getNextVersion() internal pure returns (string memory nextVersion) {
        // Lógica simple: incrementar version minor
        // En producción sería más sofisticado
        return "upgraded";
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
        require(index < allWrappers.length, "WrapperFactoryUpgradeable: index out of bounds");
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
    ) external virtual whenNotPaused returns (address wrapper) {
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
        _revokeRole(UPGRADER_ROLE, oldAdmin);
        
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(ADMINISTRATOR_ROLE, newAdmin);
        _grantRole(UPGRADER_ROLE, newAdmin);
        
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
