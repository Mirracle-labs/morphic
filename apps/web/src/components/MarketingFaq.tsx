'use client';

import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const FAQS = [
  {
    q: 'Mengapa saya membutuhkan API Key reseller dari Morphic?',
    a: 'Sebagian besar provider AI resmi (OpenAI, DeepSeek, Moonshot) mewajibkan kartu kredit internasional dengan kurs USD dan rate-limit yang ketat. Morphic menjembatani hal ini dengan menyediakan pembayaran lokal QRIS (Rupiah), endpoint tunggal OpenAI-compatible, rate limit tinggi untuk coding agent, serta sistem saldo gabungan (Unified Credits).',
  },
  {
    q: 'Bagaimana cara menggunakan API Key di Cursor atau Cline?',
    a: 'Sangat mudah! Di pengaturan Cursor atau ekstensi Cline, pilih provider "OpenAI Compatible", ubah Base URL menjadi https://api.morphic.xxx/v1, dan masukkan API Key Morphic (mp-xxxx) Anda. Semua request langsung diteruskan ke model AI pilihan Anda.',
  },
  {
    q: 'Apakah pembayaran mendukung QRIS instan?',
    a: 'Ya, 100% otomatis dan instan. Anda dapat membayar menggunakan GoPay, OVO, Dana, ShopeePay, BCA Mobile, Livin Mandiri, atau aplikasi e-wallet dan mobile banking apa pun yang mendukung QRIS. Kredit langsung aktif hitungan detik.',
  },
  {
    q: 'Apakah kredit yang saya beli memiliki batas kedaluwarsa?',
    a: 'Paket kredit standar berlaku 30 hari dan masa aktif akan diakumulasi/diperpanjang otomatis setiap kali Anda melakukan top-up paket baru. Tidak ada saldo yang hangus sia-sia jika Anda aktif menggunakannya.',
  },
  {
    q: 'Apakah kode dan data prompt saya aman dan privat?',
    a: 'Morphic beroperasi sebagai proxy gateway berperforma tinggi tanpa menyimpan atau melatih ulang data prompt Anda ke pihak ketiga mana pun. Kunci API Anda dienkripsi secara aman dan Anda memiliki kendali penuh untuk me-revoke (mencabut) API Key kapan saja via dashboard.',
  },
  {
    q: 'Berapa banyak API Key yang bisa saya buat?',
    a: 'Anda bisa membuat banyak API Key tanpa batas tambahan melalui menu API Keys di Dashboard. Setiap key dapat diberi nama label spesifik (misal: "Cursor Work", "Cline Laptop", "Production API") agar pemakaiannya terlacak rapi.',
  },
];

export default function MarketingFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="relative z-10 py-24 px-4 sm:px-6 bg-white text-neutral-900 border-t border-neutral-200/80 content-deferred">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <HelpCircle className="h-3.5 w-3.5 text-neutral-900" />
            <span>Tanya Jawab Seputar Layanan</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            Pertanyaan yang Sering Diajukan
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base">
            Segala hal yang perlu Anda ketahui tentang kemudahan, keamanan, dan keunggulan API Key Morphic.
          </p>
        </div>

        {/* Accordion list */}
        <div className="space-y-4">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 overflow-hidden transition-all duration-200 hover:border-neutral-300"
              >
                <button
                  onClick={() => toggle(idx)}
                  className="w-full p-6 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/50 cursor-pointer transition-colors"
                >
                  <span className="font-heading font-bold text-base md:text-lg text-neutral-950">
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-neutral-500 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-neutral-950' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-6 pb-6 text-xs md:text-sm text-neutral-600 font-body leading-relaxed border-t border-neutral-200/60 pt-4 bg-white">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
