const algosdk = require('algosdk')
const { algodClient } = require('./clients')
const { getFaucetAccount } = require('./get-faucet-account')

async function fundAccount(address, amount = 10_000_000) {
  const faucetAccount = await getFaucetAccount()

  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: faucetAccount.addr,
    to: address,
    amount,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(faucetAccount.sk)

  const { txId } = await algodClient.sendRawTransaction(signedTxn).do()

  await algosdk.waitForConfirmation(algodClient, txId, 5)
}

module.exports = { fundAccount }
