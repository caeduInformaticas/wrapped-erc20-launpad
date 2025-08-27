import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20Wrapped, MockERC20, MockERC20WithPermit } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ERC20Wrapped - Structure Base", function () {
  let wrappedToken: ERC20Wrapped;
  let underlyingToken: MockERC20;
  let underlyingTokenWithPermit: MockERC20WithPermit;
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
    
    // Deploy underlying tokens (sin permit y con permit)
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    underlyingToken = await MockERC20Factory.deploy(
      UNDERLYING_NAME,
      UNDERLYING_SYMBOL,
      UNDERLYING_DECIMALS,
      UNDERLYING_SUPPLY
    );
    
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    underlyingTokenWithPermit = await MockERC20WithPermitFactory.deploy(
      UNDERLYING_NAME + " With Permit",
      UNDERLYING_SYMBOL + "P",
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
  });

  describe("Deployment", function () {
    it("Should set correct token metadata", async function () {
      expect(await wrappedToken.name()).to.equal(WRAPPED_NAME);
      expect(await wrappedToken.symbol()).to.equal(WRAPPED_SYMBOL);
      expect(await wrappedToken.decimals()).to.equal(18); // Default ERC20 decimals
    });

    it("Should set correct immutable parameters", async function () {
      expect(await wrappedToken.underlying()).to.equal(await underlyingToken.getAddress());
      expect(await wrappedToken.depositFeeRate()).to.equal(DEPOSIT_FEE_RATE);
      expect(await wrappedToken.factory()).to.equal(fakeFactory.address);
    });

    it("Should initialize with zero supply", async function () {
      expect(await wrappedToken.totalSupply()).to.equal(0);
      expect(await wrappedToken.getReserves()).to.equal(0);
    });

    it("Should have correct constants", async function () {
      expect(await wrappedToken.MAX_FEE_RATE()).to.equal(1000); // 10%
      expect(await wrappedToken.FEE_BASE()).to.equal(10000); // 100%
    });

    it("Should return correct wrapper info", async function () {
      const [underlyingAddr, feeRate, factoryAddr] = await wrappedToken.getWrapperInfo();
      
      expect(underlyingAddr).to.equal(await underlyingToken.getAddress());
      expect(feeRate).to.equal(DEPOSIT_FEE_RATE);
      expect(factoryAddr).to.equal(fakeFactory.address);
    });
  });

  describe("Deployment Validations", function () {
    let ERC20WrappedFactory: any;

    beforeEach(async function () {
      ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
    });

    it("Should revert with zero underlying address", async function () {
      await expect(
        ERC20WrappedFactory.deploy(
          ethers.ZeroAddress, // underlying = 0
          DEPOSIT_FEE_RATE,
          fakeFactory.address,
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.be.revertedWithCustomError(wrappedToken, "ZeroAddress");
    });

    it("Should revert with zero factory address", async function () {
      await expect(
        ERC20WrappedFactory.deploy(
          await underlyingToken.getAddress(),
          DEPOSIT_FEE_RATE,
          ethers.ZeroAddress, // factory = 0
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.be.revertedWithCustomError(wrappedToken, "ZeroAddress");
    });

    it("Should revert with fee rate too high", async function () {
      const TOO_HIGH_FEE = 1001; // > MAX_FEE_RATE (1000)
      
      await expect(
        ERC20WrappedFactory.deploy(
          await underlyingToken.getAddress(),
          TOO_HIGH_FEE,
          fakeFactory.address,
          WRAPPED_NAME,
          WRAPPED_SYMBOL
        )
      ).to.be.revertedWithCustomError(wrappedToken, "InvalidFeeRate");
    });

    it("Should allow maximum fee rate", async function () {
      const MAX_FEE = 1000; // Exactly MAX_FEE_RATE
      
      const wrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        MAX_FEE,
        fakeFactory.address,
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      expect(await wrapper.depositFeeRate()).to.equal(MAX_FEE);
    });

    it("Should allow zero fee rate", async function () {
      const ZERO_FEE = 0;
      
      const wrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        ZERO_FEE,
        fakeFactory.address,
        WRAPPED_NAME,
        WRAPPED_SYMBOL
      );
      
      expect(await wrapper.depositFeeRate()).to.equal(ZERO_FEE);
    });
  });

  describe("Preview Functions", function () {
    describe("previewDeposit", function () {
      it("Should calculate correct amounts with fee", async function () {
        const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS); // 1000 TUSDC
        const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(depositAmount);
        
        const expectedFee = (depositAmount * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
        const expectedWrapped = depositAmount - expectedFee;
        
        expect(feeAmount).to.equal(expectedFee);
        expect(wrappedAmount).to.equal(expectedWrapped);
      });

      it("Should return zero for zero deposit", async function () {
        const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(0);
        
        expect(wrappedAmount).to.equal(0);
        expect(feeAmount).to.equal(0);
      });

      it("Should handle small amounts correctly", async function () {
        const smallAmount = 1; // 1 wei
        const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(smallAmount);
        
        // Con fee del 1%, 1 wei debería dar 0 fee y 1 wrapped (por redondeo)
        expect(feeAmount).to.equal(0);
        expect(wrappedAmount).to.equal(1);
      });

      it("Should handle large amounts correctly", async function () {
        const largeAmount = ethers.parseUnits("1000000", UNDERLYING_DECIMALS); // 1M TUSDC
        const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(largeAmount);
        
        const expectedFee = largeAmount / BigInt(100); // 1%
        const expectedWrapped = largeAmount - expectedFee;
        
        expect(feeAmount).to.equal(expectedFee);
        expect(wrappedAmount).to.equal(expectedWrapped);
      });
    });

    describe("previewWithdraw", function () {
      it("Should return 1:1 ratio (no fee on withdrawal)", async function () {
        const withdrawAmount = ethers.parseEther("500");
        const underlyingAmount = await wrappedToken.previewWithdraw(withdrawAmount);
        
        expect(underlyingAmount).to.equal(withdrawAmount);
      });

      it("Should handle zero withdrawal", async function () {
        const underlyingAmount = await wrappedToken.previewWithdraw(0);
        expect(underlyingAmount).to.equal(0);
      });

      it("Should handle large withdrawals", async function () {
        const largeAmount = ethers.parseEther("1000000");
        const underlyingAmount = await wrappedToken.previewWithdraw(largeAmount);
        
        expect(underlyingAmount).to.equal(largeAmount);
      });
    });
  });

  describe("Invariant Check", function () {
    it("Should start with healthy invariant", async function () {
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      
      expect(isHealthy).to.be.true;
      expect(reserves).to.equal(0);
      expect(supply).to.equal(0);
    });

    it("Should maintain invariant concept (reserves >= supply)", async function () {
      // Simular que el contrato tiene reserves pero no supply (escenario post-withdrawal)
      await underlyingToken.mint(await wrappedToken.getAddress(), ethers.parseUnits("100", UNDERLYING_DECIMALS));
      
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      
      expect(isHealthy).to.be.true; // 100 reserves >= 0 supply
      expect(reserves).to.equal(ethers.parseUnits("100", UNDERLYING_DECIMALS));
      expect(supply).to.equal(0);
    });
  });

  describe("Helper Functions Coverage", function () {
    it("Should have internal validation functions (tested through deployment)", async function () {
      // Las funciones _validateNonZeroAmount y _validateNonZeroAddress
      // se testean indirectamente a través de las validaciones de deployment
      
      // Verificar que las validaciones están funcionando
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      
      await expect(
        ERC20WrappedFactory.deploy(ethers.ZeroAddress, DEPOSIT_FEE_RATE, fakeFactory.address, WRAPPED_NAME, WRAPPED_SYMBOL)
      ).to.be.revertedWithCustomError(wrappedToken, "ZeroAddress");
    });
  });

  describe("Placeholder Functions", function () {
    it("Should revert deposit function when user has no allowance", async function () {
      await expect(
        wrappedToken.deposit(100)
      ).to.be.revertedWithCustomError(wrappedToken, "TransferFailed");
    });

    it("Should revert depositWithPermit function with invalid signature", async function () {
      await expect(
        wrappedToken.depositWithPermit(100, 1000000000, 27, ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.reverted; // Any revert is fine for invalid signature
    });

    it("Should revert withdraw function when user has no balance", async function () {
      await expect(
        wrappedToken.withdraw(100)
      ).to.be.revertedWithCustomError(wrappedToken, "ERC20InsufficientBalance");
    });
  });

  describe("Different Fee Rates", function () {
    it("Should work with 0% fee", async function () {
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const zeroFeeWrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        0, // 0% fee
        fakeFactory.address,
        "Zero Fee Wrapper",
        "ZFW"
      );
      
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const [wrappedAmount, feeAmount] = await zeroFeeWrapper.previewDeposit(depositAmount);
      
      expect(feeAmount).to.equal(0);
      expect(wrappedAmount).to.equal(depositAmount); // Todo va al usuario
    });

    it("Should work with 5% fee", async function () {
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const highFeeWrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        500, // 5% fee
        fakeFactory.address,
        "High Fee Wrapper",
        "HFW"
      );
      
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const [wrappedAmount, feeAmount] = await highFeeWrapper.previewDeposit(depositAmount);
      
      const expectedFee = depositAmount / BigInt(20); // 5%
      const expectedWrapped = depositAmount - expectedFee;
      
      expect(feeAmount).to.equal(expectedFee);
      expect(wrappedAmount).to.equal(expectedWrapped);
    });

    it("Should work with maximum 10% fee", async function () {
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const maxFeeWrapper = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        1000, // 10% fee (maximum)
        fakeFactory.address,
        "Max Fee Wrapper",
        "MFW"
      );
      
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const [wrappedAmount, feeAmount] = await maxFeeWrapper.previewDeposit(depositAmount);
      
      const expectedFee = depositAmount / BigInt(10); // 10%
      const expectedWrapped = depositAmount - expectedFee;
      
      expect(feeAmount).to.equal(expectedFee);
      expect(wrappedAmount).to.equal(expectedWrapped);
    });
  });

  describe("Integration with Different Underlying Tokens", function () {
    it("Should work with MockERC20WithPermit as underlying", async function () {
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const permitWrapper = await ERC20WrappedFactory.deploy(
        await underlyingTokenWithPermit.getAddress(),
        DEPOSIT_FEE_RATE,
        fakeFactory.address,
        "Wrapped Token With Permit",
        "wTWP"
      );
      
      expect(await permitWrapper.underlying()).to.equal(await underlyingTokenWithPermit.getAddress());
      
      // Funciones preview deberían funcionar igual
      const depositAmount = ethers.parseUnits("1000", UNDERLYING_DECIMALS);
      const [wrappedAmount, feeAmount] = await permitWrapper.previewDeposit(depositAmount);
      
      const expectedFee = (depositAmount * BigInt(DEPOSIT_FEE_RATE)) / BigInt(10000);
      expect(feeAmount).to.equal(expectedFee);
      expect(wrappedAmount).to.equal(depositAmount - expectedFee);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle very small fee calculations", async function () {
      const verySmallAmount = 10; // 10 wei
      const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(verySmallAmount);
      
      // Con 1% fee, 10 wei debería dar fee = 0 (redondeo hacia abajo)
      expect(feeAmount).to.equal(0);
      expect(wrappedAmount).to.equal(verySmallAmount);
    });

    it("Should handle fee calculation precision", async function () {
      // Testear con un número que dé exactamente 1 de fee
      const preciseAmount = 10000; // 10000 * 100 / 10000 = 100 wei fee
      const [wrappedAmount, feeAmount] = await wrappedToken.previewDeposit(preciseAmount);
      
      expect(feeAmount).to.equal(100);
      expect(wrappedAmount).to.equal(9900);
    });
  });
});
