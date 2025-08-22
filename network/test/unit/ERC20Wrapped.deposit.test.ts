import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20Wrapped, MockERC20 } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ERC20Wrapped - Deposit Function", function () {
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
  });

  describe("Successful Deposits", function () {
    it("Should allow basic deposit with correct amounts", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS); // 1000 TUSDC
      
      // Pre-calculations
      const expectedFee = (depositAmount * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000); // 1%
      const expectedWrapped = depositAmount - expectedFee;
      
      // Alice approves and deposits
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      
      // Check balances before
      const aliceUnderlyingBefore = await underlyingToken.balanceOf(alice.address);
      const aliceWrappedBefore = await wrappedToken.balanceOf(alice.address);
      const contractUnderlyingBefore = await underlyingToken.balanceOf(await wrappedToken.getAddress());
      
      // Execute deposit
      const tx = await wrappedToken.connect(alice).deposit(depositAmount);
      const receipt = await tx.wait();
      
      // Check balances after
      const aliceUnderlyingAfter = await underlyingToken.balanceOf(alice.address);
      const aliceWrappedAfter = await wrappedToken.balanceOf(alice.address);
      const contractUnderlyingAfter = await underlyingToken.balanceOf(await wrappedToken.getAddress());
      
      // Verify transfers
      expect(aliceUnderlyingAfter).to.equal(aliceUnderlyingBefore - depositAmount);
      expect(aliceWrappedAfter).to.equal(aliceWrappedBefore + expectedWrapped);
      expect(contractUnderlyingAfter).to.equal(contractUnderlyingBefore + depositAmount);
      
      // Verify return value by checking the actual balance change
      expect(aliceWrappedAfter).to.equal(expectedWrapped);
    });

    it("Should emit Deposit event with correct parameters", async function () {
      const depositAmount = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      const expectedFee = (depositAmount * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      
      await expect(wrappedToken.connect(alice).deposit(depositAmount))
        .to.emit(wrappedToken, "Deposit")
        .withArgs(
          alice.address,
          depositAmount,
          expectedWrapped,
          expectedFee,
          ethers.ZeroAddress // No fee recipient configured yet
        );
    });

    it("Should handle zero fee deposits correctly", async function () {
      // Deploy wrapper with 0% fee
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const zeroFeeWrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        0, // 0% fee
        fakeFactory.address,
        "Zero Fee Wrapper",
        "ZFW"
      );
      
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      await underlyingToken.connect(alice).approve(await zeroFeeWrapper.getAddress(), depositAmount);
      
      const tx = await zeroFeeWrapper.connect(alice).deposit(depositAmount);
      
      // Should receive full amount since no fee
      expect(await zeroFeeWrapper.balanceOf(alice.address)).to.equal(depositAmount);
      
      // Should emit event with zero fee
      await expect(tx)
        .to.emit(zeroFeeWrapper, "Deposit")
        .withArgs(alice.address, depositAmount, depositAmount, 0, ethers.ZeroAddress);
    });

    it("Should handle multiple deposits correctly", async function () {
      const firstDeposit = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const secondDeposit = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      
      // First deposit
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), firstDeposit);
      await wrappedToken.connect(alice).deposit(firstDeposit);
      
      const balanceAfterFirst = await wrappedToken.balanceOf(alice.address);
      
      // Second deposit
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), secondDeposit);
      await wrappedToken.connect(alice).deposit(secondDeposit);
      
      const balanceAfterSecond = await wrappedToken.balanceOf(alice.address);
      
      // Calculate expected amounts
      const expectedFirstWrapped = firstDeposit - (firstDeposit * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      const expectedSecondWrapped = secondDeposit - (secondDeposit * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      
      expect(balanceAfterFirst).to.equal(expectedFirstWrapped);
      expect(balanceAfterSecond).to.equal(expectedFirstWrapped + expectedSecondWrapped);
    });

    it("Should update total supply correctly", async function () {
      const deposit1 = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const deposit2 = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      
      // Initial supply should be 0
      expect(await wrappedToken.totalSupply()).to.equal(0);
      
      // Alice deposits
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), deposit1);
      await wrappedToken.connect(alice).deposit(deposit1);
      
      const expectedAliceWrapped = deposit1 - (deposit1 * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      expect(await wrappedToken.totalSupply()).to.equal(expectedAliceWrapped);
      
      // Bob deposits
      await underlyingToken.connect(bob).approve(await wrappedToken.getAddress(), deposit2);
      await wrappedToken.connect(bob).deposit(deposit2);
      
      const expectedBobWrapped = deposit2 - (deposit2 * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      expect(await wrappedToken.totalSupply()).to.equal(expectedAliceWrapped + expectedBobWrapped);
    });

    it("Should maintain reserves correctly", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      expect(await wrappedToken.getReserves()).to.equal(0);
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(alice).deposit(depositAmount);
      
      // Reserves should equal total deposited (including fee portion)
      expect(await wrappedToken.getReserves()).to.equal(depositAmount);
    });

    it("Should maintain healthy invariant after deposits", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(alice).deposit(depositAmount);
      
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply); // reserves >= supply
      
      // In fact, reserves should be > supply due to fees
      expect(reserves).to.be.gt(supply);
    });
  });

  describe("Deposit Validations", function () {
    it("Should revert on zero amount deposit", async function () {
      await expect(wrappedToken.connect(alice).deposit(0))
        .to.be.revertedWithCustomError(wrappedToken, "ZeroAmount");
    });

    it("Should revert if user has insufficient balance", async function () {
      const excessiveAmount = ethers.parseUnits("20000", UNDERLYING_DECIMALS); // Alice only has 10k
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), excessiveAmount);
      
      await expect(wrappedToken.connect(alice).deposit(excessiveAmount))
        .to.be.revertedWithCustomError(wrappedToken, "TransferFailed");
    });

    it("Should revert if user has insufficient allowance", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const insufficientAllowance = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), insufficientAllowance);
      
      await expect(wrappedToken.connect(alice).deposit(depositAmount))
        .to.be.revertedWithCustomError(wrappedToken, "TransferFailed");
    });

    it("Should revert if transferFrom fails", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // No approval = transferFrom will fail
      await expect(wrappedToken.connect(alice).deposit(depositAmount))
        .to.be.revertedWithCustomError(wrappedToken, "TransferFailed");
    });
  });

  describe("Fee Handling", function () {
    it("Should keep fees in contract when no fee recipient", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const expectedFee = (depositAmount * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      await wrappedToken.connect(alice).deposit(depositAmount);
      
      // All deposited tokens should be in the contract (wrapped amount + fee)
      expect(await underlyingToken.balanceOf(await wrappedToken.getAddress())).to.equal(depositAmount);
      
      // Reserves should be greater than supply due to fee
      const reserves = await wrappedToken.getReserves();
      const supply = await wrappedToken.totalSupply();
      expect(reserves - supply).to.equal(expectedFee);
    });

    it("Should calculate different fee rates correctly", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // Test with 5% fee rate
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const highFeeWrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        500, // 5% fee
        fakeFactory.address,
        "High Fee Wrapper",
        "HFW"
      );
      
      await underlyingToken.connect(alice).approve(await highFeeWrapper.getAddress(), depositAmount);
      await highFeeWrapper.connect(alice).deposit(depositAmount);
      
      const expectedFee = depositAmount / BigInt(20); // 5%
      const expectedWrapped = depositAmount - expectedFee;
      
      expect(await highFeeWrapper.balanceOf(alice.address)).to.equal(expectedWrapped);
    });

    it("Should handle very small amounts with fee precision", async function () {
      // Test edge case where fee calculation might round to zero
      const smallAmount = 50; // 50 wei with 1% fee should give 0 fee
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), smallAmount);
      await wrappedToken.connect(alice).deposit(smallAmount);
      
      // Should receive full amount since fee rounds to 0
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(smallAmount);
    });
  });

  describe("Gas Optimization", function () {
    it("Should have reasonable gas costs for deposits", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      
      const tx = await wrappedToken.connect(alice).deposit(depositAmount);
      const receipt = await tx.wait();
      
      // Gas should be reasonable (under 120k for basic deposit with try-catch)
      expect(receipt!.gasUsed).to.be.lt(120000);
      
      console.log(`      Gas used for deposit: ${receipt!.gasUsed.toString()}`);
    });
  });

  describe("Integration Tests", function () {
    it("Should work correctly with preview functions", async function () {
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      
      // Get preview
      const [previewWrapped, previewFee] = await wrappedToken.previewDeposit(depositAmount);
      
      // Execute actual deposit and verify event
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      
      await expect(wrappedToken.connect(alice).deposit(depositAmount))
        .to.emit(wrappedToken, "Deposit")
        .withArgs(alice.address, depositAmount, previewWrapped, previewFee, ethers.ZeroAddress);
      
      // Verify actual balance matches preview
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(previewWrapped);
    });

    it("Should maintain correct state across multiple users", async function () {
      const aliceDeposit = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const bobDeposit = ethers.parseUnits("500", UNDERLYING_DECIMALS);
      
      // Alice deposits
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), aliceDeposit);
      await wrappedToken.connect(alice).deposit(aliceDeposit);
      
      // Bob deposits
      await underlyingToken.connect(bob).approve(await wrappedToken.getAddress(), bobDeposit);
      await wrappedToken.connect(bob).deposit(bobDeposit);
      
      // Check individual balances
      const aliceExpected = aliceDeposit - (aliceDeposit * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      const bobExpected = bobDeposit - (bobDeposit * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      
      expect(await wrappedToken.balanceOf(alice.address)).to.equal(aliceExpected);
      expect(await wrappedToken.balanceOf(bob.address)).to.equal(bobExpected);
      
      // Check total supply
      expect(await wrappedToken.totalSupply()).to.equal(aliceExpected + bobExpected);
      
      // Check reserves
      expect(await wrappedToken.getReserves()).to.equal(aliceDeposit + bobDeposit);
      
      // Check invariant
      const [isHealthy] = await wrappedToken.checkInvariant();
      expect(isHealthy).to.be.true;
    });
  });
});
