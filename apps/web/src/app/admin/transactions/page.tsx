import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminTransactions() {
  await requireAdmin();
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
      <div className="card">
        {payments.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No transactions yet</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Date</th><th>User</th><th>Provider</th><th className="text-right">Amount</th><th className="text-right">Credits</th><th>Status</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-[var(--muted)]">{p.createdAt.toLocaleString()}</td>
                  <td className="text-xs">{p.userEmail ?? '—'}</td>
                  <td>{p.provider}</td>
                  <td className="text-right">Rp{formatCredits(p.amountCents)}</td>
                  <td className="text-right">+{formatCredits(p.credits)}</td>
                  <td><span className={p.status === 'paid' ? 'badge badge-active' : 'badge'}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
