import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { saveProvider } from '@/lib/admin-actions';

export default async function AdminProviders() {
  await requireAdmin();
  const providers = await db.select().from(s.providers);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Providers</h1>

      <div className="card">
        <div className="text-sm font-medium mb-3">Add / Update Provider</div>
        <form action={saveProvider} className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input type="hidden" name="id" value="" />
          <input name="name" className="input" placeholder="provider name (e.g. moonshot)" required />
          <input name="baseUrl" className="input" placeholder="https://api.provider.com/v1" required />
          <input
            name="credential"
            className="input"
            type="password"
            placeholder="API credential (encrypted at rest, write-only)"
          />
          <select name="status" className="input">
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
          <button className="btn btn-primary">Create Provider</button>
        </form>
        <div className="text-xs text-[var(--muted)] mt-2">
          Credentials are AES-256-GCM encrypted before storage and never rendered back.
        </div>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Base URL</th><th>Credential</th><th>Status</th></tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="font-mono text-xs text-[var(--muted)]">{p.baseUrl}</td>
                <td className="text-xs text-[var(--muted)]">
                  {p.encryptedCredentials ? 'encrypted ✓' : p.credentialReference ?? '—'}
                </td>
                <td><span className={p.status === 'active' ? 'badge badge-active' : 'badge'}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
