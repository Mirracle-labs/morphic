export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getServerTranslation } from '@/lib/i18n/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Kebijakan Privasi | Morphic AI Gateway',
  description: 'Kebijakan privasi dan perlindungan data pengguna layanan Morphic AI Gateway.',
};

export default async function PrivacyPage() {
  let session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.warn('[Privacy] Session check failed:', err);
  }

  const { locale } = await getServerTranslation();
  const isEn = locale === 'en';

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-hidden">
      <Navbar session={session} />

      <section className="pt-36 sm:pt-44 pb-20 px-4 sm:px-6 max-w-4xl mx-auto w-full">
        <div className="mb-10 text-center sm:text-left">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-2">
            PRIVACY & DATA PROTECTION
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 font-heading mb-4">
            {isEn ? 'Privacy Policy' : 'Kebijakan Privasi'}
          </h1>
          <p className="text-sm text-neutral-500 font-mono">
            {isEn ? 'Last updated: September 20, 2026' : 'Terakhir diperbarui: 20 September 2026'}
          </p>
        </div>

        <div className="bg-white border border-neutral-200/90 rounded-3xl p-6 sm:p-10 shadow-xs space-y-8 text-neutral-700 text-sm sm:text-base leading-relaxed">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '1. Zero Data Retention Principle' : '1. Prinsip Zero Data Retention'}
            </h2>
            <p>
              {isEn
                ? 'Morphic strictly operates on a Zero Data Retention (ZDR) policy at the gateway level. Your prompts, chat completion contents, source code, and AI model completions are streamed directly without being logged to persistent disks, cached, or used to train AI models.'
                : 'Morphic menerapkan prinsip tanpa penyimpanan data percakapan (Zero Data Retention) pada level gateway. Isi prompt, pesan percakapan, source code, dan keluaran model AI yang dikirimkan melalui endpoint API tidak pernah dicatat (log) ke database permanen, tidak di-cache, dan tidak pernah digunakan untuk melatih model AI.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '2. Telemetry and Data Collected' : '2. Data yang Dikumpulkan'}
            </h2>
            <p>
              {isEn
                ? 'We only record minimal operational telemetry necessary for credit accounting and service diagnostics:'
                : 'Kami hanya mencatat metrik telemetri yang esensial untuk keperluan akuntansi kredit dan diagnostik koneksi:'}
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{isEn ? 'Input and output token counts for accurate credit balance deductions.' : 'Jumlah token input dan output untuk kalkulasi pemotongan saldo.'}</li>
              <li>{isEn ? 'Requested model IDs and timestamps.' : 'ID model yang dipanggil dan timestamp permintaan.'}</li>
              <li>{isEn ? 'HTTP response status codes (e.g. 200 OK, 429 Rate Limited, 500 Error).' : 'Status HTTP response (misal: 200 OK, 429 Rate Limited, 500 Error).'}</li>
              <li>{isEn ? 'Basic account credentials (authenticated email and QRIS transaction records).' : 'Informasi akun dasar (alamat email autentikasi dan riwayat transaksi QRIS).'}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '3. API Key Security' : '3. Keamanan Kunci API'}
            </h2>
            <p>
              {isEn
                ? 'Your secret API keys are stored in encrypted databases via one-way cryptographic SHA-256 hashes for authorization verification. The full key secret is presented only once upon generation.'
                : 'Kunci API rahasia Anda disimpan dalam database dengan enkripsi kriptografis satu arah (hash SHA-256) untuk verifikasi autentikasi. Kunci API hanya ditampilkan secara lengkap kepada Anda saat proses pembuatan awal.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '4. Third Parties & Payment Processing' : '4. Pihak Ketiga & Pemrosesan Pembayaran'}
            </h2>
            <p>
              {isEn
                ? 'IDR credit top-ups are processed via licensed payment gateways (Duitku / QRIS). We never retain or access your personal banking credentials or card numbers.'
                : 'Transaksi pengisian saldo Rupiah diproses melalui gerbang pembayaran terlisensi (Duitku / QRIS). Kami tidak pernah menyimpan data rekening bank atau informasi kartu kredit pribadi Anda.'}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

