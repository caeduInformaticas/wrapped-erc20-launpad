// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IWrapperFactory Interface
 * @dev Interface for the WrapperFactory contract to be used by wrapped tokens
 */
interface IWrapperFactory {
    /**
     * @dev Returns the current fee recipient address
     * @return feeRecipient The address that receives deposit fees
     */
    function getFeeRecipient() external view returns (address feeRecipient);
}
