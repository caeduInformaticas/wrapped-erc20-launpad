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
    
    
    /// @notice Mapping de wrapper -> si está pausado individualmente
    mapping(address => bool) public wrapperPaused;

    /// @notice Mapping inverso: wrapper -> underlying token
    mapping(address => address) public underlyingForWrapper;
    
    // ====== NEW EVENTS V2 ======
    
    /// @notice Emitido cuando se pausa/despausa un wrapper individual
    event WrapperPauseStatusChanged(address indexed wrapper, bool paused);
    
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
        function initializeV2(string memory _newVersion) 
        external 
        reinitializer(2) 
    {
        version = _newVersion;
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
