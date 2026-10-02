import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { saveModel } from '@/lib/admin-actions';

export default async function AdminModels() {
  await requireAdmin();
  const [models, providers] = await Promise.all([
    db
      .select({
        id: s.models.id,
        publicModelId: s.models.publicModelId,
        providerModelId: s.models.providerModelId,
        displayName: s.models.displayName,
        description: s.models.description,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
        inputCreditsPer1m: s.models.inputCreditsPer1m,
        outputCreditsPer1m: s.models.outputCreditsPer1m,
        status: s.models.status,
        providerName: s.providers.name,
      })
      .from(s.models)
      .innerJoin(s.providers, eq(s.models.providerId, s.providers.id)),
    db.select().from(s.providers),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <h1 className="text-2xl font-bold">Models</h1>

      <div className="card">
        <div className="text-sm font-medium mb-3">Add Model</div>
        <form action={saveModel} className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <select name="providerId" className="input" required>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input name="publicModelId" className="input font-mono" placeholder="deepseek-v4" required />
          <input name="providerModelId" className="input font-mono" placeholder="deepseek-chat" required />
          <input name="displayName" className="input" placeholder="DeepSeek V4" required />
          <input name="description" className="input col-span-2" placeholder="Description" />
          <input name="capabilities" className="input" placeholder="coding, reasoning" />
          <input name="contextLength" className="input" type="number" placeholder="context length" required />
          <input name="inputCreditsPer1m" className="input" type="number" placeholder="in credits/1M" required />
          <input name="outputCreditsPer1m" className="input" type="number" placeholder="out credits/1M" required />
          <button className="btn btn-primary">Create</button>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Public ID</th><th>Provider ID</th><th>Provider</th><th>Context</th>
              <th>In/Out per 1M</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="font-mono text-xs">{m.publicModelId}</td>
                <td className="font-mono text-xs text-[var(--muted)]">{m.providerModelId}</td>
                <td>{m.providerName}</td>
                <td>{m.contextLength.toLocaleString()}</td>
                <td>{m.inputCreditsPer1m} / {m.outputCreditsPer1m}</td>
                <td><span className={m.status === 'active' ? 'badge badge-active' : 'badge'}>{m.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
