'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { Check, Minus, TableProperties, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

const EASE = [0.16, 1, 0.3, 1] as const;

interface FeatureRow {
  name: string;
  tooltip?: string;
  starter: string | boolean;
  pro: string | boolean;
  ultra: string | boolean;
}

interface FeatureCategory {
  category: string;
  rows: FeatureRow[];
}

export default function PricingComparisonTable({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const { locale } = useTranslation();
  const reduced = useReducedMotionSafe();

  const matrix: FeatureCategory[] = [
    {
      category: locale === 'en' ? 'Throughput & Capacity Limits' : 'Batas Throughput & Kapasitas',
      rows: [
        {
          name: locale === 'en' ? 'Rate Limit (Requests / Min)' : 'Batas Panggilan (RPM)',
          starter: '60 RPM',
          pro: '120 RPM',
          ultra: '180 RPM',
        },
        {
          name: locale === 'en' ? 'Token Throughput (TPM)' : 'Batas Token per Menit (TPM)',
          starter: '100K TPM',
          pro: '250K TPM',
          ultra: '500K TPM',
        },
        {
          name: locale === 'en' ? 'Max Concurrent Streams' : 'Koneksi Stream Simultan',
          starter: '3 Streams',
          pro: '8 Streams',
          ultra: '20 Streams',
        },
        {
          name: locale === 'en' ? 'Median Upstream Latency' : 'Median Latensi Routing',
          starter: '< 150ms',
          pro: '< 145ms',
          ultra: '< 140ms (Priority Queue)',
        },
      ],
    },
    {
      category: locale === 'en' ? 'AI Model Catalog Access' : 'Akses Katalog Model AI',
      rows: [
        {
          name: 'Claude 3.5 Sonnet & Haiku',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: 'DeepSeek V4 Coder',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: 'Qwen 2.5 Max (128K Context)',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: 'Kimi K1.5 Preview',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'Experimental & Preview Routes' : 'Rute Eksperimental & Preview',
          starter: false,
          pro: true,
          ultra: true,
        },
      ],
    },
    {
      category: locale === 'en' ? 'Developer Experience & Tooling' : 'Fitur Integrasi & Developer Tools',
      rows: [
        {
          name: locale === 'en' ? 'Active API Keys' : 'Jumlah Kunci API Aktif',
          starter: '2 Keys',
          pro: '10 Keys',
          ultra: 'Unlimited Keys',
        },
        {
          name: locale === 'en' ? 'Custom Key Labeling (Cursor, Prod)' : 'Label Kunci Khusus (Cursor, Prod)',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'OpenAI Format Drop-in (/v1)' : 'Format Standar OpenAI SDK (/v1)',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'SSE Streaming & Tool Calls' : 'Dukungan Streaming & Tool Calls',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'Automatic Cluster Failover' : 'Failover Otomatis (Zero Drop)',
          starter: true,
          pro: true,
          ultra: true,
        },
      ],
    },
    {
      category: locale === 'en' ? 'Security & Privacy Compliance' : 'Keamanan & Privasi Data',
      rows: [
        {
          name: locale === 'en' ? 'Zero Data Retention (No Training)' : 'Zero Data Retention (Data Tidak Di-training)',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'API Key Encryption Standard' : 'Standar Enkripsi Kunci Rahasia',
          starter: 'AES-256',
          pro: 'AES-256',
          ultra: 'AES-256',
        },
        {
          name: locale === 'en' ? 'Request Activity Log History' : 'Riwayat Log Aktivitas Request',
          starter: '7 Hari',
          pro: '30 Hari',
          ultra: '90 Hari',
        },
      ],
    },
    {
      category: locale === 'en' ? 'Billing & Support Service' : 'Ketentuan Billing & Layanan Dukungan',
      rows: [
        {
          name: locale === 'en' ? 'Instant QRIS Settlement (GoPay, BCA)' : 'Pembayaran QRIS Instan (BCA, GoPay, dll)',
          starter: true,
          pro: true,
          ultra: true,
        },
        {
          name: locale === 'en' ? 'Credit Balance Expiration' : 'Masa Berlaku Saldo Kuota',
          starter: 'Selamanya',
          pro: 'Selamanya',
          ultra: 'Selamanya',
        },
        {
          name: locale === 'en' ? 'Monthly Commitment / Subscription' : 'Komitmen Biaya Langganan Bulanan',
          starter: 'Rp 0 (Pay-as-you-go)',
          pro: 'Rp 0 (Pay-as-you-go)',
          ultra: 'Rp 0 (Pay-as-you-go)',
        },
        {
          name: locale === 'en' ? 'Support Channel SLA' : 'Saluran Bantuan & Dukungan',
          starter: 'Komunitas Discord',
          pro: 'Email Prioritas',
          ultra: 'Dedicated Chat & SLA',
        },
      ],
    },
  ];

  const renderValue = (val: string | boolean) => {
    if (typeof val === 'boolean') {
      return val ? (
        <span className="inline-flex items-center justify-center w-5 h-5 text-neutral-950">
          <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
          <span className="sr-only">{locale === 'en' ? 'Included' : 'Termasuk'}</span>
        </span>
      ) : (
        <span className="inline-flex items-center justify-center w-5 h-5 text-neutral-500">
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">{locale === 'en' ? 'Not included' : 'Tidak termasuk'}</span>
        </span>
      );
    }
    return <span className="font-mono text-xs text-neutral-800 font-semibold">{val}</span>;
  };

  return (
    <section className="relative z-10 py-16 lg:py-24 px-4 sm:px-6 bg-[#fafafa] border-t border-neutral-200/80">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-center max-w-3xl mx-auto mb-12 sm:mb-16"
        >
          <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
            <TableProperties className="w-3.5 h-3.5 text-neutral-900" />
            <span>{locale === 'en' ? 'Feature Matrix' : 'Tabel Komparasi Fitur'}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-extrabold tracking-tight text-neutral-950">
            {locale === 'en'
              ? 'Compare Plan Limits & Specifications'
              : 'Perbandingan Spesifikasi & Fitur Lengkap'}
          </h2>
          <p className="mt-4 text-neutral-600 font-body text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
            {locale === 'en'
              ? 'Transparent technical specifications for every tier. No hidden throttling, zero lock-in.'
              : 'Spesifikasi teknis transparan untuk setiap paket kuota. Bebas biaya tersembunyi, tanpa langganan mengikat.'}
          </p>
        </motion.div>

        {/* The Matrix Table Container */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
          className="rounded-3xl border border-neutral-200/90 bg-white shadow-xs overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              {/* Table Sticky Header */}
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80">
                  <th className="py-5 px-6 font-mono text-xs uppercase tracking-wider text-neutral-500 font-bold w-[40%]">
                    {locale === 'en' ? 'Feature / Specification' : 'Spesifikasi & Fitur'}
                  </th>
                  <th className="py-5 px-6 text-center font-heading font-bold text-sm text-neutral-900 w-[20%]">
                    Starter
                    <div className="text-[11px] font-mono font-normal text-neutral-500 mt-0.5">Rp 15.000</div>
                  </th>
                  <th className="py-5 px-6 text-center font-heading font-extrabold text-sm text-neutral-950 bg-neutral-100/70 w-[20%] border-x border-neutral-200/80">
                    Pro (Popular)
                    <div className="text-[11px] font-mono font-normal text-neutral-500 mt-0.5">Rp 49.000</div>
                  </th>
                  <th className="py-5 px-6 text-center font-heading font-bold text-sm text-neutral-900 w-[20%]">
                    Ultra / Team
                    <div className="text-[11px] font-mono font-normal text-neutral-500 mt-0.5">Rp 149.000</div>
                  </th>
                </tr>
              </thead>

              {/* Table Groups */}
              <tbody>
                {matrix.map((group, groupIdx) => (
                  <React.Fragment key={groupIdx}>
                    {/* Category Header Row */}
                    <tr className="bg-neutral-100/50 border-b border-neutral-200">
                      <td
                        colSpan={4}
                        className="py-3 px-6 font-mono text-[11px] uppercase tracking-wider font-extrabold text-neutral-900"
                      >
                        {group.category}
                      </td>
                    </tr>

                    {/* Feature Items Rows */}
                    {group.rows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className="border-b border-neutral-100 hover:bg-neutral-50/60 transition-colors"
                      >
                        <td className="py-3.5 px-6 text-xs sm:text-sm text-neutral-800 font-medium">
                          {row.name}
                        </td>
                        <td className="py-3.5 px-6 text-center">{renderValue(row.starter)}</td>
                        <td className="py-3.5 px-6 text-center bg-neutral-50/50 border-x border-neutral-200/50">
                          {renderValue(row.pro)}
                        </td>
                        <td className="py-3.5 px-6 text-center">{renderValue(row.ultra)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>

              {/* Bottom CTA Row inside Table */}
              <tfoot>
                <tr className="bg-neutral-50/60 border-t border-neutral-200">
                  <td className="py-6 px-6 font-heading font-bold text-xs text-neutral-500 uppercase tracking-wider">
                    {locale === 'en' ? 'Get Started Today' : 'Pilih Paket Kuota'}
                  </td>
                  <td className="py-6 px-6 text-center">
                    <Link
                      href={isLoggedIn ? '/dashboard/billing' : '/login'}
                      className="inline-flex items-center justify-center gap-1 w-full max-w-[130px] py-2 px-3 rounded-xl border border-neutral-300 hover:border-neutral-950 bg-white text-neutral-900 text-xs font-bold transition-all hover:bg-neutral-950 hover:text-white"
                    >
                      <span>Starter</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                  <td className="py-6 px-6 text-center bg-neutral-100/70 border-x border-neutral-200">
                    <Link
                      href={isLoggedIn ? '/dashboard/billing' : '/login'}
                      className="inline-flex items-center justify-center gap-1 w-full max-w-[130px] py-2 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <span>Pilih Pro</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                  <td className="py-6 px-6 text-center">
                    <Link
                      href={isLoggedIn ? '/dashboard/billing' : '/login'}
                      className="inline-flex items-center justify-center gap-1 w-full max-w-[130px] py-2 px-3 rounded-xl border border-neutral-300 hover:border-neutral-950 bg-white text-neutral-900 text-xs font-bold transition-all hover:bg-neutral-950 hover:text-white"
                    >
                      <span>Ultra</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
