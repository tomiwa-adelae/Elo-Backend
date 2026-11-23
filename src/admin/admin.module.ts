import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminProductsService } from './admin-products.service';
import { AdminStoreService } from './admin-store.service';
import { AdminOrdersService } from './admin-orders.service';
import { AdminDashboardService } from './admin-dashboard.service';

// Every route in AdminController carries @Roles(ADMIN) at class level.
@Module({
  controllers: [AdminController],
  providers: [
    AdminProductsService,
    AdminStoreService,
    AdminOrdersService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
