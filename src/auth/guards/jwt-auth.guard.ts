import { AuthGuard } from '@nestjs/passport';
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import type { AuthenticatedUser } from '../../decorators/current-user.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Public routes still run the strategy so an optional token gets decoded;
    // handleRequest below is what stops it from throwing.
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Public routes pass through even without a token — handlers get
    // undefined and personalise only when someone is signed in.
    if (isPublic) {
      return (user || undefined) as TUser;
    }

    if (err || !user) {
      throw err ?? new UnauthorizedException('Invalid or expired token');
    }

    return user;
  }
}
