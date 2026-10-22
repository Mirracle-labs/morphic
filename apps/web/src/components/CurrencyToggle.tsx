'use client';

import { useCurrency } from '@/lib/currency';

export function CurrencyToggle() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div className="inline-flex items-center p-0.5 rounded-full border border-neutral-200 bg-neutral-100 text-[11px] font-mono select-none shadow-2xs">
      <button
        type="button"
        onClick={() => setCurrency('IDR')}
        aria-pressed={currency === 'IDR'}
        aria-label="Switch currency to IDR"
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
          currency === 'IDR'
            ? 'bg-white text-neutral-950 shadow-2xs font-bold'
            : 'text-neutral-500 hover:text-neutral-900 font-medium'
        }`}
        title="Indonesian Rupiah (IDR) · QRIS & Bank Transfer"
      >
        IDR
      </button>
      <button
        type="button"
        onClick={() => setCurrency('USD')}
        aria-pressed={currency === 'USD'}
        aria-label="Switch currency to USD"
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
          currency === 'USD'
            ? 'bg-white text-neutral-950 shadow-2xs font-bold'
            : 'text-neutral-500 hover:text-neutral-900 font-medium'
        }`}
        title="US Dollar (USD) · PayPal & Cards"
      >
        USD
      </button>
    </div>
  );
}
