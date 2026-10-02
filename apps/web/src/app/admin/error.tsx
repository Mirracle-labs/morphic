'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console — in production this could also fire an alert
    console.error('[admin/error]', error);
  }, [error]);

  const isDbTimeout = error.message?.includes('ETIMEDOUT') || error.message?.includes('ECONNREFUSED');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 max-w-lg w-full">
        <div className="flex items-center justify-center gap-3 mb-4">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <h2 className="text-xl font-bold text-red-800">
            {isDbTimeout ? 'Database Waking Up…' : 'Something went wrong'}
          </h2>
        </div>

        {isDbTimeout ? (
          <p className="text-sm text-red-700 mb-5 leading-relaxed">
            The database is coming online after an idle period (Neon cold-start).
            This usually takes a few seconds. Please try refreshing the page.
          </p>
        ) : (
          <p className="text-sm text-red-700 mb-5 leading-relaxed">
            An unexpected error occurred loading this admin page.
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="btn btn-primary text-sm px-5 py-2 rounded-xl"
          >
            {isDbTimeout ? 'Retry' : 'Try again'}
          </button>
          <a
            href="/admin"
            className="btn text-sm px-5 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50"
          >
            Back to Overview
          </a>
        </div>

        {error.digest && (
          <p className="text-[10px] text-neutral-500 mt-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
