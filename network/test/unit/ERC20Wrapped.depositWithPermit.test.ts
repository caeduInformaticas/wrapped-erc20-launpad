import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20Wrapped, MockERC20WithPermit } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ERC20Wrapped - DepositWithPermit (Task 2.4)", function () {
  let wrappedToken: ERC20Wrapped;
  let underlyingToken: MockERC20WithPermit;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  const TOKEN_NAME = "Underlying Token";
  const TOKEN_SYMBOL = "UT";
  const WRAPPED_NAME = "Wrapped Token";
  const WRAPPED_SYMBOL = "wUT";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const FEE_RATE = 100; // 1% en basis points
  const FACTORY_ADDRESS = "0x1234567890123456789012345678901234567890";

  // Helper function para crear signatures de permit
  async function getPermitSignature(
    token: MockERC20WithPermit,
    owner: SignerWithAddress,
    spender: string,
    value: bigint,
    deadline: number
  ) {
    const domain = {
      name: await token.name(),
      version: "1",
      chainId: await owner.provider.getNetwork().then(n => n.chainId),
      verifyingContract: await token.getAddress()
    };
    
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    
    const values = {
      owner: owner.address,
      spender: spender,
      value: value.toString(),
      nonce: (await token.nonces(owner.address)).toString(),
      deadline: deadline
    };
    
    const signature = await owner.signTypedData(domain, types, values);
    return ethers.Signature.from(signature);
  }

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    
    // Deploy underlying token with permit support
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    underlyingToken = await MockERC20WithPermitFactory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      18,
      INITIAL_SUPPLY
    );
    
    // Deploy wrapped token
    const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
    wrappedToken = await ERC20WrappedFactory.deploy(
      await underlyingToken.getAddress(),
      FEE_RATE,
      FACTORY_ADDRESS,
      WRAPPED_NAME,
      WRAPPED_SYMBOL
    );
    
    // Give Alice some tokens for testing
    await underlyingToken.mint(alice.address, ethers.parseEther("1000"));
  });

  describe("DepositWithPermit - Success Cases", function () {
    it("Should deposit with valid permit signature", async function () {
      const depositAmount = ethers.parseEther("100");
      // Use hardhat's time utilities for proper deadline
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600; // 1 hour from now
      
      // Create permit signature
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await wrappedToken.getAddress(),
        depositAmount,
        deadline
      );
      
      // Get expected amounts
      const [expectedWrapped, expectedFee] = await wrappedToken.previewDeposit(depositAmount);
      
      // Initial balances
      const initialUnderlyingBalance = await underlyingToken.balanceOf(alice.address);
      const initialWrappedBalance = await wrappedToken.balanceOf(alice.address);
      
      // Execute depositWithPermit
      const tx = await wrappedToken.connect(alice).depositWithPermit(
        depositAmount,
        deadline,
        signature.v,
        signature.r,
        signature.s
      );
      
      // Check balances after
      expect(await underlyingToken.balanceOf(alice.address))
        .to.equal(initialUnderlyingBalance - depositAmount);
      expect(await wrappedToken.balanceOf(alice.address))
        .to.equal(initialWrappedBalance + expectedWrapped);
      
      // Check event emission
      await expect(tx)
        .to.emit(wrappedToken, "Deposit")
        .withArgs(alice.address, depositAmount, expectedWrapped, expectedFee, ethers.ZeroAddress);
    });

    it("Should work exactly like regular deposit function", async function () {
      const depositAmount = ethers.parseEther("50");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Setup for regular deposit
      await underlyingToken.connect(alice).approve(await wrappedToken.getAddress(), depositAmount);
      
      // Get expected amounts
      const [expectedWrapped, expectedFee] = await wrappedToken.previewDeposit(depositAmount);
      
      // Execute regular deposit
      await wrappedToken.connect(alice).deposit(depositAmount);
      const regularDepositBalance = await wrappedToken.balanceOf(alice.address);
      
      // Reset for permit deposit
      await underlyingToken.mint(alice.address, depositAmount); // Restore tokens
      
      // Create permit signature
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await wrappedToken.getAddress(),
        depositAmount,
        deadline
      );
      
      // Execute depositWithPermit
      await wrappedToken.connect(alice).depositWithPermit(
        depositAmount,
        deadline,
        signature.v,
        signature.r,
        signature.s
      );
      
      const permitDepositBalance = await wrappedToken.balanceOf(alice.address);
      
      // Both methods should result in same wrapped token amount
      expect(permitDepositBalance - regularDepositBalance).to.equal(expectedWrapped);
    });

    it("Should handle zero fee rate correctly", async function () {
      // Deploy wrapped token with 0% fee
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const zeroFeeWrapped = await ERC20WrappedFactory.deploy(
        await underlyingToken.getAddress(),
        0, // 0% fee
        FACTORY_ADDRESS,
        "Zero Fee Wrapped",
        "ZFW"
      );
      
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Create permit signature
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await zeroFeeWrapped.getAddress(),
        depositAmount,
        deadline
      );
      
      // Execute depositWithPermit
      await zeroFeeWrapped.connect(alice).depositWithPermit(
        depositAmount,
        deadline,
        signature.v,
        signature.r,
        signature.s
      );
      
      // With 0% fee, wrapped amount should equal deposit amount
      expect(await zeroFeeWrapped.balanceOf(alice.address)).to.equal(depositAmount);
    });
  });

  describe("DepositWithPermit - Error Cases", function () {
    it("Should revert with zero amount", async function () {
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      await expect(
        wrappedToken.connect(alice).depositWithPermit(
          0,
          deadline,
          27,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(wrappedToken, "ZeroAmount");
    });

    it("Should revert with expired deadline", async function () {
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const expiredDeadline = currentTimestamp - 3600; // 1 hour ago
      
      // Create signature with expired deadline
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await wrappedToken.getAddress(),
        depositAmount,
        expiredDeadline
      );
      
      await expect(
        wrappedToken.connect(alice).depositWithPermit(
          depositAmount,
          expiredDeadline,
          signature.v,
          signature.r,
          signature.s
        )
      ).to.be.revertedWith("MockERC20WithPermit: permit expired");
    });

    it("Should revert with invalid signature", async function () {
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Use invalid signature components
      await expect(
        wrappedToken.connect(alice).depositWithPermit(
          depositAmount,
          deadline,
          27,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWith("MockERC20WithPermit: invalid signature");
    });

    it("Should revert with signature from wrong signer", async function () {
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Create signature with bob's key but try to spend alice's tokens
      const signature = await getPermitSignature(
        underlyingToken,
        bob,
        await wrappedToken.getAddress(),
        depositAmount,
        deadline
      );
      
      await expect(
        wrappedToken.connect(alice).depositWithPermit(
          depositAmount,
          deadline,
          signature.v,
          signature.r,
          signature.s
        )
      ).to.be.revertedWith("MockERC20WithPermit: invalid signature");
    });

    it("Should revert if underlying token doesn't support permit", async function () {
      // Deploy regular ERC20 token without permit
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const regularToken = await MockERC20Factory.deploy(
        "Regular Token",
        "RT",
        18,
        ethers.parseEther("1000000")
      );
      
      // Deploy wrapped token for regular ERC20
      const ERC20WrappedFactory = await ethers.getContractFactory("ERC20Wrapped");
      const wrappedRegular = await ERC20WrappedFactory.deploy(
        await regularToken.getAddress(),
        FEE_RATE,
        FACTORY_ADDRESS,
        "Wrapped Regular",
        "WR"
      );
      
      // Give Alice some tokens
      await regularToken.mint(alice.address, ethers.parseEther("1000"));
      
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // This should fail because regular ERC20 doesn't have permit
      await expect(
        wrappedRegular.connect(alice).depositWithPermit(
          depositAmount,
          deadline,
          27,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.reverted; // Any revert is fine, as regular ERC20 doesn't have permit
    });
  });

  describe("DepositWithPermit - Invariant Checks", function () {
    it("Should maintain reserves-supply invariant", async function () {
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Create permit signature
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await wrappedToken.getAddress(),
        depositAmount,
        deadline
      );
      
      // Execute depositWithPermit
      await wrappedToken.connect(alice).depositWithPermit(
        depositAmount,
        deadline,
        signature.v,
        signature.r,
        signature.s
      );
      
      // Check invariant: reserves >= supply
      const [isHealthy, reserves, supply] = await wrappedToken.checkInvariant();
      expect(isHealthy).to.be.true;
      expect(reserves).to.be.gte(supply);
    });

    it("Should update nonce after permit usage", async function () {
      const depositAmount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Get initial nonce
      const initialNonce = await underlyingToken.nonces(alice.address);
      
      // Create permit signature
      const signature = await getPermitSignature(
        underlyingToken,
        alice,
        await wrappedToken.getAddress(),
        depositAmount,
        deadline
      );
      
      // Execute depositWithPermit
      await wrappedToken.connect(alice).depositWithPermit(
        depositAmount,
        deadline,
        signature.v,
        signature.r,
        signature.s
      );
      
      // Nonce should be incremented
      const finalNonce = await underlyingToken.nonces(alice.address);
      expect(finalNonce).to.equal(initialNonce + 1n);
    });
  });
});
