import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { InventoryModule } from './inventory/inventory.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PaymentsModule } from './payments/payments.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { RestockModule } from './restock/restock.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    MailModule,
    SettingsModule,
    StorageModule,
    InventoryModule,
    DeliveryModule,
    PaymentsModule,
    AuthModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    NewsletterModule,
    RestockModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Auth is deny-by-default: every route needs a token unless it is marked
    // @Public(). Opting in is a visible decision in the diff; opting out is not.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
