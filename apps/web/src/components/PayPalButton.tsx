'use client';

import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

const API_URL = '/api/backend';

interface PayPalButtonProps {
  packageId: string;
  paymentId?: string | null;
  onSuccess: (credits: number) => void;
  onError: (msg: string) => void;
  onPendingPayPal?: () => void;
}

export function PayPalButton({ packageId, paymentId: initialPaymentId, onSuccess, onError, onPendingPayPal }: PayPalButtonProps) {
  const [paymentId, setPaymentId] = useState<string | null>(initialPaymentId ?? null);
  const [loading, setLoading] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  if (!clientId) {
    return (
      <div className="p-3 text-xs text-rose-600 bg-rose-50 rounded-xl border border-rose-200">
        PayPal Client ID missing. Please set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env.
      </div>
    );
  }

  return (
    <PayPalScriptProvider
      options={{
        clientId,
        currency: 'USD',
        intent: 'capture',
      }}
    >
      <div className="relative w-full min-h-[45px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 rounded-xl backdrop-blur-xs">
            <Loader2 className="w-5 h-5 text-neutral-800 animate-spin" />
          </div>
        )}
        <PayPalButtons
          style={{ layout: 'vertical', shape: 'rect', label: 'pay' }}
          createOrder={async () => {
            setLoading(true);
            try {
              const res = await fetch(`${API_URL}/v1/payments/paypal/create-order`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packageId }),
              });

              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData?.error?.message ?? 'Failed to create PayPal order');
              }

              const data = await res.json();
              setPaymentId(data.paymentId);
              return data.orderId;
            } catch (err: any) {
              setLoading(false);
              onError(err.message ?? 'An error occurred initializing payment');
              throw err;
            }
          }}
          onApprove={async ({ orderID }) => {
            if (!paymentId) return;
            setLoading(true);
            try {
              const res = await fetch(`${API_URL}/v1/payments/paypal/capture`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: orderID, paymentId }),
              });

              const data = await res.json();
              setLoading(false);

              if (data.status === 'pending_paypal') {
                if (onPendingPayPal) {
                  onPendingPayPal();
                } else {
                  onError('Payment is under review by PayPal.');
                }
              } else if (data.success) {
                onSuccess(data.credits);
              } else {
                onError(data.error?.message ?? 'Capture failed. Please check payment status.');
              }
            } catch (err: any) {
              setLoading(false);
              onError(err.message ?? 'Failed to complete PayPal payment capture');
            }
          }}
          onError={(err) => {
            setLoading(false);
            console.error('[PayPalButton] SDK error:', err);
            onError('PayPal encountered an error. Please try again.');
          }}
          onCancel={() => {
            setLoading(false);
          }}
        />
      </div>
    </PayPalScriptProvider>
  );
}
