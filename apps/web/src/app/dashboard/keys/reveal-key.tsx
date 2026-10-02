'use client';

import { useActionState, useState } from 'react';

const initial = { raw: null as string | null };

export function RevealKey({
  createAction,
}: {
  createAction: (prev: { raw: string | null }, fd: FormData) => Promise<{ raw: string | null }>;
}) {
  const [state, formAction, pending] = useActionState(createAction, initial);
  const [copied, setCopied] = useState(false);

  return (
    <div className="card flex flex-col gap-3">
      <form action={formAction} className="flex gap-2">
        <input name="name" className="input max-w-xs" placeholder="Key name (e.g. OpenCode)" />
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : '+ Create API Key'}
        </button>
      </form>

      {state.raw && (
        <div className="border border-[var(--accent)] rounded-lg p-3 flex flex-col gap-2">
          <div className="text-xs text-[var(--muted)]">
            Copy now — this key is shown only once.
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm flex-1 break-all">{state.raw}</code>
            <button
              className="btn btn-ghost text-xs"
              onClick={() => {
                navigator.clipboard.writeText(state.raw!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
