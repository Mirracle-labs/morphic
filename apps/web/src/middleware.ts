import { NextRequest, NextResponse } from 'next/server';

// ── In-Memory Edge Rate Limiter ─────────────────────────────
// Map of IP -> { count, expiresAt }
const ipRateLimitMap = new Map<string, { count: number; expiresAt: number }>();

function cleanExpiredLimits(now: number) {
  if (ipRateLimitMap.size > 2000) {
    for (const [ip, entry] of ipRateLimitMap.entries()) {
      if (entry.expiresAt <= now) {
        ipRateLimitMap.delete(ip);
      }
    }
  }
}

function checkEdgeRateLimit(ip: string, maxRequests: number, windowSeconds: number): boolean {
  const now = Date.now();
  cleanExpiredLimits(now);

  const key = `${ip}:${Math.floor(now / (windowSeconds * 1000))}`;
  const entry = ipRateLimitMap.get(key);

  if (!entry || entry.expiresAt <= now) {
    ipRateLimitMap.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ── Suspicious Scanner & Stress-Test Tools User-Agents ──────
const BLOCKED_TOOLS_REGEX =
  /\b(k6|wrk|autocannon|siege|hey|artillery|vegeta|sqlmap|nuclei|nikto|masscan|zgrab|nessus|openvas|gobuster|dirbuster|wfuzz)\b/i;

// Probing paths to drop immediately
const PROBING_PATHS_REGEX =
  /(\.php|\.env|\.git|\.aws|\.well-known\/security|wp-admin|wp-login|xmlrpc|cgi-bin|actuator|config\.json)/i;

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 1. Immediately drop common vulnerability probing / scanner paths
  if (PROBING_PATHS_REGEX.test(pathname)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // 2. Extract Client IP
  const forwardedFor = req.headers.get('x-forwarded-for');
  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.headers.get('x-real-ip') || 'unknown');

  const userAgent = req.headers.get('user-agent') || '';

  // 3. Block known automated stress-test tools & scanners targeting API/dashboard
  if (
    (pathname.startsWith('/api') || pathname.startsWith('/dashboard') || req.method !== 'GET') &&
    BLOCKED_TOOLS_REGEX.test(userAgent)
  ) {
    return new NextResponse(
      JSON.stringify({
        error: {
          message: 'Automated stress-testing or scanning tools are blocked.',
          code: 'tool_blocked',
        },
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 4. Payload Size Guard (Reject oversized HTTP bodies > 2MB on API routes)
  if (pathname.startsWith('/api')) {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
      return new NextResponse(
        JSON.stringify({
          error: {
            message: 'Payload Too Large. Maximum allowed request size is 2MB.',
            code: 'payload_too_large',
          },
        }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // 5. Edge Rate Limiting:
  // - Sensitive API & Auth routes: max 60 requests / minute per IP
  // - General Pages / Actions: max 180 requests / minute per IP
  const isApiRoute = pathname.startsWith('/api');
  const maxAllowed = isApiRoute ? 60 : 180;
  const isWithinLimit = checkEdgeRateLimit(clientIp, maxAllowed, 60);

  if (!isWithinLimit) {
    return new NextResponse(
      JSON.stringify({
        error: {
          message: 'Too Many Requests. Rate limit exceeded, please slow down.',
          code: 'edge_rate_limit_exceeded',
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      }
    );
  }

  // 6. Geolocation & Currency Resolution (Decoupling Locale from Currency)
  const isPrivateOrLocalIp = (ip: string): boolean => {
    return (
      ip === 'unknown' ||
      ip === 'localhost' ||
      ip === '::1' ||
      ip === '127.0.0.1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
      ip.startsWith('fe80:') ||
      ip.startsWith('fc00:')
    );
  };

  const rawCountry =
    req.headers.get('cf-ipcountry') ||
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('x-country-code');

  const detectedCountry =
    rawCountry && rawCountry !== 'XX' && rawCountry !== 'T1'
      ? rawCountry.toUpperCase()
      : isPrivateOrLocalIp(clientIp)
        ? 'ID'
        : 'US';

  const cookieCurrency = req.cookies.get('morphic_currency')?.value;
  const currency =
    cookieCurrency === 'IDR' || cookieCurrency === 'USD'
      ? cookieCurrency
      : detectedCountry === 'ID'
        ? 'IDR'
        : 'USD';

  // Pass detected metadata to downstream server components
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-morphic-country', detectedCountry);
  requestHeaders.set('x-morphic-currency', currency);

  // 7. Security Headers & Response setup
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-morphic-country', detectedCountry);
  response.headers.set('x-morphic-currency', currency);

  if (!cookieCurrency) {
    response.cookies.set('morphic_currency', currency, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets (logos, images, svgs)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|logos/|images/).*)',
  ],
};
