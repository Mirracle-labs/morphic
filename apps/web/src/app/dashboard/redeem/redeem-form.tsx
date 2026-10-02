'use client';

import { useActionState } from 'react';

const initial = { ok: false, message: '' };

export function RedeemForm({
  action,
}: {
  action: (prev: { ok: boolean; message: string }, fd: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <div className="card flex flex-col gap-3">
      <form action={formAction} className="flex gap-2">
        <input name="code" className="input font-mono uppercase" placeholder="MIRRACLE-HACK" />
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Redeeming…' : 'Redeem'}
        </button>
      </form>
      {state.message && (
        <div className={state.ok ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
          {state.ok ? '✓ ' : ''}{state.message}
        </div>
      )}
    </div>
  );
}
