const algosdk = require('algosdk')
const { algodClient } = require('./clients')

async function createAsset(
  creatorAccount,
  name,
  decimals,
  total = Number.MAX_SAFE_INTEGER
) {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: creatorAccount.addr,
    assetName: name,
    unitName: name,
    total,
    decimals,
    manager: undefined,
    reserve: undefined,
    freeze: undefined,
    clawback: undefined,
    defaultFrozen: false,
    assetURL: 'http://someurl',
    assetMetadataHash: '16efaa3924a6fd9d3a4824799a4ac65d',
    note: undefined,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(creatorAccount.sk)
  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
  const ptx = await algodClient.pendingTransactionInformation(txId).do()
  return ptx['asset-index']
}

module.exports = { createAsset }
