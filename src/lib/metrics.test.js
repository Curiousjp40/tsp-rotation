const { blendedReturnPct } = require('./metrics');

/**
 * Validates the blended-return formula against the worked example from the
 * v2 spec: a 50% C / 30% S / 20% I / 0% F / 0% G allocation, where C/S/I's
 * own trailing returns over the window are +10.13% / +13.52% / +15.35%,
 * must blend to 12.19%:
 *   (0.50 × 10.13) + (0.30 × 13.52) + (0.20 × 15.35) = 12.19
 */
test('blendedReturnPct matches the spec worked example (50/30/20 C/S/I -> 12.19%)', () => {
  const prices = [
    { date: '2026-01-01', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-02-01', C: 110.13, S: 113.52, I: 115.35, F: 100.5, G: 100.2 },
  ];
  const allocation = { C: 50, S: 30, I: 20, F: 0, G: 0 };

  const blended = blendedReturnPct(prices, allocation, 1, 1);

  expect(blended).toBeCloseTo(12.19, 1);
});

test('blendedReturnPct with 100% G matches G\'s own trailing return', () => {
  const prices = [
    { date: '2026-01-01', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-02-01', C: 90, S: 85, I: 80, F: 101, G: 100.5 },
  ];
  const allocation = { C: 0, S: 0, I: 0, F: 0, G: 100 };

  expect(blendedReturnPct(prices, allocation, 1, 1)).toBeCloseTo(0.5, 5);
});
