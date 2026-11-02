import type { RebateComparison } from './types.ts';

const centFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Parse decimal money before reducing it, avoiding floating-point remainder errors.
function cents(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(centFormatter.format(value).replace('.', ''));
}

export function formatConversion(cost: number, revenue: number): string {
  const costCents = cents(cost);
  const revenueCents = cents(revenue);
  if (costCents === 0n && revenueCents === 0n) return '0:0';
  let left = costCents;
  let right = revenueCents;
  while (right !== 0n) {
    [left, right] = [right, left % right];
  }
  return `${costCents / left}:${revenueCents / left}`;
}

// Normalize cost:revenue to 1:x, rounding x half up to three decimal places.
export function formatConversionApprox(cost: number, revenue: number): string {
  const costCents = cents(cost);
  if (costCents === 0n) return '—';
  const revenueCents = cents(revenue);
  const thousandths = (revenueCents * 2000n + costCents) / (costCents * 2n);
  return `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;
}
export type ComparisonSort = 'totalRevenue' | 'totalCost' | 'conversion';

export interface OfferComparison {
  offerName: string;
  totalRevenue: number;
  settledRevenue: number;
  unsettledRevenue: number;
  totalCost: number;
  recordCount: number;
}

// The API comparison covers all filtered records, including records outside the current page.
export function aggregateOfferComparisons(comparison: RebateComparison[]): OfferComparison[] {
  const offers = new Map<string, {
    revenue: bigint; settled: bigint; unsettled: bigint; cost: bigint; recordCount: number;
  }>();
  for (const item of comparison) {
    const name = item.offerName.trim();
    const totals = offers.get(name) || { revenue: 0n, settled: 0n, unsettled: 0n, cost: 0n, recordCount: 0 };
    totals.revenue += cents(item.totalRevenue);
    totals.settled += cents(item.settledRevenue);
    totals.unsettled += cents(item.unsettledRevenue);
    totals.cost += cents(item.totalCost);
    totals.recordCount += item.recordCount;
    offers.set(name, totals);
  }
  return [...offers].map(([offerName, totals]) => ({
    offerName, totalRevenue: Number(totals.revenue) / 100,
    settledRevenue: Number(totals.settled) / 100,
    unsettledRevenue: Number(totals.unsettled) / 100,
    totalCost: Number(totals.cost) / 100, recordCount: totals.recordCount,
  }));
}

export function comparisonKey(item: RebateComparison | OfferComparison): string {
  return JSON.stringify('accountId' in item
    ? [item.accountId, item.siteName, item.domain, item.offerName]
    : [item.offerName]);
}

// Use the same rounded ratio as the displayed 1:x value; zero cost is undefined.
export function conversionMultiple(cost: number, revenue: number): number | null {
  const formatted = formatConversionApprox(cost, revenue);
  return formatted === '—' ? null : Number(formatted);
}

export function sortComparisons<T extends RebateComparison | OfferComparison>(
  comparison: T[],
  sort: ComparisonSort,
): T[] {
  const value = (item: T) =>
    sort === 'conversion'
      ? conversionMultiple(item.totalCost, item.totalRevenue)
      : item[sort];
  return [...comparison].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    return (right ?? 0) - (left ?? 0) || comparisonKey(a).localeCompare(comparisonKey(b));
  });
}
