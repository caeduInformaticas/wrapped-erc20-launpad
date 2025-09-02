import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20Wrapped, MockERC20, MockDeflationaryERC20, WrapperFactoryUpgradeable } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Phase 5.2 - Deflationary Tokens and Edge Cases", function () {
  let wrappedToken: ERC20Wrapped;
  let wrappedDeflationaryToken: ERC20Wrapped;
  let underlyingToken: MockERC20;
  let deflationaryToken: MockDeflationaryERC20;
  let factory: WrapperFactoryUpgradeable;
  let zeroFeeWrapper: ERC20Wrapped;
  let maxFeeWrapper: ERC20Wrapped;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let deflationaryFeeCollector: SignerWithAddress;
  
  // Configuración de test
  const UNDERLYING_DECIMALS = 6;
  const UNDERLYING_SUPPLY = ethers.parseUnits("1000000", UNDERLYING_DECIMALS); // 1M
  const DEPOSIT_FEE_RATE = 100; // 1% = 100 basis points
  const MAX_FEE_RATE = 1000; // 10% = 1000 basis points
  
  beforeEach(async function () {
    [owner, alice, bob, charlie, feeRecipient, deflationaryFeeCollector] = await ethers.getSigners();
    
    // Deploy underlying token estándar
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    underlyingToken = await MockERC20Factory.deploy(
      "Test USDC",
      "TUSDC",
      UNDERLYING_DECIMALS,
      UNDERLYING_SUPPLY
    );
    
    // Deploy token deflacionario (2% fee on transfer)
    const MockDeflationaryERC20Factory = await ethers.getContractFactory("MockDeflationaryERC20");
    deflationaryToken = await MockDeflationaryERC20Factory.deploy(
      "Deflationary Token",
      "DEFLA",
      UNDERLYING_DECIMALS,
      UNDERLYING_SUPPLY,
      200, // 2% fee on transfer
      deflationaryFeeCollector.address
    );
    
    // Deploy factory upgradeable
    const WrapperFactoryUpgradeableFactory = await ethers.getContractFactory("WrapperFactoryUpgradeable");
    factory = await WrapperFactoryUpgradeableFactory.deploy();
    await factory.initialize(
      owner.address,      // admin
      owner.address,      // treasurer
      owner.address,      // operator
      feeRecipient.address, // fee recipient
      DEPOSIT_FEE_RATE    // fee rate
    );
    
    // Deploy wrapped tokens con diferentes configuraciones
    const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
    
    // Wrapper normal (1% fee)
    wrappedToken = await ERC20WrappedFactory.deploy(
      await underlyingToken.getAddress(),
      DEPOSIT_FEE_RATE,
      await factory.getAddress(),
      "Wrapped Test USDC",
      "wTUSDC"
    );
    
    // Wrapper para token deflacionario
    wrappedDeflationaryToken = await ERC20WrappedFactory.deploy(
      await deflationaryToken.getAddress(),
      DEPOSIT_FEE_RATE,
      await factory.getAddress(),
      "Wrapped Deflationary Token",
      "wDEFLA"
    );
    
    // Wrapper con 0% fee
    zeroFeeWrapper = await ERC20WrappedFactory.deploy(
      await underlyingToken.getAddress(),
      0, // 0% fee
      await factory.getAddress(),
      "Zero Fee Wrapper",
      "ZFW"
    );
    
    // Wrapper con fee máximo (10%)
    maxFeeWrapper = await ERC20WrappedFactory.deploy(
      await underlyingToken.getAddress(),
      MAX_FEE_RATE, // 10% fee
      await factory.getAddress(),
      "Max Fee Wrapper",
      "MFW"
    );
    
    // Distribuir tokens a usuarios de test
    await underlyingToken.transfer(alice.address, ethers.parseUnits("50000", UNDERLYING_DECIMALS));
    await underlyingToken.transfer(bob.address, ethers.parseUnits("50000", UNDERLYING_DECIMALS));
    await underlyingToken.transfer(charlie.address, ethers.parseUnits("50000", UNDERLYING_DECIMALS));
    
    await deflationaryToken.transfer(alice.address, ethers.parseUnits("50000", UNDERLYING_DECIMALS));
    await deflationaryToken.transfer(bob.address, ethers.parseUnits("50000", UNDERLYING_DECIMALS));
  });

  describe("Deflationary Token Behavior", function () {
    it("Should handle deflationary tokens correctly in deposit", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // Aprobar y depositar token deflacionario
      await deflationaryToken.connect(alice).approve(await wrappedDeflationaryToken.getAddress(), depositAmount);
      
      // Verificar balances antes
      const aliceBalanceBefore = await deflationaryToken.balanceOf(alice.address);
      const contractBalanceBefore = await deflationaryToken.balanceOf(await wrappedDeflationaryToken.getAddress());
      
      // Ejecutar depósito
      const tx = await wrappedDeflationaryToken.connect(alice).deposit(depositAmount);
      const receipt = await tx.wait();
      
      // Verificar que se ajustó por la pérdida deflacionaria
      const contractBalanceAfter = await deflationaryToken.balanceOf(await wrappedDeflationaryToken.getAddress());
      const actualReceived = contractBalanceAfter - contractBalanceBefore;
      
      // El contrato debería haber recibido menos del monto solicitado (por el fee del token)
      expect(actualReceived).to.be.lt(depositAmount);
      
      // Verificar que el wrapper ajustó sus cálculos
      const wrappedBalance = await wrappedDeflationaryToken.balanceOf(alice.address);
      expect(wrappedBalance).to.be.gt(0);
      
      // Verificar invariante
      const [isHealthy, reserves, supply] = await wrappedDeflationaryToken.checkInvariant();
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply);
    });

    it("Should maintain invariants with deflationary tokens", async function () {
      const amounts = [
        ethers.parseUnits("100", UNDERLYING_DECIMALS),
        ethers.parseUnits("500", UNDERLYING_DECIMALS),
        ethers.parseUnits("250", UNDERLYING_DECIMALS)
      ];
      
      for (const amount of amounts) {
        await deflationaryToken.connect(alice).approve(await wrappedDeflationaryToken.getAddress(), amount);
        await wrappedDeflationaryToken.connect(alice).deposit(amount);
        
        // Verificar invariante después de cada depósito
        const [isHealthy, reserves, supply] = await wrappedDeflationaryToken.checkInvariant();
        expect(isHealthy).to.be.true;
        expect(reserves).to.be.gte(supply);
      }
    });

    it("Should handle withdrawals with deflationary tokens", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // Hacer depósito inicial
      await deflationaryToken.connect(alice).approve(await wrappedDeflationaryToken.getAddress(), depositAmount);
      await wrappedDeflationaryToken.connect(alice).deposit(depositAmount);
      
      const wrappedBalance = await wrappedDeflationaryToken.balanceOf(alice.address);
      const aliceBalanceBefore = await deflationaryToken.balanceOf(alice.address);
      
      // Retirar todo
      await wrappedDeflationaryToken.connect(alice).withdraw(wrappedBalance);
      
      const aliceBalanceAfter = await deflationaryToken.balanceOf(alice.address);
      const received = aliceBalanceAfter - aliceBalanceBefore;
      
      // Alice debería recibir menos debido al fee del token deflacionario en la transferencia de salida
      expect(received).to.be.lt(wrappedBalance);
      
      // Verificar invariante final
      const [isHealthy] = await wrappedDeflationaryToken.checkInvariant();
      expect(isHealthy).to.be.true;
    });
  });

  describe("Zero Fee Rate (0%)", function () {
    it("Should work correctly with 0% fee rate", async function () {
      const amount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      await underlyingToken.connect(alice).approve(await zeroFeeWrapper.getAddress(), amount);
      await zeroFeeWrapper.connect(alice).deposit(amount);
      
      // Con 0% fee, wrapped amount debe ser igual al amount
      const wrappedBalance = await zeroFeeWrapper.balanceOf(alice.address);
      expect(wrappedBalance).to.equal(amount);
      
      // No debe haber fees enviados
      const feeRecipientBalance = await underlyingToken.balanceOf(feeRecipient.address);
      expect(feeRecipientBalance).to.equal(0);
      
      // Verificar invariante
      const [isHealthy, reserves, supply] = await zeroFeeWrapper.checkInvariant();
      expect(isHealthy).to.be.true;
      expect(reserves).to.equal(supply); // Exactamente igual, no mayor
    });

    it("Should handle multiple operations with 0% fee", async function () {
      const amounts = [
        ethers.parseUnits("100", UNDERLYING_DECIMALS),
        ethers.parseUnits("200", UNDERLYING_DECIMALS),
        ethers.parseUnits("150", UNDERLYING_DECIMALS)
      ];
      
      let totalDeposited = 0n;
      
      for (const amount of amounts) {
        await underlyingToken.connect(alice).approve(await zeroFeeWrapper.getAddress(), amount);
        await zeroFeeWrapper.connect(alice).deposit(amount);
        totalDeposited += amount;
        
        const wrappedBalance = await zeroFeeWrapper.balanceOf(alice.address);
        expect(wrappedBalance).to.equal(totalDeposited);
      }
      
      // Retirar todo
      await zeroFeeWrapper.connect(alice).withdraw(totalDeposited);
      const finalWrappedBalance = await zeroFeeWrapper.balanceOf(alice.address);
      expect(finalWrappedBalance).to.equal(0);
    });
  });

  describe("Maximum Fee Rate (10%)", function () {
    it("Should work correctly with maximum fee rate", async function () {
      const amount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const expectedFee = (amount * BigInt(MAX_FEE_RATE)) / 10000n; // 10%
      const expectedWrapped = amount - expectedFee;
      
      await underlyingToken.connect(alice).approve(await maxFeeWrapper.getAddress(), amount);
      await maxFeeWrapper.connect(alice).deposit(amount);
      
      const wrappedBalance = await maxFeeWrapper.balanceOf(alice.address);
      expect(wrappedBalance).to.equal(expectedWrapped);
      
      // Verificar invariante con fee alto
      const [isHealthy, reserves, supply] = await maxFeeWrapper.checkInvariant();
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply);
    });

    it("Should handle small amounts with high fees", async function () {
      const smallAmount = 10; // 10 tokens base unit
      
      await underlyingToken.connect(alice).approve(await maxFeeWrapper.getAddress(), smallAmount);
      
      // Con fee del 10%, fee = 1, wrapped = 9
      // Esto debería funcionar, no revertir
      await expect(maxFeeWrapper.connect(alice).deposit(smallAmount))
        .to.not.be.reverted;
        
      const wrappedBalance = await maxFeeWrapper.balanceOf(alice.address);
      expect(wrappedBalance).to.equal(9); // 10 - 1 = 9
    });

    it("Should not exceed maximum fee rate in constructor", async function () {
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      
      // Intentar crear wrapper con fee > 10%
      await expect(ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        1001, // 10.01% - más que el máximo
        await factory.getAddress(),
        "Invalid Fee Wrapper",
        "IFW"
      )).to.be.revertedWithCustomError(wrappedToken, "InvalidFeeRate");
    });
  });

  describe("Consecutive Operations", function () {
    it("Should handle multiple consecutive deposits", async function () {
      const depositAmount = ethers.parseUnits("100", UNDERLYING_DECIMALS);
      const numOperations = 10;
      
      for (let i = 0; i < numOperations; i++) {
        await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
        await wrappedToken.connect(alice).deposit(depositAmount);
        
        // Verificar invariante en cada operación
        const [isHealthy] = await wrappedToken.checkInvariant();
        expect(isHealthy).to.be.true;
      }
      
      const finalWrappedBalance = await wrappedToken.balanceOf(alice.address);
      expect(finalWrappedBalance).to.be.gt(0);
    });

    it("Should handle multiple consecutive withdrawals", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // Depósito inicial grande
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(alice).deposit(depositAmount);
      
      // Múltiples retiros pequeños
      const withdrawAmount = ethers.parseUnits("50", UNDERLYING_DECIMALS);
      let remainingBalance = await wrappedToken.balanceOf(alice.address);
      
      while (remainingBalance >= withdrawAmount) {
        await wrappedToken.connect(alice).withdraw(withdrawAmount);
        
        const [isHealthy] = await wrappedToken.checkInvariant();
        expect(isHealthy).to.be.true;
        
        remainingBalance = await wrappedToken.balanceOf(alice.address);
      }
      
      // Retirar el resto
      if (remainingBalance > 0) {
        await wrappedToken.connect(alice).withdraw(remainingBalance);
      }
      
      const finalBalance = await wrappedToken.balanceOf(alice.address);
      expect(finalBalance).to.equal(0);
    });

    it("Should handle mixed consecutive operations", async function () {
      const operations = [
        { type: 'deposit', amount: ethers.parseUnits("200", UNDERLYING_DECIMALS) },
        { type: 'withdraw', amount: ethers.parseUnits("50", UNDERLYING_DECIMALS) },
        { type: 'deposit', amount: ethers.parseUnits("100", UNDERLYING_DECIMALS) },
        { type: 'withdraw', amount: ethers.parseUnits("30", UNDERLYING_DECIMALS) },
        { type: 'deposit', amount: ethers.parseUnits("75", UNDERLYING_DECIMALS) }
      ];
      
      for (const op of operations) {
        if (op.type === 'deposit') {
          await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), op.amount);
          await wrappedToken.connect(alice).deposit(op.amount);
        } else {
          const currentBalance = await wrappedToken.balanceOf(alice.address);
          if (currentBalance >= op.amount) {
            await wrappedToken.connect(alice).withdraw(op.amount);
          }
        }
        
        const [isHealthy] = await wrappedToken.checkInvariant();
        expect(isHealthy).to.be.true;
      }
    });
  });

  describe("Very Small Balances", function () {
    it("Should handle very small deposit amounts", async function () {
      const smallAmount = 100; // 100 base units
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), smallAmount);
      
      // Con 1% fee, 100 -> fee = 1, wrapped = 99
      await expect(wrappedToken.connect(alice).deposit(smallAmount))
        .to.not.be.reverted;
      
      const wrappedBalance = await wrappedToken.balanceOf(alice.address);
      expect(wrappedBalance).to.be.gt(0);
      expect(wrappedBalance).to.be.lt(smallAmount); // Menos debido al fee
    });

    it("Should handle very small withdrawal amounts", async function () {
      // Primero hacer un depósito
      const depositAmount = ethers.parseUnits("1", UNDERLYING_DECIMALS);
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(alice).deposit(depositAmount);
      
      // Retirar cantidad muy pequeña
      const smallWithdraw = 10; // 10 base units
      const wrappedBalance = await wrappedToken.balanceOf(alice.address);
      
      if (wrappedBalance >= smallWithdraw) {
        await expect(wrappedToken.connect(alice).withdraw(smallWithdraw))
          .to.not.be.reverted;
      }
    });

    it("Should handle edge case where fee calculation results in zero", async function () {
      const tinyAmount = 1; // 1 base unit
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), tinyAmount);
      
      // Con fee de 1%, fee = 0 (rounding down), wrapped = 1
      // Esto debería funcionar o revertir gracefully
      await expect(wrappedToken.connect(alice).deposit(tinyAmount))
        .to.not.be.reverted;
    });
  });

  describe("Zero Balance Scenarios", function () {
    it("Should handle operations when wrapper has zero supply", async function () {
      // Estado inicial: sin supply
      expect(await wrappedToken.totalSupply()).to.equal(0);
      
      // Primer depósito debe funcionar normalmente
      const amount = ethers.parseUnits("100", UNDERLYING_DECIMALS);
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), amount);
      await wrappedToken.connect(alice).deposit(amount);
      
      expect(await wrappedToken.totalSupply()).to.be.gt(0);
    });

    it("Should handle return to zero supply", async function () {
      const amount = ethers.parseUnits("100", UNDERLYING_DECIMALS);
      
      // Depósito
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), amount);
      await wrappedToken.connect(alice).deposit(amount);
      
      // Retirar todo
      const wrappedBalance = await wrappedToken.balanceOf(alice.address);
      await wrappedToken.connect(alice).withdraw(wrappedBalance);
      
      // Volver a supply cero
      expect(await wrappedToken.totalSupply()).to.equal(0);
      
      // Nuevo depósito debe funcionar
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), amount);
      await expect(wrappedToken.connect(alice).deposit(amount))
        .to.not.be.reverted;
    });

    it("Should maintain invariant with zero balances", async function () {
      // Estado inicial
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      expect(isHealthy).to.be.true;
      expect(supply).to.equal(0);
      expect(reserves).to.equal(0);
    });

    it("Should handle user with zero balance trying to withdraw", async function () {
      // Alice no tiene wrapped tokens
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(0);
      
      // Intentar retirar debe fallar - puede ser custom error o mensaje estándar
      await expect(wrappedToken.connect(alice).withdraw(1))
        .to.be.reverted; // Cualquier tipo de revert está bien
    });
  });

  describe("Edge Cases Integration", function () {
    it("Should handle all edge cases in sequence", async function () {
      // 1. Comenzar con depósito normal
      let amount = ethers.parseUnits("100", UNDERLYING_DECIMALS);
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), amount);
      await wrappedToken.connect(alice).deposit(amount);
      
      // 2. Depósito muy pequeño
      amount = 50n;
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), amount);
      await wrappedToken.connect(alice).deposit(amount);
      
      // 3. Retiro parcial
      const wrappedBalance = await wrappedToken.balanceOf(alice.address);
      await wrappedToken.connect(alice).withdraw(wrappedBalance / 2n);
      
      // 4. Token deflacionario
      amount = ethers.parseUnits("100", UNDERLYING_DECIMALS);
      await deflationaryToken.connect(alice).approve(await wrappedDeflationaryToken.getAddress(), amount);
      await wrappedDeflationaryToken.connect(alice).deposit(amount);
      
      // 5. Verificar todos los invariantes
      let [isHealthy] = await wrappedToken.checkInvariant();
      expect(isHealthy).to.be.true;
      
      [isHealthy] = await wrappedDeflationaryToken.checkInvariant();
      expect(isHealthy).to.be.true;
    });

    it("Should stress test with multiple users and edge cases", async function () {
      const users = [alice, bob, charlie];
      const amounts = [
        ethers.parseUnits("1000", UNDERLYING_DECIMALS),
        ethers.parseUnits("50", UNDERLYING_DECIMALS),
        1000n // small amount
      ];
      
      // Cada usuario hace depósitos diferentes
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const amount = amounts[i];
        
        await underlyingToken.connect(user).approve(await wrappedToken.getAddress(), amount);
        await wrappedToken.connect(user).deposit(amount);
        
        const [isHealthy] = await wrappedToken.checkInvariant();
        expect(isHealthy).to.be.true;
      }
      
      // Retiros escalonados
      for (const user of users) {
        const balance = await wrappedToken.balanceOf(user.address);
        if (balance > 0) {
          await wrappedToken.connect(user).withdraw(balance / 2n);
          
          const [isHealthy] = await wrappedToken.checkInvariant();
          expect(isHealthy).to.be.true;
        }
      }
    });
  });
});
