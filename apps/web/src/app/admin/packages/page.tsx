import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { savePackage } from '@/lib/admin-actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminPackages() {
  await requireAdmin();
  const [packages, models] = await Promise.all([
    db.select().from(s.packages),
    db.select({ id: s.models.id, displayName: s.models.displayName }).from(s.models),
  ]);
  const modelName = (id: string | null) => models.find((m) => m.id === id)?.displayName ?? 'All models';

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Packages</h1>

      <div className="card">
        <div className="text-sm font-medium mb-3">Create Package</div>
        <form action={savePackage} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input name="name" className="input" placeholder="DeepSeek V4 — 1 Day" required />
          <input name="description" className="input" placeholder="Unlimited for 24 hours (fair use)" />
          <select name="modelId" className="input">
            <option value="">All models (credit pack)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
          <input name="creditAllowance" className="input" type="number" placeholder="credit allowance" required />
          <input name="durationHours" className="input" type="number" placeholder="duration hours" />
          <input name="priceCents" className="input" type="number" placeholder="price (IDR)" />
          <button className="btn btn-primary">Create Package</button>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Model</th><th className="text-right">Allowance</th><th>Duration</th><th className="text-right">Price</th><th>Status</th></tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{modelName(p.modelId)}</td>
                <td className="text-right">{formatCredits(p.creditAllowance)}</td>
                <td>{p.durationHours ? `${p.durationHours}h` : '—'}</td>
                <td className="text-right">{p.priceCents ? `Rp${p.priceCents.toLocaleString('id-ID')}` : '—'}</td>
                <td><span className={p.status === 'active' ? 'badge badge-active' : 'badge'}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
