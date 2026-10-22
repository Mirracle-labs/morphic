import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import NavigationProgress from '@/components/NavigationProgress';
import { LanguageProvider, Locale } from '@/lib/i18n';
import { CurrencyProvider, type Currency } from '@/lib/currency';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://morphic.cloud'),
  title: 'Morphic: Satu API untuk Berbagai Model AI',
  description:
    'Akses API Claude 3.5, DeepSeek V4, Qwen Max, dan Kimi melalui satu endpoint OpenAI-compatible dengan pembayaran QRIS lokal.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '128x128' },
    ],
    shortcut: '/favicon.svg',
    apple: '/icon.png',
  },
  openGraph: {
    title: 'Morphic: Satu API untuk Berbagai Model AI',
    description:
      'Akses API Claude 3.5, DeepSeek V4, Qwen Max, dan Kimi melalui satu endpoint OpenAI-compatible dengan pembayaran QRIS lokal.',
    url: 'https://morphic.cloud',
    siteName: 'Morphic AI Gateway',
    images: [
      {
        url: '/morphic-symbol.jpg',
        width: 1024,
        height: 824,
        alt: 'Morphic Logo',
      },
    ],
    locale: 'id_ID',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Morphic: Satu API untuk Berbagai Model AI',
    description:
      'Akses API Claude 3.5, DeepSeek V4, Qwen Max, dan Kimi melalui satu endpoint OpenAI-compatible dengan pembayaran QRIS lokal.',
    images: ['/morphic-symbol.jpg'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#fafafa',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieVal = cookieStore.get('morphic_lang')?.value as Locale | undefined;

  // English by default; Indonesian only when the visitor chose it with the language toggle.
  const initialLocale: Locale = cookieVal === 'id' ? 'id' : 'en';

  const cookieCurrency = cookieStore.get('morphic_currency')?.value as Currency | undefined;
  const headerCurrency = headerStore.get('x-morphic-currency') as Currency | undefined;
  const initialCurrency: Currency =
    cookieCurrency === 'IDR' || cookieCurrency === 'USD'
      ? cookieCurrency
      : (headerCurrency === 'IDR' || headerCurrency === 'USD' ? headerCurrency : 'IDR');
  const detectedCountry = headerStore.get('x-morphic-country') || null;

  return (
    <html lang={initialLocale} className="scroll-smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Manrope:wght@200..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#fafafa] text-neutral-900 antialiased selection:bg-neutral-900 selection:text-white font-body min-h-screen">
        <NavigationProgress />
        <LanguageProvider initialLocale={initialLocale}>
          <CurrencyProvider initialCurrency={initialCurrency} detectedCountry={detectedCountry}>
            {children}
          </CurrencyProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

