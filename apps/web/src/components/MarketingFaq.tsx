'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { API_BASE_URL } from '@/lib/utils';
import { Plus } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1] as const;

interface FaqItem {
  q: { id: string; en: string };
  a: { id: string; en: string };
}

const FAQS: FaqItem[] = [
  {
    q: { id: 'Kenapa pakai Morphic, bukan langsung ke provider?', en: 'Why Morphic instead of going to each provider?' },
    a: {
      id: 'Provider resmi biasanya minta kartu kredit internasional dan bayar dalam USD. Di Morphic Anda top up Rupiah via QRIS, pakai satu key untuk semua model, dan cek satu saldo saja.',
      en: 'Official providers usually want an international card and bill in USD. With Morphic you top up in Rupiah with QRIS, use one key for every model, and track a single balance.',
    },
  },
  {
    q: { id: 'Bagaimana cara pasang di Cursor atau Cline?', en: 'How do I set it up in Cursor or Cline?' },
    a: {
      id: `Pilih provider "OpenAI Compatible", isi Base URL dengan ${API_BASE_URL}, lalu tempel API key Morphic Anda (mp-...). Selesai.`,
      en: `Choose the "OpenAI Compatible" provider, set the Base URL to ${API_BASE_URL}, and paste your Morphic API key (mp-...). That's it.`,
    },
  },
  {
    q: { id: 'Bayar pakai apa? Berapa lama saldo masuk?', en: 'How do I pay, and how fast do credits arrive?' },
    a: {
      id: 'Scan QRIS dari GoPay, OVO, Dana, ShopeePay, BCA, Mandiri, atau m-banking lain. Pembayaran terkonfirmasi otomatis dan saldo masuk dalam hitungan detik.',
      en: 'Scan the QRIS code with GoPay, OVO, Dana, ShopeePay, BCA, Mandiri or any banking app. Payment confirms automatically and credits land in seconds.',
    },
  },
  {
    q: { id: 'Apakah kode dan prompt saya disimpan?', en: 'Do you store my code or prompts?' },
    a: {
      id: 'Tidak. Request diteruskan ke provider tanpa disimpan dan tidak dipakai untuk melatih model. API key dienkripsi, dan Anda bisa revoke key kapan saja dari dashboard.',
      en: 'No. Requests pass through to the provider without being stored or used for training. API keys are encrypted, and you can revoke any key from the dashboard.',
    },
  },
  {
    q: { id: 'Berapa banyak API key yang bisa dibuat?', en: 'How many API keys can I create?' },
    a: {
      id: 'Paket Starter Dev sampai 3 key. Paket Pro Agent ke atas tanpa batas. Beri label tiap key, misalnya "Cursor" atau "Production", supaya mudah dilacak.',
      en: 'Starter Dev allows up to 3 keys. Pro Agent and above are unlimited. Label each one, say "Cursor" or "Production", so usage stays easy to track.',
    },
  },
];

export default function MarketingFaq() {
  const { locale, t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduced = useReducedMotionSafe();

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="relative z-10 py-14 lg:py-20 px-6 bg-[#fafafa] text-neutral-900 border-t border-neutral-200/70 scroll-mt-20 sm:scroll-mt-24">
      <div className="max-w-6xl mx-auto grid gap-12 lg:grid-cols-[0.7fr_1.3fr] items-start">
        {/* Left Column: Sticky Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="lg:sticky lg:top-32 lg:self-start"
        >
          <div className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
            {t.faq.badge}
          </div>

          <h2 suppressHydrationWarning className="text-4xl sm:text-5xl lg:text-6xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            {t.faq.title}
          </h2>

          <p suppressHydrationWarning className="text-neutral-600 font-body text-base sm:text-lg leading-relaxed max-w-sm">
            {t.faq.desc}
          </p>
        </motion.div>

        {/* Right Column: Numbered Hairline Accordion List */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
          className="border-t border-neutral-200 divide-y divide-neutral-200"
        >
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;
            const question = faq.q[locale] || faq.q.en || faq.q.id;
            const answer = faq.a[locale] || faq.a.en || faq.a.id;

            return (
              <div
                key={idx}
                className="transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  aria-expanded={isOpen}
                  className="w-full py-6 sm:py-7 text-left flex items-center justify-between gap-6 cursor-pointer group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                >
                  <span className="flex items-baseline gap-4 min-w-0 pr-2">
                    <span className={`font-mono text-sm tabular-nums shrink-0 transition-colors ${isOpen ? 'text-neutral-950 font-bold' : 'text-neutral-500 group-hover:text-neutral-700'}`}>
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span suppressHydrationWarning className={`font-heading text-lg sm:text-xl tracking-tight transition-colors ${
                      isOpen ? 'text-neutral-950 font-bold' : 'text-neutral-800 font-semibold group-hover:text-neutral-950'
                    }`}>
                      {question}
                    </span>
                  </span>

                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                    isOpen
                      ? 'border-neutral-950 bg-neutral-950 text-white rotate-45 shadow-xs'
                      : 'border-neutral-200 bg-white text-neutral-500 group-hover:border-neutral-400 group-hover:text-neutral-900'
                  }`}>
                    <Plus className="h-4.5 w-4.5" />
                  </span>
                </button>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div suppressHydrationWarning className="pb-7 pl-8 pr-4 text-sm sm:text-base text-neutral-600 font-body leading-relaxed">
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
