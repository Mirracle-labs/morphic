export type CapabilityTag = 'Code' | 'Reasoning' | 'Chat' | 'Vision' | 'Long Context';

export interface ModelItem {
  id: string;
  name: string;
  provider: string;
  category: 'Coding' | 'Reasoning' | 'Chat' | 'Multimodal';
  capabilities: CapabilityTag[];
  contextWindow: string;
  // Marketing fields that only the static landing catalogue carries. Rows coming from the
  // database leave them out rather than inventing a speed, a latency or a daily price.
  dailyRate?: string;
  dailyRateEn?: string;
  speed?: 'Ultra Fast' | 'Fast' | 'Balanced';
  estimatedLatency?: string;
  inputCreditsPer1m?: number;
  outputCreditsPer1m?: number;
  description: {
    id: string;
    en: string;
  };
  badge?: string;
  badgeEn?: string;
  badgeType?: 'popular' | 'flagship' | 'pro' | 'hemat';
}

export const ALL_MODELS: ModelItem[] = [
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    provider: 'DeepSeek',
    category: 'Coding',
    capabilities: ['Code', 'Chat', 'Reasoning'],
    contextWindow: '64K Tokens',
    dailyRate: 'Mulai Rp 2.500 / hari',
    dailyRateEn: 'From Rp 2,500 / day',
    speed: 'Ultra Fast',
    estimatedLatency: '~110ms',
    badge: 'POPULER',
    badgeEn: 'POPULAR',
    badgeType: 'popular',
    description: {
      id: 'Model coding dan penalaran flagship dari DeepSeek. Sangat responsif dan presisi untuk Cursor, Windsurf, dan Cline.',
      en: 'Flagship coding and reasoning model from DeepSeek. Ultra-fast, precise, and cost-effective for Cursor, Windsurf, and Cline.',
    },
  },
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'Alibaba Cloud',
    category: 'Reasoning',
    capabilities: ['Reasoning', 'Chat', 'Long Context'],
    contextWindow: '32K Tokens',
    dailyRate: 'Mulai Rp 3.500 / hari',
    dailyRateEn: 'From Rp 3,500 / day',
    speed: 'Fast',
    estimatedLatency: '~160ms',
    badge: 'FLAGSHIP',
    badgeEn: 'FLAGSHIP',
    badgeType: 'flagship',
    description: {
      id: 'Model flagship serba bisa dengan penalaran tingkat lanjut dan pemahaman bahasa Indonesia alami tinggi.',
      en: 'Flagship all-round model with advanced reasoning and exceptional natural multilingual understanding.',
    },
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    provider: 'Moonshot AI',
    category: 'Coding',
    capabilities: ['Code', 'Long Context'],
    contextWindow: '256K Tokens',
    dailyRate: 'Mulai Rp 4.000 / hari',
    dailyRateEn: 'From Rp 4,000 / day',
    speed: 'Fast',
    estimatedLatency: '~190ms',
    badge: '256K CONTEXT',
    badgeEn: '256K CONTEXT',
    badgeType: 'pro',
    description: {
      id: 'Context window masif 256K tokens untuk membaca dan merancang seluruh repositori kode besar tanpa terpotong.',
      en: 'Massive 256K token context window capable of ingesting entire code repositories without truncation.',
    },
  },
  {
    id: 'MiniMaxAI/MiniMax-M2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    category: 'Coding',
    capabilities: ['Code', 'Chat'],
    contextWindow: '128K Tokens',
    dailyRate: 'Mulai Rp 3.000 / hari',
    dailyRateEn: 'From Rp 3,000 / day',
    speed: 'Ultra Fast',
    estimatedLatency: '~120ms',
    badge: 'HEMAT',
    badgeEn: 'BUDGET',
    badgeType: 'hemat',
    description: {
      id: 'Model inferensi kode dan teks berkecepatan tinggi dengan efisiensi biaya luar biasa.',
      en: 'High-speed code and text generation model with outstanding cost-efficiency.',
    },
  },
  {
    id: 'DeepSeek-V4-Flash-0731',
    name: 'DeepSeek V4 Flash',
    provider: 'DeepSeek',
    category: 'Coding',
    capabilities: ['Code', 'Chat'],
    contextWindow: '64K Tokens',
    dailyRate: 'Mulai Rp 2.000 / hari',
    dailyRateEn: 'From Rp 2,000 / day',
    speed: 'Ultra Fast',
    estimatedLatency: '~95ms',
    badge: 'TERHEMAT',
    badgeEn: 'BEST VALUE',
    badgeType: 'hemat',
    description: {
      id: 'Varian ringan DeepSeek V4 dengan latensi kilat dan konsumsi token paling hemat untuk auto-completion.',
      en: 'Lightweight DeepSeek V4 variant with ultra-low latency and maximum token efficiency for auto-completion.',
    },
  },
];

/** Alias used by DeveloperGateway as static fallback when no DB models are available. */
export const INFERENCE_MODELS = ALL_MODELS;

export function getModelDailyRate(model: ModelItem, locale: string): string {
  if (locale === 'en') {
    return model.dailyRateEn || (model.dailyRate ?? '').replace('/ hari', '/ day').replace(/\./g, ',');
  }
  return model.dailyRate ?? '';
}

export function getModelBadge(model: ModelItem, locale: string): string | undefined {
  if (!model.badge) return undefined;
  if (locale === 'en') {
    return (
      model.badgeEn ||
      (model.badge === 'POPULER'
        ? 'POPULAR'
        : model.badge === 'HEMAT'
        ? 'BUDGET'
        : model.badge === 'TERHEMAT'
        ? 'BEST VALUE'
        : model.badge)
    );
  }
  return model.badge;
}
