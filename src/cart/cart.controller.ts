import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CartService } from './cart.service';
import {
  AddCartItemDto,
  ApplyDiscountDto,
  UpdateCartItemDto,
} from './dto/cart.dto';
import { Public } from '../decorators/public.decorator';
import type { AppRequest } from '../types/request';

const CART_COOKIE = 'cartSession';
// Set by the storefront's currency switcher (and its first-visit geo default).
const CURRENCY_COOKIE = 'currency';
const CART_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/**
 * Guest checkout is a hard requirement, so every route here is @Public().
 * Ownership comes from the signed-in user when there is one and from an
 * opaque session cookie when there is not.
 */
@ApiTags('cart')
@Public()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * Resolves the caller's cart and makes sure the guest session cookie is set
   * for anonymous shoppers.
   */
  private async resolveCart(req: AppRequest, res: Response) {
    const userId = req.user?.id;
    const sessionToken = req.cookies?.[CART_COOKIE];

    const wanted = req.cookies?.[CURRENCY_COOKIE];
    const currency = wanted === 'USD' || wanted === 'NGN' ? wanted : undefined;

    const cart = await this.cart.getOrCreateCart(
      { userId, sessionToken },
      currency,
    );

    if (!userId && cart.sessionToken && cart.sessionToken !== sessionToken) {
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie(CART_COOKIE, cart.sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: CART_COOKIE_MAX_AGE,
      });
    }

    return cart;
  }

  @Get()
  @ApiOperation({ summary: 'Current bag with live prices and stock' })
  async getCart(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cart = await this.resolveCart(req, res);
    return this.cart.getCartView(cart.id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a variant to the bag' })
  async addItem(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AddCartItemDto,
  ) {
    const cart = await this.resolveCart(req, res);
    await this.cart.addItem(cart.id, dto.variantId, dto.quantity);
    // The whole priced bag, so the client needn't re-fetch.
    return this.cart.getCartView(cart.id);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Change a line quantity (0 removes it)' })
  async updateItem(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const cart = await this.resolveCart(req, res);
    await this.cart.updateItem(cart.id, itemId, dto.quantity);
    // The whole priced bag, so the client needn't re-fetch.
    return this.cart.getCartView(cart.id);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove a line from the bag' })
  async removeItem(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('itemId') itemId: string,
  ) {
    const cart = await this.resolveCart(req, res);
    await this.cart.removeItem(cart.id, itemId);
    // The whole priced bag, so the client needn't re-fetch.
    return this.cart.getCartView(cart.id);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the bag' })
  async clear(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cart = await this.resolveCart(req, res);
    return this.cart.clear(cart.id);
  }

  @Post('discount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a discount code' })
  async applyDiscount(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ApplyDiscountDto,
  ) {
    const cart = await this.resolveCart(req, res);
    return this.cart.applyDiscount(cart.id, dto.code, req.user?.id);
  }

  @Delete('discount')
  @ApiOperation({ summary: 'Remove the applied discount code' })
  async removeDiscount(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cart = await this.resolveCart(req, res);
    return this.cart.removeDiscount(cart.id);
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fold the guest bag into the signed-in account' })
  async merge(@Req() req: AppRequest) {
    const userId = req.user?.id;
    const sessionToken = req.cookies?.[CART_COOKIE];

    if (!userId || !sessionToken) {
      const cart = await this.cart.getOrCreateCart({ userId, sessionToken });
      return this.cart.getCartView(cart.id);
    }

    const merged = await this.cart.mergeGuestCart(userId, sessionToken);
    return this.cart.getCartView(merged.id);
  }
}
