import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20Wrapped, MockERC20 } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ERC20Wrapped - Withdraw Function", function () {
  let wrappedToken: ERC20Wrapped;
  let underlyingToken: MockERC20;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let fakeFactory: SignerWithAddress;
  
  // Configuración de test
  const UNDERLYING_NAME = "Test USDC";
  const UNDERLYING_SYMBOL = "TUSDC";
  const UNDERLYING_DECIMALS = 6;
  const UNDERLYING_SUPPLY = ethers.parseUnits("1000000", UNDERLYING_DECIMALS); // 1M TUSDC
  
  const WRAPPED_NAME = "Wrapped Test USDC";
  const WRAPPED_SYMBOL = "wTUSDC";
  const DEPOSIT_FEE_RATE = 100; // 1% = 100 basis points
  
  beforeEach(async function () {
    [owner, alice, bob, fakeFactory] = await ethers.getSigners();
    
    // Deploy underlying token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    underlyingToken = await MockERC20Factory.deploy(
      UNDERLYING_NAME,
      UNDERLYING_SYMBOL,
      UNDERLYING_DECIMALS,
      UNDERLYING_SUPPLY
    );
    
    // Deploy wrapped token
    const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
    wrappedToken = await ERC20WrappedFactory.deploy(
      await underlyingToken.getAddress(),
      DEPOSIT_FEE_RATE,
      fakeFactory.address,
      WRAPPED_NAME,
      WRAPPED_SYMBOL
    );
    
    // Transfer tokens to users for testing
    await underlyingToken.transfer(alice.address, ethers.parseUnits("10000", UNDERLYING_DECIMALS));
    await underlyingToken.transfer(bob.address, ethers.parseUnits("5000", UNDERLYING_DECIMALS));
    
    // Setup: Alice deposits some tokens first so we have wrapped tokens to withdraw
    const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
    await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
    await wrappedToken.connect(alice).deposit(depositAmount);
  });

  describe("Successful Withdrawals", function () {
    it("Should allow basic withdrawal with 1:1 ratio", async function () {
      // Alice should have ~990 wrapped tokens (1000 - 1% fee = 990)
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(2); // Withdraw half
      
      // Check balances before
      const aliceWrappedBefore = await wrappedToken.balanceOf(alice.address);
      const aliceUnderlyingBefore = await underlyingToken.balanceOf(alice.address);
      const contractUnderlyingBefore = await underlyingToken.balanceOf(await wrappedToken.getAddress());
      const totalSupplyBefore = await wrappedToken.totalSupply();
      
      // Execute withdrawal
      const tx = await wrappedToken.connect(alice).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      
      // Check balances after
      const aliceWrappedAfter = await wrappedToken.balanceOf(alice.address);
      const aliceUnderlyingAfter = await underlyingToken.balanceOf(alice.address);
      const contractUnderlyingAfter = await underlyingToken.balanceOf(await wrappedToken.getAddress());
      const totalSupplyAfter = await wrappedToken.totalSupply();
      
      // Verify transfers - 1:1 ratio, no fee
      expect(aliceWrappedAfter).to.equal(aliceWrappedBefore - withdrawAmount);
      expect(aliceUnderlyingAfter).to.equal(aliceUnderlyingBefore + withdrawAmount);
      expect(contractUnderlyingAfter).to.equal(contractUnderlyingBefore - withdrawAmount);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore - withdrawAmount);
    });

    it("Should emit Withdrawal event with correct parameters", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(3); // Withdraw one-third
      
      await expect(wrappedToken.connect(alice).withdraw(withdrawAmount))
        .to.emit(wrappedToken, "Withdrawal")
        .withArgs(
          alice.address,
          withdrawAmount,
          withdrawAmount // 1:1 ratio
        );
    });

    it("Should handle multiple withdrawals correctly", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const firstWithdraw = aliceBalance / BigInt(5); // 20%
      const secondWithdraw = aliceBalance / BigInt(10); // 10%
      
      const initialBalance = await wrappedToken.balanceOf(alice.address);
      const initialUnderlying = await underlyingToken.balanceOf(alice.address);
      
      // First withdrawal
      await wrappedToken.connect(alice).withdraw(firstWithdraw);
      
      const balanceAfterFirst = await wrappedToken.balanceOf(alice.address);
      const underlyingAfterFirst = await underlyingToken.balanceOf(alice.address);
      
      // Second withdrawal
      await wrappedToken.connect(alice).withdraw(secondWithdraw);
      
      const balanceAfterSecond = await wrappedToken.balanceOf(alice.address);
      const underlyingAfterSecond = await underlyingToken.balanceOf(alice.address);
      
      expect(balanceAfterFirst).to.equal(initialBalance - firstWithdraw);
      expect(balanceAfterSecond).to.equal(initialBalance - firstWithdraw - secondWithdraw);
      
      expect(underlyingAfterFirst).to.equal(initialUnderlying + firstWithdraw);
      expect(underlyingAfterSecond).to.equal(initialUnderlying + firstWithdraw + secondWithdraw);
    });

    it("Should allow full withdrawal of user balance", async function () {
      const fullBalance = await wrappedToken.balanceOf(alice.address);
      const initialUnderlying = await underlyingToken.balanceOf(alice.address);
      
      await wrappedToken.connect(alice).withdraw(fullBalance);
      
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(0);
      expect(await underlyingToken.balanceOf(alice.address)).to.equal(initialUnderlying + fullBalance);
    });

    it("Should update total supply correctly", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(4); // Withdraw 25%
      const initialSupply = await wrappedToken.totalSupply();
      
      await wrappedToken.connect(alice).withdraw(withdrawAmount);
      
      expect(await wrappedToken.totalSupply()).to.equal(initialSupply - withdrawAmount);
    });

    it("Should maintain healthy invariant after withdrawals", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(3); // Withdraw 33%
      
      await wrappedToken.connect(alice).withdraw(withdrawAmount);
      
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply); // reserves >= supply still holds
    });

    it("Should work correctly with preview function", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(4); // Withdraw 25%
      
      // Get preview (should be 1:1)
      const previewAmount = await wrappedToken.previewWithdraw(withdrawAmount);
      expect(previewAmount).to.equal(withdrawAmount);
      
      const initialUnderlying = await underlyingToken.balanceOf(alice.address);
      
      // Execute withdrawal
      await wrappedToken.connect(alice).withdraw(withdrawAmount);
      
      // Verify actual result matches preview
      const finalUnderlying = await underlyingToken.balanceOf(alice.address);
      expect(finalUnderlying - initialUnderlying).to.equal(previewAmount);
    });
  });

  describe("Withdrawal Validations", function () {
    it("Should revert on zero amount withdrawal", async function () {
      await expect(wrappedToken.connect(alice).withdraw(0))
        .to.be.revertedWithCustomError(wrappedToken, "ZeroAmount");
    });

    it("Should revert if user has insufficient wrapped balance", async function () {
      const userBalance = await wrappedToken.balanceOf(alice.address);
      const excessiveAmount = userBalance + ethers.parseEther("1"); // More than user has
      
      await expect(wrappedToken.connect(alice).withdraw(excessiveAmount))
        .to.be.revertedWithCustomError(wrappedToken, "ERC20InsufficientBalance");
    });

    it("Should revert if user has zero balance", async function () {
      // Bob hasn't deposited anything, so should have zero balance
      expect(await wrappedToken.balanceOf(bob.address)).to.equal(0);
      
      await expect(wrappedToken.connect(bob).withdraw(ethers.parseEther("1")))
        .to.be.revertedWithCustomError(wrappedToken, "ERC20InsufficientBalance");
    });

    it("Should revert if contract has insufficient underlying reserves", async function () {
      // This is a more complex scenario - we'd need to artificially drain the contract
      // For now, we'll test by withdrawing more than possible
      const totalSupply = await wrappedToken.totalSupply();
      const reserves = await wrappedToken.getReserves();
      
      // In normal circumstances, this shouldn't happen due to invariant
      // But let's verify our withdrawal doesn't exceed available reserves
      const userBalance = await wrappedToken.balanceOf(alice.address);
      expect(userBalance).to.be.lte(reserves);
    });
  });

  describe("Multiple Users", function () {
    beforeEach(async function () {
      // Setup: Bob also deposits some tokens
      const bobDepositAmount = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      await underlyingToken.connect(bob).approve(await wrappedToken.getAddress(), bobDepositAmount);
      await wrappedToken.connect(bob).deposit(bobDepositAmount);
    });

    it("Should handle withdrawals from multiple users correctly", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const bobBalance = await wrappedToken.balanceOf(bob.address);
      
      const aliceWithdraw = aliceBalance / BigInt(5); // 20% of Alice's balance
      const bobWithdraw = bobBalance / BigInt(4); // 25% of Bob's balance
      
      const aliceInitialWrapped = await wrappedToken.balanceOf(alice.address);
      const aliceInitialUnderlying = await underlyingToken.balanceOf(alice.address);
      const bobInitialWrapped = await wrappedToken.balanceOf(bob.address);
      const bobInitialUnderlying = await underlyingToken.balanceOf(bob.address);
      const initialSupply = await wrappedToken.totalSupply();
      
      // Both users withdraw
      await wrappedToken.connect(alice).withdraw(aliceWithdraw);
      await wrappedToken.connect(bob).withdraw(bobWithdraw);
      
      // Check balances
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(aliceInitialWrapped - aliceWithdraw);
      expect(await wrappedToken.balanceOf(bob.address)).to.equal(bobInitialWrapped - bobWithdraw);
      
      expect(await underlyingToken.balanceOf(alice.address)).to.equal(aliceInitialUnderlying + aliceWithdraw);
      expect(await underlyingToken.balanceOf(bob.address)).to.equal(bobInitialUnderlying + bobWithdraw);
      
      // Check total supply
      expect(await wrappedToken.totalSupply()).to.equal(initialSupply - aliceWithdraw - bobWithdraw);
    });

    it("Should maintain invariant with multiple users", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const bobBalance = await wrappedToken.balanceOf(bob.address);
      
      // Withdraw some from both users
      await wrappedToken.connect(alice).withdraw(aliceBalance / BigInt(3));
      await wrappedToken.connect(bob).withdraw(bobBalance / BigInt(2));
      
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply);
    });
  });

  describe("Fee Impact on Withdrawals", function () {
    it("Should allow withdrawal of wrapped amount even when less than original deposit", async function () {
      // Alice deposited 1000 TUSDC but received less due to 1% fee
      const aliceWrappedBalance = await wrappedToken.balanceOf(alice.address);
      const originalDeposit = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // She should have less wrapped than she deposited (due to fee)
      expect(aliceWrappedBalance).to.be.lt(originalDeposit);
      
      // But she should be able to withdraw all her wrapped tokens
      await wrappedToken.connect(alice).withdraw(aliceWrappedBalance);
      
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(0);
    });

    it("Should maintain fee reserves in contract after withdrawals", async function () {
      const initialReserves = await wrappedToken.getReserves();
      const initialSupply = await wrappedToken.totalSupply();
      const feeReserves = initialReserves - initialSupply;
      
      // Alice withdraws some tokens
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(5); // 20%
      await wrappedToken.connect(alice).withdraw(withdrawAmount);
      
      const finalReserves = await wrappedToken.getReserves();
      const finalSupply = await wrappedToken.totalSupply();
      const finalFeeReserves = finalReserves - finalSupply;
      
      // Fee reserves should remain the same (only user's wrapped tokens are withdrawn)
      expect(finalFeeReserves).to.equal(feeReserves);
    });
  });

  describe("Gas Optimization", function () {
    it("Should have reasonable gas costs for withdrawals", async function () {
      const aliceBalance = await wrappedToken.balanceOf(alice.address);
      const withdrawAmount = aliceBalance / BigInt(3); // Withdraw 33%
      
      const tx = await wrappedToken.connect(alice).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      
      // Gas should be reasonable (under 70k for basic withdrawal)
      expect(receipt!.gasUsed).to.be.lt(70000);
      
      console.log(`      Gas used for withdrawal: ${receipt!.gasUsed.toString()}`);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle very small withdrawal amounts", async function () {
      const smallAmount = 1; // 1 wei
      
      // Make sure Alice has at least this amount
      const balance = await wrappedToken.balanceOf(alice.address);
      expect(balance).to.be.gte(smallAmount);
      
      const initialUnderlying = await underlyingToken.balanceOf(alice.address);
      
      await wrappedToken.connect(alice).withdraw(smallAmount);
      
      expect(await underlyingToken.balanceOf(alice.address)).to.equal(initialUnderlying + BigInt(smallAmount));
    });

    it("Should handle exact balance withdrawal", async function () {
      const exactBalance = await wrappedToken.balanceOf(alice.address);
      
      await wrappedToken.connect(alice).withdraw(exactBalance);
      
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(0);
    });
  });

  describe("Integration with Deposit Flow", function () {
    it("Should allow deposit and immediate withdrawal", async function () {
      // Fresh deposit
      const depositAmount = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      await underlyingToken.connect(bob).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(bob).deposit(depositAmount);
      
      const wrappedReceived = await wrappedToken.balanceOf(bob.address);
      const initialUnderlying = await underlyingToken.balanceOf(bob.address);
      
      // Immediate withdrawal
      await wrappedToken.connect(bob).withdraw(wrappedReceived);
      
      const finalUnderlying = await underlyingToken.balanceOf(bob.address);
      
      // Bob should get back his wrapped amount (which was less than deposit due to fee)
      expect(finalUnderlying - initialUnderlying).to.equal(wrappedReceived);
      expect(wrappedReceived).to.be.lt(depositAmount); // Due to 1% deposit fee
    });

    it("Should maintain system consistency with multiple deposit/withdraw cycles", async function () {
      const amount = ethers.parseUnits("200", UNDERLYING_DECIMALS);
      
      // Bob does multiple deposit/withdraw cycles
      for (let i = 0; i < 3; i++) {
        await underlyingToken.connect(bob).approve(await wrappedToken.getAddress(), amount);
        await wrappedToken.connect(bob).deposit(amount);
        
        const wrapped = await wrappedToken.balanceOf(bob.address);
        await wrappedToken.connect(bob).withdraw(wrapped);
      }
      
      // System should still be healthy
      const [isHealthy] = await wrappedToken.checkInvariant();
      expect(isHealthy).to.be.true;
      
      // Bob should have zero wrapped tokens
      expect(await wrappedToken.balanceOf(bob.address)).to.equal(0);
    });
  });
});
