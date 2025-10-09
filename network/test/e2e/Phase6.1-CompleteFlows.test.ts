import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  WrapperFactory,
  ERC20Wrapped,
  MockERC20,
  MockERC20WithPermit
} from "../../typechain-types";

/**
 * Phase 6.1 - Tests E2E de Flujos Completos del README
 * 
 * Implementa todos los 7 flujos específicos mencionados en el README:
 * ✅ Flujo 1: Configuración inicial de fábrica (roles, fee, recipient)
 * ✅ Flujo 2: Lanzar nuevo wrapper para token X
 * ✅ Flujo 3: Depósito con aprobación clásica (María, 100X → 99wX)
 * ✅ Flujo 4: Depósito con permit (Juan, 200X → 198wX)
 * ✅ Flujo 5: Retiro (Ana, 50wX → 50X)
 * ✅ Flujo 6: Cambiar receptor de comisiones
 * ✅ Flujo 7: Subir tasa de fee para futuros wrappers
 */
describe("Phase 6.1 - Flujos Completos del README", function () {
  // ====== ACTORS ======
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let treasurer: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;
  let newFeeRecipient: HardhatEthersSigner;
  
  // Usuarios finales para los flujos
  let maria: HardhatEthersSigner;
  let juan: HardhatEthersSigner;
  let ana: HardhatEthersSigner;
  let carlos: HardhatEthersSigner;

  // ====== CONTRACTS ======
  let factory: WrapperFactory;
  let tokenX: MockERC20;  // Token sin permit
  let tokenY: MockERC20WithPermit;  // Token con permit
  let wrapperX: ERC20Wrapped;
  let wrapperY: ERC20Wrapped;

  // ====== CONSTANTS ======
  const INITIAL_FEE_RATE = 100;  // 1%
  const NEW_FEE_RATE = 150;      // 1.5%
  const DECIMALS = 18;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  before(async function () {
    // Get signers
    [deployer, admin, treasurer, operator, feeRecipient, newFeeRecipient, 
     maria, juan, ana, carlos] = await ethers.getSigners();

    console.log("\n🚀 === PHASE 6.1 E2E SETUP ===");
    console.log(`📋 Deployer: ${deployer.address}`);
    console.log(`👑 Admin: ${admin.address}`);
    console.log(`💰 Treasurer: ${treasurer.address}`);
    console.log(`⚙️  Operator: ${operator.address}`);
    console.log(`📨 Fee Recipient: ${feeRecipient.address}`);
    console.log(`👥 Users: María=${maria.address.slice(0,8)}... Juan=${juan.address.slice(0,8)}... Ana=${ana.address.slice(0,8)}...`);

    // Deploy factory for all tests
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactory.connect(deployer).deploy(
      admin.address,        // _initialAdmin
      treasurer.address,    // _initialTreasurer  
      operator.address,     // _initialOperator
      feeRecipient.address, // _feeRecipient
      INITIAL_FEE_RATE     // _depositFeeRate (1%)
    );
    await factory.waitForDeployment();
    console.log(`🏭 Factory deployed at: ${await factory.getAddress()}`);
  });

  describe("✅ Flujo 1: Configuración Inicial de Fábrica", function () {
    it("Should deploy factory with complete role configuration", async function () {
      console.log("\n🏗️  === FLUJO 1: CONFIGURACIÓN INICIAL ===");
      
      const factoryAddress = await factory.getAddress();
      console.log(`🏭 Factory deployed at: ${factoryAddress}`);
      console.log(`💸 Initial fee rate: ${INITIAL_FEE_RATE} basis points (${INITIAL_FEE_RATE/100}%)`);
      console.log(`📬 Initial fee recipient: ${feeRecipient.address}`);

      // Verify initial configuration
      expect(await factory.getFeeRecipient()).to.equal(feeRecipient.address);
      const factoryInfo = await factory.getFactoryInfo();
      expect(factoryInfo.currentFeeRecipient).to.equal(feeRecipient.address);
      expect(factoryInfo.currentFeeRate).to.equal(INITIAL_FEE_RATE);
      expect(factoryInfo.totalWrappers).to.equal(0);

      // Verify role assignments
      const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
      const ADMINISTRATOR_ROLE = await factory.ADMINISTRATOR_ROLE();
      const TREASURER_ROLE = await factory.TREASURER_ROLE();
      const OPERATOR_ROLE = await factory.OPERATOR_ROLE();

      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await factory.hasRole(ADMINISTRATOR_ROLE, admin.address)).to.be.true;
      expect(await factory.hasRole(TREASURER_ROLE, treasurer.address)).to.be.true;
      expect(await factory.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;

      console.log("✅ Factory configured with correct roles and parameters");
    });

    it("Should verify access control is working", async function () {
      // Test that only correct roles can perform actions
      await expect(
        factory.connect(maria).setFeeRecipient(newFeeRecipient.address)
      ).to.be.reverted;

      await expect(
        factory.connect(maria).setDepositFeeRate(200)
      ).to.be.reverted;

      console.log("✅ Access control verified - unauthorized users cannot modify settings");
    });
  });

  describe("✅ Flujo 2: Lanzar Nuevos Wrappers", function () {
    before(async function () {
      // Deploy underlying tokens for wrapping
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const MockERC20WithPermit = await ethers.getContractFactory("MockERC20WithPermit");

      tokenX = await MockERC20.deploy("Token X", "X", DECIMALS, INITIAL_SUPPLY);
      await tokenX.waitForDeployment();

      tokenY = await MockERC20WithPermit.deploy("Token Y", "Y", DECIMALS, INITIAL_SUPPLY);
      await tokenY.waitForDeployment();

      console.log(`\n🪙 Token X (no permit): ${await tokenX.getAddress()}`);
      console.log(`🪙 Token Y (with permit): ${await tokenY.getAddress()}`);

      // Distribute tokens to users
      const transferAmount = ethers.parseEther("10000");
      await tokenX.transfer(maria.address, transferAmount);
      await tokenX.transfer(ana.address, transferAmount);
      await tokenY.transfer(juan.address, transferAmount);
      await tokenY.transfer(carlos.address, transferAmount);

      console.log("💰 Tokens distributed to test users");
    });

    it("Should create wrapper for Token X (no permit support)", async function () {
      console.log("\n🔧 === FLUJO 2A: CREAR WRAPPER PARA TOKEN X ===");
      
      const tokenXAddress = await tokenX.getAddress();
      
      // Anyone can create wrapper (even regular user)
      const tx = await factory.connect(maria).createWrapper(
        tokenXAddress,
        "Wrapped Token X",
        "wX"
      );
      const receipt = await tx.wait();

      // Get wrapper address from event
      const createEvent = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });

      expect(createEvent).to.not.be.undefined;
      const parsedEvent = factory.interface.parseLog({
        topics: createEvent!.topics as string[],
        data: createEvent!.data
      });

      const wrapperXAddress = parsedEvent!.args[1];
      wrapperX = await ethers.getContractAt("ERC20Wrapped", wrapperXAddress);
      
      console.log(`🎁 Wrapper X created at: ${wrapperXAddress}`);
      console.log(`📝 Created by user: ${maria.address}`);
      console.log(`🔗 Underlying token: ${tokenXAddress}`);

      // Verify wrapper configuration
      expect(await wrapperX.underlying()).to.equal(tokenXAddress);
      expect(await wrapperX.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      expect(await wrapperX.factory()).to.equal(await factory.getAddress());
      expect(await wrapperX.name()).to.equal("Wrapped Token X");
      expect(await wrapperX.symbol()).to.equal("wX");
      expect(await wrapperX.totalSupply()).to.equal(0);

      // Verify factory registry
      expect(await factory.wrapperForUnderlying(tokenXAddress)).to.equal(wrapperXAddress);
      const factoryInfo = await factory.getFactoryInfo();
      expect(factoryInfo.totalWrappers).to.equal(1);

      console.log("✅ Wrapper X properly configured and registered");
    });

    it("Should create wrapper for Token Y (permit support)", async function () {
      console.log("\n🔧 === FLUJO 2B: CREAR WRAPPER PARA TOKEN Y ===");
      
      const tokenYAddress = await tokenY.getAddress();
      
      // Create wrapper for permit-enabled token
      const tx = await factory.connect(juan).createWrapper(
        tokenYAddress,
        "Wrapped Token Y", 
        "wY"
      );
      const receipt = await tx.wait();

      const createEvent = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = factory.interface.parseLog({
        topics: createEvent!.topics as string[],
        data: createEvent!.data
      });

      const wrapperYAddress = parsedEvent!.args[1];
      wrapperY = await ethers.getContractAt("ERC20Wrapped", wrapperYAddress);
      
      console.log(`🎁 Wrapper Y created at: ${wrapperYAddress}`);
      console.log(`📝 Created by user: ${juan.address}`);
      console.log(`🔗 Underlying token: ${tokenYAddress}`);

      // Verify wrapper configuration
      expect(await wrapperY.underlying()).to.equal(tokenYAddress);
      expect(await wrapperY.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      expect(await wrapperY.factory()).to.equal(await factory.getAddress());
      expect(await wrapperY.name()).to.equal("Wrapped Token Y");
      expect(await wrapperY.symbol()).to.equal("wY");

      // Verify factory now has 2 wrappers
      const factoryInfo2 = await factory.getFactoryInfo();
      expect(factoryInfo2.totalWrappers).to.equal(2);

      console.log("✅ Wrapper Y properly configured and registered");
    });

    it("Should prevent duplicate wrapper creation", async function () {
      // Try to create wrapper for same token
      const tokenXAddress = await tokenX.getAddress();
      
      await expect(
        factory.connect(carlos).createWrapper(
          tokenXAddress,
          "Duplicate Wrapper",
          "dupwX"
        )
      ).to.be.revertedWithCustomError(factory, "WrapperAlreadyExists");

      console.log("✅ Duplicate wrapper creation properly prevented");
    });
  });

  describe("✅ Flujo 3: Depósito con Aprobación Clásica (María)", function () {
    it("Should complete classic approve + deposit flow (María: 100X → 99wX)", async function () {
      console.log("\n💰 === FLUJO 3: DEPÓSITO CLÁSICO (MARÍA) ===");
      
      const depositAmount = ethers.parseEther("100");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;

      console.log(`📊 Deposit amount: ${ethers.formatEther(depositAmount)} X`);
      console.log(`💸 Expected fee (${INITIAL_FEE_RATE/100}%): ${ethers.formatEther(expectedFee)} X`);
      console.log(`🎁 Expected wrapped: ${ethers.formatEther(expectedWrapped)} wX`);

      // Step 1: María approves wrapper to spend her tokens (classic flow)
      console.log("\n📝 Step 1: María approves wrapper...");
      await tokenX.connect(maria).approve(await wrapperX.getAddress(), depositAmount);
      
      const allowance = await tokenX.allowance(maria.address, await wrapperX.getAddress());
      expect(allowance).to.equal(depositAmount);
      console.log(`✅ Allowance set: ${ethers.formatEther(allowance)} X`);

      // Record balances before
      const mariaXBefore = await tokenX.balanceOf(maria.address);
      const mariaWXBefore = await wrapperX.balanceOf(maria.address);
      const recipientXBefore = await tokenX.balanceOf(feeRecipient.address);
      const wrapperXReserves = await tokenX.balanceOf(await wrapperX.getAddress());

      console.log(`\n📈 Balances before deposit:`);
      console.log(`   María X: ${ethers.formatEther(mariaXBefore)}`);
      console.log(`   María wX: ${ethers.formatEther(mariaWXBefore)}`);
      console.log(`   Recipient X: ${ethers.formatEther(recipientXBefore)}`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperXReserves)}`);

      // Step 2: María deposits tokens
      console.log("\n💳 Step 2: María deposits tokens...");
      const tx = await wrapperX.connect(maria).deposit(depositAmount);
      const receipt = await tx.wait();

      // Verify event emission
      const depositEvent = receipt?.logs.find(log => {
        try {
          const parsed = wrapperX.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'Deposit';
        } catch {
          return false;
        }
      });

      expect(depositEvent).to.not.be.undefined;
      const parsedEvent = wrapperX.interface.parseLog({
        topics: depositEvent!.topics as string[],
        data: depositEvent!.data
      });

      expect(parsedEvent!.args[0]).to.equal(maria.address); // user
      expect(parsedEvent!.args[1]).to.equal(depositAmount); // underlyingAmount
      expect(parsedEvent!.args[2]).to.equal(expectedWrapped); // wrappedAmount
      expect(parsedEvent!.args[3]).to.equal(expectedFee); // feeAmount
      expect(parsedEvent!.args[4]).to.equal(feeRecipient.address); // feeRecipient

      // Record balances after
      const mariaXAfter = await tokenX.balanceOf(maria.address);
      const mariaWXAfter = await wrapperX.balanceOf(maria.address);
      const recipientXAfter = await tokenX.balanceOf(feeRecipient.address);
      const wrapperXReservesAfter = await tokenX.balanceOf(await wrapperX.getAddress());
      const totalSupply = await wrapperX.totalSupply();

      console.log(`\n📊 Balances after deposit:`);
      console.log(`   María X: ${ethers.formatEther(mariaXAfter)} (${ethers.formatEther(mariaXBefore - mariaXAfter)} spent)`);
      console.log(`   María wX: ${ethers.formatEther(mariaWXAfter)} (${ethers.formatEther(mariaWXAfter - mariaWXBefore)} received)`);
      console.log(`   Recipient X: ${ethers.formatEther(recipientXAfter)} (${ethers.formatEther(recipientXAfter - recipientXBefore)} fee)`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperXReservesAfter)} (${ethers.formatEther(wrapperXReservesAfter - wrapperXReserves)} increase)`);
      console.log(`   Total wX supply: ${ethers.formatEther(totalSupply)}`);

      // Verify all balances
      expect(mariaXBefore - mariaXAfter).to.equal(depositAmount);
      expect(mariaWXAfter - mariaWXBefore).to.equal(expectedWrapped);
      expect(recipientXAfter - recipientXBefore).to.equal(expectedFee);
      expect(wrapperXReservesAfter - wrapperXReserves).to.equal(expectedWrapped);
      expect(totalSupply).to.equal(expectedWrapped);

      // Verify invariant: total supply = reserves
      expect(totalSupply).to.equal(wrapperXReservesAfter);

      console.log("✅ Flujo 3 completed successfully - Classic approve + deposit");
      console.log(`✅ Invariant maintained: ${ethers.formatEther(totalSupply)} wX = ${ethers.formatEther(wrapperXReservesAfter)} X reserves`);
    });
  });

  describe("✅ Flujo 4: Depósito con Permit (Juan)", function () {
    it("Should complete permit + deposit flow (Juan: 200Y → 198wY)", async function () {
      console.log("\n🖊️  === FLUJO 4: DEPÓSITO CON PERMIT (JUAN) ===");
      
      const depositAmount = ethers.parseEther("200");
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;

      console.log(`📊 Deposit amount: ${ethers.formatEther(depositAmount)} Y`);
      console.log(`💸 Expected fee (${INITIAL_FEE_RATE/100}%): ${ethers.formatEther(expectedFee)} Y`);
      console.log(`🎁 Expected wrapped: ${ethers.formatEther(expectedWrapped)} wY`);

      // Prepare permit signature
      const latestBlock = await ethers.provider.getBlock('latest');
      const deadline = latestBlock!.timestamp + 7200; // 2 hours from latest block
      const wrapperYAddress = await wrapperY.getAddress();

      // Get domain separator and nonce
      const domain = {
        name: await tokenY.name(),
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await tokenY.getAddress()
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

      const nonce = await tokenY.nonces(juan.address);
      const value = {
        owner: juan.address,
        spender: wrapperYAddress,
        value: depositAmount,
        nonce: nonce,
        deadline: deadline
      };

      console.log("\n🔐 Generating permit signature...");
      console.log(`   Owner: ${juan.address}`);
      console.log(`   Spender: ${wrapperYAddress}`);
      console.log(`   Value: ${ethers.formatEther(depositAmount)} Y`);
      console.log(`   Nonce: ${nonce}`);
      console.log(`   Deadline: ${deadline}`);

      const signature = await juan.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      // Record balances before
      const juanYBefore = await tokenY.balanceOf(juan.address);
      const juanWYBefore = await wrapperY.balanceOf(juan.address);
      const recipientYBefore = await tokenY.balanceOf(feeRecipient.address);
      const wrapperYReserves = await tokenY.balanceOf(await wrapperY.getAddress());

      console.log(`\n📈 Balances before deposit:`);
      console.log(`   Juan Y: ${ethers.formatEther(juanYBefore)}`);
      console.log(`   Juan wY: ${ethers.formatEther(juanWYBefore)}`);
      console.log(`   Recipient Y: ${ethers.formatEther(recipientYBefore)}`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperYReserves)}`);

      // Execute permit + deposit in single transaction
      console.log("\n⚡ Executing permit + deposit in single transaction...");
      const tx = await wrapperY.connect(juan).depositWithPermit(
        depositAmount,
        deadline,
        v,
        r,
        s
      );
      const receipt = await tx.wait();

      // Verify event emission  
      const depositEvent = receipt?.logs.find(log => {
        try {
          const parsed = wrapperY.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'Deposit';
        } catch {
          return false;
        }
      });

      expect(depositEvent).to.not.be.undefined;
      const parsedEvent = wrapperY.interface.parseLog({
        topics: depositEvent!.topics as string[],
        data: depositEvent!.data
      });

      expect(parsedEvent!.args[0]).to.equal(juan.address);
      expect(parsedEvent!.args[1]).to.equal(depositAmount);
      expect(parsedEvent!.args[2]).to.equal(expectedWrapped);
      expect(parsedEvent!.args[3]).to.equal(expectedFee);
      expect(parsedEvent!.args[4]).to.equal(feeRecipient.address);

      // Record balances after
      const juanYAfter = await tokenY.balanceOf(juan.address);
      const juanWYAfter = await wrapperY.balanceOf(juan.address);
      const recipientYAfter = await tokenY.balanceOf(feeRecipient.address);
      const wrapperYReservesAfter = await tokenY.balanceOf(await wrapperY.getAddress());
      const totalSupply = await wrapperY.totalSupply();

      console.log(`\n📊 Balances after deposit:`);
      console.log(`   Juan Y: ${ethers.formatEther(juanYAfter)} (${ethers.formatEther(juanYBefore - juanYAfter)} spent)`);
      console.log(`   Juan wY: ${ethers.formatEther(juanWYAfter)} (${ethers.formatEther(juanWYAfter - juanWYBefore)} received)`);
      console.log(`   Recipient Y: ${ethers.formatEther(recipientYAfter)} (${ethers.formatEther(recipientYAfter - recipientYBefore)} fee)`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperYReservesAfter)} (${ethers.formatEther(wrapperYReservesAfter - wrapperYReserves)} increase)`);
      console.log(`   Total wY supply: ${ethers.formatEther(totalSupply)}`);

      // Verify all balances
      expect(juanYBefore - juanYAfter).to.equal(depositAmount);
      expect(juanWYAfter - juanWYBefore).to.equal(expectedWrapped);
      expect(recipientYAfter - recipientYBefore).to.equal(expectedFee);
      expect(wrapperYReservesAfter - wrapperYReserves).to.equal(expectedWrapped);
      expect(totalSupply).to.equal(expectedWrapped);

      // Verify invariant
      expect(totalSupply).to.equal(wrapperYReservesAfter);

      // Verify nonce was incremented
      const nonceAfter = await tokenY.nonces(juan.address);
      expect(nonceAfter).to.equal(nonce + 1n);

      console.log("✅ Flujo 4 completed successfully - Permit + deposit in single transaction");
      console.log(`✅ Invariant maintained: ${ethers.formatEther(totalSupply)} wY = ${ethers.formatEther(wrapperYReservesAfter)} Y reserves`);
      console.log(`✅ Permit nonce incremented: ${nonce} → ${nonceAfter}`);
    });
  });

  describe("✅ Flujo 5: Retiro (Ana)", function () {
    before(async function () {
      // Ana needs some wrapped tokens first, so let's give her some
      const depositAmount = ethers.parseEther("100");
      await tokenX.connect(ana).approve(await wrapperX.getAddress(), depositAmount);
      await wrapperX.connect(ana).deposit(depositAmount);
      
      console.log(`\n🎁 Setup: Ana deposited ${ethers.formatEther(depositAmount)} X and received wrapped tokens`);
    });

    it("Should complete withdrawal flow (Ana: 50wX → 50X)", async function () {
      console.log("\n💸 === FLUJO 5: RETIRO (ANA) ===");
      
      const withdrawAmount = ethers.parseEther("50");

      console.log(`📊 Withdraw amount: ${ethers.formatEther(withdrawAmount)} wX`);
      console.log(`🎯 Expected underlying: ${ethers.formatEther(withdrawAmount)} X (1:1 ratio)`);

      // Record balances before
      const anaXBefore = await tokenX.balanceOf(ana.address);
      const anaWXBefore = await wrapperX.balanceOf(ana.address);
      const wrapperXReservesBefore = await tokenX.balanceOf(await wrapperX.getAddress());
      const totalSupplyBefore = await wrapperX.totalSupply();

      console.log(`\n📈 Balances before withdrawal:`);
      console.log(`   Ana X: ${ethers.formatEther(anaXBefore)}`);
      console.log(`   Ana wX: ${ethers.formatEther(anaWXBefore)}`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperXReservesBefore)}`);
      console.log(`   Total wX supply: ${ethers.formatEther(totalSupplyBefore)}`);

      // Verify Ana has enough wrapped tokens
      expect(anaWXBefore).to.be.gte(withdrawAmount);

      // Execute withdrawal
      console.log("\n🏧 Executing withdrawal...");
      const tx = await wrapperX.connect(ana).withdraw(withdrawAmount);
      const receipt = await tx.wait();

      // Verify event emission
      const withdrawEvent = receipt?.logs.find(log => {
        try {
          const parsed = wrapperX.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'Withdrawal';
        } catch {
          return false;
        }
      });

      expect(withdrawEvent).to.not.be.undefined;
      const parsedEvent = wrapperX.interface.parseLog({
        topics: withdrawEvent!.topics as string[],
        data: withdrawEvent!.data
      });

      expect(parsedEvent!.args[0]).to.equal(ana.address); // user
      expect(parsedEvent!.args[1]).to.equal(withdrawAmount); // wrappedAmount
      expect(parsedEvent!.args[2]).to.equal(withdrawAmount); // underlyingAmount (1:1)

      // Record balances after
      const anaXAfter = await tokenX.balanceOf(ana.address);
      const anaWXAfter = await wrapperX.balanceOf(ana.address);
      const wrapperXReservesAfter = await tokenX.balanceOf(await wrapperX.getAddress());
      const totalSupplyAfter = await wrapperX.totalSupply();

      console.log(`\n📊 Balances after withdrawal:`);
      console.log(`   Ana X: ${ethers.formatEther(anaXAfter)} (+${ethers.formatEther(anaXAfter - anaXBefore)} received)`);
      console.log(`   Ana wX: ${ethers.formatEther(anaWXAfter)} (-${ethers.formatEther(anaWXBefore - anaWXAfter)} burned)`);
      console.log(`   Wrapper reserves: ${ethers.formatEther(wrapperXReservesAfter)} (-${ethers.formatEther(wrapperXReservesBefore - wrapperXReservesAfter)} released)`);
      console.log(`   Total wX supply: ${ethers.formatEther(totalSupplyAfter)} (-${ethers.formatEther(totalSupplyBefore - totalSupplyAfter)} burned)`);

      // Verify all balances
      expect(anaXAfter - anaXBefore).to.equal(withdrawAmount); // Ana received underlying 1:1
      expect(anaWXBefore - anaWXAfter).to.equal(withdrawAmount); // Ana's wrapped tokens burned
      expect(wrapperXReservesBefore - wrapperXReservesAfter).to.equal(withdrawAmount); // Reserves decreased
      expect(totalSupplyBefore - totalSupplyAfter).to.equal(withdrawAmount); // Supply decreased

      // Verify invariant maintained
      expect(totalSupplyAfter).to.equal(wrapperXReservesAfter);

      console.log("✅ Flujo 5 completed successfully - Withdrawal with 1:1 ratio");
      console.log(`✅ Invariant maintained: ${ethers.formatEther(totalSupplyAfter)} wX = ${ethers.formatEther(wrapperXReservesAfter)} X reserves`);
    });
  });

  describe("✅ Flujo 6: Cambiar Receptor de Comisiones", function () {
    it("Should change fee recipient and affect all existing wrappers immediately", async function () {
      console.log("\n📨 === FLUJO 6: CAMBIAR RECEPTOR DE COMISIONES ===");
      
      console.log(`📬 Current fee recipient: ${feeRecipient.address}`);
      console.log(`📬 New fee recipient: ${newFeeRecipient.address}`);

      // Record current recipient balances
      const oldRecipientXBefore = await tokenX.balanceOf(feeRecipient.address);
      const oldRecipientYBefore = await tokenY.balanceOf(feeRecipient.address);
      const newRecipientXBefore = await tokenX.balanceOf(newFeeRecipient.address);
      const newRecipientYBefore = await tokenY.balanceOf(newFeeRecipient.address);

      console.log(`\n📈 Recipient balances before change:`);
      console.log(`   Old recipient X: ${ethers.formatEther(oldRecipientXBefore)}`);
      console.log(`   Old recipient Y: ${ethers.formatEther(oldRecipientYBefore)}`);
      console.log(`   New recipient X: ${ethers.formatEther(newRecipientXBefore)}`);
      console.log(`   New recipient Y: ${ethers.formatEther(newRecipientYBefore)}`);

      // Change fee recipient (only treasurer can do this)
      console.log("\n🔄 Treasurer changing fee recipient...");
      const tx = await factory.connect(treasurer).setFeeRecipient(newFeeRecipient.address);
      const receipt = await tx.wait();

      // Verify event emission
      const updateEvent = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'FeeRecipientUpdated';
        } catch {
          return false;
        }
      });

      expect(updateEvent).to.not.be.undefined;
      const parsedEvent = factory.interface.parseLog({
        topics: updateEvent!.topics as string[],
        data: updateEvent!.data
      });

      expect(parsedEvent!.args[0]).to.equal(feeRecipient.address); // oldRecipient
      expect(parsedEvent!.args[1]).to.equal(newFeeRecipient.address); // newRecipient

      // Verify factory updated
      expect(await factory.getFeeRecipient()).to.equal(newFeeRecipient.address);
      console.log("✅ Factory fee recipient updated");

      // Test that both existing wrappers now use the new recipient
      const testDepositAmount = ethers.parseEther("50");
      const expectedFee = (testDepositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);

      console.log(`\n🧪 Testing both wrappers use new recipient...`);
      console.log(`   Test deposit: ${ethers.formatEther(testDepositAmount)}`);
      console.log(`   Expected fee: ${ethers.formatEther(expectedFee)}`);

      // Setup approvals for test deposits
      await tokenX.connect(maria).approve(await wrapperX.getAddress(), testDepositAmount);
      await tokenY.connect(juan).approve(await wrapperY.getAddress(), testDepositAmount);

      // Test deposit in wrapper X
      console.log(`\n💰 Testing wrapper X...`);
      await wrapperX.connect(maria).deposit(testDepositAmount);

      // Test deposit in wrapper Y
      console.log(`💰 Testing wrapper Y...`);
      await wrapperY.connect(juan).deposit(testDepositAmount);

      // Verify fees went to new recipient
      const oldRecipientXAfter = await tokenX.balanceOf(feeRecipient.address);
      const oldRecipientYAfter = await tokenY.balanceOf(feeRecipient.address);
      const newRecipientXAfter = await tokenX.balanceOf(newFeeRecipient.address);
      const newRecipientYAfter = await tokenY.balanceOf(newFeeRecipient.address);

      console.log(`\n📊 Recipient balances after test deposits:`);
      console.log(`   Old recipient X: ${ethers.formatEther(oldRecipientXAfter)} (no change: ${oldRecipientXAfter === oldRecipientXBefore})`);
      console.log(`   Old recipient Y: ${ethers.formatEther(oldRecipientYAfter)} (no change: ${oldRecipientYAfter === oldRecipientYBefore})`);
      console.log(`   New recipient X: ${ethers.formatEther(newRecipientXAfter)} (+${ethers.formatEther(newRecipientXAfter - newRecipientXBefore)})`);
      console.log(`   New recipient Y: ${ethers.formatEther(newRecipientYAfter)} (+${ethers.formatEther(newRecipientYAfter - newRecipientYBefore)})`);

      // Verify old recipient didn't receive new fees
      expect(oldRecipientXAfter).to.equal(oldRecipientXBefore);
      expect(oldRecipientYAfter).to.equal(oldRecipientYBefore);

      // Verify new recipient received fees from both wrappers
      expect(newRecipientXAfter - newRecipientXBefore).to.equal(expectedFee);
      expect(newRecipientYAfter - newRecipientYBefore).to.equal(expectedFee);

      console.log("✅ Flujo 6 completed successfully - Fee recipient change affects all wrappers immediately");
      console.log("✅ All existing wrappers now send fees to new recipient without redeploy");
    });
  });

  describe("✅ Flujo 7: Subir Tasa de Fee para Futuros Wrappers", function () {
    it("Should increase fee rate for future wrappers only", async function () {
      console.log("\n📈 === FLUJO 7: SUBIR TASA DE FEE ===");
      
      console.log(`📊 Flujo 7 Current fee rate: ${INITIAL_FEE_RATE} basis points (${INITIAL_FEE_RATE/100}%)`);
      console.log(`📊 Flujo 7 New fee rate: ${NEW_FEE_RATE} basis points (${NEW_FEE_RATE/100}%)`);

      // Verify existing wrappers still have old fee rate
      expect(await wrapperX.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      expect(await wrapperY.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      console.log("✅ Flujo 7 Existing wrappers still have old fee rate");

      // Change fee rate (only operator can do this)
      console.log("\n🔧 Flujo 7 Operator changing fee rate...");
      const tx = await factory.connect(operator).setDepositFeeRate(NEW_FEE_RATE);
      const receipt = await tx.wait();

      // Verify event emission
      const updateEvent = receipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'DepositFeeRateUpdated';
        } catch {
          return false;
        }
      });

      expect(updateEvent).to.not.be.undefined;
      const parsedEvent = factory.interface.parseLog({
        topics: updateEvent!.topics as string[],
        data: updateEvent!.data
      });

      expect(parsedEvent!.args[0]).to.equal(INITIAL_FEE_RATE); // oldRate
      expect(parsedEvent!.args[1]).to.equal(NEW_FEE_RATE); // newRate

      // Verify factory updated
      const factoryInfo = await factory.getFactoryInfo();
      expect(factoryInfo.currentFeeRate).to.equal(NEW_FEE_RATE);
      console.log("✅ Flujo 7 Factory fee rate updated");

      // Verify existing wrappers still have old fee rate
      expect(await wrapperX.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      expect(await wrapperY.depositFeeRate()).to.equal(INITIAL_FEE_RATE);
      console.log("✅ Existing wrappers unaffected by fee rate change");

      // Create new token and wrapper to test new fee rate
      console.log("\n🆕 Flujo 7 Creating new token Z and wrapper to test new fee rate...");
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tokenZ = await MockERC20.deploy("Token Z", "Z", DECIMALS, INITIAL_SUPPLY);
      await tokenZ.waitForDeployment();

      // Transfer some tokens to Carlos for testing
      await tokenZ.transfer(carlos.address, ethers.parseEther("1000"));

      // Create wrapper for new token
      const createTx = await factory.connect(carlos).createWrapper(
        await tokenZ.getAddress(),
        "Wrapped Token Z",
        "wZ"
      );
      const createReceipt = await createTx.wait();

      const createEvent = createReceipt?.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          return parsed?.name === 'WrapperCreated';
        } catch {
          return false;
        }
      });

      const createParsedEvent = factory.interface.parseLog({
        topics: createEvent!.topics as string[],
        data: createEvent!.data
      });

      const wrapperZAddress = createParsedEvent!.args[1];
      const wrapperZ = await ethers.getContractAt("ERC20Wrapped", wrapperZAddress);

      console.log(`🎁 Flujo 7 Wrapper Z created at: ${wrapperZAddress}`);

      // Verify new wrapper has new fee rate
      expect(await wrapperZ.depositFeeRate()).to.equal(NEW_FEE_RATE);
      console.log(`✅ Flujo 7 New wrapper has new fee rate: ${NEW_FEE_RATE} basis points`);

      // Test deposits with different fee rates
      const testAmount = ethers.parseEther("100");
      const oldFeeAmount = (testAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const newFeeAmount = (testAmount * BigInt(NEW_FEE_RATE)) / BigInt(10000);

      console.log(`\n🧪 Flujo 7Testing deposits with different fee rates:`);
      console.log(`  Flujo 7 Test amount: ${ethers.formatEther(testAmount)}`);
      console.log(`  Flujo 7 Old fee (${INITIAL_FEE_RATE/100}%): ${ethers.formatEther(oldFeeAmount)}`);
      console.log(` Flujo 7  New fee (${NEW_FEE_RATE/100}%): ${ethers.formatEther(newFeeAmount)}`);

      // Setup approvals
      await tokenX.connect(maria).approve(await wrapperX.getAddress(), testAmount);
      await tokenZ.connect(carlos).approve(wrapperZAddress, testAmount);

      // Record balances
      const recipientBefore = await tokenX.balanceOf(newFeeRecipient.address);
      const recipientZBefore = await tokenZ.balanceOf(newFeeRecipient.address);

      // Test deposits
      await wrapperX.connect(maria).deposit(testAmount); // Old fee rate
      await wrapperZ.connect(carlos).deposit(testAmount); // New fee rate

      // Check fee amounts received
      const recipientAfter = await tokenX.balanceOf(newFeeRecipient.address);
      const recipientZAfter = await tokenZ.balanceOf(newFeeRecipient.address);

      const feeXReceived = recipientAfter - recipientBefore;
      const feeZReceived = recipientZAfter - recipientZBefore;

      console.log(`\n📊 Flujo 7Fees received by recipient:`);
      console.log(` Flujo 7  From old wrapper X: ${ethers.formatEther(feeXReceived)} (${INITIAL_FEE_RATE/100}% rate)`);
      console.log(` Flujo 7  From new wrapper Z: ${ethers.formatEther(feeZReceived)} (${NEW_FEE_RATE/100}% rate)`);

      // Verify correct fee amounts
      expect(feeXReceived).to.equal(oldFeeAmount);
      expect(feeZReceived).to.equal(newFeeAmount);

      console.log("✅ Flujo 7 completed successfully - Fee rate change affects only future wrappers");
      console.log("✅ Existing wrappers continue with their original fee rates");
      console.log("✅ New wrappers use updated fee rate from factory");
    });
  });

  describe("📊 E2E Integration Summary", function () {
    it("Should provide complete system summary", async function () {
      console.log("\n🎯 === E2E INTEGRATION SUMMARY ===");
      
      // Factory stats
      const factoryInfo = await factory.getFactoryInfo();
      const totalWrappers = factoryInfo.totalWrappers;
      const currentFeeRate = factoryInfo.currentFeeRate;
      const currentRecipient = await factory.getFeeRecipient();

      console.log(`\n🏭 E2E Factory Status:`);
      console.log(`  E2E Total wrappers created: ${totalWrappers}`);
      console.log(`  E2E Current fee rate: ${currentFeeRate} basis points (${Number(currentFeeRate)/100}%)`);
      console.log(`  E2E Current fee recipient: ${currentRecipient}`);

      // Wrapper stats
      const wrapperXSupply = await wrapperX.totalSupply();
      const wrapperYSupply = await wrapperY.totalSupply();
      const wrapperXReserves = await tokenX.balanceOf(await wrapperX.getAddress());
      const wrapperYReserves = await tokenY.balanceOf(await wrapperY.getAddress());

      console.log(`\n🎁 E2E Wrapper X Status:`);
      console.log(`  E2E Total supply: ${ethers.formatEther(wrapperXSupply)} wX`);
      console.log(`  E2E Reserves: ${ethers.formatEther(wrapperXReserves)} X`);
      console.log(`  E2E Fee rate: ${await wrapperX.depositFeeRate()} basis points`);
      console.log(`  E2E Invariant healthy: ${wrapperXSupply === wrapperXReserves}`);

      console.log(`\n🎁 E2E Wrapper Y Status:`);
      console.log(`  E2E Total supply: ${ethers.formatEther(wrapperYSupply)} wY`);
      console.log(`  E2E Reserves: ${ethers.formatEther(wrapperYReserves)} Y`);
      console.log(`  E2E Fee rate: ${await wrapperY.depositFeeRate()} basis points`);
      console.log(`  E2E Invariant healthy: ${wrapperYSupply === wrapperYReserves}`);

      // Fee recipient stats
      const recipientXBalance = await tokenX.balanceOf(currentRecipient);
      const recipientYBalance = await tokenY.balanceOf(currentRecipient);

      console.log(`\n💰E2E Fee Recipient Status:`);
      console.log(`  E2E Address: ${currentRecipient}`);
      console.log(`  E2E Token X fees collected: ${ethers.formatEther(recipientXBalance)} X`);
      console.log(`  E2E Token Y fees collected: ${ethers.formatEther(recipientYBalance)} Y`);

      // User balances
      const mariaWX = await wrapperX.balanceOf(maria.address);
      const juanWY = await wrapperY.balanceOf(juan.address);
      const anaWX = await wrapperX.balanceOf(ana.address);

      console.log(`\n👥 E2E User Balances:`);
      console.log(`  E2E María wX: ${ethers.formatEther(mariaWX)}`);
      console.log(`  E2E Juan wY: ${ethers.formatEther(juanWY)}`);
      console.log(`  E2E Ana wX: ${ethers.formatEther(anaWX)}`);

      // Verify all invariants
      expect(wrapperXSupply).to.equal(wrapperXReserves);
      expect(wrapperYSupply).to.equal(wrapperYReserves);
      expect(totalWrappers).to.equal(3); // X, Y, and Z

      console.log(`\n✅ E2E All ${totalWrappers} wrappers maintain healthy invariants`);
      console.log("✅ Complete E2E flow testing successful");
      console.log("✅ E2E System ready for production deployment");
    });
  });
});
