import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductStatus } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OptionValueDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  value: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'Swatch must be a hex colour like #1A1A1A',
  })
  swatch?: string | null;
}

export class OptionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Every option needs at least one value' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OptionValueDto)
  values: OptionValueDto[];
}

export class VariantDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  /** { Size: 'M', Colour: 'Black' } — keys must match the option names. */
  @IsObject()
  options: Record<string, string>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  sku?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceKobo: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  compareAtPriceKobo?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costKobo?: number | null;

  // Explicit dollar prices in cents; null converts from naira.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceUsdCents?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  compareAtUsdCents?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock: number;

  @IsOptional()
  @IsBoolean()
  allowBackorder?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockAt?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string | null;
}

export class ImageDto {
  @IsString()
  @MaxLength(500)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  colour?: string | null;
}

export class SaveProductDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsEnum(ProductStatus)
  status: ProductStatus;

  @IsOptional() @IsString() @MaxLength(80) brand?: string | null;
  @IsOptional() @IsString() @MaxLength(300) material?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) careNotes?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) fitNotes?: string | null;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  tags: string[] = [];

  @IsArray()
  @IsUUID('all', { each: true })
  collectionIds: string[] = [];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images: ImageDto[] = [];

  @IsArray()
  @ArrayMaxSize(3, {
    message: 'Use at most 3 options (e.g. Size, Colour, Material)',
  })
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[] = [];

  @IsArray()
  @ArrayMinSize(1, { message: 'A product needs at least one variant' })
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}

export class AdminProductQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsUUID() categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  lowStock?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    25;
}

export class AdjustStockDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock: number;

  @IsOptional()
  @IsEnum(['RESTOCK', 'MANUAL_ADJUSTMENT', 'DAMAGED', 'RETURN'])
  reason?: 'RESTOCK' | 'MANUAL_ADJUSTMENT' | 'DAMAGED' | 'RETURN';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
