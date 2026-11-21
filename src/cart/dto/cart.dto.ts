import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

// A per-line cap. Genuine bulk buyers go through support; without a ceiling a
// single request can reserve an entire size run.
const MAX_LINE_QUANTITY = 20;

export class AddCartItemDto {
  @IsUUID()
  variantId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number = 1;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Quantity cannot be negative' })
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export class ApplyDiscountDto {
  @IsString()
  code: string;
}
