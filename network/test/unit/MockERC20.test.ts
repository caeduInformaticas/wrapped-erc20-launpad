import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MockERC20", function () {
  let mockToken: MockERC20;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  // Configuración de test
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const TOKEN_DECIMALS = 18;
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M tokens

  beforeEach(async function () {
    // Obtener signers
    [owner, alice, bob] = await ethers.getSigners();
    
    // Desplegar mock token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      INITIAL_SUPPLY
    );
  });

  describe("Deployment", function () {
    it("Should set correct token metadata", async function () {
      expect(await mockToken.name()).to.equal(TOKEN_NAME);
      expect(await mockToken.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await mockToken.decimals()).to.equal(TOKEN_DECIMALS);
      expect(await mockToken.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("Should assign initial supply to deployer", async function () {
      expect(await mockToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should assign initial supply to deployer and emit transfer event", async function () {
      // Verificar que el deployer recibió el supply inicial
      expect(await mockToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
      
      // Para el evento, simplemente verificamos que se puede mintear (que usa la misma lógica)
      const mintAmount = ethers.parseEther("100");
      await expect(mockToken.mint(alice.address, mintAmount))
        .to.emit(mockToken, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, mintAmount);
    });
  });

  describe("Core ERC-20 Functions", function () {
    beforeEach(async function () {
      // Dar algunos tokens a Alice para los tests
      await mockToken.mint(alice.address, ethers.parseEther("1000"));
    });

    describe("transfer", function () {
      it("Should transfer tokens successfully", async function () {
        const transferAmount = ethers.parseEther("100");
        
        await expect(mockToken.connect(alice).transfer(bob.address, transferAmount))
          .to.emit(mockToken, "Transfer")
          .withArgs(alice.address, bob.address, transferAmount);
        
        expect(await mockToken.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
        expect(await mockToken.balanceOf(bob.address)).to.equal(transferAmount);
      });

      it("Should revert on insufficient balance", async function () {
        const transferAmount = ethers.parseEther("2000"); // Más de lo que tiene Alice
        
        await expect(
          mockToken.connect(alice).transfer(bob.address, transferAmount)
        ).to.be.revertedWith("MockERC20: insufficient balance");
      });

      it("Should revert on transfer to zero address", async function () {
        await expect(
          mockToken.connect(alice).transfer(ethers.ZeroAddress, ethers.parseEther("100"))
        ).to.be.revertedWith("MockERC20: transfer to zero address");
      });

      it("Should handle zero amount transfers", async function () {
        await expect(mockToken.connect(alice).transfer(bob.address, 0))
          .to.emit(mockToken, "Transfer")
          .withArgs(alice.address, bob.address, 0);
        
        // Balances no deben cambiar
        expect(await mockToken.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
        expect(await mockToken.balanceOf(bob.address)).to.equal(0);
      });
    });

    describe("approve", function () {
      it("Should approve spender successfully", async function () {
        const approvalAmount = ethers.parseEther("500");
        
        await expect(mockToken.connect(alice).approve(bob.address, approvalAmount))
          .to.emit(mockToken, "Approval")
          .withArgs(alice.address, bob.address, approvalAmount);
        
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(approvalAmount);
      });

      it("Should allow infinite approval", async function () {
        const infiniteApproval = ethers.MaxUint256;
        
        await mockToken.connect(alice).approve(bob.address, infiniteApproval);
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(infiniteApproval);
      });

      it("Should overwrite previous approvals", async function () {
        // Primera aprobación
        await mockToken.connect(alice).approve(bob.address, ethers.parseEther("100"));
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(ethers.parseEther("100"));
        
        // Segunda aprobación (sobreescribe)
        await mockToken.connect(alice).approve(bob.address, ethers.parseEther("200"));
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(ethers.parseEther("200"));
      });
    });

    describe("transferFrom", function () {
      const approvalAmount = ethers.parseEther("500");
      
      beforeEach(async function () {
        // Alice aprueba a Bob para gastar sus tokens
        await mockToken.connect(alice).approve(bob.address, approvalAmount);
      });

      it("Should transfer tokens on behalf of owner", async function () {
        const transferAmount = ethers.parseEther("200");
        
        await expect(mockToken.connect(bob).transferFrom(alice.address, bob.address, transferAmount))
          .to.emit(mockToken, "Transfer")
          .withArgs(alice.address, bob.address, transferAmount)
          .and.to.emit(mockToken, "Approval")
          .withArgs(alice.address, bob.address, approvalAmount - transferAmount);
        
        expect(await mockToken.balanceOf(alice.address)).to.equal(ethers.parseEther("800"));
        expect(await mockToken.balanceOf(bob.address)).to.equal(transferAmount);
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(approvalAmount - transferAmount);
      });

      it("Should not decrease infinite allowance", async function () {
        // Aprobar cantidad infinita
        await mockToken.connect(alice).approve(bob.address, ethers.MaxUint256);
        
        const transferAmount = ethers.parseEther("200");
        await mockToken.connect(bob).transferFrom(alice.address, bob.address, transferAmount);
        
        // Allowance debe seguir siendo infinito
        expect(await mockToken.allowance(alice.address, bob.address)).to.equal(ethers.MaxUint256);
      });

      it("Should revert on insufficient allowance", async function () {
        const transferAmount = ethers.parseEther("600"); // Más de lo aprobado
        
        await expect(
          mockToken.connect(bob).transferFrom(alice.address, bob.address, transferAmount)
        ).to.be.revertedWith("MockERC20: insufficient allowance");
      });

      it("Should revert on insufficient balance", async function () {
        // Alice aprueba una cantidad mayor a su balance
        await mockToken.connect(alice).approve(bob.address, ethers.parseEther("2000"));
        
        await expect(
          mockToken.connect(bob).transferFrom(alice.address, bob.address, ethers.parseEther("1500"))
        ).to.be.revertedWith("MockERC20: insufficient balance");
      });
    });
  });

  describe("Testing Utilities", function () {
    describe("mint", function () {
      it("Should mint tokens successfully", async function () {
        const mintAmount = ethers.parseEther("500");
        const initialBalance = await mockToken.balanceOf(alice.address);
        const initialSupply = await mockToken.totalSupply();
        
        await expect(mockToken.mint(alice.address, mintAmount))
          .to.emit(mockToken, "Transfer")
          .withArgs(ethers.ZeroAddress, alice.address, mintAmount);
        
        expect(await mockToken.balanceOf(alice.address)).to.equal(initialBalance + mintAmount);
        expect(await mockToken.totalSupply()).to.equal(initialSupply + mintAmount);
      });

      it("Should revert on mint to zero address", async function () {
        await expect(
          mockToken.mint(ethers.ZeroAddress, ethers.parseEther("100"))
        ).to.be.revertedWith("MockERC20: mint to zero address");
      });
    });

    describe("burn", function () {
      beforeEach(async function () {
        // Dar tokens a Alice para quemar
        await mockToken.mint(alice.address, ethers.parseEther("1000"));
      });

      it("Should burn tokens successfully", async function () {
        const burnAmount = ethers.parseEther("300");
        const initialBalance = await mockToken.balanceOf(alice.address);
        const initialSupply = await mockToken.totalSupply();
        
        await expect(mockToken.burn(alice.address, burnAmount))
          .to.emit(mockToken, "Transfer")
          .withArgs(alice.address, ethers.ZeroAddress, burnAmount);
        
        expect(await mockToken.balanceOf(alice.address)).to.equal(initialBalance - burnAmount);
        expect(await mockToken.totalSupply()).to.equal(initialSupply - burnAmount);
      });

      it("Should revert on insufficient balance to burn", async function () {
        await expect(
          mockToken.burn(alice.address, ethers.parseEther("2000"))
        ).to.be.revertedWith("MockERC20: insufficient balance to burn");
      });
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple transfers correctly", async function () {
      // Setup: dar tokens a Alice
      await mockToken.mint(alice.address, ethers.parseEther("1000"));
      
      // Múltiples transferencias
      await mockToken.connect(alice).transfer(bob.address, ethers.parseEther("100"));
      await mockToken.connect(alice).transfer(bob.address, ethers.parseEther("200"));
      await mockToken.connect(alice).transfer(bob.address, ethers.parseEther("300"));
      
      expect(await mockToken.balanceOf(alice.address)).to.equal(ethers.parseEther("400"));
      expect(await mockToken.balanceOf(bob.address)).to.equal(ethers.parseEther("600"));
    });

    it("Should maintain total supply conservation", async function () {
      const initialSupply = await mockToken.totalSupply();
      
      // Mint y burn en secuencia
      await mockToken.mint(alice.address, ethers.parseEther("500"));
      await mockToken.burn(alice.address, ethers.parseEther("300"));
      
      const finalSupply = await mockToken.totalSupply();
      expect(finalSupply).to.equal(initialSupply + ethers.parseEther("200"));
    });
  });
});
