const algosdk = require('algosdk')

const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN,
  process.env.ALGOD_SERVER,
  process.env.ALGOD_PORT
)
const kmdClient = new algosdk.Kmd(
  process.env.KMD_TOKEN,
  process.env.KMD_SERVER,
  process.env.KMD_PORT
)

module.exports = { algodClient, kmdClient }
