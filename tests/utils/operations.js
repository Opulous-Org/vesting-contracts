const path = require('path')
const algosdk = require('algosdk')
const { algodClient } = require('./clients')
const { compile } = require('./compile')

const TEAL_PATH = path.join(__dirname, '..', '..')

const VESTING_APPROVAL_PATH = path.join(TEAL_PATH, 'vesting-approval.teal')
const VESTING_CLEAR_PATH = path.join(TEAL_PATH, 'vesting-clear.teal')

async function createVestingSmartContract(from) {
  const approvalProgram = await compile(VESTING_APPROVAL_PATH)
  const clearProgram = await compile(VESTING_CLEAR_PATH)

  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: from.addr,
    suggestedParams,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 0,
    numGlobalByteSlices: 0,
  })

  const signedTxn = txn.signTxn(from.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 5)
  return ptx['application-index']
}

async function updateVestingSmartContract(from, appId) {
  const approvalProgram = await compile(VESTING_APPROVAL_PATH)
  const clearProgram = await compile(VESTING_CLEAR_PATH)

  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makeApplicationUpdateTxnFromObject({
    appIndex: appId,
    from: from.addr,
    approvalProgram,
    clearProgram,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(from.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 5)

  return ptx
}

async function deleteVestingSmartContract(from, appId) {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const txn = algosdk.makeApplicationDeleteTxnFromObject({
    appIndex: appId,
    from: from.addr,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(from.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 5)

  return ptx
}

async function makeVestingWithdrawTxns({
  vestingSmartSignatureAddress,
  receiverAddress,
  assetIndex,
  appIndex,
  startDate,
  endDate,
  totalAmount,
  amount,
  params,
  closeRemainderTo,
}) {
  let suggestedParams = params
  if (!params) {
    suggestedParams = await algodClient.getTransactionParams().do()
  }

  const isDefunding = !!closeRemainderTo

  suggestedParams.flatFee = true
  suggestedParams.fee = (isDefunding ? 3 : 2) * algosdk.ALGORAND_MIN_TX_FEE // receiver pays asset transfer fee

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    from: receiverAddress, // Receiver pays the app call
    appIndex,
    appArgs: [
      algosdk.encodeUint64(startDate),
      algosdk.encodeUint64(endDate),
      algosdk.encodeUint64(totalAmount),
    ],
    foreignAssets: [assetIndex],
    accounts: [vestingSmartSignatureAddress],
    suggestedParams,
  })

  suggestedParams.fee = 0

  const assetTransferTxn =
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: vestingSmartSignatureAddress,
      to: receiverAddress,
      assetIndex,
      amount: BigInt(amount),
      suggestedParams,
      closeRemainderTo,
    })

  return [appCallTxn, assetTransferTxn]
}

const makeVestingDefundTxn = async ({ from, to }) => {
  const suggestedParams = await algodClient.getTransactionParams().do()

  suggestedParams.flatFee = true
  suggestedParams.fee = 0

  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from,
    to,
    amount: 100000,
    closeRemainderTo: to,
    suggestedParams,
  })
}

module.exports = {
  createVestingSmartContract,
  updateVestingSmartContract,
  deleteVestingSmartContract,
  makeVestingWithdrawTxns,
  makeVestingDefundTxn,
}
