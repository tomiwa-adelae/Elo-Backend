import { Exclude, Expose } from 'class-transformer';

/**
 * The only user shape that crosses the API boundary. Built with
 * plainToInstance(..., { excludeExtraneousValues: true }) so anything not
 * marked @Expose — password hashes, OTPs, refresh tokens — cannot leak by
 * being added to the Prisma model later.
 */
export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  firstName: string | null;

  @Expose()
  lastName: string | null;

  @Expose()
  phoneNumber: string | null;

  @Expose()
  image: string | null;

  @Expose()
  role: string;

  @Expose()
  emailVerified: boolean;

  @Expose()
  acceptsMarketing: boolean;

  @Expose()
  accountStatus: string;

  @Expose()
  mustChangePassword: boolean;

  @Expose()
  adminPosition: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Exclude()
  password: string;

  @Exclude()
  refreshToken: string;

  @Exclude()
  resetOTP: string;

  @Exclude()
  resetOTPExpiry: Date;

  @Exclude()
  emailVerificationOTP: string;

  @Exclude()
  emailVerificationOTPExpiry: Date;

  @Exclude()
  provider: string;

  @Exclude()
  googleId: string;

  @Exclude()
  isDeleted: boolean;
}
