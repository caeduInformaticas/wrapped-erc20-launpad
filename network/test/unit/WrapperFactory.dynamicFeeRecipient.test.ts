import { expect } from "chai";
import { ethers } from "hardhat";
import { 
  WrapperFactory, 
  MockERC20WithPermit, 
  ERC20Wrapped 
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Task 4.1: Consulta Dinámica de Fee Recipient", function () {
  let factory: WrapperFactory;
  let underlyingToken1: MockERC20WithPermit;
  let underlyingToken2: MockERC20WithPermit;
  let wrapper1: ERC20Wrapped;
  let wrapper2: ERC20Wrapped;
  let admin: SignerWithAddress;
  let treasurer: SignerWithAddress;
  let operator: SignerWithAddress;
  let feeRecipient1: SignerWithAddress;
  let feeRecipient2: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  
  const INITIAL_FEE_RATE = 100; // 1% en basis points
  
  beforeEach(async function () {
    [admin, treasurer, operator, feeRecipient1, feeRecipient2, user1, user2] = await ethers.getSigners();
    
    // Deploy factory
    const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactoryFactory.deploy(
      admin.address,
      treasurer.address,
      operator.address,
      feeRecipient1.address,
      INITIAL_FEE_RATE
    );
    
    // Deploy test tokens
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    underlyingToken1 = await MockERC20WithPermitFactory.deploy(
      "Token 1",
      "TOK1",
      18,
      ethers.parseEther("1000000")
    );
    
    underlyingToken2 = await MockERC20WithPermitFactory.deploy(
      "Token 2", 
      "TOK2",
      18,
      ethers.parseEther("1000000")
    );
    
    // Create wrappers
    const tx1 = await factory.connect(user1).createWrapper(
      await underlyingToken1.getAddress(),
      "Wrapped Token 1",
      "wTOK1"
    );
    
    const tx2 = await factory.connect(user1).createWrapper(
      await underlyingToken2.getAddress(),
      "Wrapped Token 2", 
      "wTOK2"
    );
    
    // Get wrapper addresses from events
    const receipt1 = await tx1.wait();
    const receipt2 = await tx2.wait();
    
    // Parse wrapper addresses from WrapperCreated events
    const logs1 = receipt1!.logs;
    const logs2 = receipt2!.logs;
    
    const wrapperCreatedLog1 = logs1.find((log: any) => log.topics.length === 4);
    const wrapperCreatedLog2 = logs2.find((log: any) => log.topics.length === 4);
    
    const wrapper1Address = ethers.getAddress("0x" + wrapperCreatedLog1!.topics[2].slice(26));
    const wrapper2Address = ethers.getAddress("0x" + wrapperCreatedLog2!.topics[2].slice(26));
    
    wrapper1 = await ethers.getContractAt("ERC20Wrapped", wrapper1Address);
    wrapper2 = await ethers.getContractAt("ERC20Wrapped", wrapper2Address);
    
    // Setup tokens for testing
    await underlyingToken1.mint(user1.address, ethers.parseEther("1000"));
    await underlyingToken1.mint(user2.address, ethers.parseEther("1000"));
    await underlyingToken2.mint(user1.address, ethers.parseEther("1000"));
    await underlyingToken2.mint(user2.address, ethers.parseEther("1000"));
  });

  describe("✅ Wrapper usa fee recipient actual de factory", function () {
    it("Should query factory for current fee recipient on each deposit", async function () {
      // Verify initial fee recipient
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient1.address);
      
      // Make deposit and verify fee goes to current recipient
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      
      const feeRecipientBalanceBefore = await underlyingToken1.balanceOf(feeRecipient1.address);
      
      await wrapper1.connect(user1).deposit(depositAmount);
      
      const feeRecipientBalanceAfter = await underlyingToken1.balanceOf(feeRecipient1.address);
      expect(feeRecipientBalanceAfter).to.equal(feeRecipientBalanceBefore + expectedFee);
    });

    it("Should emit Deposit event with correct fee recipient", async function () {
      const depositAmount = ethers.parseEther("50");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;
      
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      
      await expect(wrapper1.connect(user1).deposit(depositAmount))
        .to.emit(wrapper1, "Deposit")
        .withArgs(
          user1.address,
          depositAmount,
          expectedWrapped,
          expectedFee,
          feeRecipient1.address
        );
    });
  });

  describe("✅ Cambio en factory afecta inmediatamente todos los wrappers", function () {
    it("Should update fee recipient for all wrappers immediately", async function () {
      // Change fee recipient in factory
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      
      // Verify factory updated
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient2.address);
      
      // Test both wrappers use new recipient
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      // Setup approvals
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      await underlyingToken2.connect(user2).approve(await wrapper2.getAddress(), depositAmount);
      
      // Check balances before
      const recipient2BalanceBefore1 = await underlyingToken1.balanceOf(feeRecipient2.address);
      const recipient2BalanceBefore2 = await underlyingToken2.balanceOf(feeRecipient2.address);
      
      // Make deposits
      await wrapper1.connect(user1).deposit(depositAmount);
      await wrapper2.connect(user2).deposit(depositAmount);
      
      // Check balances after
      const recipient2BalanceAfter1 = await underlyingToken1.balanceOf(feeRecipient2.address);
      const recipient2BalanceAfter2 = await underlyingToken2.balanceOf(feeRecipient2.address);
      
      expect(recipient2BalanceAfter1).to.equal(recipient2BalanceBefore1 + expectedFee);
      expect(recipient2BalanceAfter2).to.equal(recipient2BalanceBefore2 + expectedFee);
    });

    it("Should immediately reflect fee recipient changes across multiple deposits", async function () {
      const depositAmount = ethers.parseEther("50");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      // Setup approvals
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount * 2n);
      
      // First deposit - original recipient
      const recipient1BalanceBefore = await underlyingToken1.balanceOf(feeRecipient1.address);
      await wrapper1.connect(user1).deposit(depositAmount);
      const recipient1BalanceAfter = await underlyingToken1.balanceOf(feeRecipient1.address);
      expect(recipient1BalanceAfter).to.equal(recipient1BalanceBefore + expectedFee);
      
      // Change recipient
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      
      // Second deposit - new recipient
      const recipient2BalanceBefore = await underlyingToken1.balanceOf(feeRecipient2.address);
      await wrapper1.connect(user1).deposit(depositAmount);
      const recipient2BalanceAfter = await underlyingToken1.balanceOf(feeRecipient2.address);
      expect(recipient2BalanceAfter).to.equal(recipient2BalanceBefore + expectedFee);
      
      // Original recipient should not receive more fees
      const recipient1FinalBalance = await underlyingToken1.balanceOf(feeRecipient1.address);
      expect(recipient1FinalBalance).to.equal(recipient1BalanceAfter);
    });
  });

  describe("✅ Múltiples wrappers usan mismo recipient", function () {
    it("Should send fees from all wrappers to same recipient", async function () {
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      // Setup approvals
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      await underlyingToken2.connect(user2).approve(await wrapper2.getAddress(), depositAmount);
      
      // Track recipient balance
      const recipientBalanceBefore = await underlyingToken1.balanceOf(feeRecipient1.address) +
                                   await underlyingToken2.balanceOf(feeRecipient1.address);
      
      // Make deposits from different wrappers
      await wrapper1.connect(user1).deposit(depositAmount);
      await wrapper2.connect(user2).deposit(depositAmount);
      
      // Calculate total fees received
      const recipientBalanceAfter = await underlyingToken1.balanceOf(feeRecipient1.address) +
                                  await underlyingToken2.balanceOf(feeRecipient1.address);
      
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + (expectedFee * 2n));
    });

    it("Should maintain consistent fee recipient across wrapper lifecycle", async function () {
      // Verify both wrappers query same recipient
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient1.address);
      
      // Create additional wrapper
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const underlyingToken3 = await MockERC20WithPermitFactory.deploy(
        "Token 3",
        "TOK3", 
        18,
        ethers.parseEther("1000000")
      );
      
      const tx3 = await factory.connect(user1).createWrapper(
        await underlyingToken3.getAddress(),
        "Wrapped Token 3",
        "wTOK3"
      );
      
      const receipt3 = await tx3.wait();
      const logs3 = receipt3!.logs;
      const wrapperCreatedLog3 = logs3.find((log: any) => log.topics.length === 4);
      const wrapper3Address = ethers.getAddress("0x" + wrapperCreatedLog3!.topics[2].slice(26));
      const wrapper3 = await ethers.getContractAt("ERC20Wrapped", wrapper3Address);
      
      // All wrappers should use same recipient
      const depositAmount = ethers.parseEther("50");
      await underlyingToken3.mint(user1.address, ethers.parseEther("1000"));
      await underlyingToken3.connect(user1).approve(wrapper3Address, depositAmount);
      
      await expect(wrapper3.connect(user1).deposit(depositAmount))
        .to.emit(wrapper3, "Deposit")
        .withArgs(
          user1.address,
          depositAmount,
          depositAmount - (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000),
          (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000),
          feeRecipient1.address
        );
    });
  });

  describe("✅ Revert si factory devuelve address(0)", function () {
    it("Should handle when factory returns address(0) as fee recipient", async function () {
      // Deploy wrapper with fake factory that returns address(0)
      const fakeFactory = await ethers.getContractAt("WrapperFactory", user2.address);
      
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const wrapperWithFakeFactory = await ERC20WrappedFactory.deploy(
        await underlyingToken1.getAddress(),
        INITIAL_FEE_RATE,
        user2.address, // fake factory address (user2)
        "Test Wrapper",
        "TEST"
      );
      
      // Setup deposit
      const depositAmount = ethers.parseEther("100");
      await underlyingToken1.connect(user1).approve(await wrapperWithFakeFactory.getAddress(), depositAmount);
      
      // Deposit should work but fee recipient should be address(0) in event
      await expect(wrapperWithFakeFactory.connect(user1).deposit(depositAmount))
        .to.emit(wrapperWithFakeFactory, "Deposit")
        .withArgs(
          user1.address,
          depositAmount,
          depositAmount - (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000),
          (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000),
          ethers.ZeroAddress // fee recipient should be address(0)
        );
    });

    it("Should keep fees in contract when factory returns address(0)", async function () {
      // Deploy wrapper with fake factory
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const wrapperWithFakeFactory = await ERC20WrappedFactory.deploy(
        await underlyingToken1.getAddress(),
        INITIAL_FEE_RATE,
        user2.address, // fake factory address 
        "Test Wrapper",
        "TEST"
      );
      
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      await underlyingToken1.connect(user1).approve(await wrapperWithFakeFactory.getAddress(), depositAmount);
      
      // Check contract balance before
      const contractBalanceBefore = await underlyingToken1.balanceOf(await wrapperWithFakeFactory.getAddress());
      
      await wrapperWithFakeFactory.connect(user1).deposit(depositAmount);
      
      // Check contract balance after - should contain the full deposit amount
      const contractBalanceAfter = await underlyingToken1.balanceOf(await wrapperWithFakeFactory.getAddress());
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + depositAmount);
    });
  });

  describe("✅ Wrapper funciona correctamente tras cambio de recipient", function () {
    it("Should continue normal operation after fee recipient change", async function () {
      const depositAmount = ethers.parseEther("100");
      
      // Setup approvals
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount * 3n);
      
      // Initial deposit
      await wrapper1.connect(user1).deposit(depositAmount);
      const wrappedBalance1 = await wrapper1.balanceOf(user1.address);
      expect(wrappedBalance1).to.be.gt(0);
      
      // Change fee recipient
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      
      // Deposit after change
      await wrapper1.connect(user1).deposit(depositAmount);
      const wrappedBalance2 = await wrapper1.balanceOf(user1.address);
      expect(wrappedBalance2).to.be.gt(wrappedBalance1);
      
      // Withdrawal should still work
      await wrapper1.connect(user1).withdraw(wrappedBalance2);
      expect(await wrapper1.balanceOf(user1.address)).to.equal(0);
      
      // Another deposit after withdrawal
      await wrapper1.connect(user1).deposit(depositAmount);
      const wrappedBalance3 = await wrapper1.balanceOf(user1.address);
      expect(wrappedBalance3).to.be.gt(0);
    });

    it("Should maintain wrapper invariants after recipient changes", async function () {
      const depositAmount = ethers.parseEther("200");
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      
      // Initial state
      const [healthyBefore, reservesBefore, supplyBefore] = await wrapper1.checkInvariant();
      expect(healthyBefore).to.be.true;
      expect(reservesBefore).to.equal(supplyBefore);
      
      // Change recipient and deposit
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      await wrapper1.connect(user1).deposit(depositAmount);
      
      // Check invariants maintained
      const [healthyAfter, reservesAfter, supplyAfter] = await wrapper1.checkInvariant();
      expect(healthyAfter).to.be.true;
      expect(reservesAfter).to.equal(supplyAfter);
      expect(reservesAfter).to.be.gt(reservesBefore);
    });

    it("Should handle multiple recipient changes smoothly", async function () {
      const depositAmount = ethers.parseEther("50");
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount * 4n);
      
      // Track balances
      let recipient1Balance = await underlyingToken1.balanceOf(feeRecipient1.address);
      let recipient2Balance = await underlyingToken1.balanceOf(feeRecipient2.address);
      
      // First deposit - recipient1
      await wrapper1.connect(user1).deposit(depositAmount);
      const newRecipient1Balance = await underlyingToken1.balanceOf(feeRecipient1.address);
      expect(newRecipient1Balance).to.be.gt(recipient1Balance);
      recipient1Balance = newRecipient1Balance;
      
      // Change to recipient2
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      await wrapper1.connect(user1).deposit(depositAmount);
      const newRecipient2Balance = await underlyingToken1.balanceOf(feeRecipient2.address);
      expect(newRecipient2Balance).to.be.gt(recipient2Balance);
      recipient2Balance = newRecipient2Balance;
      
      // Change back to recipient1
      await factory.connect(treasurer).setFeeRecipient(feeRecipient1.address);
      await wrapper1.connect(user1).deposit(depositAmount);
      const finalRecipient1Balance = await underlyingToken1.balanceOf(feeRecipient1.address);
      expect(finalRecipient1Balance).to.be.gt(recipient1Balance);
      
      // Recipient2 should not receive additional fees
      const finalRecipient2Balance = await underlyingToken1.balanceOf(feeRecipient2.address);
      expect(finalRecipient2Balance).to.equal(recipient2Balance);
    });
  });

  describe("Integration with Factory Fee Management", function () {
    it("Should work with zero fee rate", async function () {
      // Change fee rate to 0%
      await factory.connect(operator).setDepositFeeRate(0);
      
      // Create new wrapper with 0% fee
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const zeroFeeToken = await MockERC20WithPermitFactory.deploy(
        "Zero Fee Token",
        "ZERO",
        18,
        ethers.parseEther("1000000")
      );
      
      const tx = await factory.connect(user1).createWrapper(
        await zeroFeeToken.getAddress(),
        "Zero Fee Wrapper",
        "wZERO"
      );
      
      const receipt = await tx.wait();
      const logs = receipt!.logs;
      const wrapperCreatedLog = logs.find((log: any) => log.topics.length === 4);
      const zeroFeeWrapperAddress = ethers.getAddress("0x" + wrapperCreatedLog!.topics[2].slice(26));
      const zeroFeeWrapper = await ethers.getContractAt("ERC20Wrapped", zeroFeeWrapperAddress);
      
      // Test deposit with zero fee
      const depositAmount = ethers.parseEther("100");
      await zeroFeeToken.mint(user1.address, ethers.parseEther("1000"));
      await zeroFeeToken.connect(user1).approve(zeroFeeWrapperAddress, depositAmount);
      
      await expect(zeroFeeWrapper.connect(user1).deposit(depositAmount))
        .to.emit(zeroFeeWrapper, "Deposit")
        .withArgs(
          user1.address,
          depositAmount,
          depositAmount, // No fee deducted
          0, // Zero fee
          ethers.ZeroAddress // No fee recipient for zero fee
        );
    });

    it("Should handle fee recipient queries correctly across all scenarios", async function () {
      // Test various factory states
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient1.address);
      
      // Change recipient
      await factory.connect(treasurer).setFeeRecipient(feeRecipient2.address);
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient2.address);
      
      // Both wrappers should query and get the same result
      const depositAmount = ethers.parseEther("10");
      await underlyingToken1.connect(user1).approve(await wrapper1.getAddress(), depositAmount);
      await underlyingToken2.connect(user1).approve(await wrapper2.getAddress(), depositAmount);
      
      // Both deposits should go to feeRecipient2
      const balanceBefore = await underlyingToken1.balanceOf(feeRecipient2.address) +
                          await underlyingToken2.balanceOf(feeRecipient2.address);
      
      await wrapper1.connect(user1).deposit(depositAmount);
      await wrapper2.connect(user1).deposit(depositAmount);
      
      const balanceAfter = await underlyingToken1.balanceOf(feeRecipient2.address) +
                         await underlyingToken2.balanceOf(feeRecipient2.address);
      
      const expectedTotalFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000) * 2n;
      expect(balanceAfter).to.equal(balanceBefore + expectedTotalFee);
    });
  });
});
