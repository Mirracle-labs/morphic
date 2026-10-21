export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { Mail } from 'lucide-react';
import { db, schema as s } from '@morphic/db';
import { getSessionSafe } from '@/lib/auth';
import { getServerTranslation } from '@/lib/i18n/server';
import { memo } from '@/lib/memo';
import { API_BASE_URL } from '@/lib/utils';
import type { SnapshotModel } from '@/lib/model-catalog';
import snapshot from '@/data/model-catalog.json';
import Navbar from '@/components/Navbar';
import GitHubIcon from '@/components/icons/GitHubIcon';
import LinkedInIcon from '@/components/icons/LinkedInIcon';
import Footer from '@/components/Footer';
import { SUPPORT_ADDRESS, SUPPORT_EMAIL, SUPPORT_HOURS, SUPPORT_PHONE } from '@/lib/contact';

export const metadata = {
  title: 'About Us | Morphic AI Gateway',
  description: 'Morphic is an OpenAI-compatible AI gateway with credit billing and local QRIS top-ups, built in Bogor, Indonesia.',
};

const LINKEDIN_URL = 'https://www.linkedin.com/company/143706990/';
const GITHUB_URL = 'https://github.com/Mirracle-labs';
const WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE.replace(/[^0-9+]/g, '').replace(/^08/, '628').replace(/^\+/, '')}`;
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';

const catalog = snapshot.models as SnapshotModel[];

/** Active models we route right now; null when the DB is unreachable, so the cell is left out rather than guessed. */
const liveCount = () =>
  memo('about:live-models', 60_000, async () => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(s.models).where(eq(s.models.status, 'active'));
    return Number(row?.n ?? 0);
  }).catch((err) => {
    console.warn('[AboutPage] Live model count failed:', err);
    return null;
  });

export default async function AboutPage() {
  const [session, live, { locale }] = await Promise.all([
    headers()
      .then((h) => getSessionSafe(h))
      .catch((err) => {
        console.warn('[AboutPage] Session check failed, rendering as guest:', err);
        return null;
      }),
    liveCount(),
    getServerTranslation(),
  ]);
  const en = locale === 'en';

  const makers = new Set(catalog.map((m) => m.maker)).size;
  const providers = new Set(catalog.flatMap((m) => m.providers.map((p) => p.name))).size;
  const facts: [string, string][] = [
    [String(catalog.length), en ? 'models in the public catalog' : 'model di katalog publik'],
    ...(live === null ? [] : [[String(live), en ? 'live on Morphic today' : 'aktif di Morphic hari ini'] as [string, string]]),
    [String(makers), en ? 'model makers listed' : 'pembuat model terdaftar'],
    [String(providers), en ? 'upstream providers tracked' : 'provider upstream dipantau'],
  ];

  const compare: [string, string][] = en
    ? [
        ['A separate key for every provider', 'One Morphic key for every model'],
        ['A dashboard and invoice per provider, billed in dollars', 'One credit balance, topped up in Rupiah with QRIS or PayPal'],
        ['A different SDK shape for each vendor', 'The OpenAI request format, everywhere'],
        ['Guessing what each call cost', 'The cost of every request in your logs'],
      ]
    : [
        ['Key terpisah untuk tiap provider', 'Satu key Morphic untuk semua model'],
        ['Dashboard dan tagihan per provider, dalam dolar', 'Satu saldo kredit, top-up Rupiah lewat QRIS atau PayPal'],
        ['Format SDK beda untuk tiap vendor', 'Format request OpenAI, di mana saja'],
        ['Menebak biaya tiap panggilan', 'Biaya tiap request tercatat di log kamu'],
      ];

  const principles: [string, string][] = en
    ? [
        ['Prepaid, no subscription', 'You buy credits and spend them per request. Nothing renews on its own.'],
        ['Real numbers or none', 'Token counts, uptime and latency on our model pages come from traffic through Morphic. A model with no traffic shows an empty chart, not a borrowed figure.'],
        ['Built and supported from Bogor', `Rupiah pricing, local payment methods, and a team you can reach during WIB working hours.`],
      ]
    : [
        ['Prabayar, tanpa langganan', 'Kamu beli kredit dan memakainya per request. Tidak ada perpanjangan otomatis.'],
        ['Angka asli atau tidak sama sekali', 'Jumlah token, uptime, dan latensi di halaman model berasal dari trafik lewat Morphic. Model tanpa trafik menampilkan grafik kosong, bukan angka pinjaman.'],
        ['Dibuat dan di-support dari Bogor', 'Harga Rupiah, metode bayar lokal, dan tim yang bisa dihubungi di jam kerja WIB.'],
      ];

  const code = `import os
from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}",
    api_key=os.environ["MORPHIC_API_KEY"],
)

client.chat.completions.create(
    model="deepseek-v4",  # ${en ? 'swap for any model id' : 'ganti dengan id model mana pun'}
    messages=[{"role": "user", "content": "Halo"}],
)`;

  const cta = session ? '/dashboard' : '/login';
  const ctaLabel = session ? (en ? 'Open your dashboard' : 'Buka dashboard') : en ? 'Create your API key' : 'Buat API key kamu';

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />

      <div className="px-4 sm:px-6 pt-28 pb-20 sm:pt-36 sm:pb-28">
        <div className="mx-auto max-w-6xl">
          {/* Hero: the one focal point is the headline; the brand mark carries identity on the right. */}
          <section className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-neutral-950 text-balance">
                {en ? 'The AI gateway we wanted to use ourselves.' : 'AI gateway yang ingin kami pakai sendiri.'}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-700">
                {en
                  ? 'Paying several AI providers in dollars, each with its own key and dashboard, slows Indonesian teams down. Morphic puts those models behind one key, one balance and one request format.'
                  : 'Membayar beberapa provider AI dalam dolar, masing-masing dengan key dan dashboard sendiri, memperlambat tim di Indonesia. Morphic menaruh model-model itu di balik satu key, satu saldo, dan satu format request.'}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={cta} className={`inline-flex h-12 items-center rounded-full bg-neutral-950 px-6 text-sm font-semibold text-white hover:bg-neutral-800 ${focusRing}`}>
                  {ctaLabel}
                </Link>
                <Link href="/models" className={`inline-flex h-12 items-center rounded-full border border-neutral-300 bg-white px-6 text-sm font-semibold text-neutral-950 hover:border-neutral-950 ${focusRing}`}>
                  {en ? 'Browse the models' : 'Lihat daftar model'}
                </Link>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-3xl bg-neutral-950 aspect-[4/3] lg:aspect-square">
              <Image src="/morphic-symbol.jpg" alt="" fill priority sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent px-5 pb-5 pt-16 sm:px-6 sm:pb-6">
                <p className="text-sm text-neutral-300">{en ? 'Every model, one endpoint' : 'Semua model, satu endpoint'}</p>
                <p className="mt-1 break-all font-mono text-sm text-white">{API_BASE_URL}</p>
              </div>
            </div>
          </section>

          {/* Facts: computed from the catalog file and our DB on every render. */}
          <section aria-label={en ? 'Morphic in numbers' : 'Morphic dalam angka'} className="mt-20 overflow-clip rounded-2xl border border-neutral-300 bg-white">
            <dl className={`-mb-px -mr-px grid grid-cols-2 ${facts.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
              {facts.map(([n, label]) => (
                <div key={label} className="border-b border-r border-neutral-200 px-5 py-6 sm:px-6 sm:py-7">
                  <dt className="sr-only">{label}</dt>
                  <dd>
                    <span className="block font-heading text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-950 tabular-nums">{n}</span>
                    <span className="mt-2 block text-sm text-neutral-700">{label}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-neutral-200 px-5 py-3 text-xs text-neutral-600 sm:px-6">
              {en ? 'Counted from ' : 'Dihitung dari '}
              <Link href="/models" className={`underline underline-offset-2 hover:text-neutral-950 rounded ${focusRing}`}>
                {en ? 'our model catalog' : 'katalog model kami'}
              </Link>
              {en ? ' and the models our gateway routes right now.' : ' dan model yang sedang dilayani gateway kami.'}
            </p>
          </section>

          {/* Before / after: the problem and the answer side by side, one row per pain. */}
          <section className="mt-28">
            <h2 className="max-w-2xl font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950 text-balance">
              {en ? 'What changes when you route through Morphic' : 'Apa yang berubah saat lewat Morphic'}
            </h2>
            <div className="mt-8 overflow-clip rounded-2xl border border-neutral-300 bg-white">
              <div className="hidden sm:grid grid-cols-2 border-b border-neutral-300 bg-neutral-50 text-sm font-semibold">
                <div className="px-6 py-3 text-neutral-700">{en ? 'Calling providers directly' : 'Langsung ke provider'}</div>
                <div className="border-l border-neutral-300 px-6 py-3 text-neutral-950">{en ? 'Through Morphic' : 'Lewat Morphic'}</div>
              </div>
              <ul className="divide-y divide-neutral-200">
                {compare.map(([before, after]) => (
                  <li key={before} className="grid sm:grid-cols-2">
                    <p className="px-5 pt-5 text-sm text-neutral-600 line-through decoration-neutral-400 sm:px-6 sm:py-5 sm:text-base">{before}</p>
                    <p className="px-5 pb-5 pt-1.5 font-semibold text-neutral-950 sm:border-l sm:border-neutral-200 sm:px-6 sm:py-5">{after}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* One line of code: the claim "keep your code" shown, not told. */}
          <section className="mt-28 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950 text-balance">
                {en ? 'Keep your code. Change the base URL.' : 'Kodenya tetap. Ganti base URL saja.'}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-neutral-700">
                {en
                  ? 'Morphic speaks the OpenAI format, so the SDK you already use works as is. Point it at our endpoint, then switch models by changing one string.'
                  : 'Morphic memakai format OpenAI, jadi SDK yang sudah kamu pakai langsung jalan. Arahkan ke endpoint kami, lalu ganti model cukup dengan mengubah satu string.'}
              </p>
              <Link href="/docs" className={`mt-6 inline-flex text-sm font-semibold text-neutral-950 underline underline-offset-4 hover:no-underline rounded ${focusRing}`}>
                {en ? 'Read the quickstart' : 'Baca panduan mulai'}
              </Link>
            </div>
            <pre className="overflow-x-auto rounded-2xl bg-neutral-950 p-5 sm:p-6 text-[13px] leading-relaxed text-neutral-100">
              <code>{code}</code>
            </pre>
          </section>

          {/* How we work: numbered rows on the same hairline system as the catalog. */}
          <section className="mt-28">
            <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">{en ? 'How we run it' : 'Cara kami menjalankannya'}</h2>
            <ol className="mt-8 border-t border-neutral-300">
              {principles.map(([title, body], i) => (
                <li key={title} className="grid gap-2 border-b border-neutral-300 py-7 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-8">
                  <span className="font-mono text-sm text-neutral-600">0{i + 1}</span>
                  <h3 className="font-heading text-xl font-bold text-neutral-950">{title}</h3>
                  <p className="text-base leading-relaxed text-neutral-700">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Contact: every line is a real channel. */}
          <section className="mt-28 overflow-clip rounded-3xl bg-neutral-950 text-white">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="p-7 sm:p-10">
                <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-balance">
                  {en ? 'Questions before you top up? Ask us.' : 'Ada pertanyaan sebelum top-up? Tanya kami.'}
                </h2>
                <p className="mt-4 max-w-md text-base leading-relaxed text-neutral-300">
                  {en ? `We answer email and phone ${SUPPORT_HOURS.replace('Senin - Jumat', 'Monday to Friday')}.` : `Kami menjawab email dan telepon ${SUPPORT_HOURS}.`}
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href={cta} className="inline-flex h-12 items-center rounded-full bg-white px-6 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950">
                    {ctaLabel}
                  </Link>
                  <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="w-12 h-12 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-200 hover:text-white hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    <LinkedInIcon className="h-5 w-5" />
                  </a>
                  <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="w-12 h-12 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-200 hover:text-white hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    <GitHubIcon className="h-5 w-5" />
                  </a>
                </div>
              </div>
              <dl className="border-t border-neutral-800 lg:border-l lg:border-t-0 divide-y divide-neutral-800">
                <div className="px-7 py-5 sm:px-10">
                  <dt className="text-sm text-neutral-400">Email</dt>
                  <dd className="mt-1">
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 text-lg font-semibold underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      <Mail className="h-4 w-4 text-neutral-400" aria-hidden="true" /> {SUPPORT_EMAIL}
                    </a>
                  </dd>
                </div>
                <div className="px-7 py-5 sm:px-10">
                  <dt className="text-sm text-neutral-400">{en ? 'Phone / WhatsApp' : 'Telepon / WhatsApp'}</dt>
                  <dd className="mt-1">
                    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold tabular-nums underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      {SUPPORT_PHONE}
                    </a>
                  </dd>
                </div>
                <div className="px-7 py-5 sm:px-10">
                  <dt className="text-sm text-neutral-400">{en ? 'Office' : 'Kantor'}</dt>
                  <dd className="mt-1 text-base text-neutral-100">{SUPPORT_ADDRESS}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>

      <Footer />
    </main>
  );
}
