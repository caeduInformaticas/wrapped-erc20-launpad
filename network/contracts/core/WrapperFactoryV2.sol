// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./WrapperFactoryUpgradeable.sol";

/**
 * @title WrapperFactoryV2
 * @notice Versión V2 de la factory - demuestra upgradeabilidad
 * @dev Extiende la funcionalidad de V1 agregando nuevas características
 * 
 * Nuevas funcionalidades en V2:
 * - Statistics tracking (total volume, active wrappers)
 * - Batch operations para múltiples wrappers
 * - Emergency pause por wrapper individual
 * - Fee discounts para high-volume users
 */
contract WrapperFactoryV2 is WrapperFactoryUpgradeable {
    // ====== NEW STATE VARIABLES V2 ======
    
    /// @notice Total volume procesado por la factory
    uint256 public totalVolumeProcessed;
    
    /// @notice Mapping de wrapper -> si está pausado individualmente
    mapping(address => bool) public wrapperPaused;
    
    /// @notice Mapping de usuario -> volumen total depositado
    mapping(address => uint256) public userVolume;
    
    /// @notice Mapping inverso: wrapper -> underlying token
    mapping(address => address) public underlyingForWrapper;
    
    /// @notice Threshold para descuentos de fee (high-volume users)
    uint256 public highVolumeThreshold;
    
    /// @notice Descuento para usuarios de alto volumen (en basis points)
    uint256 public highVolumeDiscount;
    
    // ====== NEW EVENTS V2 ======
    
    /// @notice Emitido cuando se pausa/despausa un wrapper individual
    event WrapperPauseStatusChanged(address indexed wrapper, bool paused);
    
    /// @notice Emitido cuando se actualiza el threshold de alto volumen
    event HighVolumeThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    
    /// @notice Emitido cuando se actualiza el descuento de alto volumen
    event HighVolumeDiscountUpdated(uint256 oldDiscount, uint256 newDiscount);
    
    /// @notice Emitido cuando se registra volumen de depósito
    event VolumeRecorded(address indexed user, address indexed wrapper, uint256 amount);
    
    // ====== NEW ERRORS V2 ======
    
    error WrapperNotExists();
    error WrapperIndividuallyPaused();
    error InvalidVolumeThreshold();
    error InvalidDiscount();
    
    // ====== V2 INITIALIZER ======
    
    /**
     * @dev Inicializa nuevas variables de V2
     * @dev Debe ser llamada después del upgrade para configurar nuevas variables
     */
        function initializeV2(uint256 _highVolumeThreshold, uint256 _highVolumeDiscount) 
        external 
        reinitializer(2) 
    {
        // Configurar nuevos parámetros V2
        highVolumeThreshold = _highVolumeThreshold;
        highVolumeDiscount = _highVolumeDiscount;
        version = "2.0.0";
        
        // Migrar wrappers existentes al mapping inverso
        _migrateExistingWrappers();
    }
    
    /**
     * @notice Migra wrappers existentes al mapping inverso
     * @dev Solo para uso interno durante el upgrade
     */
    function _migrateExistingWrappers() internal {
        // Por simplicidad, los wrappers existentes necesitarán ser registrados manualmente
        // En un sistema de producción, esto se haría a través de eventos históricos
        // o se implementaría un sistema de migración más robusto
    }
    
    /**
     * @notice Función de utilidad para registrar wrapper existente (solo para tests/migration)
     * @param wrapper Dirección del wrapper
     * @param underlying Dirección del token subyacente
     * @dev Solo puede ser llamada por admin durante inicialización
     */
    function _registerExistingWrapper(address wrapper, address underlying) 
        external 
        onlyRole(ADMINISTRATOR_ROLE) 
    {
        require(underlyingForWrapper[wrapper] == address(0), "Wrapper already registered");
        require(wrapperForUnderlying[underlying] == wrapper, "Wrapper mismatch");
        
        underlyingForWrapper[wrapper] = underlying;
    }
    
    // ====== NEW VIEW FUNCTIONS V2 ======
    
    /**
     * @notice Override createWrapper to maintain inverse mapping
     * @param underlying Token subyacente a wrappear
     * @param wrappedName Nombre del token wrapped
     * @param wrappedSymbol Símbolo del token wrapped
     * @return wrapper Dirección del nuevo wrapper creado
     */
    function createWrapper(
        address underlying,
        string memory wrappedName,
        string memory wrappedSymbol
    ) external override whenNotPaused returns (address wrapper) {
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
        
        // Registrar wrapper en ambos mappings
        wrapperForUnderlying[underlying] = wrapper;
        underlyingForWrapper[wrapper] = underlying; // Nuevo en V2
        allWrappers.push(wrapper);
        
        emit WrapperCreated(underlying, wrapper, depositFeeRate, _msgSender());
        
        return wrapper;
    }
    
    /**
     * @notice Calcula el fee efectivo para un usuario específico
     * @param user Dirección del usuario
     * @param baseAmount Cantidad base para el cálculo
     * @return effectiveFeeRate Fee rate efectivo considerando descuentos
     * @return discount Descuento aplicado en basis points
     */
    function getEffectiveFeeRate(address user, uint256 baseAmount) 
        external 
        view 
        returns (uint256 effectiveFeeRate, uint256 discount) 
    {
        effectiveFeeRate = depositFeeRate;
        discount = 0;
        
        // Aplicar descuento si el usuario califica
        if (userVolume[user] >= highVolumeThreshold) {
            discount = highVolumeDiscount;
            effectiveFeeRate = effectiveFeeRate > discount ? effectiveFeeRate - discount : 0;
        }
    }
    
    /**
     * @notice Retorna estadísticas de la factory V2
     * @return totalVolume Volumen total procesado
     * @return activeWrappers Número de wrappers activos (no pausados)
     * @return totalWrappersCreated Total de wrappers creados
     */
    function getFactoryStats() external view returns (
        uint256 totalVolume,
        uint256 activeWrappers,
        uint256 totalWrappersCreated
    ) {
        totalVolume = totalVolumeProcessed;
        totalWrappersCreated = allWrappers.length;
        
        // Contar wrappers activos
        activeWrappers = 0;
        for (uint256 i = 0; i < allWrappers.length; i++) {
            if (!wrapperPaused[allWrappers[i]]) {
                activeWrappers++;
            }
        }
    }
    
    /**
     * @notice Verifica si un wrapper está pausado individualmente
     * @param wrapper Dirección del wrapper
     * @return isPaused True si está pausado
     */
    function isWrapperPaused(address wrapper) external view returns (bool isPaused) {
        return wrapperPaused[wrapper];
    }
    
    // ====== NEW ADMIN FUNCTIONS V2 ======
    
    /**
     * @notice Pausa/despausa un wrapper específico
     * @param wrapper Dirección del wrapper
     * @param pauseStatus True para pausar, false para despausar
     * @dev Solo puede ser llamada por ADMINISTRATOR_ROLE
     */
    function setWrapperPauseStatus(address wrapper, bool pauseStatus) 
        external 
        onlyRole(ADMINISTRATOR_ROLE) 
    {
        if (wrapperForUnderlying[_getUnderlyingForWrapper(wrapper)] != wrapper) {
            revert WrapperNotExists();
        }
        
        wrapperPaused[wrapper] = pauseStatus;
        emit WrapperPauseStatusChanged(wrapper, pauseStatus);
    }
    
    /**
     * @notice Actualiza el threshold para usuarios de alto volumen
     * @param newThreshold Nuevo threshold en wei
     * @dev Solo puede ser llamada por OPERATOR_ROLE
     */
    function setHighVolumeThreshold(uint256 newThreshold) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        if (newThreshold == 0) revert InvalidVolumeThreshold();
        
        uint256 oldThreshold = highVolumeThreshold;
        highVolumeThreshold = newThreshold;
        
        emit HighVolumeThresholdUpdated(oldThreshold, newThreshold);
    }
    
    /**
     * @notice Actualiza el descuento para usuarios de alto volumen
     * @param newDiscount Nuevo descuento en basis points
     * @dev Solo puede ser llamada por OPERATOR_ROLE
     */
    function setHighVolumeDiscount(uint256 newDiscount) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        if (newDiscount >= depositFeeRate) revert InvalidDiscount();
        
        uint256 oldDiscount = highVolumeDiscount;
        highVolumeDiscount = newDiscount;
        
        emit HighVolumeDiscountUpdated(oldDiscount, newDiscount);
    }
    
    // ====== NEW VOLUME TRACKING V2 ======
    
    /**
     * @notice Registra volumen de depósito (llamada por wrappers)
     * @param user Usuario que realizó el depósito
     * @param amount Cantidad depositada
     * @dev Esta función sería llamada por los wrappers en cada depósito
     */
    function recordDeposit(address user, uint256 amount) external {
        // Verificar que el caller sea un wrapper válido
        address underlying = _getUnderlyingForWrapper(msg.sender);
        if (wrapperForUnderlying[underlying] != msg.sender) {
            revert WrapperNotExists();
        }
        
        // Verificar que el wrapper no esté pausado individualmente
        if (wrapperPaused[msg.sender]) {
            revert WrapperIndividuallyPaused();
        }
        
        // Registrar volumen
        userVolume[user] += amount;
        totalVolumeProcessed += amount;
        
        emit VolumeRecorded(user, msg.sender, amount);
    }
    
    // ====== BATCH OPERATIONS V2 ======
    
    /**
     * @notice Crea múltiples wrappers en una transacción
     * @param underlyings Array de tokens subyacentes
     * @param wrappedNames Array de nombres para los wrappers
     * @param wrappedSymbols Array de símbolos para los wrappers
     * @return wrappers Array de direcciones de wrappers creados
     */
    function createMultipleWrappers(
        address[] memory underlyings,
        string[] memory wrappedNames,
        string[] memory wrappedSymbols
    ) external whenNotPaused returns (address[] memory wrappers) {
        require(
            underlyings.length == wrappedNames.length && 
            underlyings.length == wrappedSymbols.length,
            "WrapperFactoryV2: arrays length mismatch"
        );
        
        wrappers = new address[](underlyings.length);
        
        for (uint256 i = 0; i < underlyings.length; i++) {
            wrappers[i] = this.createWrapper(
                underlyings[i],
                wrappedNames[i],
                wrappedSymbols[i]
            );
        }
    }
    
    // ====== INTERNAL HELPERS V2 ======
    
    /**
     * @notice Helper para obtener el token subyacente de un wrapper
     * @param wrapper Dirección del wrapper
     * @return underlying Dirección del token subyacente
     */
    function _getUnderlyingForWrapper(address wrapper) internal view returns (address underlying) {
        return underlyingForWrapper[wrapper];
    }
}
