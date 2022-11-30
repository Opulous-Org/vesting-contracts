const { algodClient } = require('./clients')

const getLatestTimestamp = async () => {
  const status = await algodClient.status().do()
  const latestBlockNumber = status['last-round']
  const { block: latestBlock } = await algodClient.block(latestBlockNumber).do()
  return latestBlock['ts']
}

module.exports = { getLatestTimestamp }
