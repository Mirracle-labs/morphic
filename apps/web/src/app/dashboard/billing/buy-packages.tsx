'use client';

import { useState, useCallback } from 'react';
import { createMockPayment, simulatePaymentWebhook } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';

type Checkout = {
  paymentId: string;
  externalId: string;
  qrPayload: string;
  amountCents: number;
  packageName: string;
};

export function BuyPackages({ packageId }: { packageId: string }) {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'paid' | 'error'>('idle');

  const start = useCallback(async () => {
    const fd = new FormData();
    fd.set('packageId', packageId);
    const res = await createMockPayment(fd);
    if ('error' in res) {
      setStatus('error');
      return;
    }
    setCheckout(res);
    setStatus('waiting');
  }, [packageId]);

  const simulatePaid = useCallback(async () => {
    if (!checkout) return;
    const fd = new FormData();
    fd.set('externalId', checkout.externalId);
    const res = await simulatePaymentWebhook(fd);
    setStatus(res.ok ? 'paid' : 'error');
  }, [checkout]);

  if (status === 'paid') {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-green-400 text-sm font-medium">
          ✓ Payment successful — {checkout?.packageName}
        </div>
        <button className="btn btn-ghost text-xs" onClick={() => window.location.reload()}>
          Continue
        </button>
      </div>
    );
  }

  if (checkout && status === 'waiting') {
    return (
      <div className="flex flex-col gap-2 border border-[var(--border)] rounded-lg p-3">
        <div className="text-sm">
          {checkout.packageName} · Rp{checkout.amountCents.toLocaleString('id-ID')}
        </div>
        <div className="bg-white text-black p-3 rounded font-mono text-[10px] break-all text-center">
          {checkout.qrPayload}
        </div>
        <div className="text-xs text-[var(--muted)]">Scan to pay — waiting for payment…</div>
        <button className="btn btn-ghost text-xs" onClick={simulatePaid}>
          Simulate QR paid (dev)
        </button>
      </div>
    );
  }

  return (
    <button className="btn btn-primary mt-auto" onClick={start} disabled={status === 'error'}>
      Buy Package
    </button>
  );
}
