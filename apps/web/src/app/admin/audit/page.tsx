import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { History } from 'lucide-react';

export default async function AdminAudit() {
  await requireAdmin();
  const { t } = await getServerTranslation();

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
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <History className="w-5 h-5 text-neutral-700" />
            {t.admin.audit.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.audit.desc} ({entries.length} {t.admin.audit.recentLogs}).
          </p>
        </div>
      </div>

      {/* Audit Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">{t.admin.audit.noAudit}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.audit.thWhen}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.audit.thAdmin}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.audit.thAction}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.audit.thEntity}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.audit.thDetail}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                      {e.createdAt.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-semibold text-neutral-950">{e.adminEmail ?? '—'}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider bg-neutral-100 text-neutral-800 border border-neutral-200">
                        {e.action}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-neutral-700">
                      {e.entity}{e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-neutral-600 max-w-sm truncate">
                      {e.detail ? JSON.stringify(e.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

