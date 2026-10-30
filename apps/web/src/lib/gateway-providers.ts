// Upstream gateway providers (Admin › Providers). Client-safe: no DB, no credentials.
// One list feeds the admin quick-presets and the public logo/label lookup.
export const GATEWAY_PROVIDERS = [
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', host: 'openai.com', logo: '/logos/openai.svg' },
  { key: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', host: 'anthropic.com', logo: '/logos/anthropic.svg' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', host: 'deepseek.com', logo: '/logos/deepseek-color.svg' },
  { key: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', host: 'groq.com', logo: '/logos/groq.svg' },
  { key: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', host: 'openrouter.ai', logo: '/logos/openrouter.svg' },
  { key: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', host: 'mistral.ai', logo: '/logos/mistral-color.svg' },
  { key: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', host: 'moonshot.', logo: '/logos/moonshot.svg' },
  { key: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', host: 'minimax', logo: '/logos/minimax-color.svg' },
  { key: 'alibaba', label: 'Alibaba Cloud', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', host: 'aliyuncs.com', logo: '/logos/alibabacloud-color.svg' },
  { key: 'chutes', label: 'Chutes', baseUrl: 'https://llm.chutes.ai/v1', host: 'chutes.ai', logo: '/logos/chutes.svg' },
  { key: 'inceptron', label: 'Inceptron', baseUrl: 'https://api.inceptron.io/v1', host: 'inceptron.io', logo: '/logos/inceptron-color.svg' },
  { key: 'ollama', label: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', host: ':11434', logo: '/logos/ollama.svg' },
] as const;

export interface ProviderBrand {
  /** Admin-entered provider name, the routing slug */
  name: string;
  label: string;
  logo: string | null;
}

/** Recognise a provider by its base URL host first, then by its admin name. Unknown → its own name, no logo. */
export function providerBrand(name: string, baseUrl?: string | null): ProviderBrand {
  const url = (baseUrl ?? '').toLowerCase();
  const n = name.toLowerCase();
  const hit =
    (url && GATEWAY_PROVIDERS.find((p) => url.includes(p.host))) ||
    GATEWAY_PROVIDERS.find((p) => n === p.key || n.startsWith(`${p.key}-`) || n.startsWith(`${p.key}_`));
  return hit
    ? { name, label: hit.label.replace(' (Local)', ''), logo: hit.logo }
    : { name, label: name.charAt(0).toUpperCase() + name.slice(1), logo: null };
}
