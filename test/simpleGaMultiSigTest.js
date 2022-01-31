const { assert } = require('chai');
const { utils, wallets } = require('@aeternity/aeproject');

describe('SimpleGAMultiSig', () => {
  let aeSdk;
  let gaContract;

  const gaAccount = wallets[0];
  const coSigner1 = wallets[1];
  const coSigner2 = wallets[2];
  const coSigner3 = wallets[3];

  before(async () => {
    aeSdk = await utils.getClient();

    // get content of contract
    const source = utils.getContractContent('./contracts/SimpleGAMultiSig.aes');

    // attach the Generalized Account
    await aeSdk.createGeneralizeAccount('authorize', source, Array.of('2', Array.of(coSigner1.publicKey, coSigner2.publicKey, coSigner3.publicKey)), { onAccount: gaAccount.publicKey });
    const isGa = await aeSdk.isGA(gaAccount.publicKey);
    assert.equal(isGa, true);

    const { contractAddress } = await aeSdk.getAccount(gaAccount.publicKey);
    gaContract = await aeSdk.getContractInstance({ source, contractAddress });
    
    const signers = await gaContract.methods.get_signers();
    console.log(signers);

    // create a snapshot of the blockchain state
    await utils.createSnapshot(aeSdk);
  });

  // after each test roll back to initial state
  afterEach(async () => {
    await utils.rollbackSnapshot(aeSdk);
  });

  it('Fail on make GA on already GA account', async () => {
    await aeSdk.createGeneralizeAccount('authorize', source, Array.of('2', Array.of(coSigner1.publicKey, coSigner2.publicKey, coSigner3.publicKey)), { onAccount: gaAccount.publicKey })
      .should.be.rejectedWith(`Account ${gaAccount.publicKey} is already GA`)
  })
});
