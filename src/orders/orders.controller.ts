import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';
import { OrdersService } from './orders.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';

class OrderListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

class GuestLookupQuery {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Your order history' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderListQuery) {
    return this.orders.listForUser(user.id, query.page, query.limit);
  }

  // Declared before :orderNumber so "lookup" is not swallowed as an order id.
  @Public()
  @Get('lookup/:orderNumber')
  @ApiOperation({ summary: 'Guest order lookup by number and email' })
  lookup(
    @Param('orderNumber') orderNumber: string,
    @Query() query: GuestLookupQuery,
  ) {
    return this.orders.getForGuest(orderNumber, query.email);
  }

  @Get(':orderNumber')
  @ApiOperation({ summary: 'Order detail with timeline and shipments' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.orders.getForUser(user.id, orderNumber);
  }
}
