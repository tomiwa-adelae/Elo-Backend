import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto';
import { InsufficientStockError } from '../inventory/reservation.service';
import { Public } from '../decorators/public.decorator';
import type { AppRequest } from '../types/request';

const CART_COOKIE = 'cartSession';

@ApiTags('checkout')
@Public()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly cart: CartService,
    private readonly payments: PaymentsService,
  ) {}

  private async currentCartId(req: AppRequest): Promise<string> {
    const cart = await this.cart.getOrCreateCart({
      userId: req.user?.id,
      sessionToken: req.cookies?.[CART_COOKIE],
    });
    return cart.id;
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delivery fee and totals for an address' })
  async quote(@Req() req: AppRequest, @Body() dto: QuoteDto) {
    const cartId = await this.currentCartId(req);
    return this.checkout.quote(cartId, dto.shippingAddress);
  }

  // Placing an order reserves stock and can create a Paystack transaction, so
  // it is rate limited harder than a read.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Place an order and start payment' })
  async placeOrder(@Req() req: AppRequest, @Body() dto: PlaceOrderDto) {
    const cartId = await this.currentCartId(req);

    try {
      return await this.checkout.placeOrder(cartId, dto, req.user?.id);
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        CheckoutService.toHttpError(error);
      }
      throw error;
    }
  }

  /**
   * Called by the storefront after Paystack redirects the shopper back.
   *
   * This verifies server-to-server rather than trusting the redirect, and
   * exists so the success page can show a confirmed order without waiting for
   * webhook delivery. The webhook remains the authority.
   */
  @Get('verify')
  @ApiOperation({ summary: 'Reconcile a payment reference with Paystack' })
  async verify(@Query('reference') reference: string) {
    return this.payments.reconcile(reference);
  }
}
