import { expect } from "chai";
import { ethers } from "hardhat";
import { WrapperFactory, MockERC20WithPermit, ERC20Wrapped } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WrapperFactory - Fee Management (Task 3.3)", function () {
  let factory: WrapperFactory;
  let underlyingToken: MockERC20WithPermit;
  let admin: SignerWithAddress;
  let treasurer: SignerWithAddress;
  let operator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let newFeeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  
  const INITIAL_FEE_RATE = 150; // 1.5% en basis points
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const WRAPPED_NAME = "Wrapped Test Token";
  const WRAPPED_SYMBOL = "wTEST";
  
  beforeEach(async function () {
    [admin, treasurer, operator, feeRecipient, newFeeRecipient, user1, user2] = await ethers.getSigners();
    
    // Deploy factory
    const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactoryFactory.deploy(
      admin.address,
      treasurer.address,
      operator.address,
      feeRecipient.address,
      INITIAL_FEE_RATE
    );
    
    // Deploy test token
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    underlyingToken = await MockERC20WithPermitFactory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      18,
      ethers.parseEther("1000000")
    );
  });

  describe("Fee Recipient Management", function () {
    it("Should initialize with correct fee recipient", async function () {
      const [currentFeeRecipient, , ] = await factory.getFactoryInfo();
      expect(currentFeeRecipient).to.equal(feeRecipient.address);
    });

    it("Should allow treasurer to set fee recipient", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(newFeeRecipient.address)
      ).to.emit(factory, "FeeRecipientUpdated")
        .withArgs(feeRecipient.address, newFeeRecipient.address);
      
      const [currentFeeRecipient, , ] = await factory.getFactoryInfo();
      expect(currentFeeRecipient).to.equal(newFeeRecipient.address);
    });

    it("Should only allow treasurer to set fee recipient", async function () {
      // Admin cannot set fee recipient
      await expect(
        factory.connect(admin).setFeeRecipient(newFeeRecipient.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount")
        .withArgs(admin.address, await factory.TREASURER_ROLE());
      
      // Operator cannot set fee recipient  
      await expect(
        factory.connect(operator).setFeeRecipient(newFeeRecipient.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount")
        .withArgs(operator.address, await factory.TREASURER_ROLE());
      
      // User cannot set fee recipient
      await expect(
        factory.connect(user1).setFeeRecipient(newFeeRecipient.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await factory.TREASURER_ROLE());
    });

    it("Should revert if setting zero address as fee recipient", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidFeeRecipient");
    });

    it("Should revert if setting same address as current fee recipient", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(feeRecipient.address)
      ).to.be.revertedWithCustomError(factory, "InvalidFeeRecipient");
    });

    it("Should emit event with correct parameters", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(newFeeRecipient.address)
      ).to.emit(factory, "FeeRecipientUpdated")
        .withArgs(feeRecipient.address, newFeeRecipient.address);
    });
  });

  describe("Deposit Fee Rate Management", function () {
    it("Should initialize with correct fee rate", async function () {
      const [, currentFeeRate, ] = await factory.getFactoryInfo();
      expect(currentFeeRate).to.equal(INITIAL_FEE_RATE);
    });

    it("Should allow operator to set deposit fee rate", async function () {
      const newFeeRate = 300; // 3%
      
      await expect(
        factory.connect(operator).setDepositFeeRate(newFeeRate)
      ).to.emit(factory, "DepositFeeRateUpdated")
        .withArgs(INITIAL_FEE_RATE, newFeeRate);
      
      const [, currentFeeRate, ] = await factory.getFactoryInfo();
      expect(currentFeeRate).to.equal(newFeeRate);
    });

    it("Should allow admin to set deposit fee rate", async function () {
      const newFeeRate = 250; // 2.5%
      
      await expect(
        factory.connect(admin).setDepositFeeRate(newFeeRate)
      ).to.emit(factory, "DepositFeeRateUpdated")
        .withArgs(INITIAL_FEE_RATE, newFeeRate);
      
      const [, currentFeeRate, ] = await factory.getFactoryInfo();
      expect(currentFeeRate).to.equal(newFeeRate);
    });

    it("Should only allow admin or operator to set fee rate", async function () {
      const newFeeRate = 200;
      
      // Treasurer cannot set fee rate
      await expect(
        factory.connect(treasurer).setDepositFeeRate(newFeeRate)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount")
        .withArgs(treasurer.address, await factory.OPERATOR_ROLE());
      
      // User cannot set fee rate
      await expect(
        factory.connect(user1).setDepositFeeRate(newFeeRate)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await factory.OPERATOR_ROLE());
    });

    it("Should enforce maximum fee rate limit", async function () {
      const maxFeeRate = 1000; // 10%
      const tooHighFeeRate = 1001; // 10.01%
      
      // Should work at max
      await expect(
        factory.connect(operator).setDepositFeeRate(maxFeeRate)
      ).to.not.be.reverted;
      
      // Should fail above max
      await expect(
        factory.connect(operator).setDepositFeeRate(tooHighFeeRate)
      ).to.be.revertedWithCustomError(factory, "FeeRateTooHigh");
    });

    it("Should allow zero fee rate", async function () {
      await expect(
        factory.connect(operator).setDepositFeeRate(0)
      ).to.not.be.reverted;
      
      const [, currentFeeRate, ] = await factory.getFactoryInfo();
      expect(currentFeeRate).to.equal(0);
    });

    it("Should emit event with correct parameters", async function () {
      const newFeeRate = 400;
      
      await expect(
        factory.connect(operator).setDepositFeeRate(newFeeRate)
      ).to.emit(factory, "DepositFeeRateUpdated")
        .withArgs(INITIAL_FEE_RATE, newFeeRate);
    });
  });

  describe("Fee Integration with Wrappers", function () {
    let wrapper: ERC20Wrapped;
    let wrapperAddress: string;

    beforeEach(async function () {
      // Create a wrapper for testing
      const tx = await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factory.interface.parseLog(event!);
      wrapperAddress = parsedEvent!.args.wrapper;
      wrapper = await ethers.getContractAt("ERC20Wrapped", wrapperAddress);
      
      // Setup user1 with tokens
      await underlyingToken.mint(user1.address, ethers.parseEther("10000"));
      await underlyingToken.connect(user1).approve(wrapperAddress, ethers.parseEther("10000"));
    });

    it("Should use current factory fee recipient for deposits", async function () {
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      const initialBalance = await underlyingToken.balanceOf(feeRecipient.address);
      
      // Perform deposit
      await wrapper.connect(user1).deposit(depositAmount);
      
      // Check fee went to current recipient
      expect(await underlyingToken.balanceOf(feeRecipient.address))
        .to.equal(initialBalance + expectedFee);
    });

    it("Should use updated fee recipient for new deposits", async function () {
      // Change fee recipient
      await factory.connect(treasurer).setFeeRecipient(newFeeRecipient.address);
      
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      const initialOldBalance = await underlyingToken.balanceOf(feeRecipient.address);
      const initialNewBalance = await underlyingToken.balanceOf(newFeeRecipient.address);
      
      // Perform deposit
      await wrapper.connect(user1).deposit(depositAmount);
      
      // Check fee went to new recipient, not old
      expect(await underlyingToken.balanceOf(feeRecipient.address))
        .to.equal(initialOldBalance);
      expect(await underlyingToken.balanceOf(newFeeRecipient.address))
        .to.equal(initialNewBalance + expectedFee);
    });

    it("Should not affect wrapper's stored fee rate when factory rate changes", async function () {
      // Wrapper starts with factory's initial rate
      expect(await wrapper.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      
      // Change factory fee rate
      const newFactoryRate = 300;
      await factory.connect(operator).setDepositFeeRate(newFactoryRate);
      
      // Wrapper still uses its original rate
      expect(await wrapper.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      
      // But new wrappers use the new rate
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const anotherToken = await MockERC20WithPermitFactory.deploy(
        "Another Token",
        "ANOTHER",
        18,
        ethers.parseEther("1000000")
      );
      
      const tx = await factory.connect(user1).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factory.interface.parseLog(event!);
      const newWrapperAddress = parsedEvent!.args.wrapper;
      const newWrapper = await ethers.getContractAt("ERC20Wrapped", newWrapperAddress);
      
      expect(await newWrapper.depositFeeRate()).to.equal(newFactoryRate);
    });

    it("Should handle zero fee rate correctly", async function () {
      // Set fee rate to zero
      await factory.connect(operator).setDepositFeeRate(0);
      
      // Create new wrapper with zero fee
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const anotherToken = await MockERC20WithPermitFactory.deploy(
        "Another Token",
        "ANOTHER",
        18,
        ethers.parseEther("1000000")
      );
      
      const tx = await factory.connect(user1).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factory.interface.parseLog(event!);
      const zeroFeeWrapperAddress = parsedEvent!.args.wrapper;
      const zeroFeeWrapper = await ethers.getContractAt("ERC20Wrapped", zeroFeeWrapperAddress);
      
      // Setup for deposit
      await anotherToken.mint(user1.address, ethers.parseEther("1000"));
      await anotherToken.connect(user1).approve(zeroFeeWrapperAddress, ethers.parseEther("1000"));
      
      const depositAmount = ethers.parseEther("100");
      const initialRecipientBalance = await anotherToken.balanceOf(newFeeRecipient.address);
      
      // Deposit with zero fee
      await zeroFeeWrapper.connect(user1).deposit(depositAmount);
      
      // No fee should be charged
      expect(await anotherToken.balanceOf(newFeeRecipient.address))
        .to.equal(initialRecipientBalance);
      
      // Full amount should be wrapped
      expect(await zeroFeeWrapper.balanceOf(user1.address)).to.equal(depositAmount);
    });
  });

  describe("Fee Configuration Scenarios", function () {
    it("Should handle multiple fee changes", async function () {
      const rates = [0, 100, 500, 1000, 50];
      
      for (let i = 0; i < rates.length; i++) {
        const currentRate = i === 0 ? INITIAL_FEE_RATE : rates[i - 1];
        const newRate = rates[i];
        
        await expect(
          factory.connect(operator).setDepositFeeRate(newRate)
        ).to.emit(factory, "DepositFeeRateUpdated")
          .withArgs(currentRate, newRate);
        
        const [, factoryRate, ] = await factory.getFactoryInfo();
        expect(factoryRate).to.equal(newRate);
      }
    });

    it("Should handle multiple recipient changes", async function () {
      const recipients = [newFeeRecipient, user1, user2, admin];
      let currentRecipient = feeRecipient.address;
      
      for (const recipient of recipients) {
        await expect(
          factory.connect(treasurer).setFeeRecipient(recipient.address)
        ).to.emit(factory, "FeeRecipientUpdated")
          .withArgs(currentRecipient, recipient.address);
        
        const [factoryRecipient, , ] = await factory.getFactoryInfo();
        expect(factoryRecipient).to.equal(recipient.address);
        
        currentRecipient = recipient.address;
      }
    });

    it("Should work with edge case fee rates", async function () {
      // Test minimum rate (0)
      await factory.connect(operator).setDepositFeeRate(0);
      let [, rate, ] = await factory.getFactoryInfo();
      expect(rate).to.equal(0);
      
      // Test 1 basis point (0.01%)
      await factory.connect(operator).setDepositFeeRate(1);
      [, rate, ] = await factory.getFactoryInfo();
      expect(rate).to.equal(1);
      
      // Test maximum rate (10%)
      await factory.connect(operator).setDepositFeeRate(1000);
      [, rate, ] = await factory.getFactoryInfo();
      expect(rate).to.equal(1000);
    });
  });

  describe("Fee Information Queries", function () {
    it("Should return accurate factory info", async function () {
      const [recipient, feeRate, wrapperCount] = await factory.getFactoryInfo();
      
      expect(recipient).to.equal(feeRecipient.address);
      expect(feeRate).to.equal(INITIAL_FEE_RATE);
      expect(wrapperCount).to.equal(0);
      
      // Create a wrapper and check count
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const [, , newWrapperCount] = await factory.getFactoryInfo();
      expect(newWrapperCount).to.equal(1);
    });

    it("Should update factory info after changes", async function () {
      // Change both recipient and rate
      await factory.connect(treasurer).setFeeRecipient(newFeeRecipient.address);
      await factory.connect(operator).setDepositFeeRate(500);
      
      const [recipient, feeRate, wrapperCount] = await factory.getFactoryInfo();
      
      expect(recipient).to.equal(newFeeRecipient.address);
      expect(feeRate).to.equal(500);
      expect(wrapperCount).to.equal(0);
    });
  });
});
