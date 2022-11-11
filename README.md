# Opulous - Vesting Contracts

Assets slowly released to users over time. Every second new assets can be withdrawn.

<br/>

## Blockchain

Algorand

<br/>

## Files

**vesting-sig.teal:** Vesting Smart Signature (LogicSig)

**vesting-approval.teal:** Vesting Smart Contract (Approval)

**vesting-clear.teal:** Vesting Smart Contract (Clear)

<br/>

## Roles

**Funder:** The one who will create the Vesting Smart Signature and send the assets to it.

**Contract Account:** The Vesting Smart Signature which will hold the assets sent by the funder and allow their withdrawal through logic signature.

**Asset Receiver:** The one who will receive the assets.

<br/>

## Vesting Smart Signature (LogicSig)

Vesting Smart Signature is the contract account which will hold the assets.

<br/>

### - Parameters

**<APP_ID>:** Vesting Smart Contract App Id

**<ASSET_ID>:** Asset Id of the asset that will be hold by the contract account

**<START_TIMESTAMP>:** The date (unix timestamp) when the distribution will start

**<END_TIMESTAMP>:** The date (unix timestamp) when the distribution will end

**<TOTAL_AMOUNT>:** Total asset amount that will be distributed

**<RECEIVER_ADDRESS>:** Address that will receive the assets (Asset Receiver address)

**<FUNDING_ADDRESS>:** Address that will receive the funds after all assets are claimed (Probably the Funder address)

<br/>

### - Transactions

<a name="vss-txns-opt-in">**Opt-in:** Contract account opts-in to the expected asset</a>

- Txn 0 - opt-in (signed by contract account)
  - type: asset transfer
  - sender: contract account
  - asset receiver: contract account
  - asset (XferAsset): ASSET_ID
  - asset amount: 0
  - fee: 0

<br/>

- Txn 1 - pay the fees (signed by funder (or another)) - type: payment - sender: funder (or another) - receiver: funder (or another) - amount: 0 - fee: enough to pay both transactions
  <br/>

<a name="vss-txns-withdraw">**Withdraw:** Receiver withdraws assets from contract account</a>

- Txn 0 - app call to check the amount that will be withdrawn (signed by asset receiver)
  - type: app call
  - application id: APP_ID
  - sender: asset receiver
  - args:
    - 0: START_TIMESTAMP
    - 1: END_TIMESTAMP
    - 2: TOTAL_AMOUNT
  - assets:
    - 0: ASSET_ID
  - accounts:
    - 0: RECEIVER_ADDRESS (Sender by default)
    - 1: Vesting Smart Signature (LogicSig) address
  - fee: enough to pay all (2 or \*3) transactions

<br/>

- Txn 1 - withdraw (signed by contract account)
  - type: asset transfer
  - sender: contract account
  - asset receiver: RECEIVER_ADDRESS
  - asset (XferAsset): ASSET_ID
  - asset amount: amount to be withdrawn
  - fee: 0
  - \*asset close to: RECEIVER_ADDRESS

<br/>

- \*Txn 2 - defund (signed by contract account) - type: payment - sender: contract account - receiver: FUNDING_ADDRESS - close remainder to: FUNDING_ADDRESS - fee: 0
  <br/>
  <br/>

**\*required when the total amount of assets is available (Current Timestamp >= END_TIMESTAMP)**

<br/>

## Vesting Smart Contract (Approval)

Vesting Smart Contract is responsible for checking the amount to be withdrawn.

<br/>

### - Transactions

Vesting Smart Contract will receive the app call and check the grouped transactions described in [Withdraw](#vss-txns-withdraw)

<br/>

### - <a name="vsc-available-amount-of-assets-calculation">Available Amount of Assets Calculation</a>

- **Current Timestamp < START_TIMESTAMP:** The available amount will be 0 zero as the distribution has not started.

- **START_TIMESTAMP <= Current Timestamp < END_TIMESTAMP:** The available amount will be the amount available by second (TOTAL_AMOUNT/(END_TIMESTAMP - START_TIMESTAMP)) times elapsed time (Current Timestamp - START_TIMESTAMP) minus the amount withdrawn (TOTAL_AMOUNT - Current Contract Account balance).

- **Current Timestamp >= END_TIMESTAMP:** The amount available will be the total amount remaining.

<br/>

Javascript (algosdk) example:

```javascript
const getAvailableAmount = async () => {
  const currentTimestamp = await getCurrentTimestamp() // get latest confirmed block's Unix timestamp

  const contractAccountInfo = await algodClient
    .accountInformation(vestingSmartSignature.address())
    .do()
  const asset = contractAccountInfo.assets.find(
    (asset) => asset['asset-id'] === assetId
  )

  const currentContractAccountBalance = BigInt(asset ? asset.amount : 0)

  if (currentTimestamp < startTimestamp) return BigInt(0)
  if (currentTimestamp >= endTimestamp) return currentContractAccountBalance

  const A = BigInt(endTimestamp - startTimestamp)
  const B = totalAmount / A
  const C = BigInt(currentTimestamp - startTimestamp)
  const D = B * C
  const E = totalAmount - currentContractAccountBalance
  const F = D - E

  return F
}
```

<br/>

## Vesting Smart Contract (Clear)

Vesting Smart Contract does not have actions for when the state is cleared.

<br/>

## How to use

<br/>

**1 - Deploying the Vesting Smart Contract**

Deploy Vesting Smart Contract using the files `vesting-approval.teal` and `vesting-clear.teal` and keep its App Id. This same app can be used for all Vesting Smart Signatures.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const deployVestingSmartContract = async () => {
  const vestingApprovalFile = fs.readFileSync(
    path.join(__dirname, 'vesting-approval.teal')
  )
  const vestingClearFile = fs.readFileSync(
    path.join(__dirname, 'vesting-clear.teal')
  )
  const approval = await algodClient.compile(vestingApprovalFile).do()
  const clearState = await algodClient.compile(vestingClearFile).do()

  const suggestedParams = await algodClient.getTransactionParams().do()

  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: funderAccount.addr,
    suggestedParams,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: new Uint8Array(Buffer.from(approval.result, 'base64')),
    clearProgram: new Uint8Array(Buffer.from(clearState.result, 'base64')),
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 0,
    numGlobalByteSlices: 0,
  })

  const signedTxn = txn.signTxn(funderAccount.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  const response = await algosdk.waitForConfirmation(algodClient, txId, 5)

  appId = response['application-index']
}
```

<br/>

**2 - Compiling the Vesting Smart Signature**

Replace the parameters in the file `vesting-sig.teal` with the values ​​that will be used. One of the parameters to be replaced is the <APP_ID>, where the value to be used is the App Id which we kept from the step 1. Then compile to have the logic signature.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const compileVestingSmartSignature = async () => {
  let vestingSmartSignatureFile = fs.readFileSync(
    path.join(__dirname, 'vesting-sig.teal'),
    {
      encoding: 'ascii',
    }
  )

  const today = new Date()
  startTimestamp = getUnixTime(today) // date-fns methods
  endTimestamp = getUnixTime(addDays(today, 60))
  totalAmount = BigInt(100_0000000000)

  const parameters = {
    APP_ID: appId,
    ASSET_ID: assetId,
    START_TIMESTAMP: startTimestamp,
    END_TIMESTAMP: endTimestamp,
    TOTAL_AMOUNT: totalAmount,
    RECEIVER_ADDRESS: assetReceiverAccount.addr,
    FUNDING_ADDRESS: funderAccount.addr,
  }

  Object.entries(parameters).forEach(([parameter, value]) => {
    vestingSmartSignatureFile = vestingSmartSignatureFile.replace(
      new RegExp(`<${parameter}>`, 'g'),
      value
    )
  })

  const response = await algodClient.compile(vestingSmartSignatureFile).do()
  const vestingSmartSignatureCompiled = new Uint8Array(
    Buffer.from(response.result, 'base64')
  )

  vestingSmartSignature = new algosdk.LogicSigAccount(
    vestingSmartSignatureCompiled
  )
}
```

<br/>

**3 - Funding Vesting Smart Signature with algos**

Transfer the minimum amount of algos (0.2 algo) from the Funder account to the contract account created in step 2 so that the account can hold the asset.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const fundVestingSmartSignatureWithAlgos = async () => {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: funderAccount.addr,
    to: vestingSmartSignature.address(),
    amount: 200_000,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(funderAccount.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}
```

<br/>

**4 - Vesting Smart Signature opt-in**

Create and send the grouped transactions described in [Opt-in](#vss-txns-opt-in) so that the contract account created in step 2 can receive the assets.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const vestingSmartSignatureOptIn = async () => {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const numberOfTxns = 2

  const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: vestingSmartSignature.address(),
    to: vestingSmartSignature.address(),
    assetIndex: assetId,
    amount: 0,
    suggestedParams,
  })
  txn0.flatFee = false
  txn0.fee = 0

  const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: funderAccount.addr,
    to: funderAccount.addr,
    amount: 0,
    suggestedParams,
  })
  txn1.flatFee = false
  txn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

  algosdk.assignGroupID([txn0, txn1])

  const signedTxn0 = algosdk.signLogicSigTransactionObject(
    txn0,
    vestingSmartSignature
  ).blob
  const signedTxn1 = txn1.signTxn(funderAccount.sk)

  const { txId } = await algodClient
    .sendRawTransaction([signedTxn0, signedTxn1])
    .do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}
```

<br/>

**5 - Funding Vesting Smart Signature with the assets**

Transfer the amount of assets (TOTAL_AMOUNT parameter) from the account that currently holds the assets (Funder) to the contract account created in step 2.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const fundVestingSmartSignatureWithTheAssets = async () => {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: funderAccount.addr,
    to: vestingSmartSignature.address(),
    assetIndex: assetId,
    amount: totalAmount,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(funderAccount.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}
```

<br/>

**6 - Withdrawing from the Vesting Smart Signature account**

Create and send the grouped transactions described in [Withdraw](#vss-txns-withdraw) so that the asset receiver will be able to receive the assets if the amount respects the calculations described in [Available Amount of Assets Calculation](#vsc-available-amount-of-assets-calculation). The receiver must have opted in to the asset in order to receive it. This process should be repeated until all assets have been transferred to the asset receiver.

<br/>

Javascript (algosdk) example:

```javascript
// some variables are declared on the top-level

const withdrawFromTheVestingSmartSignatureAccount = async () => {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const currentTimestamp = await getCurrentTimestamp() // get latest confirmed block's Unix timestamp

  const areAllAssetsAvailable = currentTimestamp >= endTimestamp

  const txn0 = algosdk.makeApplicationNoOpTxnFromObject({
    from: assetReceiverAccount.addr,
    appIndex: appId,
    appArgs: [
      algosdk.encodeUint64(startTimestamp),
      algosdk.encodeUint64(endTimestamp),
      algosdk.encodeUint64(totalAmount),
    ],
    foreignAssets: [assetId],
    accounts: [vestingSmartSignature.address()], // Sender is added by default
    suggestedParams,
  })
  txn0.flatFee = false
  const numberOfTxns = areAllAssetsAvailable ? 3 : 2
  txn0.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE // pooled transaction fees

  const amountToBeWithdrawn = await getAvailableAmount()
  const txn1 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: vestingSmartSignature.address(),
    to: assetReceiverAccount.addr,
    assetIndex: assetId,
    amount: amountToBeWithdrawn,
    suggestedParams,
    closeRemainderTo: areAllAssetsAvailable
      ? assetReceiverAccount.addr
      : undefined,
  })
  txn1.flatFee = false
  txn1.fee = 0

  let txn2
  if (areAllAssetsAvailable) {
    txn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: vestingSmartSignature.address(),
      to: funderAccount.addr,
      closeRemainderTo: funderAccount.addr,
      suggestedParams,
    })
    txn2.flatFee = false
    txn2.fee = 0
  }

  const txns = [txn0, txn1]
  if (txn2) txns.push(txn2)
  algosdk.assignGroupID(txns)

  const signedTxns = []

  const signedTxn0 = txn0.signTxn(assetReceiverAccount.sk)
  signedTxns.push(signedTxn0)

  const signedTxn1 = algosdk.signLogicSigTransactionObject(
    txn1,
    vestingSmartSignature
  ).blob
  signedTxns.push(signedTxn1)

  if (txn2) {
    const signedTxn2 = algosdk.signLogicSigTransactionObject(
      txn2,
      vestingSmartSignature
    ).blob
    signedTxns.push(signedTxn2)
  }

  const { txId } = await algodClient.sendRawTransaction(signedTxns).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}
```
