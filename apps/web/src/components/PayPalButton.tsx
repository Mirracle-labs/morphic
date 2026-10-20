'use client';

import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

const API_URL = '/api/backend';

interface PayPalButtonProps {
  packageId: string;
  giftCard?: { design: string; recipientEmail: string | null } | null;
  paymentId?: string | null;
  onPaymentCreated?: (paymentId: string) => void;
  onSuccess: (credits: number) => void;
  onError: (msg: string) => void;
  onPendingPayPal?: () => void;
  onProcessing?: (paymentId: string) => void;
}

export function PayPalButton({
  packageId,
  giftCard,
  paymentId: initialPaymentId,
  onPaymentCreated,
  onSuccess,
  onError,
  onPendingPayPal,
  onProcessing,
}: PayPalButtonProps) {
  const [paymentId, setPaymentId] = useState<string | null>(initialPaymentId ?? null);
  const [loading, setLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

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
      {isVerifying ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-2">
          <Loader2 className="w-5 h-5 text-amber-600 animate-spin mx-auto" />
          <div className="text-xs font-bold text-amber-900">
            Verifying payment...
          </div>
          <div className="text-[11px] text-amber-700">
            Payment is being processed by PayPal. Please wait.
          </div>
        </div>
      ) : (
        <div className="relative w-full min-h-[45px]">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 rounded-xl backdrop-blur-xs">
              <Loader2 className="w-5 h-5 text-neutral-800 animate-spin" />
            </div>
          )}
          <PayPalButtons
            disabled={loading || isVerifying}
            style={{ layout: 'vertical', shape: 'rect', label: 'pay' }}
            createOrder={async () => {
              if (isVerifying) {
                throw new Error('Payment is currently verifying. Please wait.');
              }
              setLoading(true);
              try {
                const res = await fetch(`${API_URL}/v1/payments/paypal/create-order`, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ packageId, giftCard: giftCard ?? undefined }),
                });

                if (!res.ok) {
                  const errData = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
                  throw new Error(errData?.error?.message ?? 'Failed to create PayPal order');
                }

                const data = (await res.json()) as { paymentId: string; orderId: string };
                setPaymentId(data.paymentId);
                onPaymentCreated?.(data.paymentId);
                return data.orderId;
              } catch (err: unknown) {
                setLoading(false);
                const msg = err instanceof Error ? err.message : 'An error occurred initializing payment';
                onError(msg);
                throw err;
              }
            }}
            onApprove={async ({ orderID }) => {
              if (!paymentId || isVerifying) return;
              setLoading(true);
              try {
                const res = await fetch(`${API_URL}/v1/payments/paypal/capture`, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId: orderID, paymentId }),
                });

                const status = res.status;
                const data = (await res.json().catch(() => ({}))) as {
                  success?: boolean;
                  credits?: number;
                  status?: string;
                  error?: { message?: string; code?: string };
                };

                setLoading(false);

                if (status === 200 && data.success) {
                  onSuccess(data.credits ?? 0);
                  return;
                }

                if (status === 202) {
                  // 202 processing -> not an error.
                  // Switch to verifying state, start polling verification, disable PayPal button, never create new order.
                  setIsVerifying(true);
                  if (onProcessing) {
                    onProcessing(paymentId);
                  } else if (onPendingPayPal) {
                    onPendingPayPal();
                  }
                  return;
                }

                if (status === 422) {
                  // 422 instrument_declined -> friendly message, keep modal open, allow retry (API returns payment to pending)
                  onError(
                    data.error?.code === 'instrument_declined'
                      ? 'Your payment method was declined by PayPal. Please try another card or method.'
                      : (data.error?.message ?? 'Payment method was declined. Please try another payment method.')
                  );
                  return;
                }

                if (status === 409) {
                  // 409 -> "Payment state changed, refreshing", re-check status once; no retry loop
                  onError('Payment state changed, refreshing...');
                  try {
                    const verifyRes = await fetch(`${API_URL}/v1/payments/paypal/verify/${paymentId}`, {
                      credentials: 'include',
                    });
                    const verifyData = (await verifyRes.json().catch(() => ({}))) as {
                      status?: string;
                      credits?: number;
                    };
                    if (verifyData.status === 'paid') {
                      onSuccess(verifyData.credits ?? 0);
                      return;
                    } else if (verifyData.status === 'pending_paypal') {
                      onPendingPayPal?.();
                      return;
                    } else if (verifyData.status === 'needs_review') {
                      if (onProcessing) onProcessing(paymentId);
                      return;
                    }
                  } catch {
                    // Single refresh failure is non-fatal
                  }
                  return;
                }

                // Anything else -> generic error
                onError(data.error?.message ?? 'Capture failed. Please check payment status.');
              } catch (err: unknown) {
                setLoading(false);
                const msg = err instanceof Error ? err.message : 'Failed to complete PayPal payment capture';
                onError(msg);
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
      )}
    </PayPalScriptProvider>
  );
}
