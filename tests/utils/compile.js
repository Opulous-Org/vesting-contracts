const fs = require('fs')
const { algodClient } = require('./clients')

async function compile(filePath, templateVariables = {}) {
  let file = fs.readFileSync(filePath, {
    encoding: 'ascii',
  })

  Object.entries(templateVariables).forEach(([variable, value]) => {
    file = file.replace(new RegExp(`<${variable}>`, 'g'), value)
  })

  const response = await algodClient.compile(file).do()
  const compiled = new Uint8Array(Buffer.from(response.result, 'base64'))
  return compiled
}

module.exports = { compile }
