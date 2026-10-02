import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';

export default async function AdminAudit() {
  await requireAdmin();
  const entries = await db
    .select({
      id: s.adminAuditLog.id,
      action: s.adminAuditLog.action,
      entity: s.adminAuditLog.entity,
      entityId: s.adminAuditLog.entityId,
      detail: s.adminAuditLog.detail,
      createdAt: s.adminAuditLog.createdAt,
      adminEmail: s.users.email,
    })
    .from(s.adminAuditLog)
    .leftJoin(s.users, eq(s.adminAuditLog.adminId, s.users.id))
    .orderBy(desc(s.adminAuditLog.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <div className="card">
        {entries.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No admin actions recorded</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>When</th><th>Admin</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="text-xs text-[var(--muted)]">{e.createdAt.toLocaleString()}</td>
                  <td className="text-xs">{e.adminEmail ?? '—'}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="text-xs">{e.entity}{e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}</td>
                  <td className="text-xs text-[var(--muted)] max-w-xs truncate">
                    {e.detail ? JSON.stringify(e.detail) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
