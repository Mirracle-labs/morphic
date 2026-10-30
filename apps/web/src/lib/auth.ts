import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@morphic/db';
import * as schema from '@morphic/db/schema';
import { captcha, twoFactor } from 'better-auth/plugins';
import { sendEmail } from '@morphic/shared/email';

const authSecret = process.env.BETTER_AUTH_SECRET;
// `next build` evaluates this module to collect page data with NODE_ENV=production but
// before runtime env is injected (Vercel injects it after the build). The build never
// handles real sessions, so enforce the secret at RUNTIME only — throwing here would
// fail the build even when the secret will be present when the app actually serves.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
const secretIsValid = Boolean(
  authSecret && authSecret !== 'change-me-32+chars-random-secret' && authSecret.length >= 32,
);
if (process.env.NODE_ENV === 'production' && !isBuildPhase && !secretIsValid) {
  throw new Error(
    '[FATAL SECURITY] BETTER_AUTH_SECRET must be set to a secure 32+ character random string in production. Generate one using: openssl rand -base64 32',
  );
}
// During the build phase only, fall back to a throwaway secret so betterAuth can
// instantiate for static analysis. It never signs a real session (runtime enforces above).
const resolvedSecret = secretIsValid
  ? authSecret
  : isBuildPhase
    ? 'build-phase-placeholder-secret-not-used-at-runtime-000000'
    : authSecret;

// Better Auth derives its trusted origin from `baseURL` alone, so every other host the app
// is served on (localhost during development, a Vercel preview URL) fails the origin check
// with 403 INVALID_ORIGIN the moment the browser sends a cookie. List the app's own origins.
const trustedOrigins = [
  ...new Set(
    [
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.BETTER_AUTH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    ].flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    }),
  ),
];

const authPlugins: any[] = [
  // Email OTP as the second step for email+password sign-in. TOTP / authenticator apps and
  // backup codes are deliberately not exposed in the UI.
  twoFactor({
    issuer: 'Morphic',
    allowPasswordless: true,
    otpOptions: {
      period: 5,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      sendOTP: async ({ user, otp }) => {
        await sendEmail({
          to: user.email,
          subject: `Kode login Morphic: ${otp}`,
          text: `Kode verifikasi Morphic Anda: ${otp}\n\nBerlaku 5 menit. Abaikan email ini jika Anda tidak sedang masuk.`,
          html: `<p>Kode verifikasi Morphic Anda:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${otp}</p><p>Berlaku 5 menit. Abaikan email ini jika Anda tidak sedang masuk.</p>`,
        });
      },
    },
  }),
];
if (process.env.RECAPTCHA_SECRET_KEY) {
  authPlugins.push(
    captcha({
      provider: 'google-recaptcha',
      secretKey: process.env.RECAPTCHA_SECRET_KEY,
    }),
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes signed cookie cache
    },
  },
  rateLimit: {
    window: 60,
    max: 20, // Tighten rate limit to mitigate brute-force
  },
  emailAndPassword: {
    enabled: true,
    // No session until the address is proven: sign-up sends a link, and an unverified sign-in
    // is refused with EMAIL_NOT_VERIFIED after a fresh link is sent (sendOnSignIn).
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 30 * 60,
    revokeSessionsOnPasswordReset: true,
    // Signing up again with a registered email returns a generic 200 and sends nothing, so an
    // unverified user who lost the first link would be stuck. Resend the link only while the
    // account is unverified; a verified account still gets nothing (no enumeration signal).
    onExistingUserSignUp: async ({ user }) => {
      if (user.emailVerified) return;
      await auth.api.sendVerificationEmail({ body: { email: user.email, callbackURL: '/dashboard' } });
    },
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Atur ulang kata sandi Morphic',
        text: `Buka tautan ini untuk membuat kata sandi baru (berlaku 30 menit):\n${url}\n\nAbaikan email ini jika Anda tidak memintanya.`,
        html: `<p>Buka tautan ini untuk membuat kata sandi baru (berlaku 30 menit):</p><p><a href="${url}">Atur ulang kata sandi</a></p><p>Abaikan email ini jika Anda tidak memintanya.</p>`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verifikasi email Morphic Anda',
        text: `Buka tautan ini untuk memverifikasi email dan masuk ke Morphic (berlaku 24 jam):\n${url}\n\nAbaikan email ini jika Anda tidak mendaftar.`,
        html: `<p>Buka tautan ini untuk memverifikasi email dan masuk ke Morphic (berlaku 24 jam):</p><p><a href="${url}">Verifikasi email</a></p><p>Abaikan email ini jika Anda tidak mendaftar.</p>`,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    },
  },
  secret: resolvedSecret,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  advanced: {
    database: { generateId: false },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    },
  },
  plugins: authPlugins,
});

export type Session = typeof auth.$Infer.Session;

/**
 * Fetches the current session for public server-component pages (homepage, docs, pricing …).
 *
 * Races against a 3-second timeout so a cold-start Neon DB or temporary network
 * hiccup never blocks the initial page render. Falls back to `null` (guest view)
 * gracefully — the user can still log in normally; auth routes are unaffected.
 */
/** Public pages hand this to client components, so it carries only what the navbar shows:
 *  never the session token, IP or user agent, which would be serialized into the page. */
export async function getSessionSafe(
  reqHeaders: Headers,
): Promise<{ user: { name: string; email: string; image: string | null } } | null> {
  try {
    const result = await Promise.race([
      auth.api.getSession({ headers: reqHeaders }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (!result?.user) return null;
    return { user: { name: result.user.name, email: result.user.email, image: result.user.image ?? null } };
  } catch {
    return null;
  }
}

