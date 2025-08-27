import { expect } from "chai";
import { ethers } from "hardhat";
import { WrapperFactory, MockERC20WithPermit, ERC20Wrapped } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WrapperFactory - Create Wrappers (Task 3.2)", function () {
  let factory: WrapperFactory;
  let underlyingToken: MockERC20WithPermit;
  let anotherToken: MockERC20WithPermit;
  let admin: SignerWithAddress;
  let treasurer: SignerWithAddress;
  let operator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  
  const INITIAL_FEE_RATE = 150; // 1.5% en basis points
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const WRAPPED_NAME = "Wrapped Test Token";
  const WRAPPED_SYMBOL = "wTEST";
  
  beforeEach(async function () {
    [admin, treasurer, operator, feeRecipient, user1, user2] = await ethers.getSigners();
    
    // Deploy factory
    const WrapperFactoryFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactoryFactory.deploy(
      admin.address,
      treasurer.address,
      operator.address,
      feeRecipient.address,
      INITIAL_FEE_RATE
    );
    
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

  describe("Wrapper Creation", function () {
    it("Should create wrapper successfully", async function () {
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
      
      expect(event).to.not.be.undefined;
      
      // Parse the event
      const parsedEvent = factory.interface.parseLog(event!);
      const wrapperAddress = parsedEvent!.args.wrapper;
      
      // Verify wrapper is registered
      const [exists, registeredWrapper] = await factory.hasWrapper(await underlyingToken.getAddress());
      expect(exists).to.be.true;
      expect(registeredWrapper).to.equal(wrapperAddress);
      
      // Verify wrapper in allWrappers array
      expect(await factory.getWrapperAt(0)).to.equal(wrapperAddress);
      
      // Verify total count
      const [, , totalWrappers] = await factory.getFactoryInfo();
      expect(totalWrappers).to.equal(1);
    });

    it("Should emit WrapperCreated event with correct parameters", async function () {
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
      
      expect(event).to.not.be.undefined;
      
      const parsedEvent = factory.interface.parseLog(event!);
      expect(parsedEvent!.args.underlying).to.equal(await underlyingToken.getAddress());
      expect(parsedEvent!.args.feeRate).to.equal(INITIAL_FEE_RATE);
      expect(parsedEvent!.args.creator).to.equal(user1.address);
      expect(parsedEvent!.args.wrapper).to.not.equal(ethers.ZeroAddress);
    });

    it("Should configure wrapper with current factory parameters", async function () {
      // Create wrapper
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
      const wrapperAddress = parsedEvent!.args.wrapper;
      
      // Get wrapper contract instance
      const wrapper = await ethers.getContractAt("ERC20Wrapped", wrapperAddress);
      
      // Verify wrapper configuration
      expect(await wrapper.underlying()).to.equal(await underlyingToken.getAddress());
      expect(await wrapper.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      expect(await wrapper.factory()).to.equal(await factory.getAddress());
      expect(await wrapper.name()).to.equal(WRAPPED_NAME);
      expect(await wrapper.symbol()).to.equal(WRAPPED_SYMBOL);
      expect(await wrapper.decimals()).to.equal(18);
      expect(await wrapper.totalSupply()).to.equal(0);
    });

    it("Should allow anyone to create wrappers", async function () {
      // User1 creates wrapper
      await expect(
        factory.connect(user1).createWrapper(
          await underlyingToken.getAddress(),
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.not.be.reverted;
      
      // User2 creates another wrapper
      await expect(
        factory.connect(user2).createWrapper(
          await anotherToken.getAddress(),
          "Wrapped Another",
          "wANOTHER"
        )
      ).to.not.be.reverted;
      
      // Even admin can create
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const thirdToken = await MockERC20WithPermitFactory.deploy(
        "Third Token",
        "THIRD",
        18,
        ethers.parseEther("100000")
      );
      
      await expect(
        factory.connect(admin).createWrapper(
          await thirdToken.getAddress(),
          "Wrapped Third",
          "wTHIRD"
        )
      ).to.not.be.reverted;
      
      // Verify all three wrappers exist
      const [, , totalWrappers] = await factory.getFactoryInfo();
      expect(totalWrappers).to.equal(3);
    });

    it("Should maintain registry mapping correctly", async function () {
      // Create multiple wrappers
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      await factory.connect(user2).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      // Check first wrapper
      const [exists1, wrapper1] = await factory.hasWrapper(await underlyingToken.getAddress());
      expect(exists1).to.be.true;
      expect(wrapper1).to.not.equal(ethers.ZeroAddress);
      
      // Check second wrapper
      const [exists2, wrapper2] = await factory.hasWrapper(await anotherToken.getAddress());
      expect(exists2).to.be.true;
      expect(wrapper2).to.not.equal(ethers.ZeroAddress);
      
      // Wrappers should be different
      expect(wrapper1).to.not.equal(wrapper2);
      
      // Check array access
      expect(await factory.getWrapperAt(0)).to.equal(wrapper1);
      expect(await factory.getWrapperAt(1)).to.equal(wrapper2);
    });
  });

  describe("Wrapper Creation Validations", function () {
    it("Should revert if underlying token is zero address", async function () {
      await expect(
        factory.connect(user1).createWrapper(
          ethers.ZeroAddress,
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.be.revertedWithCustomError(factory, "InvalidUnderlyingToken");
    });

    it("Should revert if wrapper already exists (uniqueness)", async function () {
      // Create first wrapper
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      // Try to create another wrapper for same underlying token
      await expect(
        factory.connect(user2).createWrapper(
          await underlyingToken.getAddress(),
          "Different Name",
          "DIFF"
        )
      ).to.be.revertedWithCustomError(factory, "WrapperAlreadyExists");
    });

    it("Should revert when factory is paused", async function () {
      // Pause factory
      await factory.connect(admin).pause();
      
      await expect(
        factory.connect(user1).createWrapper(
          await underlyingToken.getAddress(),
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.be.revertedWithCustomError(factory, "EnforcedPause");
    });

    it("Should work when factory is unpaused", async function () {
      // Pause and then unpause
      await factory.connect(admin).pause();
      await factory.connect(admin).unpause();
      
      await expect(
        factory.connect(user1).createWrapper(
          await underlyingToken.getAddress(),
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.not.be.reverted;
    });
  });

  describe("Wrapper Integration", function () {
    it("Should create functional wrapper that can handle deposits", async function () {
      // Create wrapper
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
      const wrapperAddress = parsedEvent!.args.wrapper;
      const wrapper = await ethers.getContractAt("ERC20Wrapped", wrapperAddress);
      
      // Give user1 some tokens
      await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
      
      // Approve wrapper to spend tokens
      await underlyingToken.connect(user1).approve(wrapperAddress, ethers.parseEther("100"));
      
      // Perform deposit
      const depositAmount = ethers.parseEther("100");
      await wrapper.connect(user1).deposit(depositAmount);
      
      // Check results
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;
      
      expect(await wrapper.balanceOf(user1.address)).to.equal(expectedWrapped);
      expect(await wrapper.totalSupply()).to.equal(expectedWrapped);
      expect(await underlyingToken.balanceOf(wrapperAddress)).to.equal(expectedWrapped);
    });

    it("Should integrate properly with factory fee recipient", async function () {
      // Create wrapper
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
      const wrapperAddress = parsedEvent!.args.wrapper;
      const wrapper = await ethers.getContractAt("ERC20Wrapped", wrapperAddress);
      
      // Setup deposit
      await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
      await underlyingToken.connect(user1).approve(wrapperAddress, ethers.parseEther("100"));
      
      // Perform deposit
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      
      const initialFeeRecipientBalance = await underlyingToken.balanceOf(feeRecipient.address);
      
      await wrapper.connect(user1).deposit(depositAmount);
      
      // Check fee was sent to correct recipient
      expect(await underlyingToken.balanceOf(feeRecipient.address))
        .to.equal(initialFeeRecipientBalance + expectedFee);
    });
  });

  describe("Fee Rate Changes", function () {
    it("Should not affect wrappers already created when fee rate changes", async function () {
      // Create wrapper with initial fee rate
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      const [, wrapper1] = await factory.hasWrapper(await underlyingToken.getAddress());
      const wrapper1Contract = await ethers.getContractAt("ERC20Wrapped", wrapper1);
      
      // Change fee rate in factory
      const newFeeRate = 300; // 3%
      await factory.connect(operator).setDepositFeeRate(newFeeRate);
      
      // Create another wrapper with new fee rate
      await factory.connect(user2).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      const [, wrapper2] = await factory.hasWrapper(await anotherToken.getAddress());
      const wrapper2Contract = await ethers.getContractAt("ERC20Wrapped", wrapper2);
      
      // Check that old wrapper still has old fee rate
      expect(await wrapper1Contract.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      
      // Check that new wrapper has new fee rate
      expect(await wrapper2Contract.depositFeeRate()).to.equal(newFeeRate);
    });
  });

  describe("Array and Index Management", function () {
    it("Should handle getWrapperAt with valid indices", async function () {
      // Create three wrappers
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      await factory.connect(user1).createWrapper(
        await anotherToken.getAddress(),
        "Wrapped Another",
        "wANOTHER"
      );
      
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const thirdToken = await MockERC20WithPermitFactory.deploy(
        "Third Token",
        "THIRD",
        18,
        ethers.parseEther("100000")
      );
      
      await factory.connect(user1).createWrapper(
        await thirdToken.getAddress(),
        "Wrapped Third",
        "wTHIRD"
      );
      
      // Check all indices work
      const wrapper0 = await factory.getWrapperAt(0);
      const wrapper1 = await factory.getWrapperAt(1);
      const wrapper2 = await factory.getWrapperAt(2);
      
      expect(wrapper0).to.not.equal(ethers.ZeroAddress);
      expect(wrapper1).to.not.equal(ethers.ZeroAddress);
      expect(wrapper2).to.not.equal(ethers.ZeroAddress);
      
      // All should be different
      expect(wrapper0).to.not.equal(wrapper1);
      expect(wrapper1).to.not.equal(wrapper2);
      expect(wrapper0).to.not.equal(wrapper2);
      
      // Check total count
      const [, , totalWrappers] = await factory.getFactoryInfo();
      expect(totalWrappers).to.equal(3);
    });

    it("Should revert getWrapperAt with invalid index", async function () {
      // No wrappers created yet
      try {
        await factory.getWrapperAt(0);
        expect.fail("Should have reverted");
      } catch (error: any) {
        expect(error.message).to.include("index out of bounds");
      }
      
      // Create one wrapper
      await factory.connect(user1).createWrapper(
        await underlyingToken.getAddress(),
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      // Index 0 should work
      const wrapper0 = await factory.getWrapperAt(0);
      expect(wrapper0).to.not.equal(ethers.ZeroAddress);
      
      // Index 1 should fail
      try {
        await factory.getWrapperAt(1);
        expect.fail("Should have reverted");
      } catch (error: any) {
        expect(error.message).to.include("index out of bounds");
      }
    });
  });
});
