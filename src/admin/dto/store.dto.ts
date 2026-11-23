import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DiscountType,
  OrderStatus,
  PaymentStatus,
} from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ── taxonomy ───────────────────────────────────────────────────────────────

export class SaveCategoryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) image?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

export class SaveCollectionDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(500) image?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

// ── delivery ───────────────────────────────────────────────────────────────

export class SaveDeliveryZoneDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;

  // ISO 3166-1 alpha-2 codes, or "*" for the rest of the world.
  @IsArray()
  @Matches(/^([A-Z]{2}|\*)$/, {
    each: true,
    message: 'Countries are 2-letter codes like NG or GB, or * for everywhere else',
  })
  countries: string[] = ['NG'];
  @IsArray() @IsString({ each: true }) states: string[] = [];
  @IsArray() @IsString({ each: true }) cities: string[] = [];

  @Type(() => Number) @IsInt() @Min(0) feeKobo: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) freeAboveKobo?:
    number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) feeUsdCents?:
    number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) freeAboveUsdCents?:
    number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;

  @Type(() => Number) @IsInt() @Min(0) @Max(60) estimatedMinDays: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(60) estimatedMaxDays: number;

  @IsBoolean() allowPayOnDelivery: boolean;
  @IsBoolean() isActive: boolean;
}

// ── discounts ──────────────────────────────────────────────────────────────

export class SaveDiscountDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_-]{3,30}$/, {
    message: 'Codes are 3–30 letters, numbers, dashes or underscores',
  })
  code: string;

  @IsEnum(DiscountType) type: DiscountType;

  // Percent for PERCENTAGE, kobo for FIXED_AMOUNT, ignored for FREE_SHIPPING.
  @Type(() => Number) @IsInt() @Min(0) value: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxDiscountKobo?:
    number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minSubtotalKobo?:
    number | null;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  appliesToCollectionIds?: string[];
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  appliesToProductIds?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimit?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perUserLimit?:
    number | null;

  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsBoolean() isActive: boolean;
}

// ── orders ─────────────────────────────────────────────────────────────────

export class AdminOrderQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    25;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;

  @IsOptional() @IsString() @MaxLength(500) note?: string;

  // Shipping details, used when moving to SHIPPED.
  @IsOptional() @IsString() @MaxLength(80) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) trackingUrl?: string;

  /** Email the customer about this change. Defaults to true. */
  @IsOptional() @IsBoolean() notifyCustomer?: boolean;
}

export class MarkPaidDto {
  @IsEnum(['BANK_TRANSFER', 'PAY_ON_DELIVERY', 'CARD', 'USSD'])
  method: 'BANK_TRANSFER' | 'PAY_ON_DELIVERY' | 'CARD' | 'USSD';

  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class OrderNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) note: string;
}

export class PageQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    25;
}
