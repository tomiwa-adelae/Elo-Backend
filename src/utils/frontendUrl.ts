/**
 * FRONTEND_URL is a comma-separated allowlist (it also feeds CORS). The first
 * entry is the canonical origin used to build links in emails and OAuth
 * redirects.
 */
export function getFrontendUrl(): string {
  const first = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)[0];

  return (first ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function frontendPath(path: string): string {
  return `${getFrontendUrl()}/${path.replace(/^\//, '')}`;
}
