'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Cpu,
  Code2,
  Brain,
  MessageSquare,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

type ModelCategory = 'All' | 'Coding' | 'Reasoning' | 'Chat';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  category: 'Coding' | 'Reasoning' | 'Chat';
  contextWindow: string;
  dailyRate: string;
  description: string;
  badge?: string;
  speed: 'Ultra Fast' | 'Fast' | 'Balanced';
}

const PUBLIC_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4 Coder',
    provider: 'DeepSeek',
    category: 'Coding',
    contextWindow: '64K Tokens',
    dailyRate: 'Rp 2.500 / hari',
    description: 'Sangat kencang dan presisi untuk auto-complete, refactoring, dan error fixing di Cursor & Cline.',
    badge: 'PALING POPULER',
    speed: 'Ultra Fast',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1 Reasoning',
    provider: 'DeepSeek',
    category: 'Reasoning',
    contextWindow: '128K Tokens',
    dailyRate: 'Rp 4.500 / hari',
    description: 'Kemampuan penalaran bertahap (Chain-of-Thought) untuk arsitektur sistem rumit dan algoritma berat.',
    badge: 'REASONING',
    speed: 'Balanced',
  },
  {
    id: 'qwen-2.5-max',
    name: 'Qwen 2.5 Max',
    provider: 'Alibaba Cloud',
    category: 'Chat',
    contextWindow: '128K Tokens',
    dailyRate: 'Rp 3.500 / hari',
    description: 'Model flagship serba bisa untuk percakapan bahasa Indonesia alami, analisis data, dan multi-step tasks.',
    badge: 'FLAGSHIP',
    speed: 'Fast',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding 256K',
    provider: 'Moonshot AI',
    category: 'Coding',
    contextWindow: '256K Tokens',
    dailyRate: 'Rp 4.000 / hari',
    description: 'Context window super masif 256K tokens untuk membaca seluruh codebase repository proyek Anda tanpa terpotong.',
    badge: 'MASIF CONTEXT',
    speed: 'Fast',
  },
  {
    id: 'glm-4-air',
    name: 'GLM-4 Air',
    provider: 'Zhipu AI',
    category: 'Chat',
    contextWindow: '128K Tokens',
    dailyRate: 'Rp 1.500 / hari',
    description: 'Model chat dan coding ringan berperforma tinggi dengan latensi respon kilat dan efisiensi biaya maksimal.',
    badge: 'SUPER HEMAT',
    speed: 'Ultra Fast',
  },
  {
    id: 'yi-lightning',
    name: 'Yi Lightning',
    provider: '01.AI',
    category: 'Chat',
    contextWindow: '16K Tokens',
    dailyRate: 'Rp 1.000 / hari',
    description: 'Model instan untuk quick chat dan auto-completion cepat dengan tarif harian termurah.',
    badge: 'TERHEMAT',
    speed: 'Ultra Fast',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini Gateway',
    provider: 'OpenAI Compatible',
    category: 'Chat',
    contextWindow: '128K Tokens',
    dailyRate: 'Rp 3.500 / hari',
    description: 'Endpoint drop-in OpenAI resmi dengan burst rate limit tinggi untuk agent otomatisasi tanpa throttling.',
    speed: 'Fast',
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet Proxy',
    provider: 'Anthropic Proxy',
    category: 'Coding',
    contextWindow: '200K Tokens',
    dailyRate: 'Rp 8.500 / hari',
    description: 'Model coding terbaik di kelasnya untuk problem solving tingkat senior developer dan arsitektur enterprise.',
    badge: 'PRO DEV',
    speed: 'Fast',
  },
];

export default function ModelCatalog({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>('All');

  const filteredModels = useMemo(() => {
    if (selectedCategory === 'All') return PUBLIC_MODELS;
    return PUBLIC_MODELS.filter((m) => m.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <section
      id="models"
      className="relative z-10 py-24 px-4 sm:px-6 bg-white text-neutral-900 border-t border-neutral-200/80"
    >
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <Cpu className="h-3.5 w-3.5 text-neutral-950" />
            <span>Katalog Model AI & Dukungan Lengkap</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            Satu Endpoint untuk Semua Model AI Terbaik
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Tidak perlu berlangganan terpisah di banyak provider luar negeri. Hubungkan Cursor, Cline,
            atau Windsurf Anda ke Morphic dan nikmati tarif harian hemat yang dapat diakses setelah masuk.
          </p>
        </div>

        {/* Category Filters */}
        <div className="flex items-center justify-center gap-2 mb-10 flex-wrap">
          {(['All', 'Coding', 'Reasoning', 'Chat'] as ModelCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-neutral-950 text-white shadow-sm'
                  : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
              }`}
            >
              {cat === 'All' ? 'Semua Model' : cat}
            </button>
          ))}
        </div>

        {/* Models Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-14">
          {filteredModels.map((model) => (
            <div
              key={model.id}
              className="rounded-3xl border border-neutral-200/90 bg-neutral-50/50 p-6 flex flex-col justify-between hover:bg-white hover:border-neutral-300 hover:shadow-lg transition-all group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">
                    {model.provider}
                  </span>
                  {model.badge && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-950 text-white shadow-sm">
                      {model.badge}
                    </span>
                  )}
                </div>

                <h3 className="font-heading font-bold text-lg text-neutral-950 mb-1">
                  {model.name}
                </h3>
                <code className="text-[11px] font-mono text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-md inline-block mb-3">
                  {model.id}
                </code>

                <p className="text-xs text-neutral-600 font-body leading-relaxed mb-6">
                  {model.description}
                </p>
              </div>

              <div className="pt-4 border-t border-neutral-200/70 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Context Window:</span>
                  <span className="font-mono font-bold text-neutral-900">{model.contextWindow}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Estimasi Harian:</span>
                  <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/70">
                    {model.dailyRate}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Member Pricing Banner (Separated: Pricing details available upon login) */}
        <div className="rounded-3xl border border-neutral-200/90 bg-white p-8 md:p-10 shadow-sm text-center max-w-4xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-950 mx-auto mb-4 shadow-sm">
            <Zap className="h-6 w-6" />
          </div>

          <h3 className="text-2xl font-heading font-bold text-neutral-950 mb-2">
            Akses Paket Harian Mulai Rp 1.000 - Rp 4.500 / Hari
          </h3>

          <p className="text-neutral-600 text-xs sm:text-sm max-w-xl mx-auto mb-6 leading-relaxed">
            Paket harga harian hemat dan mikro top-up saldo dapat diakses langsung melalui dashboard member setelah Anda melakukan autentikasi.
          </p>

          <Link
            href={isLoggedIn ? '/dashboard' : '/login'}
            className="inline-flex items-center justify-center gap-2 bg-neutral-950 text-white rounded-full px-8 py-3 text-xs sm:text-sm font-bold hover:bg-neutral-800 transition-all shadow-md hover:shadow-lg"
          >
            <span>{isLoggedIn ? 'Buka Dashboard & Beli Paket' : 'Masuk untuk Melihat & Membeli Paket'}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
