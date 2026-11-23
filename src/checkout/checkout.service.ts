import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { DeliveryService } from '../delivery/delivery.service';
import {
  InsufficientStockError,
  ReservationService,
} from '../inventory/reservation.service';
import { PaystackService } from '../payments/paystack.service';
import { MailService } from '../mail/mail.service';
import { formatMoney, usdCentsToKobo } from '../money/money';
import { getFrontendUrl } from '../utils/frontendUrl';
import { generateOrderNumber, generatePaymentReference } from './order-number';
import {
  CheckoutPaymentMethod,
  type PlaceOrderDto,
  type ShippingAddressDto,
} from './dto/checkout.dto';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private prisma: PrismaService,
    private cart: CartService,
    private delivery: DeliveryService,
    private reservations: ReservationService,
    private paystack: PaystackService,
    private mail: MailService,
    private settings: SettingsService,
  ) {}

  /**
   * Totals for a given address, with no side effects. The checkout page calls
   * this on every address change.
   */
  async quote(cartId: string, address: ShippingAddressDto) {
    const cart = await this.cart.getCartView(cartId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Your bag is empty');
    }

    const { subtotalKobo, discountKobo } = cart.totals;
    const currency = cart.currency;

    const store = await this.settings.get();

    const zone = await this.delivery.resolve(address, subtotalKobo, currency);

    // A FREE_SHIPPING code zeroes delivery instead of the subtotal.
    const deliveryKobo = cart.discount?.freeDelivery ? 0 : zone.feeKobo;
    const totalKobo = Math.max(0, subtotalKobo - discountKobo + deliveryKobo);

    return {
      currency,
      ngnPerUsd: cart.ngnPerUsd,
      delivery: {
        zoneName: zone.zoneName,
        feeKobo: deliveryKobo,
        isFree: zone.isFree || Boolean(cart.discount?.freeDelivery),
        freeAboveKobo: zone.freeAboveKobo,
        estimatedMinDays: zone.estimatedMinDays,
        estimatedMaxDays: zone.estimatedMaxDays,
        allowPayOnDelivery:
          zone.allowPayOnDelivery && store.enablePayOnDelivery,
      },
      totals: {
        subtotalKobo,
        discountKobo,
        deliveryKobo,
        totalKobo,
        formatted: {
          subtotal: formatMoney(subtotalKobo, currency),
          discount: formatMoney(discountKobo, currency),
          delivery: formatMoney(deliveryKobo, currency),
          total: formatMoney(totalKobo, currency),
        },
      },
      hasUnavailableItems: cart.hasUnavailableItems,
    };
  }

  /**
   * Places the order.
   *
   * Everything that must not half-happen — stock reservation, order rows,
   * payment row, emptying the bag — runs in one transaction. Paystack is
   * called only after it commits, because an HTTP call inside a transaction
   * holds a database connection open for the length of a network round trip.
   */
  async placeOrder(cartId: string, dto: PlaceOrderDto, userId?: string) {
    const cart = await this.cart.getCartView(cartId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Your bag is empty');
    }

    const purchasable = cart.items.filter(
      (item) => item.purchasableQuantity > 0,
    );

    if (purchasable.length === 0) {
      throw new ConflictException(
        'Everything in your bag has sold out. Please review your items.',
      );
    }

    const email = await this.resolveEmail(dto, userId);

    const quote = await this.quote(cartId, dto.shippingAddress);

    if (
      dto.paymentMethod === CheckoutPaymentMethod.PAY_ON_DELIVERY &&
      !quote.delivery.allowPayOnDelivery
    ) {
      throw new BadRequestException(
        'Pay on delivery is not available for your area',
      );
    }

    const isPayOnDelivery =
      dto.paymentMethod === CheckoutPaymentMethod.PAY_ON_DELIVERY;

    const cartRecord = await this.prisma.cart.findUnique({
      where: { id: cartId },
      select: { discountId: true },
    });

    const currency = quote.currency;
    const isUsd = currency === 'USD';
    const money = (minor: number) => formatMoney(minor, currency);

    const result = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.allocateOrderNumber(tx);

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId,
          email,
          status: 'PENDING',
          paymentStatus: isPayOnDelivery
            ? 'AWAITING_DELIVERY_PAYMENT'
            : 'UNPAID',
          subtotalKobo: quote.totals.subtotalKobo,
          discountKobo: quote.totals.discountKobo,
          deliveryKobo: quote.totals.deliveryKobo,
          totalKobo: quote.totals.totalKobo,
          currency,
          totalNgnKobo: isUsd
            ? usdCentsToKobo(quote.totals.totalKobo, quote.ngnPerUsd)
            : quote.totals.totalKobo,
          ngnPerUsd: isUsd ? quote.ngnPerUsd : null,
          discountId: cartRecord?.discountId ?? null,
          discountCode: cart.discount?.code ?? null,
          // Frozen copy — the customer may edit or delete the saved address.
          shippingAddress: {
            ...dto.shippingAddress,
            countryCode: dto.shippingAddress.countryCode ?? 'NG',
          },
          customerNote: dto.customerNote,
          items: {
            create: purchasable.map((item) => ({
              variantId: item.variantId,
              productTitle: item.product.title,
              variantTitle: Object.entries(item.options)
                .map(([name, value]) => `${name}: ${value}`)
                .join(', '),
              sku: item.sku,
              image: item.product.image,
              unitPriceKobo: item.unitPriceKobo,
              quantity: item.purchasableQuantity,
              totalKobo: item.unitPriceKobo * item.purchasableQuantity,
            })),
          },
        },
      });

      // Throws InsufficientStockError if someone else took the last one
      // between the cart view and here, rolling the whole thing back.
      await this.reservations.reserve(
        tx,
        purchasable.map((item) => ({
          variantId: item.variantId,
          quantity: item.purchasableQuantity,
        })),
        order.id,
      );

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PLACED',
          message: `Order placed for ${money(quote.totals.totalKobo)}`,
        },
      });

      let reference: string | null = null;

      if (isPayOnDelivery) {
        // Nothing to collect online, so the order is immediately confirmed
        // and the stock is committed rather than held.
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CONFIRMED' },
        });

        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'MANUAL',
            method: 'PAY_ON_DELIVERY',
            reference: generatePaymentReference(orderNumber),
            amountKobo: quote.totals.totalKobo,
            currency,
            status: 'PENDING',
          },
        });

        await this.reservations.consume(tx, order.id);
      } else {
        reference = generatePaymentReference(orderNumber);

        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'PAYSTACK',
            method: 'CARD',
            reference,
            amountKobo: quote.totals.totalKobo,
            currency,
            status: 'PENDING',
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'PAYMENT_INITIATED',
            message: 'Redirecting to Paystack',
            data: { reference },
          },
        });
      }

      // The bag is spent — a new one is created on the next request.
      await tx.cartItem.deleteMany({ where: { cartId } });
      await tx.cart.update({
        where: { id: cartId },
        data: { status: 'CONVERTED' },
      });

      return { order, reference, orderNumber };
    });

    if (isPayOnDelivery) {
      await this.notifyPlaced(result.order.id);

      return {
        orderNumber: result.orderNumber,
        paymentMethod: CheckoutPaymentMethod.PAY_ON_DELIVERY,
        status: 'CONFIRMED',
        totalKobo: quote.totals.totalKobo,
        currency,
        authorizationUrl: null,
      };
    }

    // Outside the transaction: a network call must not hold a DB connection.
    const transaction = await this.paystack.initializeTransaction({
      email,
      amountKobo: quote.totals.totalKobo,
      currency,
      reference: result.reference!,
      callbackUrl: `${getFrontendUrl()}/checkout/callback`,
      metadata: {
        orderNumber: result.orderNumber,
        orderId: result.order.id,
      },
    });

    await this.prisma.payment.update({
      where: { reference: result.reference! },
      data: { authorizationUrl: transaction.authorizationUrl },
    });

    return {
      orderNumber: result.orderNumber,
      paymentMethod: CheckoutPaymentMethod.PAYSTACK,
      status: 'PENDING',
      totalKobo: quote.totals.totalKobo,
      currency,
      reference: result.reference,
      authorizationUrl: transaction.authorizationUrl,
    };
  }

  private async resolveEmail(
    dto: PlaceOrderDto,
    userId?: string,
  ): Promise<string> {
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user) return user.email;
    }

    if (!dto.email) {
      throw new BadRequestException(
        'An email address is required to place an order',
      );
    }

    return dto.email.toLowerCase();
  }

  /**
   * Order numbers are random, so a collision is possible if unlikely. Retry a
   * few times rather than failing a paid-for checkout on a coin flip.
   */
  private async allocateOrderNumber(tx: {
    order: { findUnique: (args: any) => Promise<unknown> };
  }): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateOrderNumber();
      const clash = await tx.order.findUnique({
        where: { orderNumber: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }

    throw new ConflictException(
      'Could not allocate an order number. Please try again.',
    );
  }

  private async notifyPlaced(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        email: true,
        userId: true,
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
      },
    });

    if (!order) return;

    await this.mail.sendOrderConfirmed(order, true);

    if (order.userId) {
      await this.prisma.notification.create({
        data: {
          userId: order.userId,
          type: 'ORDER_PLACED',
          title: 'Order placed',
          body: `Order ${order.orderNumber} has been received.`,
          data: { orderNumber: order.orderNumber },
        },
      });
    }
  }

  /** Maps a stock failure onto a 409 the storefront can act on. */
  static toHttpError(error: unknown): never {
    if (error instanceof InsufficientStockError) {
      throw new ConflictException(
        'Someone just bought the last one. Please review your bag.',
      );
    }
    throw error;
  }
}
