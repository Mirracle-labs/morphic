export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { headers } from 'next/headers';
import { getSessionSafe } from '@/lib/auth';
import { getServerTranslation } from '@/lib/i18n/server';
import Navbar from '@/components/Navbar';
import Footer, { SUPPORT_ADDRESS, SUPPORT_EMAIL, SUPPORT_PHONE } from '@/components/Footer';

export const metadata = {
  title: 'About Us | Morphic AI Gateway',
  description: 'Morphic is an OpenAI-compatible AI gateway with credit billing and local QRIS top-ups, built in Bogor, Indonesia.',
};

export default async function AboutPage() {
  let session = null;
  try {
    session = await getSessionSafe(await headers());
  } catch (err) {
    console.warn('[AboutPage] Session check failed, rendering as guest:', err);
  }
  const { locale } = await getServerTranslation();
  const en = locale === 'en';

  // Copy describes only what the product does today; edit freely.
  const points = en
    ? [
        ['One key, many models', 'Claude, DeepSeek, Qwen, Kimi and more behind one OpenAI-compatible endpoint. Change the model name, keep your code.'],
        ['Pay for what you use', 'Prepaid credits, no subscription. Top up with QRIS or PayPal and see every request’s cost in your dashboard.'],
        ['Built for developers in Indonesia', 'Rupiah pricing, local payment methods and support during WIB working hours.'],
      ]
    : [
        ['Satu key, banyak model', 'Claude, DeepSeek, Qwen, Kimi, dan lainnya lewat satu endpoint yang kompatibel dengan OpenAI. Ganti nama model, kodenya tetap.'],
        ['Bayar sesuai pakai', 'Kredit prabayar, tanpa langganan. Isi lewat QRIS atau PayPal, dan lihat biaya tiap request di dashboard.'],
        ['Dibuat untuk developer Indonesia', 'Harga Rupiah, metode bayar lokal, dan support di jam kerja WIB.'],
      ];

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <section className="px-4 sm:px-6 pt-28 pb-20 sm:pt-36 sm:pb-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-3 text-sm font-medium text-neutral-600">{en ? 'About us' : 'Tentang kami'}</p>
          <h1 className="max-w-3xl font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 text-balance">
            {en ? 'Morphic is the AI gateway we wanted to use ourselves.' : 'Morphic adalah AI gateway yang ingin kami pakai sendiri.'}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-700">
            {en
              ? 'Paying for several AI providers in dollars, each with its own key and dashboard, is a hassle for teams in Indonesia. Morphic puts them behind one key and one balance.'
              : 'Bayar beberapa provider AI dalam dolar, masing-masing dengan key dan dashboard sendiri, itu merepotkan untuk tim di Indonesia. Morphic menyatukannya dalam satu key dan satu saldo.'}
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {points.map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-neutral-300 bg-white p-6">
                <h2 className="font-heading text-lg font-bold text-neutral-950">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-neutral-300 bg-white p-6 sm:p-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h2 className="font-heading text-xl font-bold text-neutral-950">{en ? 'Talk to us' : 'Hubungi kami'}</h2>
              <dl className="mt-4 grid gap-2 text-sm text-neutral-800">
                <div><dt className="inline font-medium text-neutral-950">Email: </dt><dd className="inline"><a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">{SUPPORT_EMAIL}</a></dd></div>
                <div><dt className="inline font-medium text-neutral-950">{en ? 'Phone' : 'Telepon'}: </dt><dd className="inline">{SUPPORT_PHONE}</dd></div>
                <div><dt className="inline font-medium text-neutral-950">{en ? 'Address' : 'Alamat'}: </dt><dd className="inline">{SUPPORT_ADDRESS}</dd></div>
              </dl>
            </div>
            <Link href={session ? '/dashboard' : '/login'} className="inline-flex h-11 items-center justify-center rounded-full bg-neutral-950 px-6 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2">
              {session ? (en ? 'Go to dashboard' : 'Ke dashboard') : en ? 'Get started' : 'Mulai sekarang'}
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
