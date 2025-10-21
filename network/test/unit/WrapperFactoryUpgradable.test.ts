import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { 
  WrapperFactoryUpgradeable, 
  WrapperFactoryV2, 
  MockERC20WithPermit, 
  ERC20Wrapped 
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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
    value: value,
    nonce: await token.nonces(owner.address),
    deadline: deadline
  };
  
  const signature = await owner.signTypedData(domain, types, values);
  return ethers.Signature.from(signature);
}

describe("WrapperFactory - Upgradeability", function () {
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

      const newVersion = "2.0.0";
      // Initialize V2 specific variables
      await factoryV2.initializeV2(newVersion);
      
      // Verify upgrade
      expect(await factoryV2.version()).to.equal(newVersion);
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
      
      await factoryV2.initializeV2("2.0.0");
      
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
      
      await factoryV2.initializeV2("2.0.0");
      
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
      
      await factoryV2.initializeV2("2.0.0");
      
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

  describe("EIP-2612 Permit Functionality", function () {
    let deadline: number;
    let wrapperContract: ERC20Wrapped;

    this.beforeEach(async function () {
      const currentTimestamp = await time.latest();
      deadline = currentTimestamp + 3600; // 1 hour from now
      
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

      const underlayingSupply = await underlyingToken.totalSupply();
      const wrappedSupply = await wrapperContract.totalSupply();
      console.log(`Total underlyingToken supply: ${ethers.formatEther(underlayingSupply)}`);
      console.log(`Total wrappedToken supply: ${ethers.formatEther(wrappedSupply)}`);
    });
    it("Should permit successfully with valid signature", async function () {
      const permitAmount = ethers.parseEther("500");
      const sig = await getPermitSignature(
        underlyingToken,
        user1,
        user2.address,
        permitAmount,
        deadline
      );

       // Verificar nonce inicial
      expect(await underlyingToken.nonces(user1.address)).to.equal(0);

      // Ejecutar permit
      await expect(
        underlyingToken.permit(
          user1.address,
          user2.address,
          permitAmount,
          deadline,
          sig.v,
          sig.r,
          sig.s
        )
      )
      .to.emit(underlyingToken, "Approval")
      .withArgs(user1.address, user2.address, permitAmount);

      // Verificar resultado
      expect(await underlyingToken.allowance(user1.address, user2.address)).to.equal(permitAmount);
      expect(await underlyingToken.nonces(user1.address)).to.equal(1);
    });

    it("Should deposit with permit", async function () {
      // Preparar: mint y balance para user1
      const initialMint = ethers.parseEther("1000");
      await underlyingToken.mint(user1.address, initialMint);

      // Obtener dirección del wrapper
      const wrapperAddress = await wrapperContract.getAddress();

      // Cantidad a depositar con permit
      const depositAmount = ethers.parseEther("50");

      // Generar firma permit para que el wrapper pueda gastar en nombre de user1
      const sig = await getPermitSignature(
        underlyingToken,
        user1,
        wrapperAddress,
        depositAmount,
        deadline
      );

      // Registros previos
      const userUnderlyingBefore = await underlyingToken.balanceOf(user1.address);
      const userWrappedBefore = await wrapperContract.balanceOf(user1.address);
      const recipientBefore = await underlyingToken.balanceOf(await factoryV1.feeRecipient());
      const wrapperReservesBefore = await underlyingToken.balanceOf(wrapperAddress);

      console.log('\n>>> Deposit with permit - before');
      console.log('User underlying before:', ethers.formatEther(userUnderlyingBefore));
      console.log('User wrapped before:', ethers.formatEther(userWrappedBefore));

      // Ejecutar depositWithPermit en el wrapper
      const tx = await wrapperContract.connect(user1).depositWithPermit(
        depositAmount,
        deadline,
        sig.v,
        sig.r,
        sig.s
      );
      const receipt = await tx.wait();

      // Buscar evento Deposit
      const depositEventLog = receipt?.logs.find(log => {
        try {
          const parsed = wrapperContract.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === 'Deposit';
        } catch {
          return false;
        }
      });
      expect(depositEventLog).to.not.be.undefined;
      const parsed = wrapperContract.interface.parseLog({ topics: depositEventLog!.topics as string[], data: depositEventLog!.data });

      // Calcular expected fee y wrapped
      const expectedFee = (depositAmount * BigInt(INITIAL_FEE_RATE)) / BigInt(10000);
      const expectedWrapped = depositAmount - expectedFee;

      // Verificar argumentos del evento
      expect(parsed!.args[0]).to.equal(user1.address);
      expect(parsed!.args[1]).to.equal(depositAmount);
      expect(parsed!.args[2]).to.equal(expectedWrapped);
      expect(parsed!.args[3]).to.equal(expectedFee);

      // Balances posteriores
      const userUnderlyingAfter = await underlyingToken.balanceOf(user1.address);
      const userWrappedAfter = await wrapperContract.balanceOf(user1.address);
      const recipientAfter = await underlyingToken.balanceOf(await factoryV1.feeRecipient());
      const wrapperReservesAfter = await underlyingToken.balanceOf(wrapperAddress);
      const totalSupply = await wrapperContract.totalSupply();

      console.log('\n>>> Deposit with permit - after');
      console.log('User underlying after:', ethers.formatEther(userUnderlyingAfter));
      console.log('User wrapped after:', ethers.formatEther(userWrappedAfter));
      console.log('Fee recipient after:', ethers.formatEther(recipientAfter));

      // Verificaciones de balances
      expect(userUnderlyingBefore - userUnderlyingAfter).to.equal(depositAmount);
      expect(userWrappedAfter - userWrappedBefore).to.equal(expectedWrapped);
      expect(recipientAfter - recipientBefore).to.equal(expectedFee);
      expect(wrapperReservesAfter - wrapperReservesBefore).to.equal(expectedWrapped);
      expect(totalSupply).to.equal(expectedWrapped);

      // Ahora cambiar la fee en factory y crear otro wrapper para underlyingToken (simulando nuevo wrapper con nuevo fee)
      await factoryV1.connect(operator).setDepositFeeRate(300); // 3%

      // Crear nuevo wrapper for a diferente underlying (anotherToken) after fee change
      const tx2 = await factoryV1.connect(user2).createWrapper(await anotherToken.getAddress(), WRAPPED_NAME, WRAPPED_SYMBOL);
      const rcpt2 = await tx2.wait();
      const event2 = rcpt2?.logs.find(log => {
        try {
          const parsed = factoryV1.interface.parseLog(log);
          return parsed?.name === 'WrapperCreated';
        } catch { return false; }
      });
      const parsedEvent2 = factoryV1.interface.parseLog(event2!);
      const wrapper2Address = parsedEvent2!.args.wrapper;
      const wrapper2 = await ethers.getContractAt('ERC20Wrapped', wrapper2Address);

      // Mint and permit for user1 again on the new underlying (anotherToken)
      await anotherToken.mint(user1.address, ethers.parseEther('100'));
      const deposit2 = ethers.parseEther('40');
      const sig2 = await getPermitSignature(anotherToken, user1, wrapper2Address, deposit2, deadline);

      const recipientBefore2 = await anotherToken.balanceOf(await factoryV1.feeRecipient());
      const wrapper2ReservesBefore = await anotherToken.balanceOf(wrapper2Address);

      // depositWithPermit on new wrapper (should use new fee 3%)
      const tx3 = await wrapper2.connect(user1).depositWithPermit(deposit2, deadline, sig2.v, sig2.r, sig2.s);
      const rc3 = await tx3.wait();

      const newFee = (deposit2 * BigInt(300)) / BigInt(10000);
      const newWrapped = deposit2 - newFee;

      const recipientAfter2 = await anotherToken.balanceOf(await factoryV1.feeRecipient());
      const wrapper2ReservesAfter = await anotherToken.balanceOf(wrapper2Address);
      const totalSupply2 = await wrapper2.totalSupply();

      console.log('\n>>> Deposit with permit on new wrapper after fee change');
      console.log('Deposit2:', ethers.formatEther(deposit2));
      console.log('Expected new fee (3%):', ethers.formatEther(newFee));
      console.log('Expected new wrapped:', ethers.formatEther(newWrapped));

      expect(recipientAfter2 - recipientBefore2).to.equal(newFee);
      expect(wrapper2ReservesAfter - wrapper2ReservesBefore).to.equal(newWrapped);
      expect(totalSupply2).to.equal(newWrapped);
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
      
      // Setup tokens for testing with approve
      await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
      await underlyingToken.connect(user1).approve(wrapperAddress, ethers.parseEther("100"));
    });

    it("Should allow existing wrappers to function normally after upgrade", async function () {
      // Test deposit before upgrade
      const depositAmount = ethers.parseEther("50");
      await wrapperContract.connect(user1).deposit(depositAmount);
      
      const balanceBefore = await wrapperContract.balanceOf(user1.address);
      const previewDeposit = await wrapperContract.previewDeposit(depositAmount);
      console.log("FEE1 Balance before upgrade:", ethers.formatEther(balanceBefore));
      console.log("FEE1 Preview deposit:", previewDeposit.wrappedAmount);
      expect(balanceBefore).to.be.eq(ethers.toBigInt(previewDeposit.wrappedAmount)); // 50 - 1.5% fee
      
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2("2.0.0");
      
      // Test deposit after upgrade - should still work
      await underlyingToken.connect(user1).approve(await wrapperContract.getAddress(), ethers.parseEther("50"));
      await wrapperContract.connect(user1).deposit(ethers.parseEther("25"));
      
      const balanceAfter = await wrapperContract.balanceOf(user1.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should allow withdrawal from existing wrappers after upgrade", async function () {
      // Make deposit before upgrade
      const depositAmount = ethers.parseEther("30");
      await wrapperContract.connect(user1).deposit(depositAmount);
      const wrappedBalance = await wrapperContract.balanceOf(user1.address);
      console.log('withdraw wrapped balance user1:', ethers.formatEther(wrappedBalance));
      // Upgrade to V2
      const WrapperFactoryV2Factory = await ethers.getContractFactory("WrapperFactoryV2");
      factoryV2 = await upgrades.upgradeProxy(
        await factoryV1.getAddress(),
        WrapperFactoryV2Factory
      ) as unknown as WrapperFactoryV2;
      
      await factoryV2.initializeV2("2.0.0");
      
      // Test withdrawal after upgrade
      const underlyingBalanceBefore = await underlyingToken.balanceOf(user1.address);
      console.log('withdraw underlying before user1:', ethers.formatEther(underlyingBalanceBefore));

      await wrapperContract.connect(user1).withdraw(wrappedBalance);
      const underlyingBalanceAfter = await underlyingToken.balanceOf(user1.address);
      console.log('withdraw underlying after user1:', ethers.formatEther(underlyingBalanceAfter));
    
      expect(underlyingBalanceAfter).to.be.gt(underlyingBalanceBefore);
      console.log('withdraw wrapped user1:', await wrapperContract.balanceOf(user1.address));
      expect(await wrapperContract.balanceOf(user1.address)).to.equal(0);
    });

  });
});
