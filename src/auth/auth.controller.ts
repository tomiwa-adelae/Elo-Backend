import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest } from '../types/request';
import { AuthService } from './auth.service';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

// Credential endpoints are the ones worth rate limiting: 5 attempts per
// minute stops password spraying without annoying real users.
const STRICT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    res.cookie(
      'accessToken',
      tokens.accessToken,
      this.authService.getCookieOptions(this.authService.accessCookieMaxAge),
    );
    res.cookie(
      'refreshToken',
      tokens.refreshToken,
      this.authService.getCookieOptions(this.authService.refreshCookieMaxAge),
    );
  }

  private clearAuthCookies(res: Response) {
    // clearCookie must match the attributes the cookie was set with, minus
    // maxAge — passing it would set a new expiry instead of clearing.
    const options = this.authService.getCookieOptions();
    delete (options as { maxAge?: number }).maxAge;

    res.clearCookie('accessToken', options);
    res.clearCookie('refreshToken', options);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() _dto: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // LocalAuthGuard has already validated the credentials and set req.user.
    const { accessToken, refreshToken, user } = await this.authService.login(
      req.user!,
    );

    this.setAuthCookies(res, { accessToken, refreshToken });

    return { message: 'Signed in', user, accessToken };
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Create a customer account' })
  async register(@Body() dto: RegisterUserDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email address with its OTP' })
  async verifyEmail(@Body() dto: VerifyCodeDto) {
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('resend-email-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a fresh email verification code' })
  async resendEmailVerification(@Body() dto: ForgotPasswordDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a password reset' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a password reset code before showing the form',
  })
  async verifyCode(@Body() dto: VerifyCodeDto) {
    return this.authService.verifyResetCode(dto.email, dto.otp);
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('set-new-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset' })
  async setNewPassword(@Body() dto: SetNewPasswordDto) {
    return this.authService.setNewPassword(
      dto.email,
      dto.otp,
      dto.newPassword,
      dto.confirmPassword,
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the session tokens' })
  async refresh(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      req.cookies?.['refreshToken'] ??
      (req.body as { refreshToken?: string })?.refreshToken;

    if (!token) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const { accessToken, refreshToken, user } =
      await this.authService.refresh(token);

    this.setAuthCookies(res, { accessToken, refreshToken });

    return { user, accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out and revoke the refresh token' })
  async logout(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.clearAuthCookies(res);
    return this.authService.logout(user?.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the signed-in user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update name, phone, avatar or marketing consent' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Throttle(STRICT_THROTTLE)
  @Patch('change-password')
  @ApiOperation({ summary: 'Change password while signed in' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmPassword,
    );
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Redirect to Google consent screen' })
  googleAuth(@Res() res: Response) {
    return res.redirect(this.authService.getGoogleAuthUrl());
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth redirect target' })
  async googleCallback(@Query('code') code: string, @Res() res: Response) {
    const frontend = this.authService.googleRedirectUrl;

    if (!code) {
      return res.redirect(`${frontend}/login?error=google_failed`);
    }

    try {
      const { accessToken, refreshToken } = await this.authService.googleSignIn(
        code,
        `${process.env.BACKEND_URL}/api/auth/google/callback`,
      );

      this.setAuthCookies(res, { accessToken, refreshToken });

      return res.redirect(frontend);
    } catch {
      return res.redirect(`${frontend}/login?error=google_failed`);
    }
  }

  @Public()
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a Google code from a client-side flow' })
  async googleExchange(
    @Body() body: { code: string; redirectUri: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } =
      await this.authService.googleSignIn(body.code, body.redirectUri);

    this.setAuthCookies(res, { accessToken, refreshToken });

    return { user, accessToken };
  }
}
