const algosdk = require('algosdk')
const { algodClient } = require('./clients')

async function getAccountInfo(
  address,
  intDecoding = algosdk.IntDecoding.DEFAULT
) {
  return await algodClient
    .accountInformation(address)
    .setIntDecoding(intDecoding)
    .do()
}

module.exports = { getAccountInfo }
