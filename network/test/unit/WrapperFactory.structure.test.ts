import { expect } from "chai";
import { ethers } from "hardhat";
import { WrapperFactory, MockERC20WithPermit } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WrapperFactory - Structure and Roles (Task 3.1)", function () {
  let factory: WrapperFactory;
  let admin: SignerWithAddress;
  let treasurer: SignerWithAddress;
  let operator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  
  const INITIAL_FEE_RATE = 100; // 1% en basis points
  
  beforeEach(async function () {
    [admin, treasurer, operator, feeRecipient, user1, user2] = await ethers.getSigners();
    
    const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactoryFactory.deploy(
      admin.address,
      treasurer.address,
      operator.address,
      feeRecipient.address,
      INITIAL_FEE_RATE
    );
  });

  describe("Deployment", function () {
    it("Should set correct initial configuration", async function () {
      expect(await factory.feeRecipient()).to.equal(feeRecipient.address);
      expect(await factory.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      
      const [currentFeeRecipient, currentFeeRate, totalWrappers] = await factory.getFactoryInfo();
      expect(currentFeeRecipient).to.equal(feeRecipient.address);
      expect(currentFeeRate).to.equal(INITIAL_FEE_RATE);
      expect(totalWrappers).to.equal(0);
    });

    it("Should assign roles correctly at deploy", async function () {
      const ADMINISTRATOR_ROLE = await factory.ADMINISTRATOR_ROLE();
      const TREASURER_ROLE = await factory.TREASURER_ROLE();
      const OPERATOR_ROLE = await factory.OPERATOR_ROLE();
      const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
      
      expect(await factory.hasRole(ADMINISTRATOR_ROLE, admin.address)).to.be.true;
      expect(await factory.hasRole(TREASURER_ROLE, treasurer.address)).to.be.true;
      expect(await factory.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should set correct role admins", async function () {
      const ADMINISTRATOR_ROLE = await factory.ADMINISTRATOR_ROLE();
      const TREASURER_ROLE = await factory.TREASURER_ROLE();
      const OPERATOR_ROLE = await factory.OPERATOR_ROLE();
      
      expect(await factory.getRoleAdmin(TREASURER_ROLE)).to.equal(ADMINISTRATOR_ROLE);
      expect(await factory.getRoleAdmin(OPERATOR_ROLE)).to.equal(ADMINISTRATOR_ROLE);
    });

    it("Should have correct constants", async function () {
      expect(await factory.MAX_FEE_RATE()).to.equal(1000); // 10%
      expect(await factory.FEE_BASE()).to.equal(10000); // 100%
    });
  });

  describe("Deployment Validations", function () {
    it("Should revert with zero admin address", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      await expect(
        WrapperFactoryFactory.deploy(
          ethers.ZeroAddress,
          treasurer.address,
          operator.address,
          feeRecipient.address,
          INITIAL_FEE_RATE
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("Should revert with zero treasurer address", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      await expect(
        WrapperFactoryFactory.deploy(
          admin.address,
          ethers.ZeroAddress,
          operator.address,
          feeRecipient.address,
          INITIAL_FEE_RATE
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("Should revert with zero operator address", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      await expect(
        WrapperFactoryFactory.deploy(
          admin.address,
          treasurer.address,
          ethers.ZeroAddress,
          feeRecipient.address,
          INITIAL_FEE_RATE
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("Should revert with zero fee recipient address", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      await expect(
        WrapperFactoryFactory.deploy(
          admin.address,
          treasurer.address,
          operator.address,
          ethers.ZeroAddress,
          INITIAL_FEE_RATE
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("Should revert with fee rate too high", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      await expect(
        WrapperFactoryFactory.deploy(
          admin.address,
          treasurer.address,
          operator.address,
          feeRecipient.address,
          1001 // > MAX_FEE_RATE
        )
      ).to.be.revertedWithCustomError(factory, "InvalidFeeRate");
    });

    it("Should allow maximum fee rate", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      const maxRateFactory = await WrapperFactoryFactory.deploy(
        admin.address,
        treasurer.address,
        operator.address,
        feeRecipient.address,
        1000 // MAX_FEE_RATE
      );
      
      expect(await maxRateFactory.depositFeeRate()).to.equal(1000);
    });

    it("Should allow zero fee rate", async function () {
      const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
      
      const zeroRateFactory = await WrapperFactoryFactory.deploy(
        admin.address,
        treasurer.address,
        operator.address,
        feeRecipient.address,
        0 // Zero fee rate
      );
      
      expect(await zeroRateFactory.depositFeeRate()).to.equal(0);
    });
  });

  describe("Access Control", function () {
    it("Should only allow Administrator to change roles", async function () {
      const ADMINISTRATOR_ROLE = await factory.ADMINISTRATOR_ROLE();
      
      // Non-admin cannot change roles
      await expect(
        factory.connect(user1).updateTreasurer(user2.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      await expect(
        factory.connect(user1).updateOperator(user2.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      // Admin can change roles
      await expect(
        factory.connect(admin).updateTreasurer(user2.address)
      ).to.not.be.reverted;
    });

    it("Should only allow Treasurer to change fee recipient", async function () {
      // Non-treasurer cannot change fee recipient
      await expect(
        factory.connect(user1).setFeeRecipient(user2.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      await expect(
        factory.connect(admin).setFeeRecipient(user2.address)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      // Treasurer can change fee recipient
      await expect(
        factory.connect(treasurer).setFeeRecipient(user2.address)
      ).to.not.be.reverted;
      
      expect(await factory.feeRecipient()).to.equal(user2.address);
    });

    it("Should only allow Operator to change fee rate", async function () {
      // Non-operator cannot change fee rate
      await expect(
        factory.connect(user1).setDepositFeeRate(200)
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      // Operator can change fee rate
      await expect(
        factory.connect(operator).setDepositFeeRate(200)
      ).to.not.be.reverted;
      
      // Admin can also change fee rate
      await expect(
        factory.connect(admin).setDepositFeeRate(300)
      ).to.not.be.reverted;
      
      expect(await factory.depositFeeRate()).to.equal(300);
    });

    it("Should only allow Administrator to pause/unpause", async function () {
      // Non-admin cannot pause
      await expect(
        factory.connect(user1).pause()
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
      
      // Admin can pause and unpause
      await expect(
        factory.connect(admin).pause()
      ).to.not.be.reverted;
      
      expect(await factory.paused()).to.be.true;
      
      await expect(
        factory.connect(admin).unpause()
      ).to.not.be.reverted;
      
      expect(await factory.paused()).to.be.false;
    });
  });

  describe("Role Updates", function () {
    it("Should update Administrator correctly", async function () {
      const ADMINISTRATOR_ROLE = await factory.ADMINISTRATOR_ROLE();
      const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
      
      await expect(
        factory.connect(admin).updateAdministrator(user1.address)
      ).to.emit(factory, "AdministratorUpdated")
        .withArgs(admin.address, user1.address);
      
      // Old admin should lose roles
      expect(await factory.hasRole(ADMINISTRATOR_ROLE, admin.address)).to.be.false;
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.false;
      
      // New admin should have roles
      expect(await factory.hasRole(ADMINISTRATOR_ROLE, user1.address)).to.be.true;
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.true;
    });

    it("Should update Treasurer correctly", async function () {
      const TREASURER_ROLE = await factory.TREASURER_ROLE();
      
      await expect(
        factory.connect(admin).updateTreasurer(user1.address)
      ).to.emit(factory, "TreasurerUpdated")
        .withArgs(treasurer.address, user1.address);
      
      expect(await factory.hasRole(TREASURER_ROLE, treasurer.address)).to.be.false;
      expect(await factory.hasRole(TREASURER_ROLE, user1.address)).to.be.true;
    });

    it("Should update Operator correctly", async function () {
      const OPERATOR_ROLE = await factory.OPERATOR_ROLE();
      
      await expect(
        factory.connect(admin).updateOperator(user1.address)
      ).to.emit(factory, "OperatorUpdated")
        .withArgs(operator.address, user1.address);
      
      expect(await factory.hasRole(OPERATOR_ROLE, operator.address)).to.be.false;
      expect(await factory.hasRole(OPERATOR_ROLE, user1.address)).to.be.true;
    });

    it("Should revert role updates with zero address", async function () {
      await expect(
        factory.connect(admin).updateAdministrator(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      
      await expect(
        factory.connect(admin).updateTreasurer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      
      await expect(
        factory.connect(admin).updateOperator(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  describe("Fee Management", function () {
    it("Should emit events for role changes", async function () {
      await expect(
        factory.connect(admin).updateTreasurer(user1.address)
      ).to.emit(factory, "TreasurerUpdated")
        .withArgs(treasurer.address, user1.address);
      
      await expect(
        factory.connect(admin).updateOperator(user1.address)
      ).to.emit(factory, "OperatorUpdated")
        .withArgs(operator.address, user1.address);
    });

    it("Should emit event when fee recipient changes", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(user1.address)
      ).to.emit(factory, "FeeRecipientUpdated")
        .withArgs(feeRecipient.address, user1.address);
    });

    it("Should emit event when fee rate changes", async function () {
      await expect(
        factory.connect(operator).setDepositFeeRate(200)
      ).to.emit(factory, "DepositFeeRateUpdated")
        .withArgs(INITIAL_FEE_RATE, 200);
    });

    it("Should validate fee recipient is not zero address", async function () {
      await expect(
        factory.connect(treasurer).setFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidFeeRecipient");
    });

    it("Should validate fee rate is within limits", async function () {
      await expect(
        factory.connect(operator).setDepositFeeRate(1001)
      ).to.be.revertedWithCustomError(factory, "FeeRateTooHigh");
      
      // Should allow maximum rate
      await expect(
        factory.connect(operator).setDepositFeeRate(1000)
      ).to.not.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should return correct fee recipient", async function () {
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient.address);
      
      // Change it and verify
      await factory.connect(treasurer).setFeeRecipient(user1.address);
      expect(await factory.getFeeRecipient()).to.equal(user1.address);
    });

    it("Should return correct factory info", async function () {
      const [currentFeeRecipient, currentFeeRate, totalWrappers] = await factory.getFactoryInfo();
      
      expect(currentFeeRecipient).to.equal(feeRecipient.address);
      expect(currentFeeRate).to.equal(INITIAL_FEE_RATE);
      expect(totalWrappers).to.equal(0);
    });

    it("Should handle wrapper queries when no wrappers exist", async function () {
      const [exists, wrapper] = await factory.hasWrapper(user1.address);
      expect(exists).to.be.false;
      expect(wrapper).to.equal(ethers.ZeroAddress);
      
      await expect(
        factory.getWrapperAt(0)
      ).to.be.revertedWith("WrapperFactory: index out of bounds");
    });
  });

  describe("Pausable Functionality", function () {
    it("Should start unpaused", async function () {
      expect(await factory.paused()).to.be.false;
    });

    it("Should emit events when pausing/unpausing", async function () {
      await expect(
        factory.connect(admin).pause()
      ).to.emit(factory, "Paused")
        .withArgs(admin.address);
      
      await expect(
        factory.connect(admin).unpause()
      ).to.emit(factory, "Unpaused")
        .withArgs(admin.address);
    });
  });
});
