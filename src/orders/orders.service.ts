import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatKobo } from '../cart/pricing';

const ORDER_DETAIL_INCLUDE = {
  items: true,
  shipments: {
    select: {
      status: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      shippedAt: true,
      deliveredAt: true,
      zone: { select: { name: true } },
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      method: true,
      status: true,
      reference: true,
      amountKobo: true,
      channel: true,
      paidAt: true,
    },
  },
  events: {
    orderBy: { createdAt: 'asc' as const },
    select: { type: true, message: true, createdAt: true },
  },
  returns: {
    select: { id: true, status: true, reason: true, createdAt: true },
  },
};

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async listForUser(userId: string, page = 1, limit = 20) {
    const where = { userId };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalKobo: true,
          placedAt: true,
          items: {
            select: {
              productTitle: true,
              variantTitle: true,
              image: true,
              quantity: true,
            },
          },
        },
      }),
    ]);

    return {
      items: orders.map((order) => ({
        ...order,
        itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
        formattedTotal: formatKobo(order.totalKobo),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
    };
  }

  async getForUser(userId: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) throw new NotFoundException('Order not found');

    return this.decorate(order);
  }

  /**
   * Guest order lookup.
   *
   * Requires the email as well as the order number: order numbers are random
   * rather than sequential, but pairing them with the email means a leaked
   * number alone still reveals nothing.
   */
  async getForGuest(orderNumber: string, email: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        email: email.toLowerCase(),
      },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) throw new NotFoundException('Order not found');

    return this.decorate(order);
  }

  private decorate<
    T extends {
      subtotalKobo: number;
      discountKobo: number;
      deliveryKobo: number;
      totalKobo: number;
    },
  >(order: T) {
    return {
      ...order,
      formatted: {
        subtotal: formatKobo(order.subtotalKobo),
        discount: formatKobo(order.discountKobo),
        delivery: formatKobo(order.deliveryKobo),
        total: formatKobo(order.totalKobo),
      },
    };
  }
}
