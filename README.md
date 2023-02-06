# Simple MultiSig contract as Generalized Account
The [SimpleGAMultiSig](./contracts/SimpleGAMultiSig.aes) contract can be used to convert a regular, plain-old account (POA) into a MultiSig account using the [Generalized Account](https://aeternity.com/protocol/generalized_accounts/ga_explained.html) feature of [aeternity](https://aeternity.com).

By performing a [GaAttachTx](https://aeternity.com/protocol/generalized_accounts/index.html#ga_attach_tx) you can convert your POA into a GA by deploying the MultiSig contract that contains a special `authorize` function. This `authorize` function will then always be called by the protocol to authorize future transactions of this account.

## Features & limitations

- Provide a set of signers
    - minimum 2
- Provide the amount of confirmations need for a tx to be authorized
    - minimum 2
    - must not exceed amount of signers
- It's only possible to propose one tx at the same time & in order to be able to propose a new tx the current tx needs to be:
    - authorized (executed)
    - expired
    - revoked
- Signers & amount of required confirmations cannot be changed after attaching the GA MultiSig
- Currently the contract needs to handle fee protection to prevent malicious behavior of miners
    - reasonable default values have been defined by default
    - the values can be changed by any signer
    - it's expected that a future hardfork introduces handling the fee protection on protocol level
        - to prepare for this the fee protection handling on contract level can be disabled later on

## Contract entrypoints

### Stateful
- `init(int, Set.set)`
    - params
        - `int` is the amount of confirmations required for a tx to be authorized
        - `Set.set` a set of signers which will be authorized to propose and confirm transactions
    - can be used to initialize the GA
- `authorize(int)`
    - params
        - `int` the nonce to be used for authorizing the tx
    - can only be called in the `Auth`-Context in a [GaMetaTx](https://aeternity.com/protocol/generalized_accounts/index.html#meta_tx)
    - can only be executed if there is a tx proposed and confirmed by the required amount of signers
- `propose(hash, Chain.ttl)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
        - `Chain.ttl` the ttl that indicates when the tx-proposal expire
    - can be called to propose a new tx
- `confirm(hash)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
    - can be called to confirm the currently proposed tx
- `refuse(hash)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
    - can be called by co-signers to refuse the currently proposed tx
        - once enough signers refused, the tx will automatically be revoked
- `revoke(hash)`
    - params
        - `hash` the tx-hash of the meta transaction that should be authorized
    - can be called by the proposer only to explicitely revoke the currently proposed tx
- `update_fee_protection(fee_protection)`
    - params
        - `fee_protection` object with `int`-attributes `max_fee` and `max_gasprice`
    - can be called by any signer in order to change the fee protection settings
- `disable_fee_protection()`
    - can be called by any signer in order to disable handling the fee protection in the contract
    - Note:
        - we expect fee protection to be handled by the æternity protocol introduced in a future hardfork
        - can only be called once

### Read only
These entrypoints are mainly for information purposes and required to build a meaningsful management UI that can handle MultiSig transactions.

- `get_version()`
    - returns the version of the GA MultiSig contract
- `is_fee_protection_enabled()`
    - returns if the fee protection on contract-level is enabled
- `get_fee_protection()`
    - returns the values `max_fee` and `max_gasprice` which are used to protect from malicious miners
- `get_signers()`
    - returns the list of all signers
- `get_nonce()`
    - returns the required nonce to authorize the tx
- `get_consensus_info()`
    - returns a record with all information needed for users and interfaces to manage the GA that contains following properties:
        - `ga_tx_hash` the (optional) hash of the proposed meta-transaction to be authorized
        - `confirmations_required` the amount of confirmations required to authorize a tx
        - `confirmed_by` a list of all signers that confirmed the proposed tx
        - `refused_by` a list of all signers that refused the proposed tx
        - `has_consensus` bool that indicates if the proposed tx was confirmed by a sufficient amount of signers
        - `expiration_height` the block height where the proposed tx expires
        - `expired` bool that indicates if the proposed tx is expired
        - `proposed_by` refers to the address of the individual who initiated the proposal

## Events
Following events are emitted if users perform certain actions on the contract of the GA:

- `TxProposed(hash, address, int)` if one of the signers proposes a new transaction
    - `hash` the tx-hash of the meta transaction that should be authorized
    - `address` the address of the co-signer that proposed the tx
    - `int` the height where the tx will expire
- `TxConfirmed(hash, address)`
    - `hash` the tx-hash of the meta transaction that should be authorized
    - `address` the address of the co-signer that proposed the tx
- `TxRefused(hash, address)`
    - `hash` the tx-hash of the meta transaction that should be authorized
    - `address` the address of the co-signer that refused the tx
- `TxConsensusReached(hash)`
    - `hash` the tx-hash of the meta transaction that reached consensus (as soon as this event is emitted the tx can be authorized)
- `TxConsensusLost(hash)`
    - `hash` the tx-hash of the meta transaction that lost consensus, e.g. if a signer refuses a previously confirmed tx
- `TxRevoked(hash, address)`
    - `hash` the tx-hash of the meta transaction that has been revoked
    - `address` the address of the co-signer that revoked the tx
- `TxAuthorized(hash)`
    - `hash` the tx-hash of the meta transaction that has been authorized
- `FeeProtectionDisabled(address)`
    - `address` the signer that disabled the fee protection

## Disclaimer
This smart contract has not been security audited yet.

Use it at your own risk!