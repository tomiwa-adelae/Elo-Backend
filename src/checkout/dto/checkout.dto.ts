import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ShippingAddressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(7, { message: 'Phone number must be valid' })
  @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city: string;

  // Required in Nigeria, where delivery is priced by state. Abroad it is the
  // region/province/county and may legitimately be blank.
  @ValidateIf((o: ShippingAddressDto) => (o.countryCode ?? 'NG') === 'NG')
  @IsString()
  @MinLength(2, { message: 'Please choose a state' })
  @MaxLength(80)
  state: string = '';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string = 'Nigeria';

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Country must be a 2-letter code' })
  countryCode?: string = 'NG';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  // Riders rely on this more than the street line in much of Nigeria.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;
}

export enum CheckoutPaymentMethod {
  PAYSTACK = 'PAYSTACK',
  PAY_ON_DELIVERY = 'PAY_ON_DELIVERY',
}

export class QuoteDto {
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;
}

export class PlaceOrderDto {
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  // Required for guests; defaulted from the account when signed in.
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @IsEnum(CheckoutPaymentMethod)
  paymentMethod: CheckoutPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}
