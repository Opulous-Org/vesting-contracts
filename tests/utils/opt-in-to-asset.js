const { transferAsset } = require('./transfer-asset')

async function optInToAsset(account, assetId) {
  return await transferAsset(account, account.addr, assetId, 0)
}

module.exports = { optInToAsset }
