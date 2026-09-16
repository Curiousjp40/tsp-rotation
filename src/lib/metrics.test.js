const { blendedReturnPct, blendedReturnBetween, resolvePeriod, topTwoReturnSplit } = require('./metrics');

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

test('resolvePeriod(ytd) uses the prior year-end close as the baseline', () => {
  const prices = [
    { date: '2025-12-31', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-01-15', C: 105, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-07-31', C: 110.13, S: 113.52, I: 115.35, F: 100.5, G: 100.2 },
  ];
  const period = resolvePeriod(prices, 2, { kind: 'ytd' });
  expect(period).toEqual({ startIndex: 0, endIndex: 2 });
  const blended = blendedReturnBetween(prices, { C: 50, S: 30, I: 20, F: 0, G: 0 }, period.startIndex, period.endIndex);
  expect(blended).toBeCloseTo(12.19, 1);
});

test('resolvePeriod(custom) returns null when the start date predates the dataset', () => {
  const prices = [
    { date: '2026-01-01', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-02-01', C: 105, S: 100, I: 100, F: 100, G: 100 },
  ];
  expect(resolvePeriod(prices, 1, { kind: 'custom', start: '2020-01-01', end: '2026-02-01' })).toEqual({ startIndex: 0, endIndex: 1 });
  expect(resolvePeriod(prices, 1, { kind: 'custom', start: '2019-01-01', end: '2019-06-01' })).toBeNull();
});

test('topTwoReturnSplit weights the top 2 funds by their own return over the sum of both', () => {
  const prices = [
    { date: '2026-01-01', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-04-01', C: 110, S: 120, I: 105, F: 102, G: 101 },
  ];
  const result = topTwoReturnSplit(prices, 1, 3);
  expect(result.first.fund).toBe('S');
  expect(result.second.fund).toBe('C');
  expect(result.fellBack).toBe(false);
  // 20/(20+10) = 66.67% -> rounds to 67, forced complement is 33 (sums to 100 exactly).
  expect(result.allocation).toEqual({ C: 33, S: 67, I: 0, F: 0, G: 0 });
});

test('topTwoReturnSplit falls back to 50/50 when the top 2 returns have mixed signs', () => {
  const prices = [
    { date: '2026-01-01', C: 100, S: 100, I: 100, F: 100, G: 100 },
    { date: '2026-04-01', C: 103, S: 99, I: 95, F: 94, G: 93 },
  ];
  const result = topTwoReturnSplit(prices, 1, 3);
  expect(result.first.fund).toBe('C');
  expect(result.second.fund).toBe('S');
  expect(result.fellBack).toBe(true);
  expect(result.allocation).toEqual({ C: 50, S: 50, I: 0, F: 0, G: 0 });
});
