import { createAuthClient } from 'better-auth/react';

/**
 * Auth calls from the browser must go to the origin that served the page. Reading
 * NEXT_PUBLIC_APP_URL here baked the build-time value into the bundle, so a deployment built
 * with a development value shipped `http://localhost:3000` to every visitor: sign-out and
 * session refresh then hit the visitor's own machine and silently do nothing. The env var is
 * only a server-render fallback now, trimmed because a stray space in it reached production.
 */
function resolveBaseURL(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : 'http://localhost:3000';
}

export const authClient = createAuthClient({
  baseURL: resolveBaseURL(),
});

export const { signIn, signUp, signOut, useSession } = authClient;
