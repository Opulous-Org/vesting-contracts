const convertToAssetUnits = (amount, decimals) => {
  if (typeof amount === 'bigint')
    return amount * BigInt('1'.concat(''.padEnd(decimals, '0')))

  let [whole, fractional = ''] = Number(amount).toString().split('.')

  if (fractional.length > decimals) {
    throw new Error(`Number has more than ${decimals} decimal places`)
  }

  fractional = fractional.padEnd(decimals, '0')

  return BigInt(`${whole}${fractional}`)
}

module.exports = { convertToAssetUnits }
