import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { LanguageProvider, Locale } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'Morphic: Satu API untuk Berbagai Model AI',
  description: 'Akses API Claude 3.5, DeepSeek V4, Qwen Max, dan Kimi melalui satu endpoint OpenAI-compatible dengan pembayaran QRIS lokal.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#fafafa',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieVal = cookieStore.get('morphic_locale')?.value as Locale | undefined;

  let initialLocale: Locale = 'id';
  if (cookieVal === 'en' || cookieVal === 'id') {
    initialLocale = cookieVal;
  } else {
    const reqHeaders = await headers();
    const detected = reqHeaders.get('x-morphic-detected-locale');
    const country = (reqHeaders.get('cf-ipcountry') || reqHeaders.get('x-vercel-ip-country') || '').trim().toUpperCase();

    if (detected === 'en' || detected === 'id') {
      initialLocale = detected;
    } else if (country) {
      initialLocale = country === 'ID' ? 'id' : 'en';
    } else {
      const acceptLang = (reqHeaders.get('accept-language') || '').toLowerCase();
      initialLocale = acceptLang.includes('id') ? 'id' : 'en';
    }
  }

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
        <LanguageProvider initialLocale={initialLocale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}

