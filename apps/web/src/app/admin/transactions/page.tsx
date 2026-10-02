import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';
import { getServerTranslation } from '@/lib/i18n/server';
import { CreditCard } from 'lucide-react';

export default async function AdminTransactions() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const payments = await db
    .select({
      id: s.payments.id,
      userEmail: s.users.email,
      provider: s.payments.provider,
      amountCents: s.payments.amountCents,
      credits: s.payments.credits,
      status: s.payments.status,
      createdAt: s.payments.createdAt,
      paidAt: s.payments.paidAt,
    })
    .from(s.payments)
    .leftJoin(s.users, eq(s.payments.userId, s.users.id))
    .orderBy(desc(s.payments.createdAt))
    .limit(100);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-neutral-700" />
            {t.admin.transactions.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.transactions.desc} ({payments.length})
          </p>
        </div>
      </div>

      {/* Transactions Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        {payments.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">{t.admin.transactions.noTransactions}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.transactions.thDate}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.transactions.thUser}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.transactions.thGateway}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.transactions.thAmount}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.transactions.thCredits}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.transactions.thStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                      {p.createdAt.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-semibold text-neutral-950">{p.userEmail ?? '—'}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-neutral-600 uppercase">
                      {p.provider}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">
                      Rp{formatCredits(p.amountCents)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-900">
                      +{formatCredits(p.credits)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {p.status === 'paid' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                          {t.admin.status.paid}
                        </span>
                      ) : p.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-amber-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                          {t.admin.status.pending}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" aria-hidden="true" />
                          {p.status}
                        </span>
                      )}
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
