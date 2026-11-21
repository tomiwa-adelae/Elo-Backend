import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface VariantAvailability {
  variantId: string;
  /** Physical units on the shelf. */
  stock: number;
  /** Units held by in-flight checkouts. */
  reserved: number;
  /** What a new shopper can actually add to their cart. */
  available: number;
  inStock: boolean;
  lowStock: boolean;
}

/**
 * Single source of truth for "can someone buy this right now".
 *
 * Available stock is never `variant.stock` on its own — units held by
 * in-flight checkouts have not been paid for, so they are not yet sold, but
 * they must not be sellable twice either. Everything that needs a stock
 * number (catalog, cart, checkout) goes through here so the answer stays
 * consistent.
 */
@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Reserved counts for many variants in one query. Expired reservations are
   * excluded rather than deleted — the sweeper releases them separately, and
   * filtering on expiresAt means a late sweeper never blocks a sale.
   */
  async getReservedCounts(variantIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    if (variantIds.length === 0) return counts;

    const grouped = await this.prisma.inventoryReservation.groupBy({
      by: ['variantId'],
      where: {
        variantId: { in: variantIds },
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      _sum: { quantity: true },
    });

    for (const row of grouped) {
      counts.set(row.variantId, row._sum.quantity ?? 0);
    }

    return counts;
  }

  /**
   * Resolves availability for variants already loaded by the caller, so the
   * catalog does not re-query rows it is holding.
   */
  async resolve(
    variants: {
      id: string;
      stock: number;
      lowStockAt: number;
      allowBackorder: boolean;
    }[],
  ): Promise<Map<string, VariantAvailability>> {
    const reservedCounts = await this.getReservedCounts(
      variants.map((v) => v.id),
    );

    const result = new Map<string, VariantAvailability>();

    for (const variant of variants) {
      const reserved = reservedCounts.get(variant.id) ?? 0;
      const available = Math.max(0, variant.stock - reserved);

      result.set(variant.id, {
        variantId: variant.id,
        stock: variant.stock,
        reserved,
        available,
        inStock: variant.allowBackorder || available > 0,
        // Backorder variants never nag about low stock — the count is
        // meaningless when you are happy to sell past zero.
        lowStock:
          !variant.allowBackorder &&
          available > 0 &&
          available <= variant.lowStockAt,
      });
    }

    return result;
  }

  async forVariant(variantId: string): Promise<VariantAvailability | null> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        stock: true,
        lowStockAt: true,
        allowBackorder: true,
      },
    });

    if (!variant) return null;

    const map = await this.resolve([variant]);
    return map.get(variant.id) ?? null;
  }
}
