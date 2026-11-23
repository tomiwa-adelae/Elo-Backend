import type { Discount } from '../../generated/prisma/client';
import { formatMoney, fromKobo, type Currency } from '../money/money';

export interface PricedLine {
  variantId: string;
  productId: string;
  quantity: number;
  unitPriceKobo: number;
  totalKobo: number;
}

export interface DiscountOutcome {
  discountKobo: number;
  /** True when the code zeroes the delivery fee rather than the subtotal. */
  freeDelivery: boolean;
  reason?: string;
}

/**
 * Applies a discount to a set of lines.
 *
 * Product/collection-scoped codes only discount the lines they cover, so
 * "20% off dresses" does not quietly take 20% off the whole basket. The
 * caller is responsible for having already checked validity windows and
 * usage limits — this function only does arithmetic.
 */
export function computeDiscount(
  discount: Pick<
    Discount,
    | 'type'
    | 'value'
    | 'maxDiscountKobo'
    | 'minSubtotalKobo'
    | 'appliesToProductIds'
    | 'appliesToCollectionIds'
  >,
  lines: PricedLine[],
  subtotalKobo: number,
  /** Collections each product belongs to, for scoped codes. */
  collectionsByProduct: Map<string, string[]>,
  /** Currency the lines are priced in; naira-authored limits are converted. */
  currency: Currency = 'NGN',
  ngnPerUsd = 1,
): DiscountOutcome {
  const minSubtotal = fromKobo(discount.minSubtotalKobo, currency, ngnPerUsd);
  const maxDiscount = fromKobo(discount.maxDiscountKobo, currency, ngnPerUsd);

  if (minSubtotal !== null && subtotalKobo < minSubtotal) {
    return {
      discountKobo: 0,
      freeDelivery: false,
      reason: `Spend at least ${formatMoney(minSubtotal, currency)} to use this code`,
    };
  }

  if (discount.type === 'FREE_SHIPPING') {
    return { discountKobo: 0, freeDelivery: true };
  }

  const scoped = scopeLines(discount, lines, collectionsByProduct);

  if (scoped.length === 0) {
    return {
      discountKobo: 0,
      freeDelivery: false,
      reason: 'This code does not apply to anything in your bag',
    };
  }

  const eligibleTotal = scoped.reduce((sum, line) => sum + line.totalKobo, 0);

  let discountKobo =
    discount.type === 'PERCENTAGE'
      ? Math.floor((eligibleTotal * discount.value) / 100)
      : fromKobo(discount.value, currency, ngnPerUsd);

  if (maxDiscount !== null && discountKobo > maxDiscount) {
    discountKobo = maxDiscount;
  }

  // A fixed-amount code larger than the basket must not produce a negative
  // total or, worse, a refund.
  discountKobo = Math.min(discountKobo, eligibleTotal);

  return { discountKobo, freeDelivery: false };
}

function scopeLines(
  discount: Pick<Discount, 'appliesToProductIds' | 'appliesToCollectionIds'>,
  lines: PricedLine[],
  collectionsByProduct: Map<string, string[]>,
): PricedLine[] {
  const hasProductScope = discount.appliesToProductIds.length > 0;
  const hasCollectionScope = discount.appliesToCollectionIds.length > 0;

  if (!hasProductScope && !hasCollectionScope) return lines;

  return lines.filter((line) => {
    if (discount.appliesToProductIds.includes(line.productId)) return true;

    const collections = collectionsByProduct.get(line.productId) ?? [];
    return collections.some((id) =>
      discount.appliesToCollectionIds.includes(id),
    );
  });
}

/** Naira formatting for amounts that are always kobo. */
export function formatKobo(kobo: number): string {
  return formatMoney(kobo, 'NGN');
}
