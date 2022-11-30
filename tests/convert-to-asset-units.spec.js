const { convertToAssetUnits } = require('./utils/convert-to-asset-units')

describe('convertToAssetUnits', () => {
  describe('decimals', () => {
    it('should convert strings', () => {
      expect(convertToAssetUnits('1.1111111117', 10)).toEqual(
        BigInt('11111111117')
      )
      expect(convertToAssetUnits('1.23', 10)).toEqual(BigInt('12300000000'))
      expect(convertToAssetUnits('2.0', 10)).toEqual(BigInt('20000000000'))
      expect(convertToAssetUnits('23.0', 10)).toEqual(BigInt('230000000000'))
    })
    it('should convert numbers', () => {
      expect(convertToAssetUnits(1.1111111117, 10)).toEqual(
        BigInt('11111111117')
      )
      expect(convertToAssetUnits(1.23, 10)).toEqual(BigInt('12300000000'))
      expect(convertToAssetUnits(2.0, 10)).toEqual(BigInt('20000000000'))
      expect(convertToAssetUnits(23.0, 10)).toEqual(BigInt('230000000000'))
    })
    it('should throw if decimal places greater than 10', () => {
      expect(() => convertToAssetUnits(1.12345678901, 10)).toThrow(
        'Number has more than 10 decimal places'
      )
      expect(() => convertToAssetUnits('1.12345678901', 10)).toThrow(
        'Number has more than 10 decimal places'
      )
    })
  })
  describe('integers', () => {
    it('should convert strings', () => {
      expect(convertToAssetUnits('2', 10)).toEqual(BigInt('20000000000'))
      expect(convertToAssetUnits('1234567890', 10)).toEqual(
        BigInt('12345678900000000000')
      )
      expect(convertToAssetUnits('21', 10)).toEqual(BigInt('210000000000'))
    })
    it('should convert numbers', () => {
      expect(convertToAssetUnits(2, 10)).toEqual(BigInt('20000000000'))
      expect(convertToAssetUnits(1234567890, 10)).toEqual(
        BigInt('12345678900000000000')
      )
      expect(convertToAssetUnits(21, 10)).toEqual(BigInt('210000000000'))
    })
    it('should convert bigints', () => {
      expect(convertToAssetUnits(BigInt(2), 10)).toEqual(BigInt('20000000000'))
      expect(convertToAssetUnits(BigInt(1234567890), 10)).toEqual(
        BigInt('12345678900000000000')
      )
      expect(convertToAssetUnits(BigInt(21), 10)).toEqual(
        BigInt('210000000000')
      )
    })
  })
})
