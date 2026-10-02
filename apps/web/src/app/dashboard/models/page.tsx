import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';
import { Cpu, Zap, ArrowUpRight, ShieldCheck, Terminal } from 'lucide-react';

const FALLBACK_MODELS = [
  {
    publicModelId: 'deepseek-v4',
    displayName: 'DeepSeek V4 Coder',
    description: 'Sangat cepat & presisi untuk coding, debugging, dan auto-complete di Cursor & Cline.',
    contextLength: 65536,
    capabilities: ['coding', 'chat', 'reasoning'],
    inputCreditsPer1m: 100,
    outputCreditsPer1m: 200,
    dailyRate: 'Rp 2.500 / hari',
  },
  {
    publicModelId: 'deepseek-r1',
    displayName: 'DeepSeek R1 Reasoning',
    description: 'Penalaran bertahap (Chain-of-Thought) untuk arsitektur kompleks dan algoritma rumit.',
    contextLength: 131072,
    capabilities: ['reasoning', 'coding'],
    inputCreditsPer1m: 220,
    outputCreditsPer1m: 450,
    dailyRate: 'Rp 4.500 / hari',
  },
  {
    publicModelId: 'qwen-max',
    displayName: 'Qwen 2.5 Max',
    description: 'Model flagship serba bisa untuk analisis data, bahasa Indonesia alami, dan multi-step tasks.',
    contextLength: 131072,
    capabilities: ['general', 'reasoning', 'multimodal'],
    inputCreditsPer1m: 180,
    outputCreditsPer1m: 360,
    dailyRate: 'Rp 3.500 / hari',
  },
  {
    publicModelId: 'kimi-coding',
    displayName: 'Kimi Coding 256K',
    description: 'Context window super masif 256K tokens untuk membaca seluruh file repository codebase.',
    contextLength: 262144,
    capabilities: ['coding', 'long-context'],
    inputCreditsPer1m: 190,
    outputCreditsPer1m: 380,
    dailyRate: 'Rp 4.000 / hari',
  },
  {
    publicModelId: 'glm-4-air',
    displayName: 'GLM-4 Air Ultra Fast',
    description: 'Model ringan super cepat dengan latensi rendah untuk instant chat & quick reasoning.',
    contextLength: 131072,
    capabilities: ['chat', 'coding'],
    inputCreditsPer1m: 80,
    outputCreditsPer1m: 160,
    dailyRate: 'Rp 1.500 / hari',
  },
  {
    publicModelId: 'yi-lightning',
    displayName: 'Yi Lightning 01.AI',
    description: 'Respon instan ultra-low latency untuk perulangan instruksi cepat dan auto-complete.',
    contextLength: 16384,
    capabilities: ['chat', 'reasoning'],
    inputCreditsPer1m: 60,
    outputCreditsPer1m: 120,
    dailyRate: 'Rp 1.000 / hari',
  },
  {
    publicModelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini Gateway',
    description: 'Endpoint drop-in OpenAI resmi dengan tarif hemat dan burst limit 180 RPM.',
    contextLength: 131072,
    capabilities: ['chat', 'coding', 'multimodal'],
    inputCreditsPer1m: 150,
    outputCreditsPer1m: 300,
    dailyRate: 'Rp 3.500 / hari',
  },
  {
    publicModelId: 'claude-3.5-sonnet',
    displayName: 'Claude 3.5 Sonnet Proxy',
    description: 'Model coding benchmark teratas untuk refactoring tingkat tinggi dan fullstack architecture.',
    contextLength: 200000,
    capabilities: ['coding', 'reasoning', 'chat'],
    inputCreditsPer1m: 450,
    outputCreditsPer1m: 900,
    dailyRate: 'Rp 8.500 / hari',
  },
];

export default async function ModelsPage() {
  await requireUser();
  const dbModels = await db
    .select({
      publicModelId: s.models.publicModelId,
      displayName: s.models.displayName,
      description: s.models.description,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      providerName: s.providers.name,
    })
    .from(s.models)
    .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
    .where(eq(s.models.status, 'active'));

  const models = dbModels.length > 0 ? dbModels : FALLBACK_MODELS;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950">
          Katalog Model & Tarif Harian
        </h1>
        <p className="text-xs md:text-sm text-neutral-500 mt-1">
          Gunakan model ID di Cursor, Cline, atau kode Anda — Morphic secara otomatis mengarahkan ke provider upstream yang sesuai.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map((m: any) => (
          <div key={m.publicModelId} className="p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-sm flex flex-col justify-between hover:border-neutral-300 transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-heading font-bold text-base text-neutral-950">{m.displayName}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Ready
                </span>
              </div>
              <code className="text-xs text-neutral-600 bg-neutral-100 font-mono px-2 py-0.5 rounded-md inline-block mb-2">
                {m.publicModelId}
              </code>
              <p className="text-xs text-neutral-500 mb-4 leading-relaxed">{m.description}</p>
              <div className="flex gap-1.5 flex-wrap mb-4">
                {(m.capabilities ?? []).map((cap: string) => (
                  <span key={cap} className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200 capitalize">
                    {cap.replace('-', ' ')}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-100 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-500">Estimasi Harian:</span>
                <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  {m.dailyRate ?? 'Mulai Rp 2.500 / hari'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                <span>{formatCredits(m.contextLength)} context</span>
                <span>in {formatCredits(m.inputCreditsPer1m)} / out {formatCredits(m.outputCreditsPer1m)} / 1M</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-sm space-y-2">
        <div className="text-xs font-bold text-neutral-950 flex items-center gap-1.5">
          <Terminal className="h-4 w-4 text-neutral-800" />
          <span>Contoh Request cURL</span>
        </div>
        <pre className="p-3.5 rounded-xl bg-neutral-950 text-neutral-200 text-xs overflow-x-auto font-mono">{`curl https://api.morphic.sh/v1/chat/completions \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${models[0]?.publicModelId ?? 'deepseek-v4'}", "messages": [{"role": "user", "content": "Hello"}]}'`}</pre>
      </div>
    </div>
  );
}
