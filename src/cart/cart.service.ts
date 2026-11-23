import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../inventory/availability.service';
import { computeDiscount, type PricedLine } from './pricing';
import { SettingsService } from '../settings/settings.service';
import { formatMoney, variantPrice, type Currency } from '../money/money';

export interface CartOwner {
  userId?: string;
  sessionToken?: string;
}

@Injectable()
export class CartService {
  constructor(
    private prisma: PrismaService,
    private availability: AvailabilityService,
    private settings: SettingsService,
  ) {}

  /** The currency a cart should actually be priced in right now. */
  async effectiveCurrency(wanted: Currency): Promise<Currency> {
    const store = await this.settings.get();
    return wanted === 'USD' && store.enableUsd ? 'USD' : 'NGN';
  }

  // ── resolution ───────────────────────────────────────────────────────────

  /**
   * Finds the caller's active cart, creating one if needed.
   *
   * Signed-in shoppers are keyed by userId so their bag follows them across
   * devices; guests are keyed by an opaque session token in a cookie.
   */
  async getOrCreateCart(owner: CartOwner, currency?: Currency) {
    const cart = await this.findOrCreateCart(owner, currency);

    // The shopper switched currency since the bag was created.
    if (currency && cart.currency !== currency) {
      return this.prisma.cart.update({
        where: { id: cart.id },
        data: { currency },
      });
    }

    return cart;
  }

  private async findOrCreateCart(owner: CartOwner, currency?: Currency) {
    if (owner.userId) {
      const existing = await this.prisma.cart.findFirst({
        where: { userId: owner.userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      });

      if (existing) return existing;

      return this.prisma.cart.create({
        data: { userId: owner.userId, status: 'ACTIVE', currency },
      });
    }

    let sessionToken = owner.sessionToken;

    if (sessionToken) {
      const existing = await this.prisma.cart.findUnique({
        where: { sessionToken },
      });

      if (existing?.status === 'ACTIVE') return existing;

      // The token still belongs to a cart that was checked out (or
      // abandoned). sessionToken is unique, so reusing it would fail;
      // issue a fresh one and the controller resets the cookie.
      if (existing) sessionToken = undefined;
    }

    return this.prisma.cart.create({
      data: {
        sessionToken: sessionToken ?? randomUUID(),
        status: 'ACTIVE',
        currency,
      },
    });
  }

  /**
   * Folds a guest cart into the user's on login.
   *
   * Quantities are summed rather than overwritten — someone who added items
   * on their phone, then signed in on a laptop where they had also added
   * things, should end up with both.
   */
  async mergeGuestCart(userId: string, sessionToken: string) {
    const guestCart = await this.prisma.cart.findFirst({
      where: { sessionToken, status: 'ACTIVE' },
      include: { items: true },
    });

    if (!guestCart || guestCart.items.length === 0) {
      return this.getOrCreateCart({ userId });
    }

    const userCart = await this.getOrCreateCart({ userId });

    if (userCart.id === guestCart.id) return userCart;

    await this.prisma.$transaction(async (tx) => {
      for (const item of guestCart.items) {
        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: {
              cartId: userCart.id,
              variantId: item.variantId,
            },
          },
        });

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: userCart.id,
              variantId: item.variantId,
              quantity: item.quantity,
            },
          });
        }
      }

      await tx.cart.update({
        where: { id: guestCart.id },
        data: { status: 'CONVERTED' },
      });
    });

    return userCart;
  }

  // ── mutations ────────────────────────────────────────────────────────────

  async addItem(cartId: string, variantId: string, quantity: number) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        id: true,
        stock: true,
        lowStockAt: true,
        allowBackorder: true,
      },
    });

    if (!variant) {
      throw new NotFoundException('That item is no longer available');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });

    const desired = (existing?.quantity ?? 0) + quantity;

    await this.assertAvailable(variant, desired);

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: desired },
      });
    } else {
      await this.prisma.cartItem.create({
        data: { cartId, variantId, quantity },
      });
    }

    await this.touch(cartId);

    return this.getCartView(cartId);
  }

  async updateItem(cartId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
      include: {
        variant: {
          select: {
            id: true,
            stock: true,
            lowStockAt: true,
            allowBackorder: true,
          },
        },
      },
    });

    if (!item) throw new NotFoundException('Item not in your bag');

    // Setting quantity to zero is how the UI removes a line.
    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await this.assertAvailable(item.variant, quantity);
      await this.prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity },
      });
    }

    await this.touch(cartId);

    return this.getCartView(cartId);
  }

  async removeItem(cartId: string, itemId: string) {
    const deleted = await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cartId },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Item not in your bag');
    }

    await this.touch(cartId);

    return this.getCartView(cartId);
  }

  async clear(cartId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { discountId: null },
    });

    return this.getCartView(cartId);
  }

  private async assertAvailable(
    variant: {
      id: string;
      stock: number;
      lowStockAt: number;
      allowBackorder: boolean;
    },
    desired: number,
  ) {
    const stock = await this.availability.resolve([variant]);
    const info = stock.get(variant.id);

    if (!info) throw new NotFoundException('That item is no longer available');

    if (!variant.allowBackorder && desired > info.available) {
      throw new BadRequestException(
        info.available === 0
          ? 'That size just sold out'
          : `Only ${info.available} left in that size`,
      );
    }
  }

  private touch(cartId: string) {
    return this.prisma.cart.update({
      where: { id: cartId },
      data: { updatedAt: new Date() },
    });
  }

  // ── discounts ────────────────────────────────────────────────────────────

  async applyDiscount(cartId: string, code: string, userId?: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    const now = new Date();

    if (
      !discount ||
      !discount.isActive ||
      discount.startsAt > now ||
      (discount.endsAt !== null && discount.endsAt < now)
    ) {
      throw new BadRequestException('That code is not valid');
    }

    if (
      discount.usageLimit !== null &&
      discount.usedCount >= discount.usageLimit
    ) {
      throw new BadRequestException('That code has been fully redeemed');
    }

    if (userId && discount.perUserLimit !== null) {
      const used = await this.prisma.discountRedemption.count({
        where: { discountId: discount.id, userId },
      });

      if (used >= discount.perUserLimit) {
        throw new BadRequestException('You have already used that code');
      }
    }

    await this.prisma.cart.update({
      where: { id: cartId },
      data: { discountId: discount.id },
    });

    const view = await this.getCartView(cartId);

    // Valid code, but nothing in the bag qualifies — say so rather than
    // silently applying zero.
    if (view.totals.discountKobo === 0 && view.discount?.reason) {
      throw new BadRequestException(view.discount.reason);
    }

    return view;
  }

  async removeDiscount(cartId: string) {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { discountId: null },
    });

    return this.getCartView(cartId);
  }

  // ── read ─────────────────────────────────────────────────────────────────

  /**
   * The cart as the shopper should see it right now.
   *
   * Prices come from the live variant, never from what was stored when the
   * item was added — a cart is a wish list until checkout snapshots it.
   */
  /** The variant's own photo, else the first photo of its colour, else the cover. */
  private lineImage(variant: {
    image: string | null;
    product: { images: { url: string; colour: string | null }[] };
    optionValues: { value: string; option: { name: string } }[];
  }) {
    if (variant.image) return variant.image;
    const colour = variant.optionValues.find((ov) =>
      /colou?r/i.test(ov.option.name),
    )?.value;
    const images = variant.product.images;
    return (
      (colour && images.find((i) => i.colour === colour)?.url) ??
      images[0]?.url ??
      null
    );
  }

  async getCartView(cartId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        discount: true,
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    slug: true,
                    images: {
                      orderBy: { position: 'asc' },
                      select: { url: true, alt: true, colour: true },
                    },
                    collections: { select: { collectionId: true } },
                  },
                },
                optionValues: {
                  select: {
                    value: true,
                    option: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart) throw new NotFoundException('Cart not found');

    const store = await this.settings.get();
    const currency = await this.effectiveCurrency(cart.currency);
    const rate = store.ngnPerUsd;

    const availability = await this.availability.resolve(
      cart.items.map((item) => item.variant),
    );

    const lines: PricedLine[] = [];

    const items = cart.items.map((item) => {
      const stock = availability.get(item.variantId);
      const available = stock?.available ?? 0;
      const backorder = item.variant.allowBackorder;

      // Stock can vanish between adding and checking out. Surface it per line
      // instead of failing the whole cart.
      const purchasable = backorder
        ? item.quantity
        : Math.min(item.quantity, available);
      const unit = variantPrice(item.variant, currency, rate);
      const totalKobo = unit.price * purchasable;

      if (purchasable > 0) {
        lines.push({
          variantId: item.variantId,
          productId: item.variant.product.id,
          quantity: purchasable,
          unitPriceKobo: unit.price,
          totalKobo,
        });
      }

      return {
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        product: {
          id: item.variant.product.id,
          title: item.variant.product.title,
          slug: item.variant.product.slug,
          image: this.lineImage(item.variant),
        },
        sku: item.variant.sku,
        options: Object.fromEntries(
          item.variant.optionValues.map((ov) => [ov.option.name, ov.value]),
        ),
        unitPriceKobo: unit.price,
        compareAtPriceKobo: unit.compareAt,
        totalKobo,
        available,
        inStock: backorder || available > 0,
        // The UI shows "only 1 left — quantity reduced" against these.
        quantityAdjusted: purchasable < item.quantity,
        purchasableQuantity: purchasable,
      };
    });

    const subtotalKobo = lines.reduce((sum, line) => sum + line.totalKobo, 0);

    const collectionsByProduct = new Map<string, string[]>();
    for (const item of cart.items) {
      collectionsByProduct.set(
        item.variant.product.id,
        item.variant.product.collections.map((c) => c.collectionId),
      );
    }

    const discountOutcome = cart.discount
      ? computeDiscount(
          cart.discount,
          lines,
          subtotalKobo,
          collectionsByProduct,
          currency,
          rate,
        )
      : { discountKobo: 0, freeDelivery: false };

    const total = Math.max(0, subtotalKobo - discountOutcome.discountKobo);

    return {
      id: cart.id,
      // Every *Kobo amount below is in the minor unit of this currency.
      currency,
      ngnPerUsd: rate,
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      discount: cart.discount
        ? {
            code: cart.discount.code,
            type: cart.discount.type,
            freeDelivery: discountOutcome.freeDelivery,
            reason: discountOutcome.reason,
          }
        : null,
      totals: {
        subtotalKobo,
        discountKobo: discountOutcome.discountKobo,
        // Delivery is unknown until an address exists, so the cart total
        // deliberately excludes it. Checkout adds it.
        totalKobo: total,
        formatted: {
          subtotal: formatMoney(subtotalKobo, currency),
          discount: formatMoney(discountOutcome.discountKobo, currency),
          total: formatMoney(total, currency),
        },
      },
      hasUnavailableItems: items.some((item) => item.quantityAdjusted),
    };
  }
}
