import type { Discount } from '../../generated/prisma/client';

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
): DiscountOutcome {
  if (
    discount.minSubtotalKobo !== null &&
    subtotalKobo < discount.minSubtotalKobo
  ) {
    return {
      discountKobo: 0,
      freeDelivery: false,
      reason: `Spend at least ${formatKobo(discount.minSubtotalKobo)} to use this code`,
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
      : discount.value;

  if (
    discount.maxDiscountKobo !== null &&
    discountKobo > discount.maxDiscountKobo
  ) {
    discountKobo = discount.maxDiscountKobo;
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

export function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
