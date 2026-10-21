'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Currency = 'IDR' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  detectedCountry: string | null;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'IDR',
  setCurrency: () => {},
  detectedCountry: null,
});

export function CurrencyProvider({
  children,
  initialCurrency = 'IDR',
  detectedCountry = null,
}: {
  children: React.ReactNode;
  initialCurrency?: Currency;
  detectedCountry?: string | null;
}) {
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('morphic_currency') as Currency | null;
      if (saved === 'IDR' || saved === 'USD') {
        if (saved !== initialCurrency) {
          setCurrencyState(saved);
        }
        document.cookie = `morphic_currency=${saved}; path=/; max-age=31536000; SameSite=Lax`;
        return;
      }

      // If no saved preference and no proxy country header, do a real background GeoIP lookup
      if (!detectedCountry) {
        fetch('https://api.country.is', { signal: AbortSignal.timeout(2000) })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.country) {
              const geoCurrency: Currency = data.country.toUpperCase() === 'ID' ? 'IDR' : 'USD';
              setCurrencyState(geoCurrency);
              document.cookie = `morphic_currency=${geoCurrency}; path=/; max-age=31536000; SameSite=Lax`;
            }
          })
          .catch(() => {
            // Silently fallback to initialCurrency if offline or blocked
          });
      }
    } catch {
      // LocalStorage unavailable
    }
  }, [initialCurrency, detectedCountry]);

  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    try {
      localStorage.setItem('morphic_currency', newCurrency);
      document.cookie = `morphic_currency=${newCurrency}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // LocalStorage unavailable
    }
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, detectedCountry }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
