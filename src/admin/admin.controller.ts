import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import { AdminProductsService } from './admin-products.service';
import { AdminStoreService } from './admin-store.service';
import { AdminOrdersService } from './admin-orders.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { MAX_UPLOAD_BYTES, StorageService } from '../storage/storage.service';
import type { UploadedImage } from '../storage/storage.service';
import {
  AdjustStockDto,
  AdminProductQueryDto,
  SaveProductDto,
} from './dto/product.dto';
import {
  AdminOrderQueryDto,
  MarkPaidDto,
  OrderNoteDto,
  PageQueryDto,
  SaveCategoryDto,
  SaveCollectionDto,
  SaveDeliveryZoneDto,
  SaveDiscountDto,
  UpdateOrderStatusDto,
} from './dto/store.dto';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private products: AdminProductsService,
    private store: AdminStoreService,
    private orders: AdminOrdersService,
    private dashboard: AdminDashboardService,
    private storage: StorageService,
  ) {}

  // ── dashboard ────────────────────────────────────────────────────────────

  @Get('dashboard')
  getDashboard() {
    return this.dashboard.summary();
  }

  // ── uploads ──────────────────────────────────────────────────────────────

  @Post('uploads')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Query('folder') folder = 'products',
  ) {
    return this.storage.uploadImage(file, folder);
  }

  // ── products ─────────────────────────────────────────────────────────────

  @Get('products')
  listProducts(@Query() query: AdminProductQueryDto) {
    return this.products.list(query);
  }

  @Get('products/:id')
  getProduct(@Param('id', uuid) id: string) {
    return this.products.get(id);
  }

  @Post('products')
  createProduct(
    @Body() dto: SaveProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.create(dto, user.id);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', uuid) id: string,
    @Body() dto: SaveProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.update(id, dto, user.id);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id', uuid) id: string) {
    return this.products.remove(id);
  }

  @Patch('variants/:id/stock')
  adjustStock(
    @Param('id', uuid) id: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.adjustStock(id, dto, user.id);
  }

  @Get('variants/:id/stock-history')
  stockHistory(@Param('id', uuid) id: string) {
    return this.products.stockHistory(id);
  }

  // ── categories & collections ─────────────────────────────────────────────

  @Get('categories')
  listCategories() {
    return this.store.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: SaveCategoryDto) {
    return this.store.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', uuid) id: string, @Body() dto: SaveCategoryDto) {
    return this.store.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id', uuid) id: string) {
    return this.store.deleteCategory(id);
  }

  @Get('collections')
  listCollections() {
    return this.store.listCollections();
  }

  @Post('collections')
  createCollection(@Body() dto: SaveCollectionDto) {
    return this.store.createCollection(dto);
  }

  @Patch('collections/:id')
  updateCollection(
    @Param('id', uuid) id: string,
    @Body() dto: SaveCollectionDto,
  ) {
    return this.store.updateCollection(id, dto);
  }

  @Delete('collections/:id')
  deleteCollection(@Param('id', uuid) id: string) {
    return this.store.deleteCollection(id);
  }

  // ── orders ───────────────────────────────────────────────────────────────

  @Get('orders')
  listOrders(@Query() query: AdminOrderQueryDto) {
    return this.orders.list(query);
  }

  @Get('orders/:orderNumber')
  getOrder(@Param('orderNumber') orderNumber: string) {
    return this.orders.get(orderNumber);
  }

  @Patch('orders/:orderNumber/status')
  updateOrderStatus(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateStatus(orderNumber, dto, user.id);
  }

  @Post('orders/:orderNumber/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: MarkPaidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.markPaid(orderNumber, dto, user.id);
  }

  @Post('orders/:orderNumber/notes')
  @HttpCode(HttpStatus.OK)
  addNote(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: OrderNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.addNote(orderNumber, dto.note, user.id);
  }

  // ── delivery ─────────────────────────────────────────────────────────────

  @Get('delivery-zones')
  listZones() {
    return this.store.listZones();
  }

  @Post('delivery-zones')
  createZone(@Body() dto: SaveDeliveryZoneDto) {
    return this.store.createZone(dto);
  }

  @Patch('delivery-zones/:id')
  updateZone(@Param('id', uuid) id: string, @Body() dto: SaveDeliveryZoneDto) {
    return this.store.updateZone(id, dto);
  }

  @Delete('delivery-zones/:id')
  deleteZone(@Param('id', uuid) id: string) {
    return this.store.deleteZone(id);
  }

  // ── discounts ────────────────────────────────────────────────────────────

  @Get('discounts')
  listDiscounts() {
    return this.store.listDiscounts();
  }

  @Post('discounts')
  createDiscount(@Body() dto: SaveDiscountDto) {
    return this.store.createDiscount(dto);
  }

  @Patch('discounts/:id')
  updateDiscount(@Param('id', uuid) id: string, @Body() dto: SaveDiscountDto) {
    return this.store.updateDiscount(id, dto);
  }

  @Delete('discounts/:id')
  deleteDiscount(@Param('id', uuid) id: string) {
    return this.store.deleteDiscount(id);
  }

  // ── customers ────────────────────────────────────────────────────────────

  @Get('customers')
  listCustomers(@Query() query: PageQueryDto) {
    return this.store.listCustomers(query);
  }
}
