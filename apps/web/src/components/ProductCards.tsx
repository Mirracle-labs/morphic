import Link from 'next/link';
import { Check, Zap, Sparkles, ArrowUpRight, ShieldCheck } from 'lucide-react';

export interface PackageItem {
  id: string;
  name: string;
  description: string | null;
  creditAllowance: number;
  priceCents: number | null;
  durationHours?: number | null;
}

interface ProductCardsProps {
  isLoggedIn?: boolean;
  dbPackages?: PackageItem[];
}

export default function ProductCards({ isLoggedIn = false, dbPackages = [] }: ProductCardsProps) {
  // If packages are present in database, format them; otherwise provide clean default pricing tiers
  const defaultTiers = [
    {
      id: 'starter',
      name: 'Starter Dev',
      badge: 'Hemat',
      price: 'Rp 15.000',
      credits: '50.000 Credits',
      desc: 'Cocok untuk coba-coba coding dengan Cursor & Cline.',
      popular: false,
      features: [
        'Akses DeepSeek V4 & Qwen Max',
        'Bisa buat hingga 3 API Keys',
        'Rate limit normal (60 RPM)',
        'Bayar instan via QRIS',
        'Masa aktif 30 hari',
      ],
    },
    {
      id: 'pro',
      name: 'Pro Agent',
      badge: 'Paling Populer',
      price: 'Rp 49.000',
      credits: '200.000 Credits',
      desc: 'Pilihan terbaik untuk daily coding & fullstack development.',
      popular: true,
      features: [
        'Semua model: DeepSeek V4, R1, Qwen 2.5, Kimi',
        'Unlimited API Keys (multi-device)',
        'Turbo Burst limit (180 RPM)',
        'Prioritas routing latensi rendah',
        'Masa aktif akumulasi otomatis',
      ],
    },
    {
      id: 'heavy',
      name: 'Heavy Coder',
      badge: 'Best Value',
      price: 'Rp 149.000',
      credits: '750.000 Credits',
      desc: 'Untuk developer intensif & pembacaan repo context besar.',
      popular: false,
      features: [
        'Kapasitas context masif (hingga 256K)',
        'Semua model + akses rute eksperimental',
        'Rate limit tertinggi tanpa throttling',
        'Multi-concurrency hingga 10 stream',
        'Dukungan prioritas tim Morphic',
      ],
    },
  ];

  const targetUrl = isLoggedIn ? '/dashboard/billing' : '/login';

  return (
    <section
      id="pricing"
      className="relative z-10 py-24 px-4 sm:px-6 bg-[#fafafa] text-neutral-900 border-t border-neutral-200/80"
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-neutral-200/90 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <Zap className="h-3.5 w-3.5 text-neutral-950" />
            <span>Transparan & Fleksibel</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            Pilihan Paket Kredit Hemat
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base max-w-2xl mx-auto">
            Beli kredit sesuai kebutuhan Anda tanpa komitmen bulanan yang mengikat. Bayar instan menggunakan QRIS Rupiah.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {defaultTiers.map((tier) => (
            <div
              key={tier.id}
              className={`relative rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 ${
                tier.popular
                  ? 'bg-white border-2 border-neutral-950 shadow-xl md:-translate-y-2'
                  : 'bg-white/80 border border-neutral-200/90 shadow-sm hover:border-neutral-300 hover:shadow-md'
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-neutral-950 text-white text-[11px] font-bold px-4 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  <span>{tier.badge}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="font-heading font-bold text-xl text-neutral-950">{tier.name}</h3>
                  {!tier.popular && (
                    <span className="text-[11px] font-semibold text-neutral-500 bg-neutral-100 px-2.5 py-0.5 rounded-full">
                      {tier.badge}
                    </span>
                  )}
                </div>

                <p className="text-xs text-neutral-500 mb-6 leading-relaxed">{tier.desc}</p>

                <div className="mb-6 pb-6 border-b border-neutral-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl md:text-4xl font-extrabold text-neutral-950">{tier.price}</span>
                  </div>
                  <div className="text-xs font-semibold text-emerald-700 mt-1.5 flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Mendapatkan {tier.credits}</span>
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-3 mb-8">
                  <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                    Termasuk Fitur:
                  </div>
                  {tier.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 text-xs text-neutral-700">
                      <div className="rounded-full bg-neutral-100 p-0.5 mt-0.5 text-neutral-950 shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <Link
                href={targetUrl}
                className={`w-full text-center py-3 px-6 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  tier.popular
                    ? 'bg-neutral-950 text-white hover:bg-neutral-800 shadow-md'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-950'
                }`}
              >
                <span>Pilih Paket {tier.name}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
        </div>

        {/* Bottom Guarantee Banner */}
        <div className="mt-14 p-6 rounded-2xl bg-white border border-neutral-200/80 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-neutral-950">Jaminan Keamanan & Pengembalian Kredit</div>
              <div className="text-xs text-neutral-500">
                Kredit hanya dipotong saat prompt sukses dieksekusi oleh model AI.
              </div>
            </div>
          </div>
          <Link
            href={targetUrl}
            className="text-xs font-bold text-neutral-950 hover:underline inline-flex items-center gap-1"
          >
            <span>Beli Kredit di Dashboard</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}