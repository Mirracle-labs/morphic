import { requireUser } from '@/lib/actions';

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="card flex flex-col gap-2">
        <div className="text-sm text-[var(--muted)]">Account</div>
        <div>{user.name}</div>
        <div className="text-sm text-[var(--muted)]">{user.email}</div>
      </div>
      <div className="card">
        <div className="text-sm text-[var(--muted)] mb-2">API Endpoint</div>
        <code className="font-mono text-sm">https://api.morphic.xxx/v1</code>
        <div className="text-xs text-[var(--muted)] mt-2">
          Configure your AI coding agent with this base URL and an mp- API key.
        </div>
      </div>
    </div>
  );
}
