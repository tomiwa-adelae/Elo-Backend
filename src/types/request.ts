import type { Request } from 'express';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Express's Request types `user` as `any` (and doesn't know about cookies or
 * the raw body at all), which leaks `any` through every guard and decorator
 * that touches it. Narrow it once here instead.
 */
export interface AppRequest extends Request {
  user?: AuthenticatedUser;
  cookies: Record<string, string | undefined>;
  /** Populated by the json() verify hook in main.ts for webhook signatures. */
  rawBody?: Buffer;
}
