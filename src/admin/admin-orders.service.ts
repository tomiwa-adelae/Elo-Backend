import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RestockService } from '../restock/restock.module';
import { ReservationService } from '../inventory/reservation.service';
import { MailService } from '../mail/mail.service';
import { formatMoney } from '../money/money';
import type { OrderEmailData } from '../mail/templates';
import type { Prisma } from '../../generated/prisma/client';
import type { OrderStatus } from '../../generated/prisma/enums';
import type {
  AdminOrderQueryDto,
  MarkPaidDto,
  UpdateOrderStatusDto,
} from './dto/store.dto';

type Tx = Prisma.TransactionClient;

/**
 * The fulfilment path a store actually walks. Anything not listed here is
 * refused, which keeps an order from jumping from DELIVERED back to PENDING
 * and double-counting stock.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

const EMAIL_SELECT = {
  orderNumber: true,
  email: true,
  subtotalKobo: true,
  discountKobo: true,
  deliveryKobo: true,
  totalKobo: true,
  currency: true,
  shippingAddress: true,
  items: {
    select: {
      productTitle: true,
      variantTitle: true,
      quantity: true,
      totalKobo: true,
      image: true,
    },
  },
} as const;

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private reservations: ReservationService,
    private mail: MailService,
    private restock: RestockService,
  ) {}

  async list(query: AdminOrderQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const where: Prisma.OrderWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
      ...(search && {
        OR: [
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          {
            shippingAddress: {
              path: ['fullName'],
              string_contains: search,
            },
          },
          {
            shippingAddress: {
              path: ['phoneNumber'],
              string_contains: search,
            },
          },
        ],
      }),
    };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          email: true,
          status: true,
          paymentStatus: true,
          totalKobo: true,
          currency: true,
          placedAt: true,
          shippingAddress: true,
          _count: { select: { items: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { method: true },
          },
        },
      }),
    ]);

    return {
      items: orders.map(({ _count, payments, shippingAddress, ...order }) => {
        const address = (shippingAddress ?? {}) as Record<string, string>;
        return {
          ...order,
          customerName: address.fullName ?? null,
          phoneNumber: address.phoneNumber ?? null,
          city: [address.city, address.state].filter(Boolean).join(', '),
          itemCount: _count.items,
          paymentMethod: payments[0]?.method ?? null,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
      },
    };
  }

  async get(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        shipments: {
          orderBy: { createdAt: 'desc' },
          include: { zone: { select: { name: true } } },
        },
        events: { orderBy: { createdAt: 'asc' } },
        returns: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Strip raw provider payloads; they are for disputes, not the UI.
    return {
      ...order,
      payments: order.payments.map((payment) => {
        const { rawPayload, ...rest } = payment;
        void rawPayload;
        return rest;
      }),
      allowedTransitions: TRANSITIONS[order.status],
      canMarkPaid:
        ['UNPAID', 'AWAITING_DELIVERY_PAYMENT', 'FAILED'].includes(
          order.paymentStatus,
        ) && !['CANCELLED', 'REFUNDED'].includes(order.status),
    };
  }

  async updateStatus(
    orderNumber: string,
    dto: UpdateOrderStatusDto,
    actorId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (!TRANSITIONS[order.status].includes(dto.status)) {
      throw new BadRequestException(
        `An order that is ${order.status.toLowerCase()} cannot be marked ${dto.status.toLowerCase()}`,
      );
    }

    if (
      dto.status === 'CONFIRMED' &&
      !['PAID', 'AWAITING_DELIVERY_PAYMENT'].includes(order.paymentStatus)
    ) {
      throw new BadRequestException(
        'This order has not been paid. Use "Mark as paid" once you have received the money.',
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        if (dto.status === 'CANCELLED') {
          await this.returnStock(tx, order.id, actorId);
          await tx.payment.updateMany({
            where: { orderId: order.id, status: 'PENDING' },
            data: { status: 'ABANDONED' },
          });
        }

        if (dto.status === 'SHIPPED') {
          const shipment = await tx.shipment.findFirst({
            where: { orderId: order.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          const shipmentData = {
            carrier: dto.carrier || null,
            trackingNumber: dto.trackingNumber || null,
            trackingUrl: dto.trackingUrl || null,
            status: 'IN_TRANSIT' as const,
            shippedAt: now,
          };
          if (shipment) {
            await tx.shipment.update({
              where: { id: shipment.id },
              data: shipmentData,
            });
          } else {
            await tx.shipment.create({
              data: { orderId: order.id, ...shipmentData },
            });
          }
        }

        if (dto.status === 'DELIVERED') {
          await tx.shipment.updateMany({
            where: { orderId: order.id },
            data: { status: 'DELIVERED', deliveredAt: now },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: dto.status,
            ...(dto.status === 'CANCELLED' && {
              cancelledAt: now,
              cancelReason: dto.note || null,
            }),
            ...(dto.status === 'REFUNDED' && { paymentStatus: 'REFUNDED' }),
          },
        });

        const eventType =
          dto.status === 'SHIPPED'
            ? 'SHIPPED'
            : dto.status === 'DELIVERED'
              ? 'DELIVERED'
              : dto.status === 'CANCELLED'
                ? 'CANCELLED'
                : dto.status === 'REFUNDED'
                  ? 'REFUNDED'
                  : 'STATUS_CHANGED';

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: eventType,
            message:
              `Marked ${dto.status.toLowerCase()}` +
              (dto.trackingNumber ? ` · tracking ${dto.trackingNumber}` : '') +
              (dto.note ? ` · ${dto.note}` : ''),
            actorId,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    // A cancellation puts stock back on the shelf.
    if (dto.status === 'CANCELLED') this.restock.notifyLater();

    if (dto.notifyCustomer !== false) {
      await this.notify(order.id, dto);
    }

    return this.get(orderNumber);
  }

  /**
   * Records money received outside Paystack — a bank transfer straight to the
   * store, or cash collected on delivery — and does everything a successful
   * Paystack charge would have done.
   */
  async markPaid(orderNumber: string, dto: MarkPaidDto, actorId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalKobo: true,
        currency: true,
        discountId: true,
        discountKobo: true,
        userId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('This order is already paid');
    }
    if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new BadRequestException('This order was cancelled');
    }

    const wasPending = order.status === 'PENDING';

    await this.prisma.$transaction(
      async (tx) => {
        await tx.payment.updateMany({
          where: { orderId: order.id, status: 'PENDING' },
          data: { status: 'ABANDONED' },
        });

        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'MANUAL',
            method: dto.method,
            reference: `MANUAL-${orderNumber}-${Date.now()}`,
            amountKobo: order.totalKobo,
            currency: order.currency,
            status: 'SUCCESS',
            paidAt: new Date(),
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'PAID',
            ...(wasPending && { status: 'CONFIRMED' }),
          },
        });

        await this.takeStock(tx, order.id, actorId);

        if (order.discountId) {
          const redeemed = await tx.discountRedemption.findFirst({
            where: { orderId: order.id },
            select: { id: true },
          });
          if (!redeemed) {
            await tx.discount.update({
              where: { id: order.discountId },
              data: { usedCount: { increment: 1 } },
            });
            await tx.discountRedemption.create({
              data: {
                discountId: order.discountId,
                userId: order.userId,
                orderId: order.id,
                amountKobo: order.discountKobo,
              },
            });
          }
        }

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'PAYMENT_CONFIRMED',
            message: `${formatMoney(order.totalKobo, order.currency)} received by ${dto.method.replace(/_/g, ' ').toLowerCase()}${dto.note ? ` · ${dto.note}` : ''}`,
            actorId,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    if (wasPending) {
      const data = await this.emailData(order.id);
      if (data) await this.mail.sendOrderConfirmed(data, false);
    }

    return this.get(orderNumber);
  }

  async addNote(orderNumber: string, note: string, actorId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.orderEvent.create({
      data: { orderId: order.id, type: 'NOTE_ADDED', message: note, actorId },
    });
    return this.get(orderNumber);
  }

  // ── stock ────────────────────────────────────────────────────────────────

  /** Units this order has already taken off the shelf, per variant. */
  private async soldByVariant(tx: Tx, orderId: string) {
    const movements = await tx.inventoryMovement.groupBy({
      by: ['variantId'],
      where: { orderId, reason: { in: ['SALE', 'CANCELLED_ORDER'] } },
      _sum: { delta: true },
    });
    // SALE is negative and CANCELLED_ORDER positive, so the net is what is
    // still out of stock because of this order.
    return new Map(movements.map((m) => [m.variantId, -(m._sum.delta ?? 0)]));
  }

  /**
   * Makes sure every unit in the order has been taken off the shelf exactly
   * once. Active reservations are consumed; anything whose hold already
   * expired (a slow bank transfer) is decremented directly.
   */
  private async takeStock(tx: Tx, orderId: string, actorId?: string) {
    await this.reservations.consume(tx, orderId);

    const sold = await this.soldByVariant(tx, orderId);
    const items = await tx.orderItem.findMany({
      where: { orderId, variantId: { not: null } },
      select: { variantId: true, quantity: true },
    });

    const needed = new Map<string, number>();
    for (const item of items) {
      needed.set(
        item.variantId!,
        (needed.get(item.variantId!) ?? 0) + item.quantity,
      );
    }

    for (const [variantId, quantity] of needed) {
      const missing = quantity - (sold.get(variantId) ?? 0);
      if (missing <= 0) continue;

      const variant = await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { decrement: missing } },
        select: { stock: true },
      });
      if (variant.stock < 0) {
        this.logger.warn(
          `Variant ${variantId} went to ${variant.stock} after manual payment on order ${orderId}`,
        );
      }
      await tx.inventoryMovement.create({
        data: {
          variantId,
          delta: -missing,
          reason: 'SALE',
          resultingStock: variant.stock,
          orderId,
          note: 'Taken when payment was recorded manually',
          actorId,
        },
      });
    }
  }

  /** Puts sold units back and drops any holds still active. */
  private async returnStock(tx: Tx, orderId: string, actorId?: string) {
    await this.reservations.release(tx, orderId);

    const sold = await this.soldByVariant(tx, orderId);
    for (const [variantId, quantity] of sold) {
      if (quantity <= 0) continue;
      const variant = await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: quantity } },
        select: { stock: true },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId,
          delta: quantity,
          reason: 'CANCELLED_ORDER',
          resultingStock: variant.stock,
          orderId,
          actorId,
        },
      });
    }
  }

  // ── email ────────────────────────────────────────────────────────────────

  private async emailData(orderId: string): Promise<OrderEmailData | null> {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: EMAIL_SELECT,
    });
  }

  private async notify(orderId: string, dto: UpdateOrderStatusDto) {
    const data = await this.emailData(orderId);
    if (!data) return;

    try {
      if (dto.status === 'SHIPPED') {
        await this.mail.sendOrderShipped(data, dto);
      } else if (dto.status === 'DELIVERED') {
        await this.mail.sendOrderDelivered(data);
      } else if (dto.status === 'CANCELLED') {
        await this.mail.sendOrderCancelled(data, dto.note);
      }
    } catch (error) {
      this.logger.error(`Order email failed: ${(error as Error).message}`);
    }
  }
}
