import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { listActiveSessions, requireUser } from '@/lib/actions';
import { SettingsView } from './settings-view';

export default async function SettingsPage() {
  const [user, sessions] = await Promise.all([requireUser(), listActiveSessions()]);

  // The session user carries no role, and the profile card used to print a fixed
  // "DEVELOPER" badge. Read what the account actually is.
  let account: { role: string; emailVerified: boolean } | null = null;
  try {
    const [row] = await db
      .select({ role: s.users.role, emailVerified: s.users.emailVerified })
      .from(s.users)
      .where(eq(s.users.id, user.id))
      .limit(1);
    if (row) account = { role: row.role, emailVerified: Boolean(row.emailVerified) };
  } catch (err) {
    console.warn('[SettingsPage] Could not read account role:', err);
  }

  return (
    <SettingsView
      user={{ ...user, role: account?.role ?? null, emailVerified: account?.emailVerified ?? null }}
      sessions={sessions}
    />
  );
}
