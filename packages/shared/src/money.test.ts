import { applyRateHalfUp, calculateDiscount, DiscountCalculationError, formatILS, formatRateBps, minorToDecimalString, parseMajorToMinor } from './money';

const base = { maxInvoiceMinor: 10_000_000 };

describe('calculateDiscount', () => {
  it('acceptance: 200.00 ₪ at 20% with 200.00 eligible → 40.00 discount, 160.00 net', () => {
    const r = calculateDiscount({ ...base, grossMinor: 20000, eligibleMinor: 20000, rateBps: 2000 });
    expect(r.discountMinor).toBe(4000);
    expect(r.netMinor).toBe(16000);
    expect(minorToDecimalString(r.discountMinor)).toBe('40.00');
    expect(minorToDecimalString(r.netMinor)).toBe('160.00');
  });

  it.each([
    // eligible, bps, expected discount (half-up)
    [1, 5000, 1], // 0.5 → 1
    [3, 5000, 2], // 1.5 → 2
    [1, 4999, 0], // 0.4999 → 0
    [1999, 2500, 500], // 499.75 → 500
    [1998, 2500, 500], // 499.5 → 500
    [1997, 2500, 499], // 499.25 → 499
    [333, 1500, 50], // 49.95 → 50
    [12345, 1234, 1523], // 1523.373 → 1523
    [10005, 1000, 1001], // 1000.5 → 1001
  ])('rounds half up: eligible=%i bps=%i → %i', (eligible, bps, expected) => {
    expect(applyRateHalfUp(eligible, bps)).toBe(expected);
    const r = calculateDiscount({ ...base, grossMinor: eligible, eligibleMinor: eligible, rateBps: bps });
    expect(r.discountMinor).toBe(expected);
    expect(r.netMinor).toBe(eligible - expected);
  });

  it('applies discount on eligible part only, net from gross', () => {
    const r = calculateDiscount({ ...base, grossMinor: 30000, eligibleMinor: 20000, rateBps: 2000 });
    expect(r.discountMinor).toBe(4000);
    expect(r.netMinor).toBe(26000);
  });

  it('caps the discount at maxDiscountMinor', () => {
    const r = calculateDiscount({ ...base, grossMinor: 100000, eligibleMinor: 100000, rateBps: 2000, maxDiscountMinor: 5000 });
    expect(r.discountMinor).toBe(5000);
    expect(r.capped).toBe(true);
    expect(r.netMinor).toBe(95000);
  });

  it('100% discount yields zero net, never negative', () => {
    const r = calculateDiscount({ ...base, grossMinor: 500, eligibleMinor: 500, rateBps: 10000 });
    expect(r.netMinor).toBe(0);
  });

  it.each([
    [{ grossMinor: 0, eligibleMinor: 0, rateBps: 2000 }, 'INVALID_AMOUNT'],
    [{ grossMinor: -100, eligibleMinor: -100, rateBps: 2000 }, 'INVALID_AMOUNT'],
    [{ grossMinor: 10.5, eligibleMinor: 10.5, rateBps: 2000 }, 'INVALID_AMOUNT'],
    [{ grossMinor: 100, eligibleMinor: 200, rateBps: 2000 }, 'ELIGIBLE_EXCEEDS_GROSS'],
    [{ grossMinor: 100, eligibleMinor: 100, rateBps: 0 }, 'INVALID_RATE'],
    [{ grossMinor: 100, eligibleMinor: 100, rateBps: 10001 }, 'INVALID_RATE'],
    [{ grossMinor: 10_000_001, eligibleMinor: 100, rateBps: 2000 }, 'AMOUNT_TOO_LARGE'],
    [{ grossMinor: 1000, eligibleMinor: 1000, rateBps: 2000, minEligibleMinor: 5000 }, 'BELOW_MINIMUM'],
  ])('rejects %o with %s', (input, code) => {
    expect(() => calculateDiscount({ ...base, ...input })).toThrow(DiscountCalculationError);
    try {
      calculateDiscount({ ...base, ...input });
    } catch (e) {
      expect((e as DiscountCalculationError).code).toBe(code);
    }
  });
});

describe('parsing and formatting', () => {
  it.each([
    ['200', 20000],
    ['200.5', 20050],
    ['200.50', 20050],
    ['٢٠٠٫٥٠', 20050],
    ['0.01', 1],
    [' 15 ', 1500],
  ])('parses %s', (s, v) => expect(parseMajorToMinor(s)).toBe(v));

  it.each(['', 'abc', '1.234', '-5', '1e3', '12,34,5'])('rejects %s', (s) => expect(parseMajorToMinor(s)).toBeNull());

  it('formats', () => {
    expect(formatILS(16000, 'en')).toBe('₪160.00');
    expect(formatILS(16000, 'ar')).toContain('160.00');
    expect(formatRateBps(2000)).toBe('20%');
    expect(formatRateBps(1250)).toBe('12.5%');
  });
});
