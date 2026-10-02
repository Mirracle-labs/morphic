import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Morphic — Toko Reseller API Key AI Murah',
  description: 'Akses API DeepSeek V4, Qwen Max, Kimi Coding melalui satu endpoint OpenAI-compatible dengan harga reseller termurah.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#fafafa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#fafafa] text-neutral-900 antialiased selection:bg-neutral-900 selection:text-white font-body min-h-screen">
        {children}
      </body>
    </html>
  );
}
