export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getServerTranslation } from '@/lib/i18n/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Ketentuan Layanan | Morphic AI Gateway',
  description: 'Ketentuan dan syarat penggunaan layanan gateway API AI Morphic untuk developer.',
};

export default async function TermsPage() {
  let session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.warn('[Terms] Session check failed:', err);
  }

  const { locale } = await getServerTranslation();
  const isEn = locale === 'en';

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-hidden">
      <Navbar session={session} />

      <section className="pt-36 sm:pt-44 pb-20 px-4 sm:px-6 max-w-4xl mx-auto w-full">
        <div className="mb-10 text-center sm:text-left">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-2">
            LEGAL & COMPLIANCE
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 font-heading mb-4">
            {isEn ? 'Terms of Service' : 'Ketentuan Layanan'}
          </h1>
          <p className="text-sm text-neutral-500 font-mono">
            {isEn ? 'Last updated: September 20, 2026' : 'Terakhir diperbarui: 20 September 2026'}
          </p>
        </div>

        <div className="bg-white border border-neutral-200/90 rounded-3xl p-6 sm:p-10 shadow-xs space-y-8 text-neutral-700 text-sm sm:text-base leading-relaxed">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '1. Description of Service' : '1. Deskripsi Layanan'}
            </h2>
            <p>
              {isEn
                ? 'Morphic provides an OpenAI-compatible API reverse-proxy gateway enabling software developers to access multiple third-party AI models (including Anthropic, DeepSeek, Qwen, and Moonshot). Token consumption is billed on a pay-as-you-go credit balance basis.'
                : 'Morphic menyediakan layanan gateway proksi API yang kompatibel dengan format OpenAI untuk memfasilitasi akses pengembang terhadap berbagai model kecerdasan buatan pihak ketiga (termasuk Anthropic, DeepSeek, Qwen, dan Moonshot). Pembayaran saldo kredit dihitung berdasarkan kuota penggunaan token.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '2. Accounts and API Keys' : '2. Akun dan Kunci API'}
            </h2>
            <p>
              {isEn
                ? 'Users maintain full responsibility for securing API keys issued through their dashboard. Any inferences requested with your credentials will deduct credits from your account balance. You may revoke API keys at any time.'
                : 'Pengguna bertanggung jawab penuh menjaga kerahasiaan Kunci API (API Key) yang diterbitkan melalui dashboard. Segala pemanggilan inferensi yang terjadi menggunakan kunci milik pengguna akan memotong saldo akun terkait. Pengguna dapat mencabut (revoke) kunci API kapan saja.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '3. Balance, Credit Packages, and Refunds' : '3. Saldo, Paket Kredit, dan Pengembalian Dana'}
            </h2>
            <p>
              {isEn
                ? 'Credit package purchases are processed instantly via the Indonesian national QRIS payment system in IDR. Purchased credits are prepaid and non-refundable, except in the event of persistent system outages directly attributable to Morphic.'
                : 'Pembelian kuota kredit diproses secara instan melalui sistem pembayaran lokal QRIS dalam mata uang Rupiah. Saldo yang telah dikreditkan ke akun bersifat prabayar dan tidak dapat ditarik kembali (non-refundable), kecuali terjadi kegagalan sistematis penyediaan layanan dari pihak Morphic.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '4. Acceptable Use Policy' : '4. Kebijakan Penggunaan Wajar'}
            </h2>
            <p>
              {isEn
                ? 'You agree not to use the API gateway to generate unlawful content, conduct unauthorized penetration attacks, bypass rate limits, or engage in automated abuse against upstream providers.'
                : 'Pengguna dilarang memanfaatkan gateway ini untuk memproduksi konten yang melanggar hukum, melakukan eksploitasi serangan siber, memanipulasi kuota, atau melanggar ketentuan kebijakan dari penyedia upstream.'}
            </p>
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-3">
              {isEn ? '5. Service Availability and Limitation of Liability' : '5. Batasan Tanggung Jawab & Ketersediaan Layanan'}
            </h2>
            <p>
              {isEn
                ? 'While Morphic leverages multi-provider automated fallback to maintain maximum uptime, services are provided "as-is". Morphic shall not be held liable for indirect damages or business losses stemming from upstream AI model disruptions.'
                : 'Morphic berupaya optimal menjaga ketersediaan layanan dengan sistem failover multi-provider. Namun, layanan disediakan "apa adanya" (as-is), dan Morphic tidak bertanggung jawab atas kerugian tidak langsung akibat gangguan jaringan upstream pihak ketiga.'}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
