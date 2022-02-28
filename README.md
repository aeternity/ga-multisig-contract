# Simple MultiSig contract as Generalized Account
The [SimpleGAMultiSig](./contracts/SimpleGAMultiSig.aes) contract can be used to convert a regular, plain-old account (POA) into a MultiSig account using the [Generalized Account](https://aeternity.com/protocol/generalized_accounts/ga_explained.html) feature of [aeternity](https://aeternity.com).

By performing a [GaAttachTx](https://aeternity.com/protocol/generalized_accounts/index.html#ga_attach_tx) you can convert your POA into a GA by deploying the MultiSig contract that contains a special `authorize` function. This `authorize` function will then always be called by the protocol to authorize future transactions of this account.

## Features & limitations

- Provide a list of co-signers
    - minimum 1
- Provide the amount of confirmations need for a tx to be authorized
    - minimum 2
    - must not exceed amount of co-signers
- It's only possible to propose one tx at the same time & in order to be able to propose a new tx the current tx needs to be:
    - authorized (executed)
    - expired
    - revoked
- Co-signers & amount of required confirmations cannot be changed afterwards

## Contract entrypoints

### Stateful
- `init(int, list(address))`
    - params
        - `int` is the amount of confirmations required for a tx to be authorized
        - `list(address)` a list of co-signers which will be included in addition to the address of the account which is converted into a GA
    - can be used to initialize the GA
- `authorize(int)`
    - params
        - `int` the nonce to be used for authorizing the tx
    - can only be called in the `Auth`-Context in a [GaMetaTx](https://aeternity.com/protocol/generalized_accounts/index.html#meta_tx)
    - can only be executed if there is a tx proposed and confirmed by the required amount of co-signers
- `propose(hash, Chain.ttl)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
        - `Chain.ttl` the ttl that indicates when the tx-proposal expire
    - can be called to propose a new tx
- `confirm(hash)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
    - can be called to confirm the currently proposed tx
    - the signature is checked against the stored hash
- `revoke(hash)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
    - can be called to explicitely revoke the currently proposed tx

### Read only
- `get_signers()`
    - returns the list of all co-signers
- `get_nonce()`
    - returns the required nonce to authorize the tx
- `get_consensus_info()`
    - returns a record with all information needed for users and interfaces to manage the GA that contains following properties:
        - `ga_tx_hash` the (optional) hash of the proposed meta-transaction to be authorized
        - `confirmations_required` the amount of confirmations required to authorize a tx
        - `confirmed_by` a list of all co-signers that confirmed the proposed tx
        - `has_consensus` bool that indicates if the proposed tx was confirmed by a sufficient amount of co-signers
        - `expired` bool that indicates if the proposed tx is expired

## Events
Following events are emitted if users perform certain actions on the contract of the GA:

- `TxProposed(hash, address, int)` if one of the co-signers proposes a new transaction
    - `hash` the tx-hash of the meta transaction that should be authorized
    - `address` the address of the co-signer that proposed the tx
    - `int` the height where the tx will expire
- `TxConfirmed(hash, address)`
    - `hash` the tx-hash of the meta transaction that should be authorized
    - `address` the address of the co-signer that proposed the tx
- `TxConsensusReached(hash)`
    - `hash` the tx-hash of the meta transaction that reached consensus (as soon as this event is emitted the tx can be authorized)
- `TxRevoked(hash, address)`
    - `hash` the tx-hash of the meta transaction that has been revoked
    - `address` the address of the co-signer that revoked the tx
- `TxAuthorized(hash)`
    - `hash` the tx-hash of the meta transaction that has been authorized

## Disclaimer
This smart contract has not been security audited yet.

Use it at your own risk!