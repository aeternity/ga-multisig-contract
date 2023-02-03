const { use, assert, expect } = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { utils, wallets } = require('@aeternity/aeproject');
const { MemoryAccount, Tag, generateKeyPair } = require('@aeternity/aepp-sdk');

use(chaiAsPromised);

describe('SimpleGAMultiSig', () => {
  let aeSdk;
  let source;
  let gaContract;
  let gaKeyPair;
  let gaAccount;

  const accounts = utils.getDefaultAccounts();

  const signer1 = accounts[1];
  const signer2 = accounts[2];
  const signer3 = accounts[3];
  const signer1Address = wallets[1].publicKey;
  const signer2Address = wallets[2].publicKey;
  const signer3Address = wallets[3].publicKey;

  const invalidSigner = accounts[4];

  const testRecipientKeyPair = generateKeyPair();
  const testRecipientAddress = testRecipientKeyPair.publicKey;
  let testSpendTx;
  let testSpendTxHash;

  const testDifferentRecipientKeyPair = generateKeyPair();
  const testDifferentRecipientAddress = testDifferentRecipientKeyPair.publicKey;
  let testDifferentSpendTx;
  let testDifferentSpendTxHash;

  const testSpendAmount = 1000;

  const expectedInitialConsensusInfo = {
    tx_hash: undefined,
    confirmations_required: 2n,
    confirmed_by: [],
    refused_by: [],
    has_consensus: false,
    expiration_height: 0n,
    expired: false
  }
  let consensusInfo;

  const getTxHash = async (encodedTx) => aeSdk.buildAuthTxHash(encodedTx);

  const proposeTx = async (account, gaTxHash, ttl) => {
    const txResult = await gaContract.methods.propose(gaTxHash, ttl, { onAccount: account });
    return txResult;
  };

  const confirmTx = async (account, gaTxHash) => {
    const txResult = await gaContract.methods.confirm(gaTxHash, { onAccount: account });
    return txResult;
  };

  const refuseTx = async (account, gaTxHash) => {
    const txResult = await gaContract.methods.refuse(gaTxHash, { onAccount: account });
    return txResult;
  };

  const revokeTx = async (account, gaTxHash) => {
    const txResult = await gaContract.methods.revoke(gaTxHash, { onAccount: account });
    return txResult;
  };

  before(async () => {
    aeSdk = await utils.getSdk();

    // create a new keypair to allow reoccuring tests
    gaKeyPair = generateKeyPair();
    gaAccount = new MemoryAccount({ keypair: gaKeyPair });
    // fund the account for the fresh generated keypair
    await aeSdk.spend(10e18, gaKeyPair.publicKey, { onAccount: accounts[0] });

    // get content of contract
    source = utils.getContractContent('./contracts/SimpleGAMultiSig.aes');

    // attach the Generalized Account
    await aeSdk.createGeneralizedAccount('authorize', source, [2, [signer1Address, signer2Address, signer3Address]], { onAccount: gaAccount });
    const isGa = await aeSdk.isGA(gaKeyPair.publicKey);
    assert.equal(isGa, true);
    gaAccount.isGa = true;

    // get gaContract instance
    const { contractId: contractAddress } = await aeSdk.getAccount(gaKeyPair.publicKey);
    gaContract = await aeSdk.getContractInstance({ source, contractAddress });

    const signers = (await gaContract.methods.get_signers()).decodedResult;
    assert.equal(signers.length, 3);

    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);

    const version = (await gaContract.methods.get_version()).decodedResult;
    assert.equal(version, '2.0.0');

    const fee_protection_enabled = (await gaContract.methods.is_fee_protection_enabled()).decodedResult;
    assert.isTrue(fee_protection_enabled);

    const expectedFeeProtection = {
      max_fee: 2_000_000_000_000_000n,
      max_gasprice: 10_000_000_000n
    }
    const fee_protection = (await gaContract.methods.get_fee_protection()).decodedResult;
    assert.deepEqual(fee_protection, expectedFeeProtection);

    // prepare SpendTx and its hash
    testSpendTx = await aeSdk.buildTx(Tag.SpendTx, {
      senderId: gaKeyPair.publicKey,
      recipientId: testRecipientAddress,
      amount: testSpendAmount,
    });
    testSpendTxHash = await getTxHash(testSpendTx);

    testDifferentSpendTx = await aeSdk.buildTx(Tag.SpendTx, {
      senderId: gaKeyPair.publicKey,
      recipientId: testDifferentRecipientAddress,
      amount: testSpendAmount,
    });
    testDifferentSpendTxHash = await getTxHash(testDifferentSpendTx);
  });

  describe('Successfull happy paths', () => {
    it('Successfully perform a SpendTx', async () => {
      const expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer1, testSpendTxHash, { FixedTTL: [expirationHeight] });
      let expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer1Address],
        refused_by: [],
        has_consensus: false,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      await confirmTx(signer2, testSpendTxHash);
      expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer2Address, signer1Address],
        refused_by: [],
        has_consensus: true,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      const nonce = (await gaContract.methods.get_nonce()).decodedResult;

      await aeSdk.send(testSpendTx, { onAccount: gaAccount, authData: { source, args: [nonce] } });
      expect(BigInt(await aeSdk.getBalance(testRecipientAddress))).to.be.equal(BigInt(testSpendAmount));

      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    it('Successfully revoke a tx as proposer', async () => {
      const expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer1, testSpendTxHash, { FixedTTL: [expirationHeight] });
      let expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer1Address],
        refused_by: [],
        has_consensus: false,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      await revokeTx(signer1, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    it('Successfully revoke a tx as co-signer', async () => {
      const expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer1, testSpendTxHash, { FixedTTL: [expirationHeight] });
      await confirmTx(signer2, testSpendTxHash);
      let expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer2Address, signer1Address],
        refused_by: [],
        has_consensus: true,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      await refuseTx(signer2, testSpendTxHash);
      expectedConsensusInfo.confirmed_by = [signer1Address];
      expectedConsensusInfo.refused_by = [signer2Address];
      expectedConsensusInfo.has_consensus = false;
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);
      
      await refuseTx(signer3, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });
  });

  describe('Authorization / permission checks', () => {
    it('Fail if there is no tx to confirm', async() => {
      await expect(
        confirmTx(signer1, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOTHING_TO_CONFIRM"`);
    });

    it('Fail to confirm the same tx twice', async() => {
      // proposal counts as confirmation
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });

      await expect(
        confirmTx(signer1, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_ALREADY_CONFIRMED"`);

      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    xit('Fail if authorize is called and no tx is proposed', async () => {
      // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
      // => we should be able to read the error here
      const nonce = (await gaContract.methods.get_nonce()).decodedResult;
      await expect(
        aeSdk.send(testSpendTx, { onAccount: gaAccount, authData: { source, args: [nonce] } })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NO_TX_PROPOSED"`);
    });

    it('Fail for different actions if tx is expired', async() => {
      let expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer1, testSpendTxHash, { FixedTTL: [expirationHeight] });
      let expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer1Address],
        refused_by: [],
        has_consensus: false,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // verify that proposing a new tx is not possible if current tx is not expired
      await expect(
        proposeTx(signer2, testSpendTxHash, { RelativeTTL: [50] })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_EXISTING_PROPOSED_TX_NOT_EXPIRED"`);

      // enforce expiration
      await utils.awaitKeyBlocks(aeSdk, 50);

      // check expiration
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expectedConsensusInfo.expired = true;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // propose new tx with different signer
      expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer2, testSpendTxHash, { FixedTTL: [expirationHeight] });
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expectedConsensusInfo.expiration_height = BigInt(expirationHeight);
      expectedConsensusInfo.expired = false;
      expectedConsensusInfo.confirmed_by = [signer2Address];
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      await confirmTx(signer3, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expectedConsensusInfo.confirmed_by = [signer2Address, signer3Address];
      expectedConsensusInfo.has_consensus = true;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // enforce expiration
      await utils.awaitKeyBlocks(aeSdk, 50);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expectedConsensusInfo.expired = true;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
      // verify that it is not possible to authorize a confirmed tx which is expired
      // await expect(
      //   aeSdk.send(testSpendTx, { onAccount: gaAccount, authData: { source, args: [nonce] } })
      // ).to.be.rejectedWith(`Invocation failed: "ERROR_TX_EXPIRED"`);

      // propose new tx with different signer
      expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer3, testSpendTxHash, { FixedTTL: [expirationHeight] });
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expectedConsensusInfo.expiration_height = BigInt(expirationHeight);
      expectedConsensusInfo.expired = false;
      expectedConsensusInfo.confirmed_by = [signer3Address];
      expectedConsensusInfo.has_consensus = false;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // enforce expiration
      await utils.awaitKeyBlocks(aeSdk, 50);

      // verify that an expired tx cannot be confirmed
      await expect(
        confirmTx(signer1, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_TX_EXPIRED"`);

      // revoke to ensure rollback to initial state
      await revokeTx(signer3, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    it('Fail to propose and confirm tx with invalid signer', async() => {
      // verify that it is not possible to propose a tx if not in list of cosigners
      await expect(
        proposeTx(invalidSigner, testSpendTxHash, { RelativeTTL: [50] })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

      const expirationHeight = await aeSdk.height() + 50;
      await proposeTx(signer3, testSpendTxHash, { FixedTTL: [expirationHeight] });
      let expectedConsensusInfo = {
        tx_hash: testSpendTxHash,
        confirmations_required: 2n,
        confirmed_by: [signer3Address],
        refused_by: [],
        has_consensus: false,
        expiration_height: BigInt(expirationHeight),
        expired: false
      }
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedConsensusInfo);

      // verify that it is not possible to confirm a tx if not in list of cosigners
      await expect(
        confirmTx(invalidSigner, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

      // revoke to ensure rollback to initial state
      await revokeTx(signer3, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    it('Fail to confirm a tx with a valid signature for wrong tx hash', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });

      // confirm should fail if signature for wrong tx hash is provided
      await expect(
        confirmTx(signer2, testDifferentSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
    });

    it('Fail to revoke as co-signer', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });
      await expect(
        revokeTx(signer2, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_CALLER_NOT_PROPOSER"`);
      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
    });

    it('Fail to refuse as non co-signer', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });
      await expect(
        revokeTx(invalidSigner, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);
      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
    });

    it('Fail if the signer remains in the (refused_by) list after confirming tx again.', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });
      await refuseTx(signer2, testSpendTxHash);
      await confirmTx(signer2, testSpendTxHash);
      consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
      expect(consensusInfo.refused_by.includes(signer2Address)).to.be.false 
      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
    });

    it('Fail to refuse twice as co-signer', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });
      await refuseTx(signer2, testSpendTxHash);
      await expect(
        refuseTx(signer2, testSpendTxHash)
      ).to.be.rejectedWith(`Invocation failed: "ERROR_ALREADY_REFUSED"`);
      // revoke to ensure rollback to initial state
      await revokeTx(signer1, testSpendTxHash);
    });

    xit('Fail to authorize a tx with different checks (consensus, wrong tx)', async() => {
      await proposeTx(signer1, testSpendTxHash, { RelativeTTL: [50] });
      const nonce = (await gaContract.methods.get_nonce()).decodedResult;

      // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
      await expect(
        aeSdk.send(testSpendTx, { onAccount: gaAccount, authData: { source, args: [nonce] } })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NO_CONSENSUS"`);

      await confirmTx(signer2, testSpendTxHash);

      // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
      // verify that authorizing a wrong tx is not possible
      await expect(
        aeSdk.send(testDifferentSpendTx, { onAccount: gaAccount, authData: { source, args: [nonce] } })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_UNEQUAL_HASHES"`);

      // revoke to ensure rollback to initial state
      await revokeTx(signer3, testSpendTxHash);
    });
  });

  describe('Handling fee protection', () => {
    const validUpdatedFeeProtection = {
      max_fee: 2_500_000_000_000_000n,
      max_gasprice: 15_000_000_000n
    }
    it('Fail to change fee protection as non-valid signer', async () => {
      await expect(
        gaContract.methods.disable_fee_protection({ onAccount: invalidSigner })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_A_VALID_SIGNER"`);

      await expect(
        gaContract.methods.update_fee_protection(validUpdatedFeeProtection, { onAccount: invalidSigner })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_A_VALID_SIGNER"`);
    });
    it('Successfully change fee protection', async () => {
      await gaContract.methods.update_fee_protection(validUpdatedFeeProtection, { onAccount: signer1 });
      let fee_protection = (await gaContract.methods.get_fee_protection()).decodedResult;
      assert.deepEqual(fee_protection, validUpdatedFeeProtection);

      await gaContract.methods.disable_fee_protection({ onAccount: signer1 });
      const fee_protection_enabled = (await gaContract.methods.is_fee_protection_enabled()).decodedResult;
      assert.isFalse(fee_protection_enabled);
      fee_protection = (await gaContract.methods.get_fee_protection()).decodedResult;
      assert.deepEqual(fee_protection, undefined);

      await expect(
        gaContract.methods.disable_fee_protection({ onAccount: signer1 })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_FEE_PROTECTION_ALREADY_DISABLED"`);

      await expect(
        gaContract.methods.update_fee_protection(validUpdatedFeeProtection, { onAccount: signer1 })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_FEE_PROTECTION_ALREADY_DISABLED"`);
    });
  });

  describe('Stupidity Checks', () => {
    it('Fail trying to attach a GA twice', async () => {
      await expect(
        aeSdk.createGeneralizedAccount(
          'authorize',
          source,
          [2, [signer1Address, signer2Address, signer3Address]],
          { onAccount: gaAccount }
        )
      ).to.be.rejectedWith(`Account ${gaKeyPair.publicKey} is already GA`);
    });
    it('Fail to attach GA if confirmations exceed amount of signers', async () => {
      const testKeyPair = generateKeyPair();
      const testAccount = new MemoryAccount({ keypair: testKeyPair });
      await aeSdk.spend(10e18, testKeyPair.publicKey, { onAccount: accounts[0] });
      await expect(
        aeSdk.createGeneralizedAccount(
          'authorize',
          source,
          [3, [signer1Address, signer2Address]],
          { onAccount: testAccount })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_CONFIRMATIONS_EXCEED_AMOUNT_OF_SIGNERS"`);
    });

    it('Fail to attach GA with only one signer', async () => {
      const testKeyPair = generateKeyPair();
      const testAccount = new MemoryAccount({ keypair: testKeyPair });
      await aeSdk.spend(10e18, testKeyPair.publicKey, { onAccount: accounts[0] });
      await expect(
        aeSdk.createGeneralizedAccount(
          'authorize',
          source,
          [1, [signer1Address]],
          { onAccount: testAccount })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_MIN_2_SIGNERS"`);
    });

    it('Fail to attach GA if account to transform is in list of signers', async () => {
      const testKeyPair = generateKeyPair();
      const testAccount = new MemoryAccount({ keypair: testKeyPair });
      await aeSdk.spend(10e18, testKeyPair.publicKey, { onAccount: accounts[0] });
      await expect(
        aeSdk.createGeneralizedAccount(
          'authorize',
          source,
          [2, [signer1Address, testKeyPair.publicKey]],
          { onAccount: testAccount })
      ).to.be.rejectedWith(`Invocation failed: "ERROR_ACCOUNT_OF_GA_MUST_NOT_BE_SIGNER"`);
    });
  });
});
