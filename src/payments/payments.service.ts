import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationService } from '../inventory/reservation.service';
import { MailService } from '../mail/mail.service';
import { PaystackService, type PaystackChargeData } from './paystack.service';
import { formatKobo } from '../cart/pricing';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Prisma's Json input type rejects interfaces with optional properties, so the
 * webhook payload is round-tripped into a plain JSON object. This also strips
 * anything non-serialisable before it reaches the column.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private reservations: ReservationService,
    private paystack: PaystackService,
    private mail: MailService,
  ) {}

  /**
   * Marks a payment successful and fulfils the order.
   *
   * Idempotent by design. Paystack retries webhooks, and the same charge can
   * also arrive via the verify-on-redirect path, so this must be safe to run
   * any number of times: the first call does the work, the rest no-op.
   */
  async confirmPayment(charge: PaystackChargeData): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { reference: charge.reference },
      include: { order: true },
    });

    if (!payment) {
      // A reference we never issued. Log rather than throw — returning non-200
      // to Paystack would make them retry something that can never succeed.
      this.logger.warn(
        `Received charge for unknown reference ${charge.reference}`,
      );
      return;
    }

    if (payment.status === 'SUCCESS') {
      this.logger.log(`Ignoring duplicate charge for ${charge.reference}`);
      return;
    }

    // Amount tampering: the hosted page is Paystack's, but the callback is
    // ours, so verify what was actually paid.
    if (charge.amount !== payment.amountKobo) {
      this.logger.error(
        `Amount mismatch for ${charge.reference}: expected ${payment.amountKobo}, got ${charge.amount}`,
      );
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: `Amount mismatch: expected ${payment.amountKobo}, received ${charge.amount}`,
          rawPayload: toJson(charge),
        },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction so two concurrent deliveries of the
      // same webhook cannot both pass the status check above.
      const fresh = await tx.payment.findUnique({
        where: { id: payment.id },
        select: { status: true },
      });

      if (fresh?.status === 'SUCCESS') return;

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          paidAt: charge.paid_at ? new Date(charge.paid_at) : new Date(),
          channel: charge.channel,
          rawPayload: toJson(charge),
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
      });

      // Held stock becomes sold stock only now.
      await this.reservations.consume(tx, payment.orderId);

      await tx.orderEvent.create({
        data: {
          orderId: payment.orderId,
          type: 'PAYMENT_CONFIRMED',
          message: `Payment of ${formatKobo(payment.amountKobo)} confirmed via ${charge.channel ?? 'Paystack'}`,
          data: { reference: charge.reference },
        },
      });

      if (payment.order.discountId) {
        await tx.discount.update({
          where: { id: payment.order.discountId },
          data: { usedCount: { increment: 1 } },
        });

        await tx.discountRedemption.create({
          data: {
            discountId: payment.order.discountId,
            userId: payment.order.userId,
            orderId: payment.orderId,
            amountKobo: payment.order.discountKobo,
          },
        });
      }
    });

    await this.notifyPaid(payment.orderId);
  }

  /** Records a failed charge and frees the stock it was holding. */
  async failPayment(charge: PaystackChargeData, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference: charge.reference },
    });

    if (!payment || payment.status === 'SUCCESS') return;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: reason,
          rawPayload: toJson(charge),
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: 'FAILED' },
      });

      await this.reservations.release(tx, payment.orderId);

      await tx.orderEvent.create({
        data: {
          orderId: payment.orderId,
          type: 'PAYMENT_FAILED',
          message: reason,
          data: { reference: charge.reference },
        },
      });
    });
  }

  /**
   * Reconciles a single reference against Paystack. Used by the redirect
   * handler so the shopper sees a confirmed order immediately rather than
   * waiting on webhook delivery.
   */
  async reconcile(reference: string) {
    const charge = await this.paystack.verifyTransaction(reference);

    if (charge.status === 'success') {
      await this.confirmPayment(charge);
    } else if (charge.status === 'failed') {
      await this.failPayment(charge, `Paystack reported: ${charge.status}`);
    }

    return this.prisma.payment.findUnique({
      where: { reference },
      select: {
        status: true,
        order: { select: { orderNumber: true, status: true } },
      },
    });
  }

  private async notifyPaid(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        email: true,
        totalKobo: true,
        userId: true,
      },
    });

    if (!order) return;

    await this.mail.send({
      to: order.email,
      subject: `Order ${order.orderNumber} confirmed`,
      html: `<p>Thanks — we've received your payment of ${formatKobo(order.totalKobo)} and your order is confirmed.</p>
             <p>Your order number is <strong>${order.orderNumber}</strong>.</p>`,
    });

    if (order.userId) {
      await this.prisma.notification.create({
        data: {
          userId: order.userId,
          type: 'PAYMENT_CONFIRMED',
          title: 'Payment confirmed',
          body: `Order ${order.orderNumber} is confirmed and being prepared.`,
          data: { orderNumber: order.orderNumber },
        },
      });
    }
  }
}
