import Link from 'next/link';
import { ArrowUpRight, QrCode, KeyRound, TerminalSquare, Bot } from 'lucide-react';
import AiRobotVisual from './AiRobotVisual';

interface HowItWorksStepsProps {
  isLoggedIn?: boolean;
}

export default function HowItWorksSteps({ isLoggedIn = false }: HowItWorksStepsProps) {
  const steps = [
    {
      num: '01',
      title: 'Pilih Paket & Scan QRIS',
      desc: 'Pilih kuota kredit sesuai kebutuhan Anda. Bayar seketika menggunakan QRIS (GoPay, OVO, Dana, BCA, Mandiri) tanpa kartu kredit. Saldo masuk detik itu juga.',
      icon: QrCode,
      badge: 'Instan 3 Detik',
    },
    {
      num: '02',
      title: 'Generate API Key Unik',
      desc: 'Buka Dashboard dan buat kunci rahasia (mp-xxxx) Anda. Anda bebas membuat multiple keys dengan label terpisah (misal: "Cursor Work", "Production").',
      icon: KeyRound,
      badge: 'Multi-Key Ready',
    },
    {
      num: '03',
      title: 'Tempel di Cursor / IDE Anda',
      desc: 'Ganti Base URL menjadi https://api.morphic.xxx/v1 dan masukkan API Key Anda. 100% kompatibel dengan Cursor, Cline, Windsurf, dan SDK resmi OpenAI.',
      icon: TerminalSquare,
      badge: 'OpenAI Format',
    },
    {
      num: '04',
      title: 'Robot AI Aktif Bekerja',
      desc: 'Coding agent Anda langsung siap mengeksekusi prompt, debugging, dan auto-complete dengan rate limit tinggi (hingga 180 RPM) tanpa hambatan.',
      icon: Bot,
      badge: 'High Concurrency',
    },
  ];

  return (
    <section id="integration" className="relative z-10 py-24 px-4 sm:px-6 bg-white text-neutral-900 border-t border-neutral-200/80 overflow-hidden content-deferred">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <Bot className="h-3.5 w-3.5 text-neutral-900" />
            <span>Panduan Mudah & Cepat</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            4 Langkah Mudah Menggunakan API Key AI
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base max-w-2xl mx-auto">
            Hanya butuh waktu kurang dari 2 menit untuk menghubungkan agent AI pilihan Anda dan
            langsung mulai coding tanpa ribet.
          </p>
        </div>

        {/* 2-Column Grid: Robot Visual + Steps Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Interactive Cybernetic Robot Avatar */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center text-center">
            <AiRobotVisual />
            <div className="mt-6">
              <p className="text-xs text-neutral-500 font-body max-w-xs mx-auto mb-4">
                Didukung arsitektur multi-provider proxy dengan failover otomatis dan latensi
                response rendah.
              </p>
              <Link
                href={isLoggedIn ? '/dashboard/keys' : '/login'}
                className="inline-flex items-center gap-2 text-xs font-bold text-neutral-900 hover:text-black transition-colors underline underline-offset-4"
              >
                <span>{isLoggedIn ? 'Buka Panel API Keys' : 'Daftar & Mulai Sekarang'}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Right Column: Steps Sequence Cards */}
          <div className="lg:col-span-7 space-y-4">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.num}
                  className="rounded-2xl border border-neutral-200/90 bg-neutral-50/70 p-6 flex items-start gap-5 hover:border-neutral-300 hover:bg-white hover:shadow-lg transition-all group"
                >
                  <div className="w-12 h-12 rounded-2xl bg-white border border-neutral-200/90 flex items-center justify-center text-neutral-900 shrink-0 group-hover:bg-neutral-100 shadow-sm transition-colors">
                    <Icon className="h-6 w-6" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-mono text-neutral-400 font-bold">
                          {step.num}
                        </span>
                        <h3 className="font-heading font-bold text-base md:text-lg text-neutral-950">
                          {step.title}
                        </h3>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-white text-neutral-700 border border-neutral-200/90 shadow-sm">
                        {step.badge}
                      </span>
                    </div>

                    <p className="text-xs md:text-sm text-neutral-600 font-body leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
