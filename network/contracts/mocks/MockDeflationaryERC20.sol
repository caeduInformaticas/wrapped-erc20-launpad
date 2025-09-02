// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./MockERC20.sol";

/**
 * @title MockDeflationaryERC20
 * @notice Mock token que simula tokens deflacionarios (fee-on-transfer)
 * @dev Para testing de casos edge en Phase 5
 * 
 * Este token cobra una comisión en cada transferencia, simulando
 * tokens deflacionarios reales como algunos DeFi tokens.
 */
contract MockDeflationaryERC20 is MockERC20 {
    /// @notice Fee cobrado en cada transferencia (en basis points: 100 = 1%)
    uint256 public transferFeeRate;
    
    /// @notice Máximo fee permitido (5% = 500 basis points)
    uint256 public constant MAX_TRANSFER_FEE_RATE = 500;
    
    /// @notice Base para cálculos de porcentajes (100% = 10000 basis points)
    uint256 public constant TRANSFER_FEE_BASE = 10000;
    
    /// @notice Receptor de las comisiones por transferencia
    address public feeCollector;
    
    /// @notice Emitido cuando se cobra una comisión
    event TransferFeeCharged(address from, address to, uint256 amount, uint256 fee);
    
    /// @notice Emitido cuando cambia la tasa de fee
    event TransferFeeRateUpdated(uint256 oldRate, uint256 newRate);
    
    /// @notice Emitido cuando cambia el receptor de fees
    event FeeCollectorUpdated(address oldCollector, address newCollector);
    
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        uint256 _transferFeeRate,
        address _feeCollector
    ) MockERC20(name_, symbol_, decimals_, initialSupply_) {
        require(_transferFeeRate <= MAX_TRANSFER_FEE_RATE, "MockDeflationaryERC20: fee rate too high");
        require(_feeCollector != address(0), "MockDeflationaryERC20: fee collector cannot be zero");
        
        transferFeeRate = _transferFeeRate;
        feeCollector = _feeCollector;
    }
    
    /**
     * @notice Actualiza la tasa de fee de transferencia
     * @param newFeeRate Nueva tasa en basis points
     */
    function setTransferFeeRate(uint256 newFeeRate) external {
        require(newFeeRate <= MAX_TRANSFER_FEE_RATE, "MockDeflationaryERC20: fee rate too high");
        
        uint256 oldRate = transferFeeRate;
        transferFeeRate = newFeeRate;
        
        emit TransferFeeRateUpdated(oldRate, newFeeRate);
    }
    
    /**
     * @notice Actualiza el receptor de comisiones
     * @param newFeeCollector Nueva dirección del receptor
     */
    function setFeeCollector(address newFeeCollector) external {
        require(newFeeCollector != address(0), "MockDeflationaryERC20: fee collector cannot be zero");
        
        address oldCollector = feeCollector;
        feeCollector = newFeeCollector;
        
        emit FeeCollectorUpdated(oldCollector, newFeeCollector);
    }
    
    /**
     * @notice Override de _transfer para aplicar comisión deflacionaria
     * @param from Dirección que envía
     * @param to Dirección que recibe  
     * @param value Cantidad a transferir (antes de fee)
     */
    function _transfer(address from, address to, uint256 value) internal override returns (bool) {
        require(from != address(0), "MockDeflationaryERC20: transfer from zero address");
        require(to != address(0), "MockDeflationaryERC20: transfer to zero address");
        require(balanceOf[from] >= value, "MockDeflationaryERC20: insufficient balance");
        
        uint256 feeAmount = 0;
        uint256 transferAmount = value;
        
        // Calcular y aplicar fee si está configurado
        if (transferFeeRate > 0 && from != feeCollector && to != feeCollector) {
            feeAmount = (value * transferFeeRate) / TRANSFER_FEE_BASE;
            transferAmount = value - feeAmount;
            
            // Enviar fee al collector
            if (feeAmount > 0) {
                balanceOf[from] -= feeAmount;
                balanceOf[feeCollector] += feeAmount;
                emit Transfer(from, feeCollector, feeAmount);
                emit TransferFeeCharged(from, to, value, feeAmount);
            }
        }
        
        // Realizar transferencia del monto neto
        if (transferAmount > 0) {
            balanceOf[from] -= transferAmount;
            balanceOf[to] += transferAmount;
            emit Transfer(from, to, transferAmount);
        }
        
        return true;
    }
    
    /**
     * @notice Calcula cuánto recibirá el destinatario después del fee
     * @param amount Cantidad antes del fee
     * @return netAmount Cantidad que recibirá el destinatario
     * @return feeAmount Fee que se cobrará
     */
    function previewTransfer(uint256 amount) external view returns (uint256 netAmount, uint256 feeAmount) {
        if (transferFeeRate == 0) {
            return (amount, 0);
        }
        
        feeAmount = (amount * transferFeeRate) / TRANSFER_FEE_BASE;
        netAmount = amount - feeAmount;
    }
    
    /**
     * @notice Información del token deflacionario
     * @return feeRate Tasa de fee actual
     * @return collector Receptor de fees
     */
    function getDeflationaryInfo() external view returns (uint256 feeRate, address collector) {
        return (transferFeeRate, feeCollector);
    }
}
