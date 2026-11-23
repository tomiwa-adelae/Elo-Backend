import type { Currency } from '../../generated/prisma/enums';

export type { Currency };

/**
 * Converts kobo to US cents at `ngnPerUsd` whole naira per dollar, rounding up
 * so a converted amount never undercharges.
 */
export function koboToUsdCents(kobo: number, ngnPerUsd: number): number {
  if (kobo <= 0) return 0;
  return Math.ceil(kobo / ngnPerUsd);
}

/** Converted catalogue prices round up to a whole dollar so they read cleanly. */
export function koboToUsdPrice(kobo: number, ngnPerUsd: number): number {
  if (kobo <= 0) return 0;
  return Math.ceil(kobo / ngnPerUsd / 100) * 100;
}

export function usdCentsToKobo(cents: number, ngnPerUsd: number): number {
  return cents * ngnPerUsd;
}

export interface PricedVariant {
  priceKobo: number;
  compareAtPriceKobo: number | null;
  priceUsdCents: number | null;
  compareAtUsdCents: number | null;
}

/** The effective unit price of a variant in a currency. */
export function variantPrice(
  variant: PricedVariant,
  currency: Currency,
  ngnPerUsd: number,
): { price: number; compareAt: number | null } {
  if (currency === 'NGN') {
    return { price: variant.priceKobo, compareAt: variant.compareAtPriceKobo };
  }
  const price =
    variant.priceUsdCents ?? koboToUsdPrice(variant.priceKobo, ngnPerUsd);
  const compareAt =
    variant.compareAtUsdCents ??
    (variant.compareAtPriceKobo !== null
      ? koboToUsdPrice(variant.compareAtPriceKobo, ngnPerUsd)
      : null);
  return { price, compareAt };
}

/** A naira-authored amount (fee, threshold, fixed discount) in `currency`. */
export function fromKobo(
  kobo: number,
  currency: Currency,
  ngnPerUsd: number,
): number;
export function fromKobo(
  kobo: number | null,
  currency: Currency,
  ngnPerUsd: number,
): number | null;
export function fromKobo(
  kobo: number | null,
  currency: Currency,
  ngnPerUsd: number,
): number | null {
  if (kobo === null) return null;
  return currency === 'NGN' ? kobo : koboToUsdCents(kobo, ngnPerUsd);
}

export function formatMoney(minor: number, currency: Currency = 'NGN') {
  const whole = minor % 100 === 0;
  const amount = (minor / 100).toLocaleString(
    currency === 'USD' ? 'en-US' : 'en-NG',
    {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    },
  );
  return `${currency === 'USD' ? '$' : '₦'}${amount}`;
}

/** Effective dollar price range of a product's active variants. */
export function usdRange(
  variants: (Pick<PricedVariant, 'priceKobo' | 'priceUsdCents'> & {
    isActive?: boolean | null;
  })[],
  ngnPerUsd: number,
): { minPriceUsdCents: number; maxPriceUsdCents: number } {
  const prices = variants
    .filter((v) => v.isActive ?? true)
    .map((v) => v.priceUsdCents ?? koboToUsdPrice(v.priceKobo, ngnPerUsd));
  return {
    minPriceUsdCents: prices.length ? Math.min(...prices) : 0,
    maxPriceUsdCents: prices.length ? Math.max(...prices) : 0,
  };
}
