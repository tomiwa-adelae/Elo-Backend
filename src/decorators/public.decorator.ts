import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of JwtAuthGuard. The guard still decodes a token if one is
 * present, so handlers can personalise for logged-in users without requiring
 * a session — which is what most storefront pages need.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
