import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { generateRedeemCodes, toggleRedeemCode } from '@/lib/admin-actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminCodes() {
  await requireAdmin();
  const [codes, models] = await Promise.all([
    db.select().from(s.redeemCodes).orderBy(desc(s.redeemCodes.createdAt)).limit(100),
    db.select({ id: s.models.id, displayName: s.models.displayName }).from(s.models),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <h1 className="text-2xl font-bold">Redeem Codes</h1>

      <div className="card">
        <div className="text-sm font-medium mb-3">Generate Codes</div>
        <form action={generateRedeemCodes} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input name="prefix" className="input font-mono uppercase" placeholder="MORPHIC-HACK" required />
          <input name="count" className="input" type="number" min={1} max={500} defaultValue={1} placeholder="count" />
          <select name="rewardType" className="input">
            <option value="credits">Credits</option>
            <option value="package">Model package</option>
          </select>
          <input name="creditAmount" className="input" type="number" defaultValue={100000} placeholder="credit amount" />
          <select name="modelId" className="input">
            <option value="">No model restriction</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
          <input name="durationHours" className="input" type="number" placeholder="duration hours (package)" />
          <input name="maxRedemptions" className="input" type="number" placeholder="max redemptions" />
          <input name="expiresAt" className="input" type="date" placeholder="expires" />
          <button className="btn btn-primary">Generate</button>
        </form>
      </div>

      <div className="card">
        {codes.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No codes yet</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Code</th><th>Reward</th><th className="text-right">Redeemed</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="text-xs">
                    {c.rewardType === 'credits'
                      ? `${formatCredits(c.creditAmount ?? 0)} credits`
                      : `${formatCredits(c.creditAmount ?? 0)} cr · ${c.durationHours ?? 24}h`}
                  </td>
                  <td className="text-right">
                    {c.redeemedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                  </td>
                  <td className="text-[var(--muted)] text-xs">
                    {c.expiresAt ? c.expiresAt.toLocaleDateString() : 'never'}
                  </td>
                  <td><span className={c.active ? 'badge badge-active' : 'badge'}>{c.active ? 'active' : 'disabled'}</span></td>
                  <td>
                    <form action={toggleRedeemCode}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn btn-ghost text-xs px-2 py-1">
                        {c.active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
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
