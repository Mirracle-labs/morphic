/**
 * Internal Backend API Client — Morphic Web
 *
 * Thin wrapper around fetch() that:
 * - Resolves the correct base URL for server-side vs client-side calls
 * - Forwards the session cookie when called from a Server Component / Server Action
 * - Returns a typed { data, error, status } envelope so callers never have to try/catch fetch
 * - Applies an 8-second timeout to prevent hanging requests
 *
 * Security notes (OWASP):
 * - Never logs sensitive fields (tokens, cookies, user IDs) — only non-PII error messages
 * - Cookie forwarding is read-only (we only forward what the browser already sent)
 * - AbortController timeout prevents resource exhaustion from stalled connections
 */

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  /** Machine-readable error code from the API (`error.code`), when it sent one. */
  errorCode?: string | null;
  status: number;
}

/**
 * Call the Hono backend API.
 *
 * @param path  - API path starting with `/`, e.g. `/v1/account/transactions`
 * @param options - Standard `RequestInit` options (method, body, headers, …)
 */
export async function fetchBackendApi<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const isServer = typeof window === 'undefined';

  // On server: prefer INTERNAL_API_URL or NEXT_PUBLIC_API_URL directly.
  // On browser client: route via Next.js proxy (/api/backend) so browser sends auth cookies same-origin.
  const baseUrl = isServer
    ? (
        process.env.INTERNAL_API_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'http://localhost:8787'
      ).replace(/\/+$/, '')
    : '/api/backend';

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = isServer ? `${baseUrl}${normalizedPath}` : `/api/backend${normalizedPath}`;

  const headers = new Headers(options.headers ?? {});

  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  // Forward the session cookie and attach Authorization Bearer token when running inside a Server Component or Server Action
  // so the Hono session-auth middleware can authenticate the request reliably.
  if (isServer) {
    try {
      const { headers: getNextHeaders } = await import('next/headers');
      const reqHeaders = await getNextHeaders();
      const cookie = reqHeaders.get('cookie');
      if (cookie && !headers.has('cookie')) {
        headers.set('cookie', cookie);
      }

      if (!headers.has('authorization')) {
        const { auth } = await import('@/lib/auth');
        const session = await auth.api.getSession({ headers: reqHeaders });
        if (session?.session?.token) {
          headers.set('authorization', `Bearer ${session.session.token}`);
        }
      }
    } catch {
      // next/headers or session resolution is unavailable in some edge contexts — safe to skip
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
      // Browser: include cookies via credentials; server: cookies forwarded manually above
      credentials: isServer ? undefined : 'include',
      cache: options.cache ?? 'no-store',
    });

    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') ?? '';
    let json: any = null;

    if (contentType.includes('application/json')) {
      json = await res.json();
    } else {
      const text = await res.text();
      try { json = JSON.parse(text); } catch { json = text; }
    }

    if (!res.ok) {
      // Return a sanitized error message — never expose raw DB errors to the client
      const errorMsg: string =
        json?.error?.message ??
        json?.message ??
        `Backend API error (${res.status})`;
      return { data: null, error: errorMsg, errorCode: json?.error?.code ?? null, status: res.status };
    }

    return { data: json as T, error: null, status: res.status };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const errorMsg: string =
      err?.name === 'AbortError'
        ? 'Request timed out (backend API)'
        : 'Could not reach backend API';
    // Log only non-sensitive context (no user IDs, no cookies)
    console.warn(`[api-client] ${errorMsg} — ${options.method ?? 'GET'} ${path}`);
    return { data: null, error: errorMsg, status: 0 };
  }
}
