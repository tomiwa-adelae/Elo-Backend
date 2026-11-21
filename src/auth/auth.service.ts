import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import * as bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { notDeleted } from '../utils/prismaFilters';
import { getFrontendUrl } from '../utils/frontendUrl';
import { UserResponseDto } from './dto/user-response.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

type UserRecord = User;

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// 30-day sessions. Every refresh rotates the token, so an active shopper is
// never logged out mid-checkout.
const SESSION_DURATION = '30d';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_DURATION = '15m';
const ACCESS_TOKEN_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mail: MailService,
  ) {
    this.googleClient = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private otpExpiry(): Date {
    return new Date(Date.now() + OTP_TTL_MS);
  }

  getCookieOptions(maxAge: number = SESSION_MS) {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      // SameSite=None requires Secure, and iOS Safari drops the cookie
      // entirely without it.
      secure: isProd,
      sameSite: isProd ? ('none' as const) : ('lax' as const),
      path: '/',
      maxAge,
    };
  }

  get accessCookieMaxAge() {
    return ACCESS_TOKEN_MS;
  }

  get refreshCookieMaxAge() {
    return SESSION_MS;
  }

  generateAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: ACCESS_TOKEN_DURATION,
    });
  }

  generateRefreshToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: SESSION_DURATION,
    });
  }

  private async issueTokens(user: {
    id: string;
    email: string;
  }): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS) },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Shapes a Prisma user (optionally with its admin relation) into the
   * response DTO, flattening adminPosition to the top level.
   */
  toUserResponse(
    user: UserRecord & { admin?: { position: string } | null },
  ): UserResponseDto {
    return plainToInstance(
      UserResponseDto,
      { ...user, adminPosition: user.admin?.position ?? null },
      { excludeExtraneousValues: true },
    );
  }

  // ── lookups ──────────────────────────────────────────────────────────────

  async findUserById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, ...notDeleted() },
      include: { admin: { select: { position: true } } },
    });

    if (!user) return null;

    // This object lands on request.user, so it must stay lean and must never
    // carry the password hash.
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      adminPosition: user.admin?.position ?? null,
    };
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
      include: { admin: { select: { position: true } } },
    });

    if (!user?.password) return null;

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) return null;

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException(
        user.accountStatusReason ?? 'This account is not active',
      );
    }

    return user;
  }

  // ── registration & verification ──────────────────────────────────────────

  async register(dto: RegisterUserDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the terms to continue');
    }

    const email = dto.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const otp = this.generateOTP();

    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        acceptsMarketing: dto.acceptsMarketing ?? false,
        emailVerificationOTP: otp,
        emailVerificationOTPExpiry: this.otpExpiry(),
      },
    });

    await this.mail.sendVerificationCode(email, otp);

    return {
      message: 'Account created. Check your email for a verification code.',
      user: this.toUserResponse(user),
    };
  }

  async verifyEmail(email: string, otp: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
    });

    if (!user) throw new NotFoundException('Account not found');
    if (user.emailVerified) return { message: 'Email already verified' };

    if (
      user.emailVerificationOTP !== otp ||
      !user.emailVerificationOTPExpiry ||
      user.emailVerificationOTPExpiry < new Date()
    ) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationOTP: null,
        emailVerificationOTPExpiry: null,
      },
    });

    await this.mail.sendWelcome(user.email, user.firstName);

    return { message: 'Email verified' };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
    });

    // Always the same response — a differing one tells an attacker which
    // addresses have accounts.
    const genericResponse = {
      message: 'If that account exists, a new code is on its way.',
    };

    if (!user || user.emailVerified) return genericResponse;

    const otp = this.generateOTP();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationOTP: otp,
        emailVerificationOTPExpiry: this.otpExpiry(),
      },
    });

    await this.mail.sendVerificationCode(user.email, otp);

    return genericResponse;
  }

  // ── password reset ───────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
    });

    const genericResponse = {
      message: 'If that account exists, a reset code is on its way.',
    };

    if (!user) return genericResponse;

    const otp = this.generateOTP();

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetOTP: otp, resetOTPExpiry: this.otpExpiry() },
    });

    await this.mail.sendPasswordResetCode(user.email, otp);

    return genericResponse;
  }

  async verifyResetCode(email: string, otp: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
    });

    if (
      !user ||
      user.resetOTP !== otp ||
      !user.resetOTPExpiry ||
      user.resetOTPExpiry < new Date()
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    return { message: 'Code verified', valid: true };
  }

  async setNewPassword(
    email: string,
    otp: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...notDeleted() },
    });

    if (
      !user ||
      user.resetOTP !== otp ||
      !user.resetOTPExpiry ||
      user.resetOTPExpiry < new Date()
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        resetOTP: null,
        resetOTPExpiry: null,
        mustChangePassword: false,
        // Reset invalidates every existing session.
        refreshToken: null,
      },
    });

    await this.mail.sendPasswordChanged(user.email);

    return { message: 'Password updated. Please sign in.' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...notDeleted() },
    });

    if (!user?.password) {
      throw new BadRequestException(
        'This account signs in with Google and has no password set',
      );
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
        refreshToken: null,
      },
    });

    await this.mail.sendPasswordChanged(user.email);

    return { message: 'Password changed' };
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  async login(user: { id: string; email: string }) {
    const tokens = await this.issueTokens(user);

    const fresh = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { admin: { select: { position: true } } },
    });

    // issueTokens just wrote to this row, so it exists — but the type is
    // nullable and a missing row here means something is badly wrong.
    if (!fresh) throw new NotFoundException('Account not found');

    return { ...tokens, user: this.toUserResponse(fresh) };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, ...notDeleted() },
      include: { admin: { select: { position: true } } },
    });

    if (!user?.refreshToken) {
      throw new UnauthorizedException('Session no longer valid');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Session no longer valid');
    }

    // Rotate on every use — a stolen token stops working the moment the real
    // user refreshes.
    const tokens = await this.issueTokens(user);

    return { ...tokens, user: this.toUserResponse(user) };
  }

  async logout(userId?: string) {
    if (userId) {
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: { refreshToken: null },
      });
    }

    return { message: 'Signed out' };
  }

  // ── profile ──────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...notDeleted() },
      include: { admin: { select: { position: true } } },
    });

    if (!user) throw new NotFoundException('Account not found');

    return this.toUserResponse(user);
  }

  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...notDeleted() },
    });

    if (!user) throw new NotFoundException('Account not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        phoneNumber: dto.phoneNumber ?? undefined,
        image: dto.image ?? undefined,
        acceptsMarketing: dto.acceptsMarketing ?? undefined,
      },
      include: { admin: { select: { position: true } } },
    });

    return this.toUserResponse(updated);
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────

  getGoogleAuthUrl(): string {
    return this.googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['email', 'profile'],
      redirect_uri: `${process.env.BACKEND_URL}/api/auth/google/callback`,
      prompt: 'consent',
    });
  }

  get googleRedirectUrl(): string {
    return getFrontendUrl();
  }

  /**
   * Exchanges an OAuth code for a session, creating the account on first
   * sign-in. Google has already verified the address, so the user skips OTP.
   */
  async googleSignIn(code: string, redirectUri: string) {
    let email: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let googleId: string | undefined;
    let picture: string | undefined;

    try {
      const { tokens } = await this.googleClient.getToken({
        code,
        redirect_uri: redirectUri,
      });

      const ticket = await this.googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const profile = ticket.getPayload();
      email = profile?.email?.toLowerCase();
      firstName = profile?.given_name;
      lastName = profile?.family_name;
      googleId = profile?.sub;
      picture = profile?.picture;
    } catch {
      throw new UnauthorizedException('Google sign-in failed');
    }

    if (!email || !googleId) {
      throw new UnauthorizedException('Google did not return an email address');
    }

    let user = await this.prisma.user.findFirst({
      where: { email, ...notDeleted() },
      include: { admin: { select: { position: true } } },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          image: picture,
          googleId,
          provider: 'google',
          emailVerified: true,
        },
        include: { admin: { select: { position: true } } },
      });

      await this.mail.sendWelcome(email, firstName);
    } else if (!user.googleId) {
      // Existing password account signing in with Google for the first time —
      // link the two rather than creating a duplicate.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId, emailVerified: true },
        include: { admin: { select: { position: true } } },
      });
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException(
        user.accountStatusReason ?? 'This account is not active',
      );
    }

    const tokens = await this.issueTokens(user);

    return { ...tokens, user: this.toUserResponse(user) };
  }
}
