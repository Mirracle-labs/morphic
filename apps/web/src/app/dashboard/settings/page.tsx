import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { listActiveSessions, requireUser } from '@/lib/actions';
import { SettingsView } from './settings-view';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const [user, sessions, params] = await Promise.all([requireUser(), listActiveSessions(), searchParams]);

  // The session user carries no role, and the profile card used to print a fixed
  // "DEVELOPER" badge. Read what the account actually is.
  let account: { role: string; emailVerified: boolean; twoFactorEnabled: boolean; hasPassword: boolean } | null =
    null;
  try {
    const [[row], [credential]] = await Promise.all([
      db
        .select({ role: s.users.role, emailVerified: s.users.emailVerified, twoFactorEnabled: s.users.twoFactorEnabled })
        .from(s.users)
        .where(eq(s.users.id, user.id))
        .limit(1),
      db
        .select({ id: s.accounts.id })
        .from(s.accounts)
        .where(and(eq(s.accounts.userId, user.id), eq(s.accounts.providerId, 'credential'), isNotNull(s.accounts.password)))
        .limit(1),
    ]);
    if (row)
      account = {
        role: row.role,
        emailVerified: Boolean(row.emailVerified),
        twoFactorEnabled: row.twoFactorEnabled,
        hasPassword: Boolean(credential),
      };
  } catch (err) {
    console.warn('[SettingsPage] Could not read account role:', err);
  }

  const adminMfaNotice = params.mfa === 'required' && account?.role === 'admin' && !account.twoFactorEnabled;

  return (
    <>
      {adminMfaNotice && (
        <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Panel admin butuh OTP login. Aktifkan &quot;Kode OTP via email saat login&quot; di bawah, lalu buka /admin lagi.
          <span className="block text-amber-800">Admin access needs login OTP. Turn on &quot;Email OTP at sign-in&quot; below, then open /admin again.</span>
        </p>
      )}
      <SettingsView
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        createdAt: user.createdAt,
        role: account?.role ?? null,
        emailVerified: account?.emailVerified ?? null,
      }}
      sessions={sessions}
      loginOtp={{ enabled: account?.twoFactorEnabled ?? false, hasPassword: account?.hasPassword ?? false }}
      />
    </>
  );
}
