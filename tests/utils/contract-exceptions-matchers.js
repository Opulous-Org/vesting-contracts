const getContractErrorMessage = (e) => {
  return e?.response?.text
}

const isContractLogicException = (e) => {
  const errMsg = getContractErrorMessage(e)
  return errMsg !== undefined && errMsg.includes('rejected by logic')
}

const isContractLogicEvalException = (e) => {
  const errMsg = getContractErrorMessage(e)
  return errMsg !== undefined && errMsg.includes('logic eval error')
}

module.exports = { isContractLogicException, isContractLogicEvalException }
