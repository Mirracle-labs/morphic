export interface CanonicalModel {
  publicModelId: string;
  name: string;
  provider: string;
  category: 'Coding' | 'Reasoning' | 'Chat' | 'Multimodal';
  contextLength: number;
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
}

export const CANONICAL_MODELS: CanonicalModel[] = [
  {
    publicModelId: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    category: 'Coding',
    contextLength: 200000,
    inputCreditsPer1m: 300,
    outputCreditsPer1m: 1500,
  },
  {
    publicModelId: 'deepseek-v4',
    name: 'DeepSeek V4 Coder',
    provider: 'DeepSeek',
    category: 'Coding',
    contextLength: 65536,
    inputCreditsPer1m: 100,
    outputCreditsPer1m: 200,
  },
  {
    publicModelId: 'deepseek-r1',
    name: 'DeepSeek R1 Reasoning',
    provider: 'DeepSeek',
    category: 'Reasoning',
    contextLength: 131072,
    inputCreditsPer1m: 140,
    outputCreditsPer1m: 550,
  },
  {
    publicModelId: 'qwen-2.5-max',
    name: 'Qwen 2.5 Max',
    provider: 'Alibaba Cloud',
    category: 'Chat',
    contextLength: 131072,
    inputCreditsPer1m: 120,
    outputCreditsPer1m: 360,
  },
  {
    publicModelId: 'kimi-k1.5',
    name: 'Kimi K1.5 Long-Context',
    provider: 'Moonshot AI',
    category: 'Coding',
    contextLength: 262144,
    inputCreditsPer1m: 80,
    outputCreditsPer1m: 240,
  },
  {
    publicModelId: 'glm-4-plus',
    name: 'GLM 4 Plus',
    provider: 'Zhipu AI',
    category: 'Chat',
    contextLength: 131072,
    inputCreditsPer1m: 100,
    outputCreditsPer1m: 300,
  },
  {
    publicModelId: 'minimax-01',
    name: 'MiniMax 01',
    provider: 'MiniMax',
    category: 'Coding',
    contextLength: 1000000,
    inputCreditsPer1m: 100,
    outputCreditsPer1m: 400,
  },
];

export const MODEL_ALIASES: Record<string, string> = {
  'claude-3-5': 'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3.5-sonnet-proxy': 'claude-3-5-sonnet-20241022',
  'deepseek-chat': 'deepseek-v4',
  'deepseek-coder': 'deepseek-v4',
  'qwen-2-5-max': 'qwen-2.5-max',
  'qwen-max': 'qwen-2.5-max',
  'kimi-coding': 'kimi-k1.5',
  'kimi-k1-5': 'kimi-k1.5',
};

export function normalizeModelId(modelId: string): string {
  const clean = modelId.trim().toLowerCase();
  return MODEL_ALIASES[clean] ?? clean;
}
