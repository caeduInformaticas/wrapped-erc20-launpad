import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20WithPermit } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MockERC20WithPermit", function () {
  let mockTokenWithPermit: MockERC20WithPermit;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  const TOKEN_NAME = "Test Token With Permit";
  const TOKEN_SYMBOL = "TESTP";
  const TOKEN_DECIMALS = 18;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

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
    
    const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
    mockTokenWithPermit = await MockERC20WithPermitFactory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      INITIAL_SUPPLY
    );
    
    // Dar tokens a Alice para los tests
    await mockTokenWithPermit.mint(alice.address, ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set correct token metadata", async function () {
      expect(await mockTokenWithPermit.name()).to.equal(TOKEN_NAME);
      expect(await mockTokenWithPermit.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await mockTokenWithPermit.decimals()).to.equal(TOKEN_DECIMALS);
      // Total supply incluye el INITIAL_SUPPLY + los tokens minteados a Alice en beforeEach
      expect(await mockTokenWithPermit.totalSupply()).to.equal(INITIAL_SUPPLY + ethers.parseEther("1000"));
    });

    it("Should initialize EIP-712 domain separator", async function () {
      const domainSeparator = await mockTokenWithPermit.DOMAIN_SEPARATOR();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });

    it("Should have correct PERMIT_TYPEHASH", async function () {
      const expectedTypehash = ethers.keccak256(
        ethers.toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
      );
      expect(await mockTokenWithPermit.PERMIT_TYPEHASH()).to.equal(expectedTypehash);
    });
  });

  describe("Standard ERC-20 Functions", function () {
    it("Should work exactly like MockERC20", async function () {
      const transferAmount = ethers.parseEther("100");
      
      // Transfer
      await expect(mockTokenWithPermit.connect(alice).transfer(bob.address, transferAmount))
        .to.emit(mockTokenWithPermit, "Transfer")
        .withArgs(alice.address, bob.address, transferAmount);
      
      // Approve
      await expect(mockTokenWithPermit.connect(alice).approve(bob.address, transferAmount))
        .to.emit(mockTokenWithPermit, "Approval")
        .withArgs(alice.address, bob.address, transferAmount);
      
      // TransferFrom
      await expect(mockTokenWithPermit.connect(bob).transferFrom(alice.address, bob.address, transferAmount))
        .to.emit(mockTokenWithPermit, "Transfer")
        .withArgs(alice.address, bob.address, transferAmount);
    });
  });

  describe("EIP-2612 Permit Functionality", function () {
    let deadline: number;
    
    beforeEach(async function () {
      // Use hardhat's time utilities for proper deadline
      const currentTimestamp = await time.latest();
      deadline = currentTimestamp + 3600; // 1 hour from now
    });

    it("Should permit successfully with valid signature", async function () {
      const permitAmount = ethers.parseEther("500");
      const sig = await getPermitSignature(
        mockTokenWithPermit,
        alice,
        bob.address,
        permitAmount,
        deadline
      );
      
      // Verificar nonce inicial
      expect(await mockTokenWithPermit.nonces(alice.address)).to.equal(0);
      
      // Ejecutar permit
      await expect(
        mockTokenWithPermit.permit(
          alice.address,
          bob.address,
          permitAmount,
          deadline,
          sig.v,
          sig.r,
          sig.s
        )
      )
        .to.emit(mockTokenWithPermit, "Approval")
        .withArgs(alice.address, bob.address, permitAmount);
      
      // Verificar resultado
      expect(await mockTokenWithPermit.allowance(alice.address, bob.address)).to.equal(permitAmount);
      expect(await mockTokenWithPermit.nonces(alice.address)).to.equal(1);
    });

    it("Should revert with expired deadline", async function () {
      const currentTimestamp = await time.latest();
      const expiredDeadline = currentTimestamp - 3600; // 1 hour ago
      const permitAmount = ethers.parseEther("500");
      
      const sig = await getPermitSignature(
        mockTokenWithPermit,
        alice,
        bob.address,
        permitAmount,
        expiredDeadline
      );
      
      await expect(
        mockTokenWithPermit.permit(
          alice.address,
          bob.address,
          permitAmount,
          expiredDeadline,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.be.revertedWith("MockERC20WithPermit: permit expired");
    });

    it("Should revert with invalid signature", async function () {
      const permitAmount = ethers.parseEther("500");
      
      // Crear signature válida
      const sig = await getPermitSignature(
        mockTokenWithPermit,
        alice,
        bob.address,
        permitAmount,
        deadline
      );
      
      // Usar signature con datos diferentes (inválida)
      await expect(
        mockTokenWithPermit.permit(
          alice.address,
          bob.address,
          ethers.parseEther("600"), // Cantidad diferente
          deadline,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.be.revertedWith("MockERC20WithPermit: invalid signature");
    });

    it("Should revert when signature is from wrong signer", async function () {
      const permitAmount = ethers.parseEther("500");
      
      // Bob firma, pero usamos Alice como owner
      const sig = await getPermitSignature(
        mockTokenWithPermit,
        bob, // Bob firma
        alice.address,
        permitAmount,
        deadline
      );
      
      await expect(
        mockTokenWithPermit.permit(
          alice.address, // Pero Alice es owner
          bob.address,
          permitAmount,
          deadline,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.be.revertedWith("MockERC20WithPermit: invalid signature");
    });

    it("Should increment nonce after each permit", async function () {
      const permitAmount = ethers.parseEther("100");
      
      // Primera permit
      let sig = await getPermitSignature(mockTokenWithPermit, alice, bob.address, permitAmount, deadline);
      await mockTokenWithPermit.permit(alice.address, bob.address, permitAmount, deadline, sig.v, sig.r, sig.s);
      expect(await mockTokenWithPermit.nonces(alice.address)).to.equal(1);
      
      // Segunda permit (con nuevo nonce)
      sig = await getPermitSignature(mockTokenWithPermit, alice, bob.address, permitAmount, deadline + 1);
      await mockTokenWithPermit.permit(alice.address, bob.address, permitAmount, deadline + 1, sig.v, sig.r, sig.s);
      expect(await mockTokenWithPermit.nonces(alice.address)).to.equal(2);
    });

    it("Should not allow signature replay", async function () {
      const permitAmount = ethers.parseEther("500");
      const sig = await getPermitSignature(mockTokenWithPermit, alice, bob.address, permitAmount, deadline);
      
      // Primera ejecución - exitosa
      await mockTokenWithPermit.permit(alice.address, bob.address, permitAmount, deadline, sig.v, sig.r, sig.s);
      
      // Segunda ejecución con misma signature - debe fallar
      await expect(
        mockTokenWithPermit.permit(alice.address, bob.address, permitAmount, deadline, sig.v, sig.r, sig.s)
      ).to.be.revertedWith("MockERC20WithPermit: invalid signature");
    });
  });

  describe("Integration: Permit + TransferFrom", function () {
    it("Should allow transferFrom after permit without prior approve", async function () {
      const permitAmount = ethers.parseEther("500");
      const transferAmount = ethers.parseEther("200");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Verificar que no hay allowance inicial
      expect(await mockTokenWithPermit.allowance(alice.address, bob.address)).to.equal(0);
      
      // Permit
      const sig = await getPermitSignature(mockTokenWithPermit, alice, bob.address, permitAmount, deadline);
      await mockTokenWithPermit.permit(alice.address, bob.address, permitAmount, deadline, sig.v, sig.r, sig.s);
      
      // TransferFrom sin approve previo
      await expect(
        mockTokenWithPermit.connect(bob).transferFrom(alice.address, bob.address, transferAmount)
      )
        .to.emit(mockTokenWithPermit, "Transfer")
        .withArgs(alice.address, bob.address, transferAmount);
      
      // Verificar balances y allowance restante
      expect(await mockTokenWithPermit.balanceOf(bob.address)).to.equal(transferAmount);
      expect(await mockTokenWithPermit.allowance(alice.address, bob.address)).to.equal(permitAmount - transferAmount);
    });
  });

  describe("Gas Efficiency Comparison", function () {
    it("Should measure gas: approve+transferFrom vs permit+transferFrom", async function () {
      const amount = ethers.parseEther("100");
      const currentTimestamp = await time.latest();
      const deadline = currentTimestamp + 3600;
      
      // Deploy fresh token for clean test
      const MockERC20WithPermitFactory = await ethers.getContractFactory("MockERC20WithPermit");
      const freshToken = await MockERC20WithPermitFactory.deploy("Fresh", "FRESH", 18, ethers.parseEther("1000")) as MockERC20WithPermit;
      await freshToken.mint(alice.address, ethers.parseEther("1000"));
      
      // Método 1: approve + transferFrom
      const approveTx = await freshToken.connect(alice).approve(bob.address, amount);
      const approveReceipt = await approveTx.wait();
      const transferFromTx = await freshToken.connect(bob).transferFrom(alice.address, bob.address, amount);
      const transferFromReceipt = await transferFromTx.wait();
      const traditionalGas = (approveReceipt?.gasUsed || 0n) + (transferFromReceipt?.gasUsed || 0n);
      
      // Reset para método 2
      await freshToken.mint(alice.address, amount);
      
      // Método 2: permit + transferFrom
      const sig = await getPermitSignature(freshToken, alice, bob.address, amount, deadline);
      const permitTx = await freshToken.permit(alice.address, bob.address, amount, deadline, sig.v, sig.r, sig.s);
      const permitReceipt = await permitTx.wait();
      const transferFromTx2 = await freshToken.connect(bob).transferFrom(alice.address, bob.address, amount);
      const transferFromReceipt2 = await transferFromTx2.wait();
      const permitGas = (permitReceipt?.gasUsed || 0n) + (transferFromReceipt2?.gasUsed || 0n);
      
      console.log(`Traditional (approve + transferFrom): ${traditionalGas} gas`);
      console.log(`Permit (permit + transferFrom): ${permitGas} gas`);
      
      // El gas debería ser similar, pero el flujo permit es 1 transacción del usuario
      expect(permitGas).to.be.lessThan(traditionalGas * 2n); // Sanity check
    });
  });
});
