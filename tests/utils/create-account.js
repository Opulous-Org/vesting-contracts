const algosdk = require('algosdk')
const { fundAccount } = require('./fund-account')

async function createAccount(initialFundsAmount = 10_000_000) {
  const account = algosdk.generateAccount()
  if (initialFundsAmount && initialFundsAmount > 0) {
    await fundAccount(account.addr, initialFundsAmount)
  }
  return account
}

module.exports = { createAccount }
