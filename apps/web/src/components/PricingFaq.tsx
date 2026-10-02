'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { HelpCircle, Plus } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1] as const;

interface BillingFaqItem {
  q: { id: string; en: string };
  a: { id: string; en: string };
}

const BILLING_FAQS: BillingFaqItem[] = [
  {
    q: {
      id: 'Apakah saldo kuota kredit memiliki masa kedaluwarsa?',
      en: 'Do purchased credit balances have an expiration date?',
    },
    a: {
      id: 'Tidak ada kedaluwarsa sama sekali. Saldo kredit yang Anda beli di Morphic aktif selamanya dan tidak akan pernah hangus, bahkan jika Anda tidak menggunakannya selama berbulan-bulan.',
      en: 'No expiration date whatsoever. Purchased credits in Morphic remain active forever and never expire, even if unused for months.',
    },
  },
  {
    q: {
      id: 'Metode pembayaran apa saja yang didukung oleh Morphic?',
      en: 'What payment methods are supported by Morphic?',
    },
    a: {
      id: 'Kami mendukung QRIS nasional otomatis. Anda bisa membayar menggunakan m-Banking (BCA, Mandiri, BNI, BRI, CIMB, Permata, dll) maupun dompet digital e-wallet (GoPay, OVO, Dana, ShopeePay, LinkAja). Saldo masuk otomatis dalam 3-5 detik.',
      en: 'We support instant national QRIS. Pay easily via local m-Banking (BCA, Mandiri, BNI, BRI, etc.) or popular e-wallets (GoPay, OVO, Dana, ShopeePay). Balance is credited automatically in 3-5 seconds.',
    },
  },
  {
    q: {
      id: 'Apakah ada biaya langganan bulanan atau biaya tersembunyi?',
      en: 'Are there any monthly subscription commitments or hidden fees?',
    },
    a: {
      id: 'Tidak ada biaya langganan bulanan. Sistem kami 100% Pay-As-You-Go: Anda hanya membayar saat Anda melakukan top-up kuota kredit, tanpa kartu kredit internasional dan tanpa komitmen biaya rutin.',
      en: 'No monthly subscription fees. Morphic is strictly Pay-As-You-Go: you only pay when topping up credits, without foreign credit card friction and zero recurring commitments.',
    },
  },
  {
    q: {
      id: 'Bagaimana cara kerja Pass Harian (Daily Pass)?',
      en: 'How does the 24-Hour Daily Pass work?',
    },
    a: {
      id: 'Pass Harian (mulai Rp 2.500) memberikan akses penggunaan unlimited untuk model AI pilihan Anda selama 24 jam penuh sejak waktu aktivasi. Sangat ideal untuk sesi sprint coding atau hackathon tanpa memikirkan token.',
      en: 'Daily Passes (starting from Rp 2,500) grant unlimited access to a selected AI model for a full 24-hour window from activation. Perfect for intense coding sprints or hackathons.',
    },
  },
  {
    q: {
      id: 'Apakah saya bisa mengunduh invoice resmi untuk reimburse kantor?',
      en: 'Can I download official digital invoices for corporate reimbursement?',
    },
    a: {
      id: 'Ya, setiap transaksi top-up QRIS otomatis menghasilkan invoice digital dan bukti bayar resmi lengkap dengan nomor referensi transaksi yang dapat Anda unduh dari dashboard billing kapan saja.',
      en: 'Yes, every QRIS top-up transaction automatically generates a downloadable digital invoice and receipt with transaction reference IDs from your billing dashboard.',
    },
  },
  {
    q: {
      id: 'Apa yang terjadi jika kuota kredit saya habis di tengah coding?',
      en: 'What happens if my credits run out while coding in IDE?',
    },
    a: {
      id: 'Jika saldo habis, endpoint akan merespons dengan pesan error HTTP 402 yang informatif tanpa merusak konfigurasi IDE Anda. Dashboard juga menyediakan peringatan saat saldo menyentuh batas minimum.',
      en: 'If credits deplete, the gateway returns a safe HTTP 402 status without breaking your IDE configuration. You can easily top-up via QRIS in 5 seconds to resume instantly.',
    },
  },
];

export default function PricingFaq() {
  const { locale } = useTranslation();
  const reduced = useReducedMotionSafe();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section className="relative z-10 py-16 lg:py-24 px-4 sm:px-6 bg-white border-t border-neutral-200/80">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-center max-w-3xl mx-auto mb-12 sm:mb-16"
        >
          <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
            <HelpCircle className="w-3.5 h-3.5 text-neutral-900" />
            <span>{locale === 'en' ? 'Billing & Payments' : 'Tanya Jawab Billing'}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-extrabold tracking-tight text-neutral-950">
            {locale === 'en'
              ? 'Frequently Asked Questions on Billing'
              : 'Pertanyaan Seputar Saldo & Pembayaran'}
          </h2>
          <p className="mt-4 text-neutral-600 font-body text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
            {locale === 'en'
              ? 'Everything you need to know about QRIS top-ups, credit validity, and invoicing.'
              : 'Informasi lengkap seputar masa aktif kuota, pembayaran instan QRIS, dan invoice pengeluaran.'}
          </p>
        </motion.div>

        {/* Numbered Hairline Accordion List */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
          className="rounded-3xl border border-neutral-200/90 bg-[#fafafa] p-4 sm:p-8 shadow-xs divide-y divide-neutral-200/80"
        >
          {BILLING_FAQS.map((item, idx) => {
            const isOpen = openIndex === idx;
            const question = item.q[locale] || item.q.en || item.q.id;
            const answer = item.a[locale] || item.a.en || item.a.id;

            return (
              <div key={idx} className="transition-colors">
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  aria-expanded={isOpen}
                  className="w-full py-5 sm:py-6 text-left flex items-center justify-between gap-4 sm:gap-6 cursor-pointer group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                >
                  <span className="flex items-baseline gap-3 sm:gap-4 min-w-0 pr-2">
                    <span
                      className={`font-mono text-xs sm:text-sm tabular-nums shrink-0 transition-colors ${
                        isOpen ? 'text-neutral-950 font-bold' : 'text-neutral-500 group-hover:text-neutral-700'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      suppressHydrationWarning
                      className={`font-heading text-base sm:text-lg tracking-tight transition-colors ${
                        isOpen
                          ? 'text-neutral-950 font-bold'
                          : 'text-neutral-800 font-semibold group-hover:text-neutral-950'
                      }`}
                    >
                      {question}
                    </span>
                  </span>

                  <span
                    className={`h-8 w-8 rounded-full border border-neutral-200 flex items-center justify-center shrink-0 transition-transform duration-200 bg-white ${
                      isOpen ? 'rotate-45 border-neutral-900 text-neutral-900' : 'text-neutral-500 group-hover:text-neutral-900'
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                  </span>
                </button>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div
                      suppressHydrationWarning
                      className="pb-6 pl-7 sm:pl-9 pr-4 text-xs sm:text-sm text-neutral-600 font-body leading-relaxed"
                    >
                      {answer}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
