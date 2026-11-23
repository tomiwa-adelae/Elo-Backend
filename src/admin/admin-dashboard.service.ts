import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;

/** Lagos is UTC+1 all year, so "today" for the store starts at 23:00 UTC. */
function startOfLagosDay(date = new Date()) {
  const lagos = new Date(date.getTime() + 60 * 60 * 1000);
  lagos.setUTCHours(0, 0, 0, 0);
  return new Date(lagos.getTime() - 60 * 60 * 1000);
}

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const today = startOfLagosDay();
    const weekAgo = new Date(today.getTime() - 6 * DAY);
    const monthAgo = new Date(today.getTime() - 29 * DAY);
    const chartStart = new Date(today.getTime() - 13 * DAY);

    const paid = { paymentStatus: 'PAID' as const };

    const revenue = (from: Date) =>
      this.prisma.order.aggregate({
        where: { ...paid, placedAt: { gte: from } },
        _sum: { totalNgnKobo: true },
        _count: { _all: true },
      });

    const [
      todayAgg,
      weekAgg,
      monthAgg,
      statusGroups,
      awaitingPayment,
      recentOrders,
      chartOrders,
      lowStock,
      customers,
    ] = await Promise.all([
      revenue(today),
      revenue(weekAgo),
      revenue(monthAgo),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.order.count({
        where: {
          paymentStatus: { in: ['UNPAID', 'AWAITING_DELIVERY_PAYMENT'] },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      }),
      this.prisma.order.findMany({
        orderBy: { placedAt: 'desc' },
        take: 8,
        select: {
          orderNumber: true,
          email: true,
          status: true,
          paymentStatus: true,
          totalKobo: true,
          currency: true,
          placedAt: true,
          shippingAddress: true,
        },
      }),
      this.prisma.order.findMany({
        where: { ...paid, placedAt: { gte: chartStart } },
        select: { placedAt: true, totalNgnKobo: true },
      }),
      this.prisma.productVariant.findMany({
        where: {
          isActive: true,
          product: { deletedAt: null, status: 'ACTIVE' },
        },
        orderBy: { stock: 'asc' },
        take: 40,
        select: {
          id: true,
          sku: true,
          stock: true,
          lowStockAt: true,
          product: { select: { id: true, title: true } },
          optionValues: { select: { value: true } },
        },
      }),
      this.prisma.user.count({ where: { role: 'CUSTOMER', isDeleted: false } }),
    ]);

    const byStatus = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count._all]),
    );

    const days = Array.from({ length: 14 }, (_, i) => {
      const start = new Date(chartStart.getTime() + i * DAY);
      return { start, revenueKobo: 0, orders: 0 };
    });
    for (const order of chartOrders) {
      const index = Math.floor(
        (order.placedAt.getTime() - chartStart.getTime()) / DAY,
      );
      if (days[index]) {
        days[index].revenueKobo += order.totalNgnKobo;
        days[index].orders += 1;
      }
    }

    // Revenue figures are naira: dollar orders count at the rate they were
    // placed at, so the totals never mix currencies.
    return {
      revenue: {
        today: {
          kobo: todayAgg._sum.totalNgnKobo ?? 0,
          orders: todayAgg._count._all,
        },
        week: {
          kobo: weekAgg._sum.totalNgnKobo ?? 0,
          orders: weekAgg._count._all,
        },
        month: {
          kobo: monthAgg._sum.totalNgnKobo ?? 0,
          orders: monthAgg._count._all,
        },
      },
      toFulfil: (byStatus.CONFIRMED ?? 0) + (byStatus.PROCESSING ?? 0),
      awaitingPayment,
      ordersByStatus: byStatus,
      customers,
      salesChart: days.map((d) => ({
        // Date label in Lagos time.
        date: new Date(d.start.getTime() + 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        revenueKobo: d.revenueKobo,
        orders: d.orders,
      })),
      recentOrders: recentOrders.map(({ shippingAddress, ...o }) => ({
        ...o,
        customerName:
          ((shippingAddress ?? {}) as Record<string, string>).fullName ?? null,
      })),
      lowStock: lowStock
        .filter((v) => v.stock <= v.lowStockAt)
        .slice(0, 10)
        .map((v) => ({
          variantId: v.id,
          productId: v.product.id,
          title: v.product.title,
          variant: v.optionValues.map((o) => o.value).join(' / ') || 'Default',
          sku: v.sku,
          stock: v.stock,
        })),
    };
  }
}
