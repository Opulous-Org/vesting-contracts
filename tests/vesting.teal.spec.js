const path = require('path')
const algosdk = require('algosdk')
const { algodClient } = require('./utils/clients')
const {
  addDays,
  addYears,
  subYears,
  subDays,
  getUnixTime,
  fromUnixTime,
} = require('date-fns')

const { compile } = require('./utils/compile')
const { getAccountInfo } = require('./utils/get-account-info')
const { createAccount } = require('./utils/create-account')
const { fundAccount } = require('./utils/fund-account')
const { transferAsset } = require('./utils/transfer-asset')
const { optInToAsset } = require('./utils/opt-in-to-asset')
const { createAsset } = require('./utils/create-asset')
const {
  isContractLogicException,
  isContractLogicEvalException,
} = require('./utils/contract-exceptions-matchers')
const { convertToAssetUnits } = require('./utils/convert-to-asset-units')
const { signAndSendTxns } = require('./utils/sign-and-send-txns')
const { getLatestTimestamp } = require('./utils/get-latest-timestamp')
const {
  createVestingSmartContract,
  updateVestingSmartContract,
  deleteVestingSmartContract,
  makeVestingWithdrawTxns,
  makeVestingDefundTxn,
} = require('./utils/operations')

const VESTING_SIG_PATH = path.join(__dirname, '..', 'vesting-sig.teal')

const ACCEPT_ANYTHING_TEAL_PATH = path.join(
  __dirname,
  'utils',
  'teals',
  'accept-anything.teal'
)

describe('vesting-contracts', () => {
  const ASSET_DECIMALS = 10
  const ASSET_TOTAL_RESERVE = convertToAssetUnits(500_000_000, ASSET_DECIMALS)
  const MINIMUN_FUND = 200_000 // 1 asset
  const BIGGEST_AMOUNT = BigInt('0xffffffffffffffff')
  const HUGE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER)
  const AVERAGE_AMOUNT = convertToAssetUnits(185250, ASSET_DECIMALS)
  const SMALL_AMOUNT = convertToAssetUnits(1.1111111111, ASSET_DECIMALS)

  let funderAccount,
    fundsReceiverAccount,
    assetReceiverAccount,
    appId,
    assetId,
    vestingSmartSignatureCompiled,
    acceptAnythingSmartSignatureCompiled,
    vestingSmartSignature,
    acceptAnythingSmartSignature

  const getAmountWithoutRewards = (account) => account.amount - account.rewards

  const createVestingAsset = async (
    funderAccount,
    total = ASSET_TOTAL_RESERVE
  ) => createAsset(funderAccount, 'VEST', ASSET_DECIMALS, total)

  const getAvailableAmount = async ({ startDate, endDate, totalAmount }) => {
    const latestTimestamp = await getLatestTimestamp()
    const A = BigInt(endDate) - BigInt(startDate)
    const B = totalAmount / A
    const C = BigInt(latestTimestamp) - BigInt(startDate)
    //not considering current balance here
    const D = B * C

    return D
  }

  const setup = async ({ startDate, endDate, totalAmount }) => {
    funderAccount = await createAccount()
    fundsReceiverAccount = await createAccount(0)
    assetReceiverAccount = await createAccount()

    const total =
      totalAmount && totalAmount > ASSET_TOTAL_RESERVE
        ? totalAmount
        : ASSET_TOTAL_RESERVE
    assetId = await createVestingAsset(funderAccount, total)

    vestingSmartSignatureCompiled = await compile(VESTING_SIG_PATH, {
      APP_ID: appId,
      ASSET_ID: assetId,
      RECEIVER_ADDRESS: assetReceiverAccount.addr,
      FUNDING_ADDRESS: fundsReceiverAccount.addr,
      START_TIMESTAMP: startDate,
      END_TIMESTAMP: endDate,
      TOTAL_AMOUNT: totalAmount,
    })

    vestingSmartSignature = new algosdk.LogicSigAccount(
      vestingSmartSignatureCompiled
    )

    await fundAccount(vestingSmartSignature.address(), MINIMUN_FUND)
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

    await transferAsset(
      funderAccount,
      vestingSmartSignature.address(),
      assetId,
      totalAmount
    )

    // Opt In on receiver account
    await optInToAsset(assetReceiverAccount, assetId)

    acceptAnythingSmartSignatureCompiled = await compile(
      ACCEPT_ANYTHING_TEAL_PATH
    )

    acceptAnythingSmartSignature = new algosdk.LogicSigAccount(
      acceptAnythingSmartSignatureCompiled
    )
    await fundAccount(acceptAnythingSmartSignature.address())
  }

  beforeAll(async () => {
    funderAccount = await createAccount()
  })

  describe('app/deploy', () => {
    it('should be deployed', async () => {
      appId = await createVestingSmartContract(funderAccount)

      expect(appId).toBeDefined()
    })
  })

  describe('logicsig', () => {
    beforeAll(async () => {
      assetReceiverAccount = await createAccount()
    })

    describe('compile', () => {
      it('should fail to compile the contract with an invalid address (too Long)', async () => {
        expect.assertions(1)

        totalAmount = 1
        startDate = 1
        endDate = 2
        const invalidAddress = assetReceiverAccount.addr + 'A'

        let invalidCompile
        try {
          invalidCompile = await compile(VESTING_SIG_PATH, {
            APP_ID: appId,
            ASSET_ID: assetId,
            RECEIVER_ADDRESS: invalidAddress,
            FUNDING_ADDRESS: funderAccount.addr,
            TOTAL_AMOUNT: totalAmount,
            START_TIMESTAMP: startDate,
            END_TIMESTAMP: endDate,
          })
        } catch {
          expect(invalidCompile).toBeUndefined()
        }
      })

      it('should fail to compile the contract with an invalid address (too Short)', async () => {
        expect.assertions(1)

        totalAmount = 1
        startDate = 1
        endDate = 2

        const invalidAddress = assetReceiverAccount.addr.slice(0, -1)

        let invalidCompile
        try {
          invalidCompile = await compile(VESTING_SIG_PATH, {
            APP_ID: appId,
            ASSET_ID: assetId,
            RECEIVER_ADDRESS: invalidAddress,
            FUNDING_ADDRESS: funderAccount.addr,
            TOTAL_AMOUNT: totalAmount,
            START_TIMESTAMP: startDate,
            END_TIMESTAMP: endDate,
          })
        } catch {
          expect(invalidCompile).toBeUndefined()
        }
      })
    })

    describe('opt-in', () => {
      beforeAll(async () => {
        const startDate = getUnixTime(addDays(new Date(), 2))
        const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
        const totalAmount = 1200

        assetId = await createVestingAsset(funderAccount)
        vestingSmartSignatureCompiled = await compile(VESTING_SIG_PATH, {
          APP_ID: appId,
          ASSET_ID: assetId,
          RECEIVER_ADDRESS: assetReceiverAccount.addr,
          FUNDING_ADDRESS: funderAccount.addr,
          START_TIMESTAMP: startDate,
          END_TIMESTAMP: endDate,
          TOTAL_AMOUNT: totalAmount,
        })

        vestingSmartSignature = new algosdk.LogicSigAccount(
          vestingSmartSignatureCompiled
        )

        await fundAccount(vestingSmartSignature.address(), MINIMUN_FUND)
      })

      it('should fail to opt-in to any asset other than the intended', async () => {
        expect.assertions(1)

        const otherAssetId = await createVestingAsset(funderAccount)
        const suggestedParams = await algodClient.getTransactionParams().do()
        const numberOfTxns = 2

        const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: vestingSmartSignature.address(),
          to: vestingSmartSignature.address(),
          assetIndex: otherAssetId,
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

        try {
          await signAndSendTxns(
            [txn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail to process transfer of 0 assets to someone else', async () => {
        expect.assertions(1)

        const suggestedParams = await algodClient.getTransactionParams().do()
        const numberOfTxns = 2

        const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: vestingSmartSignature.address(),
          to: funderAccount.addr,
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

        try {
          await signAndSendTxns(
            [txn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail to opt-in if the fee is not zero', async () => {
        expect.assertions(1)
        // suggested params: fee is 1000
        const suggestedParams = await algodClient.getTransactionParams().do()
        const numberOfTxns = 2

        const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: vestingSmartSignature.address(),
          to: vestingSmartSignature.address(),
          assetIndex: assetId,
          amount: 0,
          suggestedParams,
        })

        const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: funderAccount.addr,
          to: funderAccount.addr,
          amount: 0,
          suggestedParams,
        })
        txn1.flatFee = false
        txn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

        try {
          await signAndSendTxns(
            [txn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail to opt-in if a rekey address is specified', async () => {
        expect.assertions(1)

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
        txn0.addRekey(funderAccount.addr)

        const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: funderAccount.addr,
          to: funderAccount.addr,
          amount: 0,
          suggestedParams,
        })
        txn1.flatFee = false
        txn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

        try {
          await signAndSendTxns(
            [txn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should prevent transaction when closeRemainderTo is set i.e. opting out', async () => {
        expect.assertions(1)

        const suggestedParams = await algodClient.getTransactionParams().do()
        const numberOfTxns = 2

        const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: vestingSmartSignature.address(),
          to: vestingSmartSignature.address(),
          assetIndex: assetId,
          amount: 0,
          suggestedParams,
          closeRemainderTo: funderAccount.addr,
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

        try {
          await signAndSendTxns(
            [txn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail to non asset transfer transaction', async () => {
        expect.assertions(1)

        const suggestedParams = await algodClient.getTransactionParams().do()
        const numberOfTxns = 2

        const invalidTxn0 = algosdk.makePaymentTxnWithSuggestedParamsFromObject(
          {
            from: vestingSmartSignature.address(),
            to: vestingSmartSignature.address(),
            assetIndex: assetId,
            amount: 0,
            suggestedParams,
          }
        )
        invalidTxn0.flatFee = false
        invalidTxn0.fee = 0

        const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: funderAccount.addr,
          to: funderAccount.addr,
          amount: 0,
          suggestedParams,
        })
        txn1.flatFee = false
        txn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

        try {
          await signAndSendTxns(
            [invalidTxn0, txn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail when is not grouped with fees payment', async () => {
        expect.assertions(1)

        const suggestedParams = await algodClient.getTransactionParams().do()

        const txn0 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: vestingSmartSignature.address(),
          to: vestingSmartSignature.address(),
          assetIndex: assetId,
          amount: 0,
          suggestedParams,
        })
        txn0.flatFee = false
        txn0.fee = 0

        try {
          await signAndSendTxns([txn0], [vestingSmartSignature])
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should fail when payment (fees) has closeRemainderTo field', async () => {
        expect.assertions(1)

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

        const invalidTxn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject(
          {
            from: funderAccount.addr,
            to: funderAccount.addr,
            amount: 0,
            closeRemainderTo: assetReceiverAccount.addr,
            suggestedParams,
          }
        )
        invalidTxn1.flatFee = false
        invalidTxn1.fee = numberOfTxns * algosdk.ALGORAND_MIN_TX_FEE

        try {
          await signAndSendTxns(
            [txn0, invalidTxn1],
            [vestingSmartSignature, funderAccount]
          )
        } catch (e) {
          expect(isContractLogicException(e)).toBe(true)
        }
      })

      it('should successfully opt-in the logsig to the asset when called correctly', async () => {
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

        await signAndSendTxns(
          [txn0, txn1],
          [vestingSmartSignature, funderAccount]
        )

        const vestingSmartSignatureInfo = await getAccountInfo(
          vestingSmartSignature.address()
        )
        expect(getAmountWithoutRewards(vestingSmartSignatureInfo)).toBe(
          MINIMUN_FUND
        )
        expect(vestingSmartSignatureInfo.assets[0]).toMatchObject({
          amount: 0,
          'asset-id': assetId,
          'is-frozen': false,
        })
      })
    })
  })

  describe('withdraw', () => {
    it('should hold tokens after opt-in and transfer', async () => {
      const startDate = getUnixTime(new Date())
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const vestingSmartSignatureInfo = await getAccountInfo(
        vestingSmartSignature.address()
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfo)).toBe(
        MINIMUN_FUND
      )
      expect(vestingSmartSignatureInfo.assets[0]).toMatchObject({
        amount: Number(totalAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should forbid some other account from withdrawing other than the one nominated', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(new Date())
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: funderAccount.addr,
        assetIndex: assetId,
        amount: 0,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [funderAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when withdraw before start time', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(addDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const amount = 1

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    it('should fail when withdraw after end time', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const amount = 1

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    it('should fail when amount is zero', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const amount = 0

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    it('should allow withdrawal available amount to a predefined address', async () => {
      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal available amount even if current balance is greater than total', async () => {
      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      // balance is greater than total amount
      await transferAsset(
        funderAccount,
        vestingSmartSignature.address(),
        assetId,
        10
      )

      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should fail when closeRemainderTo is set in withdraw', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when app call sender is not the receiver', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: vestingSmartSignature.address(),
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when assets array length is not 1 in app call', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const otherAssetId = await createVestingAsset(funderAccount)
      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      txn0.appForeignAssets.push(otherAssetId)

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when assets[0] is not expected asset id in app call', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const invalidAssetId = await createVestingAsset(funderAccount)
      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      txn0.appForeignAssets[0] = invalidAssetId

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when accounts array length is not 1 in app call', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      txn0.appAccounts.push(algosdk.decodeAddress(assetReceiverAccount.addr))

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should fail when accounts[1] is not vestingSmartSignature', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 5))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      txn0.appAccounts[0] = algosdk.decodeAddress(assetReceiverAccount.addr)

      try {
        await signAndSendTxns(
          [txn0, txn1],
          [assetReceiverAccount, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })
  })

  describe('defund', () => {
    it('should allow withdrawal total amount and defund after end time', async () => {
      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      expect(
        getAmountWithoutRewards(vestingSmartSignatureInfoBefore)
      ).toBeGreaterThan(0)
      const fundsReceiverAccountInfoBefore = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      expect(getAmountWithoutRewards(fundsReceiverAccountInfoBefore)).toBe(0)
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      await signAndSendTxns(
        [txn0, txn1, txn2],
        [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const fundsReceiverAccountInfoAfter = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      // Expect contract to be cleared out of algos and assets
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(0)
      expect(vestingSmartSignatureInfoAfter.assets.length).toBe(0)
      // Expect the algos have been sent to the fundsReceiverAccount
      expect(
        getAmountWithoutRewards(fundsReceiverAccountInfoAfter)
      ).toBeGreaterThan(getAmountWithoutRewards(fundsReceiverAccountInfoBefore))

      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )
      const fees = 3 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(totalAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should forbid some other account being the close out other than the one nominated', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: funderAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, txn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should forbid being grouped with a payment (defund) transaction from another lsig Account', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: funderAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: acceptAnythingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, txn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should reject a transaction where the closeRemainderTo is not set on payment', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, txn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should reject a transaction where payment (defund) goes to a non FUNDING_ADDRESS', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const suggestedParams = await algodClient.getTransactionParams().do()
      suggestedParams.flatFee = true
      suggestedParams.fee = 0
      const invalidTxn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: vestingSmartSignature.address(),
        to: funderAccount.addr,
        amount: 100000,
        closeRemainderTo: fundsReceiverAccount.addr,
        suggestedParams,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, invalidTxn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should reject a transaction where the closeRemainderTo is set to a non FUNDING_ADDRESS', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const suggestedParams = await algodClient.getTransactionParams().do()
      suggestedParams.flatFee = true
      suggestedParams.fee = 0
      const invalidTxn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
        amount: 100000,
        closeRemainderTo: funderAccount.addr,
        suggestedParams,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, invalidTxn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('should reject a transaction where rekeyTo is set on payment (defund)', async () => {
      expect.assertions(1)

      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = AVERAGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const suggestedParams = await algodClient.getTransactionParams().do()
      suggestedParams.flatFee = true
      suggestedParams.fee = 0
      const invalidTxn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
        amount: 100000,
        closeRemainderTo: fundsReceiverAccount.addr,
        rekeyTo: assetReceiverAccount.addr,
        suggestedParams,
      })

      try {
        await signAndSendTxns(
          [txn0, txn1, invalidTxn2],
          [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
        )
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })
  })

  describe('big numbers', () => {
    it('should allow withdrawal at the beginning of the period', async () => {
      const startDate = getUnixTime(subDays(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = HUGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal in the middle of the period', async () => {
      const startDate = getUnixTime(subYears(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = HUGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal at the end of the period', async () => {
      const startDate = getUnixTime(addDays(subYears(new Date(), 2), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = HUGE_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal total amount and defund after end time', async () => {
      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = HUGE_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      expect(
        getAmountWithoutRewards(vestingSmartSignatureInfoBefore)
      ).toBeGreaterThan(0)
      const fundingReceiverAccountInfoBefore = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      expect(getAmountWithoutRewards(fundingReceiverAccountInfoBefore)).toBe(0)
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      await signAndSendTxns(
        [txn0, txn1, txn2],
        [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const fundsReceiverAccountInfoAfter = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      // Expect contract to be cleared out of algos and assets
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(0)
      expect(vestingSmartSignatureInfoAfter.assets.length).toBe(0)
      // Expect the algos have been sent to the fundsReceiverAccount
      expect(
        getAmountWithoutRewards(fundsReceiverAccountInfoAfter)
      ).toBeGreaterThan(
        getAmountWithoutRewards(fundingReceiverAccountInfoBefore)
      )

      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )
      const fees = 3 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )

      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(totalAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })
  })

  describe('biggest numbers', () => {
    it('should allow withdrawal at the beginning of the period', async () => {
      const startDate = getUnixTime(subDays(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = BIGGEST_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal in the middle of the period', async () => {
      const startDate = getUnixTime(subYears(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = BIGGEST_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal at the end of the period', async () => {
      const startDate = getUnixTime(addDays(subYears(new Date(), 2), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = BIGGEST_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal when start timestamp is 0 and end timestamp is the biggest integer', async () => {
      const startDate = BigInt(0)
      const endDate = BigInt('0xffffffffffffffff')
      const totalAmount = BIGGEST_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      const latestTimestamp = await getLatestTimestamp()
      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )

      // total amount / end timestamp - start timestamp === 1
      // and start timestamp is 0
      expect(Number(availableAmount)).toEqual(latestTimestamp)

      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal total amount and defund after end time', async () => {
      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = BIGGEST_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      expect(
        getAmountWithoutRewards(vestingSmartSignatureInfoBefore)
      ).toBeGreaterThan(0)
      const fundingReceiverAccountInfoBefore = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      expect(getAmountWithoutRewards(fundingReceiverAccountInfoBefore)).toBe(0)
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      await signAndSendTxns(
        [txn0, txn1, txn2],
        [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const fundsReceiverAccountInfoAfter = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      // Expect contract to be cleared out of algos and assets
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(0)
      expect(vestingSmartSignatureInfoAfter.assets.length).toBe(0)
      // Expect the algos have been sent to the fundsReceiverAccount
      expect(
        getAmountWithoutRewards(fundsReceiverAccountInfoAfter)
      ).toBeGreaterThan(
        getAmountWithoutRewards(fundingReceiverAccountInfoBefore)
      )

      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )
      const fees = 3 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )

      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(totalAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })
  })

  describe('small numbers', () => {
    it('should allow withdrawal at the beginning of the period', async () => {
      const startDate = getUnixTime(subDays(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = SMALL_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal in the middle of the period', async () => {
      const startDate = getUnixTime(subYears(new Date(), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = SMALL_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal at the end of the period', async () => {
      const startDate = getUnixTime(addDays(subYears(new Date(), 2), 1))
      const endDate = getUnixTime(addYears(fromUnixTime(startDate), 2))
      const totalAmount = SMALL_AMOUNT

      await setup({ startDate, endDate, totalAmount })
      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      const availableAmount = await getAvailableAmount({
        startDate,
        endDate,
        totalAmount,
      })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: availableAmount,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
      })

      await signAndSendTxns(
        [txn0, txn1],
        [assetReceiverAccount, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )

      expect(getAmountWithoutRewards(vestingSmartSignatureInfoBefore)).toBe(
        getAmountWithoutRewards(vestingSmartSignatureInfoAfter)
      )
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(
        MINIMUN_FUND
      )

      const fees = 2 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )
      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(availableAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })

    it('should allow withdrawal total amount and defund after end time', async () => {
      const startDate = getUnixTime(subDays(new Date(), 31))
      const endDate = getUnixTime(addDays(fromUnixTime(startDate), 30))
      const totalAmount = SMALL_AMOUNT
      await setup({ startDate, endDate, totalAmount })

      const [txn0, txn1] = await makeVestingWithdrawTxns({
        vestingSmartSignatureAddress: vestingSmartSignature.address(),
        receiverAddress: assetReceiverAccount.addr,
        assetIndex: assetId,
        amount: 1,
        appIndex: appId,
        totalAmount,
        startDate,
        endDate,
        closeRemainderTo: assetReceiverAccount.addr,
      })

      const txn2 = await makeVestingDefundTxn({
        from: vestingSmartSignature.address(),
        to: fundsReceiverAccount.addr,
      })

      const vestingSmartSignatureInfoBefore = await getAccountInfo(
        vestingSmartSignature.address()
      )
      expect(
        getAmountWithoutRewards(vestingSmartSignatureInfoBefore)
      ).toBeGreaterThan(0)
      const fundingReceiverAccountInfoBefore = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      expect(getAmountWithoutRewards(fundingReceiverAccountInfoBefore)).toBe(0)
      const assetReceiverAccountInfoBefore = await getAccountInfo(
        assetReceiverAccount.addr
      )

      await signAndSendTxns(
        [txn0, txn1, txn2],
        [assetReceiverAccount, vestingSmartSignature, vestingSmartSignature]
      )

      const vestingSmartSignatureInfoAfter = await getAccountInfo(
        vestingSmartSignature.address()
      )
      const fundsReceiverAccountInfoAfter = await getAccountInfo(
        fundsReceiverAccount.addr
      )
      // Expect contract to be cleared out of algos and assets
      expect(getAmountWithoutRewards(vestingSmartSignatureInfoAfter)).toBe(0)
      expect(vestingSmartSignatureInfoAfter.assets.length).toBe(0)
      // Expect the algos have been sent to the fundsReceiverAccount
      expect(
        getAmountWithoutRewards(fundsReceiverAccountInfoAfter)
      ).toBeGreaterThan(
        getAmountWithoutRewards(fundingReceiverAccountInfoBefore)
      )

      const assetReceiverAccountInfoAfter = await getAccountInfo(
        assetReceiverAccount.addr
      )
      const fees = 3 * algosdk.ALGORAND_MIN_TX_FEE
      expect(getAmountWithoutRewards(assetReceiverAccountInfoAfter)).toBe(
        getAmountWithoutRewards(assetReceiverAccountInfoBefore) - fees
      )

      expect(assetReceiverAccountInfoAfter.assets[0]).toMatchObject({
        amount: Number(totalAmount),
        'asset-id': assetId,
        'is-frozen': false,
      })
    })
  })

  describe('app/update and delete', () => {
    it('should not be updated', async () => {
      expect.assertions(1)

      try {
        await updateVestingSmartContract(funderAccount, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })

    it('should not be deleted', async () => {
      expect.assertions(1)

      try {
        await deleteVestingSmartContract(funderAccount, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    })
  })
})
