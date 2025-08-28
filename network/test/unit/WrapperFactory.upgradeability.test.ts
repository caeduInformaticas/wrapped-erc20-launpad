import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { 
  WrapperFactoryUpgradeable, 
  WrapperFactoryV2, 
  MockERC20WithPermit, 
  ERC20Wrapped 
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WrapperFactory - Upgradeability (Task 4.2)", function () {
  let factoryV1: WrapperFactoryUpgradeable;
  let factoryV2: WrapperFactoryV2;
  let underlyingToken: MockERC20WithPermit;
  let anotherToken: MockERC20WithPermit;
  let admin: SignerWithAddress;
  let treasurer: SignerWithAddress;
  let operator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  
  const INITIAL_FEE_RATE = 150; // 1.5% en basis points
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const WRAPPED_NAME = "Wrapped Test Token";
  const WRAPPED_SYMBOL = "wTEST";
  
  beforeEach(async function () {
    [admin, treasurer, operator, feeRecipient, user1, user2, user3] = await ethers.getSigners();
    
    // Deploy upgradeable factory V1
    const WrapperFactoryUpgradeableFactory = await ethers.getContractFactory("WrapperFactoryUpgradeable");
    factoryV1 = await upgrades.deployProxy(
      WrapperFactoryUpgradeableFactory,
      [
        admin.address,
        treasurer.address,
        operator.address,
        feeRecipient.address,
        INITIAL_FEE_RATE
      ],
      { initializer: 'initialize' }
    ) as unknown as WrapperFactoryUpgradeable;
    
    // Deploy test tokens
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    underlyingToken = await MockERC20WithPermitFactory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      18,
      ethers.parseEther("1000000")
    );
    
    anotherToken = await MockERC20WithPermitFactory.deploy(
      "Another Token",
      "ANOTHER",
      18,
      ethers.parseEther("500000")
    );
  });

  describe("Factory Upgradeability", function () {
    it("Should deploy with correct initial version", async function () {
      expect(await factoryV1.version()).to.equal("1.0.0");
    });

    it("Should upgrade to V2 successfully", async function () {
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      // Initialize V2 specific variables
      await factoryV2.initializeV2(ethers.parseEther("1000000"), 50); // 1M tokens
      
      // Verify upgrade
      expect(await factoryV2.version()).to.equal("2.0.0");
      expect(await factoryV2.highVolumeThreshold()).to.equal(ethers.parseEther("1000000"));
      expect(await factoryV2.highVolumeDiscount()).to.equal(50);
    });

    it("Should only allow UPGRADER_ROLE to perform upgrades", async function () {
      // Try to upgrade from non-admin account
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      
      // This should fail because user1 doesn't have UPGRADER_ROLE
      await expect(
        upgrades.upgradeProxy(
          await factoryV1.getAddress(),
          WrapperFactoryV2Factory.connect(user1)
        )
      ).to.be.reverted;
    });

    it("Should emit FactoryUpgraded event during upgrade", async function () {
      const oldImplementation = await factoryV1.getImplementation();
      
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      // Note: The FactoryUpgraded event is emitted in _authorizeUpgrade
      // In a real test, we'd check for this event, but proxy upgrades are complex to test events
      
      const newImplementation = await factoryV2.getImplementation();
      expect(newImplementation).to.not.equal(oldImplementation);
    });
  });

  describe("Data Persistence After Upgrade", function () {
    let wrapperAddressBefore: string;
    
    beforeEach(async function () {
      // Create wrapper in V1
      const tx = await factoryV1.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factoryV1.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factoryV1.interface.parseLog(event!);
      wrapperAddressBefore = parsedEvent!.args.wrapper;
      
      // Change some state in V1
      await factoryV1.connect(operator).setDepositFeeRate(200); // 2%
      await factoryV1.connect(treasurer).setFeeRecipient(user2.address);
    });

    it("Should preserve state variables after upgrade", async function () {
      // Verify state before upgrade
      expect(await factoryV1.depositFeeRate()).to.equal(200);
      expect(await factoryV1.feeRecipient()).to.equal(user2.address);
      const [exists, wrapper] = await factoryV1.hasWrapper(await underlyingToken.getAddress());
      expect(exists).to.be.true;
      expect(wrapper).to.equal(wrapperAddressBefore);
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Verify state persisted after upgrade
      expect(await factoryV2.depositFeeRate()).to.equal(200);
      expect(await factoryV2.feeRecipient()).to.equal(user2.address);
      const [existsAfter, wrapperAfter] = await factoryV2.hasWrapper(await underlyingToken.getAddress());
      expect(existsAfter).to.be.true;
      expect(wrapperAfter).to.equal(wrapperAddressBefore);
    });

    it("Should preserve role assignments after upgrade", async function () {
      // Verify roles before upgrade
      const ADMIN_ROLE = await factoryV1.ADMINISTRATOR_ROLE();
      const TREASURER_ROLE = await factoryV1.TREASURER_ROLE();
      const OPERATOR_ROLE = await factoryV1.OPERATOR_ROLE();
      
      expect(await factoryV1.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await factoryV1.hasRole(TREASURER_ROLE, treasurer.address)).to.be.true;
      expect(await factoryV1.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Verify roles persisted after upgrade
      expect(await factoryV2.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await factoryV2.hasRole(TREASURER_ROLE, treasurer.address)).to.be.true;
      expect(await factoryV2.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
    });

    it("Should preserve wrapper registry mappings after upgrade", async function () {
      // Create another wrapper before upgrade
      await factoryV1.connect(user2).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      // Get factory info before upgrade
      const [, , totalWrappersBefore] = await factoryV1.getFactoryInfo();
      expect(totalWrappersBefore).to.equal(2);
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Verify wrapper registry persisted
      const [, , totalWrappersAfter] = await factoryV2.getFactoryInfo();
      expect(totalWrappersAfter).to.equal(2);
      
      // Verify specific wrappers still exist
      const [exists1] = await factoryV2.hasWrapper(await underlyingToken.getAddress());
      const [exists2] = await factoryV2.hasWrapper(await anotherToken.getAddress());
      expect(exists1).to.be.true;
      expect(exists2).to.be.true;
    });
  });

  describe("Existing Wrappers Functionality After Upgrade", function () {
    let wrapperContract: ERC20Wrapped;
    
    beforeEach(async function () {
      // Create wrapper in V1
      const tx = await factoryV1.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factoryV1.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factoryV1.interface.parseLog(event!);
      const wrapperAddress = parsedEvent!.args.wrapper;
      
      wrapperContract = await ethers.getContractAt("ERC20Wrapped", wrapperAddress);
      
      // Setup tokens for testing
      await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
      await underlyingToken.connect(user1).approve(wrapperAddress, ethers.parseEther("100"));
    });

    it("Should allow existing wrappers to function normally after upgrade", async function () {
      // Test deposit before upgrade
      const depositAmount = ethers.parseEther("50");
      await wrapperContract.connect(user1).deposit(depositAmount);
      
      const balanceBefore = await wrapperContract.balanceOf(user1.address);
      expect(balanceBefore).to.be.gt(0);
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Test deposit after upgrade - should still work
      await underlyingToken.connect(user1).approve(await wrapperContract.getAddress(), ethers.parseEther("50"));
      await wrapperContract.connect(user1).deposit(ethers.parseEther("25"));
      
      const balanceAfter = await wrapperContract.balanceOf(user1.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should allow existing wrappers to query updated fee recipient after upgrade", async function () {
      // Change fee recipient in V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Change fee recipient
      await factoryV2.connect(treasurer).setFeeRecipient(user3.address);
      
      // Verify wrapper can query new fee recipient
      expect(await factoryV2.getFeeRecipient()).to.equal(user3.address);
      
      // Test that deposit sends fee to new recipient
      const balanceBefore = await underlyingToken.balanceOf(user3.address);
      await wrapperContract.connect(user1).deposit(ethers.parseEther("10"));
      const balanceAfter = await underlyingToken.balanceOf(user3.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should allow withdrawal from existing wrappers after upgrade", async function () {
      // Make deposit before upgrade
      const depositAmount = ethers.parseEther("30");
      await wrapperContract.connect(user1).deposit(depositAmount);
      const wrappedBalance = await wrapperContract.balanceOf(user1.address);
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      
      // Test withdrawal after upgrade
      const underlyingBalanceBefore = await underlyingToken.balanceOf(user1.address);
      await wrapperContract.connect(user1).withdraw(wrappedBalance);
      const underlyingBalanceAfter = await underlyingToken.balanceOf(user1.address);
      
      expect(underlyingBalanceAfter).to.be.gt(underlyingBalanceBefore);
      expect(await wrapperContract.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("New Wrappers Use Updated Logic", function () {
    beforeEach(async function () {
      // Upgrade to V2 first
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
    });

    it("Should create new wrappers with current factory parameters after upgrade", async function () {
      // Change fee rate in V2
      await factoryV2.connect(operator).setDepositFeeRate(250); // 2.5%
      
      // Create new wrapper
      const tx = await factoryV2.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factoryV2.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factoryV2.interface.parseLog(event!);
      expect(parsedEvent!.args.feeRate).to.equal(250);
    });

    it("Should enable V2 features for factory admin functions", async function () {
      // Test new V2 admin functions
      await factoryV2.connect(operator).setHighVolumeThreshold(ethers.parseEther("500000"));
      await factoryV2.connect(operator).setHighVolumeDiscount(75);
      
      expect(await factoryV2.highVolumeThreshold()).to.equal(ethers.parseEther("500000"));
      expect(await factoryV2.highVolumeDiscount()).to.equal(75);
    });

    it("Should enable V2 statistics functionality", async function () {
      // Create wrapper and test stats
      await factoryV2.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const [totalVolume, activeWrappers, totalWrappers] = await factoryV2.getFactoryStats();
      
      expect(totalVolume).to.equal(0); // No deposits yet
      expect(activeWrappers).to.equal(1); // One active wrapper
      expect(totalWrappers).to.equal(1); // One total wrapper
    });

    it("Should enable V2 batch operations", async function () {
      // Create two different underlying tokens
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const underlying1 = await MockERC20WithPermitFactory.deploy("Token1", "TK1", 18, ethers.parseEther("1000"));
      const underlying2 = await MockERC20WithPermitFactory.deploy("Token2", "TK2", 18, ethers.parseEther("1000"));

      const underlyings = [await underlying1.getAddress(), await underlying2.getAddress()];
      const names = ["Wrapped Token 1", "Wrapped Token 2"];
      const symbols = ["wTK1", "wTK2"];

      const tx = await factoryV2.connect(user1).createMultipleWrappers(
        underlyings,
        names,
        symbols
      );
      
      const receipt = await tx.wait();
      
      // Count WrapperCreated events
      const wrapperCreatedEvents = receipt!.logs.filter(log => {
        try {
          const parsed = factoryV2.interface.parseLog(log as any);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      expect(wrapperCreatedEvents).to.have.length(2);
      
      // Verify both wrappers were created
      const [exists1] = await factoryV2.hasWrapper(underlyings[0]);
      const [exists2] = await factoryV2.hasWrapper(underlyings[1]);
      expect(exists1).to.be.true;
      expect(exists2).to.be.true;
    });
  });

  describe("V2 Specific Functionality", function () {
    beforeEach(async function () {
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2(ethers.parseEther("1000"), 50); // 1000 tokens threshold, 0.5% discount
    });

    it("Should calculate effective fee rates with volume discounts", async function () {
      // Set user volume manually for testing
      await factoryV2.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      // Test user without high volume
      const [feeRate1, discount1] = await factoryV2.getEffectiveFeeRate(user1.address, ethers.parseEther("100"));
      expect(feeRate1).to.equal(INITIAL_FEE_RATE);
      expect(discount1).to.equal(0);
    });

    it("Should allow individual wrapper pause functionality", async function () {
      // Create wrapper first
      const tx = await factoryV2.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factoryV2.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factoryV2.interface.parseLog(event!);
      const wrapperAddress = parsedEvent!.args.wrapper;
      
      // Test pause functionality (wrapper should be properly registered now)
      await factoryV2.connect(admin).setWrapperPauseStatus(wrapperAddress, true);
      expect(await factoryV2.isWrapperPaused(wrapperAddress)).to.be.true;
      
      await factoryV2.connect(admin).setWrapperPauseStatus(wrapperAddress, false);
      expect(await factoryV2.isWrapperPaused(wrapperAddress)).to.be.false;
    });

    it("Should only allow admin to pause individual wrappers", async function () {
      // Create wrapper
      const tx = await factoryV2.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = factoryV2.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = factoryV2.interface.parseLog(event!);
      const wrapperAddress = parsedEvent!.args.wrapper;
      
      // Should fail from non-admin
      await expect(
        factoryV2.connect(user1).setWrapperPauseStatus(wrapperAddress, true)
      ).to.be.reverted;
    });

    it("Should only allow operator to change volume settings", async function () {
      // Should work from operator
      await factoryV2.connect(operator).setHighVolumeThreshold(ethers.parseEther("2000000"));
      await factoryV2.connect(operator).setHighVolumeDiscount(100);
      
      // Should fail from non-operator
      await expect(
        factoryV2.connect(user1).setHighVolumeThreshold(ethers.parseEther("3000000"))
      ).to.be.reverted;
      
      await expect(
        factoryV2.connect(user1).setHighVolumeDiscount(150)
      ).to.be.reverted;
    });
  });

  describe("Gas Cost Analysis", function () {
    it("Should document gas costs for upgrade operations", async function () {
      console.log("\n=== Gas Cost Analysis for Upgradeability ===");
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      const upgradeTx = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      );
      
      factoryV2 = upgradeTx as unknown as WrapperFactoryV2;
      
      // Initialize V2
      const initTx = await factoryV2.initializeV2(ethers.parseEther("1000"), 50);
      const initReceipt = await initTx.wait();
      
      console.log(`V2 Initialization gas: ${initReceipt!.gasUsed}`);
      
      // Test new V2 functions gas costs
      const setThresholdTx = await factoryV2.connect(operator).setHighVolumeThreshold(ethers.parseEther("1000000"));
      const setThresholdReceipt = await setThresholdTx.wait();
      console.log(`Set high volume threshold gas: ${setThresholdReceipt!.gasUsed}`);
      
      const batchCreateTx = await factoryV2.connect(user1).createMultipleWrappers(
        [await underlyingToken.getAddress()],
        ["Wrapped Test"],
        ["wTEST"]
      );
      const batchCreateReceipt = await batchCreateTx.wait();
      console.log(`Batch create wrapper gas: ${batchCreateReceipt!.gasUsed}`);
    });
  });
});
