const algosdk = require('algosdk')
const { algodClient } = require('./clients')

const signAndSendTxns = async (txns, sigs) => {
  algosdk.assignGroupID(txns)
  const signed = txns.map((txn, i) => {
    if (sigs[i]?.sk) return txn.signTxn(sigs[i].sk)

    return algosdk.signLogicSigTransactionObject(txns[i], sigs[i]).blob
  })

  const { txId } = await algodClient.sendRawTransaction(signed).do()
  await algosdk.waitForConfirmation(algodClient, txId, 5)
}

module.exports = { signAndSendTxns }
