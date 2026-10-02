import type { Context, Next } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and, gt, or } from 'drizzle-orm';

export interface AuthedSession {
  userId: string;
  sessionId: string;
  authMethod: string | null;
}

declare module 'hono' {
  interface ContextVariableMap {
    userSession: AuthedSession;
  }
}

const SESSION_COOKIE_NAMES = new Set([
  'better-auth.session_token',
  'better-auth_session_token',
  'better_auth_session_token',
  'session_token',
]);

/** Parse the Cookie header into name/value pairs and return the session token by exact name. */
function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    let name = part.slice(0, eq).trim();
    if (name.startsWith('__Secure-')) name = name.slice('__Secure-'.length);
    if (!SESSION_COOKIE_NAMES.has(name)) continue;
    return decodeURIComponent(part.slice(eq + 1).trim()).trim();
  }
  return undefined;
}

/** Session authentication for user-facing management routes (API keys, account balance/usage) */
export async function sessionAuth(c: Context, next: Next) {
  const authHeader = c.req.header('authorization');
  let rawToken: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    rawToken = authHeader.slice('Bearer '.length).trim();
  } else {
    // Cookie fallback. Match the Better Auth session cookie by EXACT name — an
    // unanchored regex would also accept an attacker-planted cookie such as
    // `x_session_token` or `evilbetter-auth.session_token` (see security audit M2).
    rawToken = readSessionCookie(c.req.header('cookie'));
  }

  if (!rawToken) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[session-auth] 401 missing token — headers:', c.req.header('cookie') ? 'cookie present' : 'no cookie');
    }
    return c.json(
      { error: { message: 'unauthorized: session token required', type: 'auth_error', code: 'missing_session_token' } },
      401,
    );
  }

  // Clean signed cookie prefix/suffix (e.g. s:token.signature -> token)
  let cleanToken = rawToken;
  if (cleanToken.startsWith('s:')) cleanToken = cleanToken.slice(2);
  if (cleanToken.startsWith('s%3A')) cleanToken = cleanToken.slice(4);
  const unsignedToken = cleanToken.includes('.') ? cleanToken.split('.')[0] : cleanToken;

  const [session] = await db
    .select({
      id: s.sessions.id,
      userId: s.sessions.userId,
      expiresAt: s.sessions.expiresAt,
      authMethod: s.sessions.authMethod,
      suspended: s.users.suspended,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.sessions.userId, s.users.id))
    .where(
      and(
        or(
          eq(s.sessions.token, rawToken),
          eq(s.sessions.token, cleanToken),
          eq(s.sessions.token, unsignedToken!),
        ),
        gt(s.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[session-auth] 401 invalid token in DB:', unsignedToken.slice(0, 10) + '...');
    }
    return c.json(
      { error: { message: 'invalid or expired session token', type: 'auth_error', code: 'invalid_session_token' } },
      401,
    );
  }

  if (session.suspended) {
    return c.json(
      { error: { message: 'account suspended', type: 'auth_error', code: 'account_suspended' } },
      403,
    );
  }

  c.set('userSession', { userId: session.userId, sessionId: session.id, authMethod: session.authMethod });
  await next();
}

export async function denyKeyDerivedSession(_c: Context, next: Next) {
  await next();
}
