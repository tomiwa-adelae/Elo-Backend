import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import type { JwtPayload } from '../auth.service';
import type { AppRequest } from '../../types/request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: (req: AppRequest) => {
        // Bearer token (mobile / API clients)
        const auth = req?.headers?.authorization;
        if (auth?.startsWith('Bearer ')) return auth.slice(7);
        // httpOnly cookie (web)
        return req?.cookies?.['accessToken'] ?? null;
      },
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.authService.findUserById(payload.sub);

    if (!user) throw new UnauthorizedException('User not found');

    return user;
  }
}
