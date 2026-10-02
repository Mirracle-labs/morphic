import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { toggleUserSuspension, adjustUserCredits } from '@/lib/admin-actions';
import { formatCredits } from '@/lib/utils';
import { getServerTranslation } from '@/lib/i18n/server';
import { Users as UsersIcon } from 'lucide-react';

export default async function AdminUsers() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const users = await db
    .select({
      id: s.users.id,
      email: s.users.email,
      name: s.users.name,
      role: s.users.role,
      suspended: s.users.suspended,
      createdAt: s.users.createdAt,
      credits: s.balances.credits,
    })
    .from(s.users)
    .leftJoin(s.balances, eq(s.users.id, s.balances.userId))
    .orderBy(desc(s.users.createdAt))
    .limit(100);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-neutral-700" />
            {t.admin.users.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.users.desc} ({users.length})
          </p>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.users.thUser}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.users.thRole}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.users.thStatus}</th>
                <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.users.thCredits}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.users.thJoined}</th>
                <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.users.thActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-neutral-950">{u.email}</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{u.name || t.admin.users.noDisplayName}</div>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider ${
                        u.role === 'admin'
                          ? 'bg-neutral-950 text-white'
                          : 'bg-neutral-100 text-neutral-600 border border-neutral-200/80'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {u.suspended ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-red-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
                        {t.admin.status.suspended}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                        {t.admin.status.active}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">
                    {formatCredits(u.credits ?? 0)}
                  </td>
                  <td className="py-3 px-3 font-mono text-neutral-500 text-[11px] whitespace-nowrap">
                    {u.createdAt.toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <form action={adjustUserCredits} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={u.id} />
                        <label htmlFor={`adjust-${u.id}`} className="sr-only">
                          Adjust credits for {u.email}
                        </label>
                        <input
                          id={`adjust-${u.id}`}
                          name="amount"
                          type="number"
                          aria-label={`Adjust credits for ${u.email}`}
                          className="w-24 px-2 py-1 text-xs rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                          placeholder={t.admin.users.adjustPlaceholder}
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-2xs"
                        >
                          {t.admin.users.adjustBtn}
                        </button>
                      </form>
                      <form action={toggleUserSuspension}>
                        <input type="hidden" name="id" value={u.id} />
                        <button
                          type="submit"
                          className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-2xs ${
                            u.suspended
                              ? 'border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-100'
                              : 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {u.suspended ? t.admin.users.unsuspendBtn : t.admin.users.suspendBtn}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
