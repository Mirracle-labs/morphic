import { XCircle, CheckCircle2, CreditCard, Zap, Layers, Lock } from 'lucide-react';

export default function MarketingProblemSolution() {
  const comparisons = [
    {
      problem: 'Wajib Kartu Kredit Internasional (USD)',
      problemDesc:
        'Provider resmi luar negeri menolak pembayaran lokal dan mengenakan kurs konversi valas tinggi.',
      solution: 'Bayar Instan dengan QRIS & Rupiah',
      solutionDesc:
        'Cukup scan QRIS via GoPay, OVO, Dana, BCA, Mandiri, atau bank lokal mana pun tanpa kartu kredit.',
      icon: CreditCard,
    },
    {
      problem: 'Akun Sering Terkena Rate-Limit & Banned',
      problemDesc:
        'Coding agent seperti Cursor dan Cline mengirim ratusan prompt per menit yang memicu limit ketat provider.',
      solution: 'High Concurrency & Turbo RPM',
      solutionDesc:
        'Infrastruktur routing khusus dengan burst rate tinggi (hingga 180 RPM) dirancang tahan beban multi-agent.',
      icon: Zap,
    },
    {
      problem: 'Saldo Terpecah di Banyak Provider',
      problemDesc:
        'Harus deposit modal terpisah di DeepSeek, Alibaba Cloud, dan Moonshot. Saldo mengendap dan boros.',
      solution: 'Unified Credits: 1 Saldo untuk Semua Model',
      solutionDesc:
        'Satu saldo kredit Morphic dapat digunakan bebas bergantian antara DeepSeek V4, Qwen Max, Kimi, dan lainnya.',
      icon: Layers,
    },
    {
      problem: 'Setup API Endpoint Rumit & Berbeda Format',
      problemDesc:
        'Setiap provider memiliki format API, SDK, dan sistem autentikasi berbeda yang menyulitkan integrasi.',
      solution: '100% OpenAI Format Compatible',
      solutionDesc:
        'Gunakan endpoint standar /v1/chat/completions. Cukup ganti Base URL dan pasang langsung di IDE Anda.',
      icon: Lock,
    },
  ];

  return (
    <section id="keunggulan" className="relative z-10 py-24 px-4 sm:px-6 bg-[#fafafa] text-neutral-900 border-t border-neutral-200/80 content-deferred">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <span>Mengapa Perlu Reseller API Key?</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight leading-tight mb-5 text-neutral-950">
            Tinggalkan Cara Lama yang Rumit & Mahal.
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Morphic hadir memecahkan kendala utama developer Indonesia saat mengakses model AI
            global untuk coding dan production harian.
          </p>
        </div>

        {/* Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {comparisons.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="rounded-3xl border border-neutral-200/90 bg-white p-6 md:p-8 flex flex-col justify-between hover:border-neutral-300 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-neutral-100">
                  <div className="w-10 h-10 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-900 group-hover:bg-neutral-200/70 transition-colors shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-heading font-bold text-lg text-neutral-950">{item.solution}</h3>
                </div>

                {/* The Old Pain (Problem) */}
                <div className="mb-4 p-4 rounded-2xl bg-rose-50/80 border border-rose-200/80 text-xs text-rose-950 flex items-start gap-3">
                  <XCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-rose-800 block mb-1">
                      Kendala Provider Biasa: {item.problem}
                    </span>
                    <span className="text-rose-700/90 leading-relaxed block">{item.problemDesc}</span>
                  </div>
                </div>

                {/* The Morphic Advantage (Solution) */}
                <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 text-xs text-emerald-950 flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-emerald-800 block mb-1">Solusi Morphic:</span>
                    <span className="text-emerald-700/90 leading-relaxed block">{item.solutionDesc}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
