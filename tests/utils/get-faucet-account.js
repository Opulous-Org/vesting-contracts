const algosdk = require('algosdk')
const { kmdClient } = require('./clients')

async function getFaucetAccount() {
  const wallets = await kmdClient.listWallets()

  if (wallets.wallets.length === 0) {
    throw new Error('No wallets')
  }

  const walletID = wallets.wallets[0].id

  const init = await kmdClient.initWalletHandle(walletID, '')

  const keysResponse = await kmdClient.listKeys(init.wallet_handle_token)

  if (keysResponse.addresses.length === 0) {
    throw new Error('No addresses for the funding wallet')
  }

  const address = keysResponse.addresses[0]

  const key = await kmdClient.exportKey(init.wallet_handle_token, '', address)

  const mnemonic = algosdk.secretKeyToMnemonic(key.private_key)

  const account = algosdk.mnemonicToSecretKey(mnemonic)

  return account
}

module.exports = { getFaucetAccount }
