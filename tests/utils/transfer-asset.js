const algosdk = require('algosdk')
const { algodClient } = require('./clients')

async function transferAsset(
  senderAccount,
  receiverAddress,
  assetId,
  amount = 1
) {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: senderAccount.addr,
    to: receiverAddress,
    assetIndex: assetId,
    amount,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(senderAccount.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}

module.exports = { transferAsset }
