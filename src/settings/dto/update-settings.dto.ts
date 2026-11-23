import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX_MESSAGE = 'Colours must be 6-digit hex values like #1A1A1A';

export class ThemeDto {
  @IsOptional() @Matches(HEX, { message: HEX_MESSAGE }) primary?: string;
  @IsOptional()
  @Matches(HEX, { message: HEX_MESSAGE })
  primaryForeground?: string;
  @IsOptional() @Matches(HEX, { message: HEX_MESSAGE }) background?: string;
  @IsOptional() @Matches(HEX, { message: HEX_MESSAGE }) foreground?: string;
  @IsOptional() @Matches(HEX, { message: HEX_MESSAGE }) muted?: string;
  @IsOptional() @Matches(HEX, { message: HEX_MESSAGE }) accent?: string;

  // Google Fonts family names, e.g. "Playfair Display".
  @IsOptional() @IsString() @MaxLength(60) fontHeading?: string;
  @IsOptional() @IsString() @MaxLength(60) fontBody?: string;

  // CSS length for corner rounding, e.g. "0.5rem" or "0px".
  @IsOptional()
  @Matches(/^\d+(\.\d+)?(px|rem)$/, {
    message: 'Radius must look like 0.5rem or 8px',
  })
  radius?: string;
}

const short = () => [IsOptional(), IsString(), MaxLength(200)];
const long = () => [IsOptional(), IsString(), MaxLength(20000)];
const apply =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @apply(short()) tagline?: string;
  @apply(short()) logoUrl?: string;
  @apply(short()) faviconUrl?: string;
  @apply(short()) ogImageUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeDto)
  theme?: ThemeDto;

  @apply(short()) announcement?: string;

  @apply(short()) heroEyebrow?: string;
  @apply(short()) heroTitle?: string;
  @IsOptional() @IsString() @MaxLength(500) heroSubtitle?: string;
  @apply(short()) heroImageUrl?: string;
  @apply(short()) heroCtaLabel?: string;
  @apply(short()) heroCtaHref?: string;

  @apply(short()) contactEmail?: string;
  @apply(short()) contactPhone?: string;

  @IsOptional()
  @Matches(/^(\d{10,15})?$/, {
    message: 'WhatsApp number must be digits only, e.g. 2348012345678',
  })
  whatsappNumber?: string;

  @apply(short()) address?: string;

  @apply(short()) instagram?: string;
  @apply(short()) tiktok?: string;
  @apply(short()) facebook?: string;
  @apply(short()) twitter?: string;

  @IsOptional() @IsBoolean() enablePayOnDelivery?: boolean;

  @IsOptional() @IsBoolean() enableUsd?: boolean;
  // Whole naira per US dollar.
  @IsOptional() @IsInt() @Min(100) @Max(100_000) ngnPerUsd?: number;

  @apply(long()) shippingPolicy?: string;
  @apply(long()) returnsPolicy?: string;
  @apply(long()) privacyPolicy?: string;
  @apply(long()) termsOfService?: string;

  @apply(short()) metaTitle?: string;
  @IsOptional() @IsString() @MaxLength(500) metaDescription?: string;
}
