import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

/**
 * How long a checkout may hold stock. Long enough to finish a bank transfer
 * or USSD payment, short enough that an abandoned checkout does not keep a
 * last-size dress off the shelf all day.
 */
export const RESERVATION_TTL_MS = 30 * 60 * 1000;

export interface ReservationRequest {
  variantId: string;
  quantity: number;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly variantId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Only ${available} left of variant ${variantId} (requested ${requested})`,
    );
    this.name = 'InsufficientStockError';
  }
}

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Holds stock for an order.
   *
   * Runs inside the caller's transaction so the availability check and the
   * insert cannot be interleaved by a second checkout — without that, two
   * shoppers can both read "1 available" and both succeed.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    items: ReservationRequest[],
    orderId: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    const now = new Date();

    for (const item of items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { id: true, stock: true, allowBackorder: true },
      });

      if (!variant) {
        throw new InsufficientStockError(item.variantId, item.quantity, 0);
      }

      if (!variant.allowBackorder) {
        const held = await tx.inventoryReservation.aggregate({
          where: {
            variantId: item.variantId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          _sum: { quantity: true },
        });

        const available = variant.stock - (held._sum.quantity ?? 0);

        if (available < item.quantity) {
          throw new InsufficientStockError(
            item.variantId,
            item.quantity,
            Math.max(0, available),
          );
        }
      }

      await tx.inventoryReservation.create({
        data: {
          variantId: item.variantId,
          quantity: item.quantity,
          orderId,
          expiresAt,
          status: 'ACTIVE',
        },
      });
    }
  }

  /**
   * Turns held stock into sold stock: decrements the variant, writes the
   * ledger entry, and closes the reservation. Called when payment confirms,
   * never before.
   */
  async consume(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });

    for (const reservation of reservations) {
      const variant = await tx.productVariant.update({
        where: { id: reservation.variantId },
        data: { stock: { decrement: reservation.quantity } },
        select: { id: true, stock: true },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: reservation.variantId,
          delta: -reservation.quantity,
          reason: 'SALE',
          resultingStock: variant.stock,
          orderId,
        },
      });

      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED' },
      });
    }
  }

  /** Gives held stock back — cancelled order, failed payment, or expiry. */
  async release(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.inventoryReservation.updateMany({
      where: { orderId, status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
  }

  /**
   * Releases holds whose TTL has passed.
   *
   * Availability queries already ignore expired rows, so this is bookkeeping
   * rather than correctness — it stops the reservation table growing without
   * bound and keeps admin stock views honest.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpired(): Promise<void> {
    const { count } = await this.prisma.inventoryReservation.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      data: { status: 'RELEASED' },
    });

    if (count > 0) {
      this.logger.log(`Released ${count} expired stock reservation(s)`);
    }
  }
}
