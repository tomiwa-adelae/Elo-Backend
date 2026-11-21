import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  adminPosition?: string | null;
}

/**
 * Pulls the user JwtStrategy attached to the request.
 *
 * Undefined on @Public() routes when the caller sent no token, so handlers
 * that accept both anonymous and authenticated traffic must null-check.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) return undefined;

    return data ? user[data] : user;
  },
);
