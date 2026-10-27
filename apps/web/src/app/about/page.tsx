export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { getSessionSafe } from '@/lib/auth';
import { getServerTranslation } from '@/lib/i18n/server';
import { memo } from '@/lib/memo';
import type { SnapshotModel } from '@/lib/model-catalog';
import snapshot from '@/data/model-catalog.json';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AboutView, { type AboutCopy } from './about-view';
import { SUPPORT_EMAIL } from '@/lib/contact';

export const metadata = {
  title: 'About Us | Morphic AI Gateway',
  description: 'Morphic is an OpenAI-compatible AI gateway with Rupiah top-ups, built by Mirracle.',
};

const LINKEDIN_URL = 'https://www.linkedin.com/company/143706990/';
const GITHUB_URL = 'https://github.com/Mirracle-labs';

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

  const cta = session ? '/dashboard' : '/login';
  const ctaLabel = session ? (en ? 'Open your dashboard' : 'Buka dashboard') : en ? 'Create your API key' : 'Buat API key kamu';

  const copy: AboutCopy = {
    heroBy: en ? 'An AI gateway by Mirracle.' : 'AI gateway buatan Mirracle.',
    heroSub: en
      ? 'This page is about the people behind it, and why they built it.'
      : 'Halaman ini soal orang-orang di baliknya, dan kenapa mereka membuatnya.',
    scrollHint: en ? 'Scroll' : 'Gulir',
    reveal: en
      ? 'Mirracle is an Indonesian team that builds tools for builders. Morphic is the one we needed most.'
      : 'Mirracle adalah tim Indonesia yang membuat alat untuk para pembuat. Morphic adalah yang paling kami butuhkan.',
    originLabel: en ? 'Where Morphic comes from' : 'Asal Morphic',
    originTitle: en ? 'We built it for ourselves first.' : 'Awalnya kami buat untuk diri sendiri.',
    originBody: en
      ? [
          'Every new model meant a new account, a new key, a new bill in dollars, and a credit card that half our friends did not have.',
          'At Mirracle we kept rewriting the same glue code for each lab, and kept losing track of what each experiment cost. So we put it all behind one gateway that we run and pay for in Rupiah.',
          'It worked well enough that we opened it up. Morphic is that gateway, now for anyone building with AI from Indonesia.',
        ]
      : [
          'Tiap model baru berarti akun baru, key baru, tagihan baru dalam dolar, dan kartu kredit yang setengah teman kami tidak punya.',
          'Di Mirracle kami terus menulis ulang kode penghubung yang sama untuk tiap lab, dan selalu lupa berapa biaya tiap eksperimen. Jadi semuanya kami taruh di balik satu gateway yang kami jalankan sendiri dan dibayar pakai Rupiah.',
          'Ternyata cukup berguna sampai kami buka untuk umum. Morphic adalah gateway itu, sekarang untuk siapa pun yang membangun dengan AI dari Indonesia.',
        ],
    factsLabel: en ? 'Morphic today' : 'Morphic hari ini',
    facts,
    visionLabel: en ? 'Vision' : 'Visi',
    vision: en
      ? 'A developer in Indonesia should reach the best AI in the world as easily as a developer anywhere else.'
      : 'Developer di Indonesia harus bisa memakai AI terbaik dunia semudah developer di mana pun.',
    missionLabel: en ? 'Mission' : 'Misi',
    mission: en
      ? [
          ['Remove the card wall.', 'Local payment, small top-ups, no subscription. Nobody should need a foreign credit card to try a model.'],
          ['Never lock you in.', 'Morphic speaks the format your code already uses. Leaving us should take the same one-line change as joining.'],
          ['Keep the price in plain sight.', 'Rates are public before you call, and every call shows what it cost after. No surprises at the end of the month.'],
        ]
      : [
          ['Hapus tembok kartu kredit.', 'Pembayaran lokal, top-up kecil, tanpa langganan. Tidak ada yang perlu kartu kredit luar negeri untuk mencoba model.'],
          ['Tidak mengunci kamu.', 'Morphic memakai format yang sudah dipakai kode kamu. Pergi dari kami cukup satu baris, sama seperti saat datang.'],
          ['Harga selalu terlihat.', 'Tarif terbuka sebelum kamu memanggil, dan tiap panggilan menunjukkan biayanya sesudahnya. Tidak ada kejutan di akhir bulan.'],
        ],
    valuesLabel: en ? 'How Mirracle works' : 'Cara Mirracle bekerja',
    values: en
      ? [
          ['Use it daily.', 'We build on Morphic ourselves, so we feel every slow route and confusing screen first.'],
          ['Small, then solid.', 'We ship the plain version, watch how it is used, and only then add more.'],
          ['Reply like people.', 'Emails reach the team that wrote the code, not a ticket queue.'],
        ]
      : [
          ['Dipakai tiap hari.', 'Kami sendiri membangun di atas Morphic, jadi kami yang pertama merasakan rute lambat dan layar membingungkan.'],
          ['Kecil dulu, lalu kokoh.', 'Kami rilis versi sederhana, lihat cara dipakainya, baru kemudian menambah.'],
          ['Balas seperti manusia.', 'Email langsung sampai ke tim yang menulis kodenya, bukan antrean tiket.'],
        ],
    builtBy: en ? 'Morphic, by Mirracle.' : 'Morphic, oleh Mirracle.',
    builtBody: en ? 'Tell us what you are building. We read every email.' : 'Ceritakan apa yang sedang kamu bangun. Setiap email kami baca.',
    cta: { href: cta, label: ctaLabel },
    email: SUPPORT_EMAIL,
    linkedin: LINKEDIN_URL,
    github: GITHUB_URL,
  };
  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <AboutView copy={copy} />
      <Footer />
    </main>
  );
}
