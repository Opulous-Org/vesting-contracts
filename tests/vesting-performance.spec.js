const path = require('path')
const algosdk = require('algosdk')
const { getUnixTime, addDays, subDays, addMonths } = require('date-fns')

const { algodClient } = require('./utils/clients')
const { compile } = require('./utils/compile')
const { createAccount } = require('./utils/create-account')
const { fundAccount } = require('./utils/fund-account')
const { transferAsset } = require('./utils/transfer-asset')
const { optInToAsset } = require('./utils/opt-in-to-asset')
const { getAccountInfo } = require('./utils/get-account-info')
const {
  isContractLogicEvalException,
} = require('./utils/contract-exceptions-matchers')
const { signAndSendTxns } = require('./utils/sign-and-send-txns')
const { createAsset } = require('./utils/create-asset')
const { getLatestTimestamp } = require('./utils/get-latest-timestamp')
const { convertToAssetUnits } = require('./utils/convert-to-asset-units')

const {
  createVestingSmartContract,
  makeVestingWithdrawTxns,
  makeVestingDefundTxn,
} = require('./utils/operations')

const VESTING_SIG_PATH = path.join(__dirname, '..', 'vesting-sig.teal')

describe('vesting - performance', () => {
  const ASSET_DECIMALS = 10
  const ASSET_TOTAL_RESERVE = convertToAssetUnits(500_000_000, ASSET_DECIMALS)
  const ASSET_AMOUNT_TO_BE_ISSUED = convertToAssetUnits(
    1_000_000,
    ASSET_DECIMALS
  )
  const MINIMUN_FUND = 200_000 // 1 asset

  let funderAccount,
    assetReceiverAccount,
    appId,
    assetId,
    vestingSmartSignatureCompiled,
    vestingSmartSignature,
    contract,
    assetReceiver,
    funder,
    currentStartDate,
    currentEndDate,
    currentTotalAmount,
    lastWithdrawAmount = 0

  const getAssetAmount = async (address) => {
    const info = await getAccountInfo(address)
    const asset = info.assets.find((asset) => asset['asset-id'] === assetId)

    if (!asset) return BigInt(0)

    return BigInt(asset.amount)
  }

  const getAmount = async (address) => {
    const info = await getAccountInfo(address)
    return info.amount - info.rewards
  }

  const getAssets = async (address) => {
    const info = await getAccountInfo(address)
    return info.assets
  }

  const makeAccount = (address) => ({
    getCurrentAssetAmount: async () => getAssetAmount(address),
    getAmount: async () => getAmount(address),
    getAssets: async () => getAssets(address),
  })

  const setup = async ({ startDate, endDate, totalAmount, balance }) => {
    currentStartDate = startDate
    currentEndDate = endDate
    currentTotalAmount = totalAmount

    // compile contract
    vestingSmartSignatureCompiled = await compile(VESTING_SIG_PATH, {
      APP_ID: appId,
      ASSET_ID: assetId,
      RECEIVER_ADDRESS: assetReceiverAccount.addr,
      FUNDING_ADDRESS: funderAccount.addr,
      START_TIMESTAMP: getUnixTime(startDate),
      END_TIMESTAMP: getUnixTime(endDate),
      TOTAL_AMOUNT: totalAmount,
    })
    vestingSmartSignature = new algosdk.LogicSigAccount(
      vestingSmartSignatureCompiled
    )
    // fund contract
    await fundAccount(vestingSmartSignature.address(), MINIMUN_FUND)
    // contract opt-in asset
    const suggestedParams = await algodClient.getTransactionParams().do()
    const numberOfTxns = 2

    const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: vestingSmartSignature.address(),
      to: vestingSmartSignature.address(),
      assetIndex: assetId,
      amount: 0,
      suggestedParams,
    })
    txn0.flatFee = false
    txn0.fee = 0

    const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: funderAccount.addr,
      to: funderAccount.addr,
      amount: 0,
      suggestedParams,
    })
    txn1.flatFee = false
    txn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

    await signAndSendTxns([txn0, txn1], [vestingSmartSignature, funderAccount])
    // transfer asset: funder -> contract
    await transferAsset(
      funderAccount,
      vestingSmartSignature.address(),
      assetId,
      balance
    )

    // Opt In on receiver account
    await optInToAsset(assetReceiverAccount, assetId)

    funder = makeAccount(funderAccount.addr)
    contract = makeAccount(vestingSmartSignature.address())
    assetReceiver = makeAccount(assetReceiverAccount.addr)
  }

  const withdraw = async (amount) => {
    lastWithdrawAmount = amount

    const currentTimestamp = await getLatestTimestamp()
    const isWithdrawAndDefund = currentTimestamp >= getUnixTime(currentEndDate)

    const [txn0, txn1] = await makeVestingWithdrawTxns({
      vestingSmartSignatureAddress: vestingSmartSignature.address(),
      receiverAddress: assetReceiverAccount.addr,
      assetIndex: assetId,
      amount,
      appIndex: appId,
      totalAmount: currentTotalAmount,
      startDate: getUnixTime(currentStartDate),
      endDate: getUnixTime(currentEndDate),
      closeRemainderTo: isWithdrawAndDefund
        ? assetReceiverAccount.addr
        : undefined,
    })

    const txns = [txn0, txn1]
    const sigs = [assetReceiverAccount, vestingSmartSignature]

    if (isWithdrawAndDefund) {
      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: funderAccount.addr,
      })

      txns.push(txn2)
      sigs.push(vestingSmartSignature)
    }

    await signAndSendTxns(txns, sigs)
  }

  const getAvailableAmount = async () => {
    const startDate = currentStartDate
    const endDate = currentEndDate
    const totalAmount = currentTotalAmount

    const currentTimestamp = await getLatestTimestamp()
    const currentBalance = await contract.getCurrentAssetAmount()

    if (currentTimestamp < getUnixTime(startDate)) return BigInt(0)
    if (currentTimestamp >= getUnixTime(endDate)) return currentBalance

    const latestTimestamp = await getLatestTimestamp()
    const A = BigInt(getUnixTime(endDate) - getUnixTime(startDate))
    const B = totalAmount / A
    const C = BigInt(latestTimestamp - getUnixTime(startDate))
    const D = B * C
    const E = totalAmount - currentBalance
    const F = D - E

    return F
  }

  const shiftTimeInDays = async (days) => {
    const startDate = subDays(currentStartDate, days)
    const endDate = subDays(currentEndDate, days)
    const balance = await contract.getCurrentAssetAmount()

    await setup({
      startDate,
      endDate,
      totalAmount: currentTotalAmount,
      balance,
    })
  }

  beforeAll(async () => {
    funderAccount = await createAccount()
    assetReceiverAccount = await createAccount()
    assetId = await createAsset(funderAccount, 'VEST', 10, ASSET_TOTAL_RESERVE)

    appId = await createVestingSmartContract(funderAccount)

    const startDate = addDays(new Date(), 5)
    const endDate = addMonths(startDate, 2)
    const totalAmount = ASSET_AMOUNT_TO_BE_ISSUED
    await setup({
      startDate,
      endDate,
      totalAmount,
      balance: totalAmount,
    })
  })

  describe('setup', () => {
    it('should be set up correctly', async () => {
      const funderCurrentAssetAmount = await funder.getCurrentAssetAmount()

      const contractCurrentAssetAmount = await contract.getCurrentAssetAmount()
      const contractAmount = await contract.getAmount()
      const contractAssets = await contract.getAssets()

      const assetReceiverCurrentAssetAmount =
        await assetReceiver.getCurrentAssetAmount()

      expect(funderCurrentAssetAmount).toBe(
        ASSET_TOTAL_RESERVE - ASSET_AMOUNT_TO_BE_ISSUED
      )

      expect(contractCurrentAssetAmount).toBe(ASSET_AMOUNT_TO_BE_ISSUED)
      expect(contractAmount).toBe(MINIMUN_FUND)
      expect(contractAssets.length).toBe(1)

      expect(assetReceiverCurrentAssetAmount).toBe(BigInt(0))
    })
  })

  describe('flow', () => {
    // 5 days before start
    it('should fail when withdrawing before start time', async () => {
      expect.assertions(1)

      try {
        await withdraw(1)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    // 5 days after start
    it('should withdraw available amount', async () => {
      await shiftTimeInDays(10)

      const contractCurrentAssetAmountBefore =
        await contract.getCurrentAssetAmount()
      const assetReceiverAmountBefore = await assetReceiver.getAmount()
      const assetReceiverCurrentAssetAmountBefore =
        await assetReceiver.getCurrentAssetAmount()

      const availableAmount = await getAvailableAmount()

      await withdraw(availableAmount)

      const contractAmount = await contract.getAmount()
      const contractCurrentAssetAmountAfter =
        await contract.getCurrentAssetAmount()

      const assetReceiverAmountAfter = await assetReceiver.getAmount()
      const assetReceiverCurrentAssetAmountAfter =
        await assetReceiver.getCurrentAssetAmount()

      expect(availableAmount).toBeGreaterThan(0)
      expect(contractAmount).toBe(MINIMUN_FUND)
      expect(contractCurrentAssetAmountAfter).toBe(
        contractCurrentAssetAmountBefore - availableAmount
      )
      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(assetReceiverAmountAfter).toBe(assetReceiverAmountBefore - fees)
      expect(assetReceiverCurrentAssetAmountAfter).toBe(
        assetReceiverCurrentAssetAmountBefore + availableAmount
      )
    })

    // 5 days after start
    it('should fail when withdrawing again', async () => {
      expect.assertions(1)

      try {
        await withdraw(lastWithdrawAmount)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    // 35 days after start
    it('should fail when withdraw more then available', async () => {
      await shiftTimeInDays(30)

      expect.assertions(1)

      const availableAmount = await getAvailableAmount()

      try {
        await withdraw(availableAmount + BigInt(1))
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    // 35 days after start
    it('should withdraw partially available amount', async () => {
      const contractCurrentAssetAmountBefore =
        await contract.getCurrentAssetAmount()
      const assetReceiverAmountBefore = await assetReceiver.getAmount()
      const assetReceiverCurrentAssetAmountBefore =
        await assetReceiver.getCurrentAssetAmount()

      const availableAmount = await getAvailableAmount()
      const partialAvailableAmount = availableAmount / BigInt(3)

      await withdraw(partialAvailableAmount)

      const contractAmount = await contract.getAmount()
      const contractCurrentAssetAmountAfter =
        await contract.getCurrentAssetAmount()

      const assetReceiverAmountAfter = await assetReceiver.getAmount()
      const assetReceiverCurrentAssetAmountAfter =
        await assetReceiver.getCurrentAssetAmount()

      expect(partialAvailableAmount).toBeGreaterThan(0)

      expect(contractAmount).toBe(MINIMUN_FUND)
      expect(contractCurrentAssetAmountAfter).toBe(
        contractCurrentAssetAmountBefore - partialAvailableAmount
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(assetReceiverAmountAfter).toBe(assetReceiverAmountBefore - fees)
      expect(assetReceiverCurrentAssetAmountAfter).toBe(
        assetReceiverCurrentAssetAmountBefore + partialAvailableAmount
      )
    })

    // 65 days after start (about 5 days after end)
    it('should defund after end time', async () => {
      await shiftTimeInDays(30)

      const contractCurrentAssetAmountBefore =
        await contract.getCurrentAssetAmount()
      const contractAmountBefore = await contract.getAmount()
      const assetReceiverAmountBefore = await assetReceiver.getAmount()
      const funderAmountBefore = await funder.getAmount()

      const availableAmount = await getAvailableAmount()
      await withdraw(availableAmount)

      const contractCurrentAssetAmountAfter =
        await contract.getCurrentAssetAmount()
      const contractAmountAfter = await contract.getAmount()
      const contractAssetsAfter = await contract.getAssets()

      const assetReceiverAmountAfter = await assetReceiver.getAmount()

      const funderAmountAfter = await funder.getAmount()

      const assetReceiverCurrentAssetAmountAfter =
        await assetReceiver.getCurrentAssetAmount()

      expect(availableAmount).toBe(contractCurrentAssetAmountBefore)

      expect(contractCurrentAssetAmountAfter).toBe(BigInt(0))
      expect(contractAmountBefore).toBe(MINIMUN_FUND)
      expect(contractAmountAfter).toBe(0)
      expect(contractAssetsAfter.length).toBe(0)

      const fees = 3 * algosdk.ALGORAND_MIN_TX_FEE
      expect(assetReceiverAmountAfter).toBe(assetReceiverAmountBefore - fees)

      expect(funderAmountAfter).toBe(funderAmountBefore + contractAmountBefore)

      expect(assetReceiverCurrentAssetAmountAfter).toBe(
        ASSET_AMOUNT_TO_BE_ISSUED
      )
    })
  })
})
