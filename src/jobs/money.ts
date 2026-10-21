import type { Transaction } from './bank.ts';

/*
 * What the numbers say without a model: plain arithmetic is exact and free, so the model is
 * kept for what needs reading (what a shop is). Repeating charges, a price that crept up, a
 * charge taken twice, a bill far above its usual.
 */

export interface Subscription {
  key: string;
  /** The amount of the last charge (positive). */
  amount: number;
  charges: number;
  lastDate: string;
  /** The price went up: the amount before. */
  roseFrom: number | null;
}

export interface DoubleCharge {
  key: string;
  amount: number;
  dates: [string, string];
}

export interface Unusual {
  key: string;
  date: string;
  amount: number;
  /** The usual amount (the median of the earlier ones). */
  usual: number;
}

/** A charge in this many different months, about the same each time, is a subscription. */
const MIN_MONTHS = 3;
/** "About the same": within this share of the usual amount. */
const SAME_PRICE = 0.25;
/** A price rise smaller than this is rounding, not news. */
const RISE = 0.03;
/** The same amount from the same shop within this many days is likely charged twice. */
const DOUBLE_DAYS = 3;
/** "Far above its usual": this share above the median, and at least this much money. */
const UNUSUAL_SHARE = 0.4;
const UNUSUAL_MIN = 15;

export function subscriptions(transactions: Transaction[]): Subscription[] {
  return [...byKey(transactions.filter((one) => one.amount < 0))].flatMap(([key, charges]) => {
    const months = new Map<string, Transaction>();
    for (const charge of charges) {
      months.set(charge.date.slice(0, 7), charge);
    }
    const monthly = [...months.values()];
    // About once a month: a shop visited every week is not a subscription, however steady.
    if (monthly.length < MIN_MONTHS || !aboutMonthly(charges, months.size)) {
      return [];
    }
    const amounts = monthly.map((one) => -one.amount);
    const usual = median(amounts.slice(0, -1));
    // Groceries are in every month too: a subscription costs about the same each time.
    if (amounts.slice(0, -1).some((amount) => Math.abs(amount - usual) > usual * SAME_PRICE)) {
      return [];
    }
    const last = amounts.at(-1)!;
    const before = amounts.at(-2)!;
    return [
      {
        key,
        amount: last,
        charges: charges.length,
        lastDate: monthly.at(-1)!.date,
        roseFrom: last > before * (1 + RISE) ? before : null,
      },
    ];
  });
}

/**
 * The same amount from the same merchant within days, where the merchant charges about once a
 * month: two rides of one price or two transfers to a friend are not a mistake of the bank.
 */
export function doubleCharges(transactions: Transaction[]): DoubleCharge[] {
  const found: DoubleCharge[] = [];
  for (const [key, charges] of byKey(transactions.filter((one) => one.amount < 0))) {
    const months = new Set(charges.map((one) => one.date.slice(0, 7))).size;
    // The extra charge itself is the one too many.
    if (months < 2 || !aboutMonthly(charges.slice(1), months)) {
      continue;
    }
    for (let i = 1; i < charges.length; i++) {
      const [a, b] = [charges[i - 1], charges[i]];
      if (a.amount === b.amount && daysBetween(a.date, b.date) <= DOUBLE_DAYS) {
        found.push({ key, amount: -a.amount, dates: [a.date, b.date] });
      }
    }
  }
  return found;
}

/**
 * Bills far above their own usual: the last charge of a monthly bill against the median of its
 * earlier ones (at least three). Only bills with a usual amount — not a shop of every day.
 */
export function unusual(transactions: Transaction[]): Unusual[] {
  return [...byKey(transactions.filter((one) => one.amount < 0))].flatMap(([key, charges]) => {
    // A bill: about one charge a month for three months or more — not a shop of every day.
    const months = new Set(charges.map((one) => one.date.slice(0, 7)));
    if (charges.length < 4 || months.size < 3 || charges.length > months.size + 1) {
      return [];
    }
    const earlier = charges.slice(0, -1).map((one) => -one.amount);
    const usual = median(earlier);
    const spread = median(earlier.map((amount) => Math.abs(amount - usual)));
    const last = charges.at(-1)!;
    const amount = -last.amount;
    const far = amount > usual * (1 + UNUSUAL_SHARE) && amount - usual >= UNUSUAL_MIN;
    // A shop whose amounts always jump around (a supermarket) is not "unusual" for jumping.
    const steady = spread <= usual * SAME_PRICE;
    return far && steady ? [{ key, date: last.date, amount, usual }] : [];
  });
}

/** At most one charge a month, give or take one. */
function aboutMonthly(charges: Transaction[], months: number): boolean {
  return charges.length <= months + 1;
}

function byKey(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const one of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    groups.set(one.key, [...(groups.get(one.key) ?? []), one]);
  }
  return groups;
}

export function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}
