import { listApiKeys, createApiKey, revokeApiKey, maskedKey } from '@/lib/actions';
import { timeAgo } from '@/lib/utils';
import { RevealKey } from './reveal-key';

export default async function KeysPage() {
  const keys = await listApiKeys();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h1 className="text-2xl font-bold">API Keys</h1>

      <RevealKey createAction={createApiKey} />

      <div className="card">
        {keys.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No keys yet. Create one above.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="font-mono text-xs">{maskedKey(k.keyPrefix)}</td>
                  <td><span className="badge badge-active">{k.status}</span></td>
                  <td className="text-[var(--muted)]">{timeAgo(k.lastUsedAt)}</td>
                  <td className="text-[var(--muted)]">{k.createdAt.toLocaleDateString()}</td>
                  <td>
                    <form action={revokeApiKey}>
                      <input type="hidden" name="id" value={k.id} />
                      <button className="btn btn-danger text-xs px-2 py-1">Revoke</button>
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
