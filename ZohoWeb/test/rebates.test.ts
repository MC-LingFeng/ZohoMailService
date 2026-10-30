import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comparisonKey,
  conversionMultiple,
  formatConversion,
  formatConversionApprox,
  sortComparisons,
} from '../src/rebates.ts';
import type { RebateComparison } from '../src/types.ts';

test('conversion reduces cost:revenue to its simplest integer ratio', () => {
  assert.equal(formatConversion(20, 400), '1:20');
  assert.equal(formatConversion(100, 25), '4:1');
  assert.equal(formatConversion(18, 18), '1:1');
  assert.equal(formatConversion(20.5, 410), '1:20');
  assert.equal(formatConversion(0.03, 0.07), '3:7');
  assert.equal(formatConversion(500.25, 250.1), '10005:5002');
});

test('conversion uses rounded integer cents instead of floating point fractions', () => {
  assert.equal(formatConversion(0.1 + 0.2, 0.6), '1:2');
  assert.equal(formatConversion(0.07, 0.28), '1:4');
  assert.equal(formatConversion(0.29, 0.58), '1:2');
});

test('conversion makes the cost and revenue zero cases explicit', () => {
  assert.equal(formatConversion(0, 0), '0:0');
  assert.equal(formatConversion(0, 42.13), '0:1');
  assert.equal(formatConversion(22.11, 0), '1:0');
});

test('conversion handles large representable amounts without scientific notation', () => {
  assert.equal(formatConversion(1_000_000_000_000, 0.01), '100000000000000:1');
  assert.equal(formatConversion(999_999_999_999.99, 0.01), '99999999999999:1');
  const large = 90_071_992_547_409.9;
  assert.equal(formatConversion(large, 0.01), '9007199254740990:1');
  assert.equal(formatConversion(0.01, large), '1:9007199254740990');
  assert.equal(formatConversion(large, large), '1:1');
});

test('approximate conversion normalizes cost to one with exactly three decimal places', () => {
  assert.equal(formatConversionApprox(4, 41), '10.250');
  assert.equal(formatConversionApprox(20, 400), '20.000');
  assert.equal(formatConversionApprox(0.03, 0.07), '2.333');
  assert.equal(formatConversionApprox(0.1 + 0.2, 0.6), '2.000');
  assert.equal(formatConversionApprox(100, 25), '0.250');
});

test('approximate conversion rounds half up using integer cents and carries correctly', () => {
  assert.equal(formatConversionApprox(16, 1), '0.063');
  assert.equal(formatConversionApprox(16, 0.99), '0.062');
  assert.equal(formatConversionApprox(16, 1.01), '0.063');
  assert.equal(formatConversionApprox(1000, 999.99), '1.000');
  assert.equal(formatConversionApprox(3, 2999.99), '999.997');
});

test('approximate conversion distinguishes a missing normalization from zero revenue', () => {
  assert.equal(formatConversionApprox(0, 0), '—');
  assert.equal(formatConversionApprox(0, 12.34), '—');
  assert.equal(formatConversionApprox(Number.NaN, 12.34), '—');
  assert.equal(formatConversionApprox(Number.POSITIVE_INFINITY, 12.34), '—');
  assert.equal(formatConversionApprox(12.34, 0), '0.000');
});

test('approximate conversion keeps large ratios as plain ungrouped decimals', () => {
  assert.equal(formatConversionApprox(0.01, 12.34), '1234.000');
  assert.equal(
    formatConversionApprox(0.01, 1_000_000_000_000),
    '100000000000000.000',
  );
  assert.equal(
    formatConversionApprox(0.01, 999_999_999_999.99),
    '99999999999999.000',
  );
  assert.equal(
    formatConversionApprox(0.01, 90_071_992_547_409.9),
    '9007199254740990.000',
  );
});

function comparison(overrides: Partial<RebateComparison> = {}): RebateComparison {
  return {
    accountId: 'mail-1', accountEmail: 'test@example.com', accountName: 'Test',
    siteName: '返利网', domain: 'rewards.example.com', offerName: 'Offer A',
    totalRevenue: 100, totalCost: 20, settledRevenue: 40, unsettledRevenue: 60,
    conversionRate: 20, recordCount: 1, ...overrides,
  };
}

test('comparison identities distinguish offers, sites, domains and mailboxes', () => {
  const items = [
    comparison(),
    comparison({ offerName: 'Offer B' }),
    comparison({ siteName: '另一个返利网' }),
    comparison({ domain: 'other.example.com' }),
    comparison({ accountId: 'mail-2' }),
  ];
  assert.equal(new Set(items.map(comparisonKey)).size, items.length);
  assert.notEqual(
    comparisonKey(comparison({ siteName: 'a|b', domain: 'c' })),
    comparisonKey(comparison({ siteName: 'a', domain: 'b|c' })),
  );
});

test('comparison sorting retains all offers and leaves source data untouched', () => {
  const items = Array.from({ length: 25 }, (_, index) => comparison({
    offerName: `Offer ${index}`, totalRevenue: index * 10, totalCost: 100 - index,
  }));
  const original = [...items];
  const byRevenue = sortComparisons(items, 'totalRevenue');
  assert.equal(byRevenue.length, 25);
  assert.equal(byRevenue[0].totalRevenue, 240);
  assert.equal(byRevenue.at(-1)?.totalRevenue, 0);
  assert.equal(sortComparisons(items, 'totalCost')[0].totalCost, 100);
  assert.deepEqual(items, original);
});

test('conversion chart uses revenue per cost and keeps zero cost undefined', () => {
  assert.equal(conversionMultiple(4, 41), 10.25);
  assert.equal(conversionMultiple(100, 25), 0.25);
  assert.equal(conversionMultiple(0.03, 0.07), 2.333);
  assert.equal(conversionMultiple(20, 0), 0);
  assert.equal(conversionMultiple(0, 20), null);
  assert.equal(conversionMultiple(0, 0), null);
  const items = [
    comparison({ offerName: 'zero cost', totalCost: 0, totalRevenue: 999 }),
    comparison({ offerName: 'zero revenue', totalCost: 50, totalRevenue: 0 }),
    comparison({ offerName: 'higher return', totalCost: 10, totalRevenue: 100 }),
    comparison({ offerName: 'lower return', totalCost: 100, totalRevenue: 25 }),
  ];
  assert.deepEqual(sortComparisons(items, 'conversion').map((item) => item.offerName), [
    'higher return', 'lower return', 'zero revenue', 'zero cost',
  ]);
});
