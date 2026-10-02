import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { toggleUserSuspension, adjustUserCredits } from '@/lib/admin-actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminUsers() {
  await requireAdmin();
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Email</th><th>Role</th><th>Status</th><th className="text-right">Credits</th>
              <th>Joined</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div>{u.email}</div>
                  <div className="text-xs text-[var(--muted)]">{u.name}</div>
                </td>
                <td>{u.role}</td>
                <td>
                  <span className={u.suspended ? 'badge' : 'badge badge-active'}>
                    {u.suspended ? 'suspended' : 'active'}
                  </span>
                </td>
                <td className="text-right">{formatCredits(u.credits ?? 0)}</td>
                <td className="text-[var(--muted)]">{u.createdAt.toLocaleDateString()}</td>
                <td className="flex gap-2 items-center">
                  <form action={toggleUserSuspension}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className={`btn text-xs px-2 py-1 ${u.suspended ? 'btn-ghost' : 'btn-danger'}`}>
                      {u.suspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </form>
                  <form action={adjustUserCredits} className="flex gap-1">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="amount" type="number" className="input w-24 text-xs" placeholder="+/- credits" />
                    <button className="btn btn-ghost text-xs px-2 py-1">Adjust</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
