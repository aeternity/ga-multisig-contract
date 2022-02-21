const { use, assert, expect } = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { utils, wallets } = require('@aeternity/aeproject');
const { Crypto, TxBuilderHelper } = require('@aeternity/aepp-sdk');

use(chaiAsPromised);

describe('SimpleGAMultiSig', () => {
  let aeSdk;
  let source;
  let gaContract;
  let gaKeyPair;

  const coSigner1 = wallets[1];
  const coSigner2 = wallets[2];
  const coSigner3 = wallets[3];

  const invalidSigner = wallets[4];

  const testRecipient = Crypto.generateKeyPair();
  let testSpendTx;
  let testSpendTxGaHash;

  const testDifferentRecipient = Crypto.generateKeyPair();
  let testDifferentSpendTx;
  let testDifferentSpendTxGaHash;

  const testSpendAmount = 1000;

  const expectedInitialConsensusInfo = {
    ga_tx_hash: undefined,
    confirmations_required: 2n,
    confirmed_by: [],
    has_consensus: false,
    expired: false
  }
  let consensusInfo;

  const getGaHash = (rlpTransaction) => new Uint8Array(Crypto.hash(Buffer.concat([
    Buffer.from(aeSdk.getNetworkId()),
    TxBuilderHelper.decode(rlpTransaction, 'tx'),
  ])));

  const proposeTx = async (keyPair, gaTxHash, ttl) => {
    const txResult = await gaContract.methods.propose(gaTxHash, ttl, { onAccount: keyPair });
    return txResult;
  };

  const confirmTx = async (keyPair, gaTxHash) => {
    const txResult = await gaContract.methods.confirm(gaTxHash, { onAccount: keyPair });
    return txResult;
  };

  const revokeTx = async (keyPair, gaTxHash) => {
    const txResult = await gaContract.methods.revoke(gaTxHash, { onAccount: keyPair });
    return txResult;
  };

  before(async () => {
    aeSdk = await utils.getClient();
    const sendOrig = aeSdk.send;
    aeSdk.send = (tx, { onlyBuildTx, ...options }) => {
      if (onlyBuildTx) return tx;
      return sendOrig.call(aeSdk, tx, options);
  };

    // create a new keypair to allow reoccuring tests
    gaKeyPair = Crypto.generateKeyPair();
    // fund the account for the fresh generated keypair
    await aeSdk.spend(10e18, gaKeyPair.publicKey, { onAccount: wallets[0] });

    // get content of contract
    source = utils.getContractContent('./contracts/SimpleGAMultiSig.aes');

    // attach the Generalized Account
    await aeSdk.createGeneralizeAccount('authorize', source, [2, [coSigner1.publicKey, coSigner2.publicKey, coSigner3.publicKey]], { onAccount: gaKeyPair });
    const isGa = await aeSdk.isGA(gaKeyPair.publicKey);
    assert.equal(isGa, true);

    // get gaContract instance
    const { contractId: contractAddress } = await aeSdk.getAccount(gaKeyPair.publicKey);
    gaContract = await aeSdk.getContractInstance({ source, contractAddress });
    
    const signers = (await gaContract.methods.get_signers()).decodedResult;
    assert.equal(signers.length, 4);

    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);

    // prepare SpendTx and GaHash
    // TODO we need to be able to build the tx without knowing the private key (sdk currently does not allow that?!)
    testSpendTx = await aeSdk.spend(
      testSpendAmount, testRecipient.publicKey, { onAccount: gaKeyPair, onlyBuildTx: true },
    );
    testSpendTxGaHash = getGaHash(testSpendTx);

    testDifferentSpendTx = await aeSdk.spend(
      testSpendAmount, testDifferentRecipient.publicKey, { onAccount: gaKeyPair, onlyBuildTx: true },
    );
    testDifferentSpendTxGaHash = getGaHash(testDifferentSpendTx);
  });

  it('Successfully perform a SpendTx', async () => {
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });
    let expectedConsensusInfo = {
      ga_tx_hash: testSpendTxGaHash,
      confirmations_required: 2n,
      confirmed_by: [coSigner1.publicKey],
      has_consensus: false,
      expired: false
    }
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    await confirmTx(coSigner2, testSpendTxGaHash);
    expectedConsensusInfo = {
      ga_tx_hash: testSpendTxGaHash,
      confirmations_required: 2n,
      confirmed_by: [coSigner2.publicKey, coSigner1.publicKey],
      has_consensus: true,
      expired: false
    }
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    const nonce = (await gaContract.methods.get_nonce()).decodedResult;

    await aeSdk.send(testSpendTx, { onAccount: gaKeyPair, authData: { source, args: [nonce] } });
    expect(BigInt(await aeSdk.balance(testRecipient.publicKey))).to.be.equal(BigInt(testSpendAmount));
    
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  it('Successfully revoke a Tx', async () => {
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });
    let expectedConsensusInfo = {
      ga_tx_hash: testSpendTxGaHash,
      confirmations_required: 2n,
      confirmed_by: [coSigner1.publicKey],
      has_consensus: false,
      expired: false
    }
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    await revokeTx(coSigner2, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  it('Fail trying to attach a GA twice', async () => {
    await expect(
      aeSdk.createGeneralizeAccount(
        'authorize',
        source,
        [2, [coSigner1.publicKey, coSigner2.publicKey, coSigner3.publicKey]],
        { onAccount: gaKeyPair }
      )
    ).to.be.rejectedWith(`Account ${gaKeyPair.publicKey} is already GA`);
  });

  it('Fail to attach GA if confirmations exceed amount of signers (stupidity check)', async () => {
    const testKeyPair = Crypto.generateKeyPair();
    await aeSdk.spend(10e18, testKeyPair.publicKey, { onAccount: wallets[0] });
    await expect(
      aeSdk.createGeneralizeAccount(
        'authorize',
        source,
        [3, [coSigner1.publicKey]],
        { onAccount: testKeyPair })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_CONFIRMATIONS_EXCEED_AMOUNT_OF_SIGNERS"`);
  });

  it('Fail to attach GA with empty list of co-signers (stupidity check)', async () => {
    const testKeyPair = Crypto.generateKeyPair();
    await aeSdk.spend(10e18, testKeyPair.publicKey, { onAccount: wallets[0] });
    await expect(
      aeSdk.createGeneralizeAccount(
        'authorize',
        source,
        [1, []],
        { onAccount: testKeyPair })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_EMPTY_LIST_OF_COSIGNERS"`);
  });

  it('Fail if there is no tx to confirm', async() => {
    await expect(
      confirmTx(coSigner1, testSpendTxGaHash)
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NOTHING_TO_CONFIRM"`);
  });

  it('Fail to confirm the same tx twice', async() => {
    // proposal counts as confirmation
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });

    await expect(
      confirmTx(coSigner1, testSpendTxGaHash)
    ).to.be.rejectedWith(`Invocation failed: "ERROR_ALREADY_CONFIRMED"`);

    // revoke to ensure rollback to initial state
    await revokeTx(coSigner1, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  xit('Fail if authorize is called and no tx is proposed', async () => {
    // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
    // => we should be able to read the error here
    await expect(
      aeSdk.send(testSpendTx, { onAccount: gaKeyPair, authData: { source, args: [] } })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NO_TX_PROPOSED"`);
  });

  it('Fail for different actions if tx is expired', async() => {
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });
    let expectedConsensusInfo = {
      ga_tx_hash: testSpendTxGaHash,
      confirmations_required: 2n,
      confirmed_by: [coSigner1.publicKey],
      has_consensus: false,
      expired: false
    }
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    // verify that proposing a new tx is not possible if current tx is not expired
    await expect(
      proposeTx(coSigner2, testSpendTxGaHash, { RelativeTTL: [50] })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_EXISTING_PROPOSED_TX_NOT_EXPIRED"`);

    // enforce expiration
    await utils.awaitKeyBlocks(aeSdk, 50);

    // check expiration
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    expectedConsensusInfo.expired = true;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    // propose new tx with different signer
    await proposeTx(coSigner2, testSpendTxGaHash, { RelativeTTL: [50] });
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    expectedConsensusInfo.expired = false;
    expectedConsensusInfo.confirmed_by = [coSigner2.publicKey];
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    await confirmTx(coSigner3, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    expectedConsensusInfo.confirmed_by = [coSigner2.publicKey, coSigner3.publicKey];
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
    //   aeSdk.send(testSpendTx, { onAccount: gaKeyPair, authData: { source, args: [] } })
    // ).to.be.rejectedWith(`Invocation failed: "ERROR_TX_EXPIRED"`);

    // propose new tx with different signer
    await proposeTx(coSigner3, testSpendTxGaHash, { RelativeTTL: [50] });
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    expectedConsensusInfo.expired = false;
    expectedConsensusInfo.confirmed_by = [coSigner3.publicKey];
    expectedConsensusInfo.has_consensus = false;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    // enforce expiration
    await utils.awaitKeyBlocks(aeSdk, 50);

    // verify that an expired tx cannot be confirmed
    await expect(
      confirmTx(coSigner1, testSpendTxGaHash)
    ).to.be.rejectedWith(`Invocation failed: "ERROR_TX_EXPIRED"`);

    // revoke to ensure rollback to initial state
    await revokeTx(coSigner1, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  it('Fail to propose and confirm tx with invalid signer', async() => {
    // verify that it is not possible to propose a tx if not in list of cosigners
    await expect(
      proposeTx(invalidSigner, testSpendTxGaHash, { RelativeTTL: [50] })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

    await proposeTx(coSigner3, testSpendTxGaHash, { RelativeTTL: [50] });
    let expectedConsensusInfo = {
      ga_tx_hash: testSpendTxGaHash,
      confirmations_required: 2n,
      confirmed_by: [coSigner3.publicKey],
      has_consensus: false,
      expired: false
    }
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedConsensusInfo);

    // verify that it is not possible to confirm a tx if not in list of cosigners
    await expect(
      confirmTx(invalidSigner, testSpendTxGaHash)
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

    // revoke to ensure rollback to initial state
    await revokeTx(coSigner3, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  it('Fail to confirm a tx with a valid signature for wrong tx hash', async() => {
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });

    // confirm should fail if signature for wrong tx hash is provided
    await expect(
      confirmTx(coSigner2, testDifferentSpendTxGaHash)
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NOT_AUTHORIZED"`);

    // revoke to ensure rollback to initial state
    await revokeTx(coSigner3, testSpendTxGaHash);
    consensusInfo = (await gaContract.methods.get_consensus_info()).decodedResult;
    assert.deepEqual(consensusInfo, expectedInitialConsensusInfo);
  });

  xit('Fail to authorize a tx with different checks (consensus, wrong tx)', async() => {
    await proposeTx(coSigner1, testSpendTxGaHash, { RelativeTTL: [50] });

    // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
    await expect(
      aeSdk.send(testSpendTx, { onAccount: gaKeyPair, authData: { source, args: [] } })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_NO_CONSENSUS"`);

    await confirmTx(coSigner2, testSpendTxGaHash);

    // TODO getting v3/transactions/th_bwEJoeemLEef6rVyYNySdLinehoRSboGvtVNZT2rdqG9WfLDD error: Transaction not found
    // verify that authorizing a wrong tx is not possible
    await expect(
      aeSdk.send(testDifferentSpendTx, { onAccount: gaKeyPair, authData: { source, args: [] } })
    ).to.be.rejectedWith(`Invocation failed: "ERROR_UNEQUAL_HASHES"`);
    
    // revoke to ensure rollback to initial state
    await revokeTx(coSigner3, testSpendTxGaHash);
  });
});
