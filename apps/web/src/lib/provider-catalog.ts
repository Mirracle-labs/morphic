// Normalizes an upstream `GET {baseUrl}/models` response into one shape.
// Prices are USD per 1M tokens, or null when the provider's API does not publish them.

export interface CatalogModel {
  id: string;
  inputPerM: number | null;
  cacheReadPerM: number | null;
  outputPerM: number | null;
  context: number | null;
  maxOutput: number | null;
}

export interface CatalogResult {
  ok: boolean;
  error?: string;
  models: CatalogModel[];
  fetchedAt: string;
}

type Json = Record<string, any>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const perTokenToPerM = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n * 1e6 * 1e6) / 1e6;
};

function prices(m: Json): Pick<CatalogModel, 'inputPerM' | 'cacheReadPerM' | 'outputPerM'> {
  // Chutes: price.input.usd is USD per 1M (its pricing.prompt is a bare number, also per 1M)
  if (m.price?.input && typeof m.price.input === 'object') {
    return {
      inputPerM: num(m.price.input.usd),
      cacheReadPerM: num(m.price.input_cache_read?.usd),
      outputPerM: num(m.price.output?.usd),
    };
  }
  const p = m.pricing;
  // Novita: pricing.prompt.price_per_m_decimal ("0.3" = $0.3 / 1M)
  if (p?.prompt && typeof p.prompt === 'object') {
    return {
      inputPerM: num(p.prompt.price_per_m_decimal),
      cacheReadPerM: num(p.input_cache_read?.price_per_m_decimal),
      outputPerM: num(p.completion?.price_per_m_decimal),
    };
  }
  // OpenRouter / Inceptron: pricing.prompt is USD per token as a string (Inceptron spells it input_cache_reads)
  if (p && typeof p.prompt === 'string') {
    return {
      inputPerM: perTokenToPerM(p.prompt),
      cacheReadPerM: perTokenToPerM(p.input_cache_read ?? p.input_cache_reads),
      outputPerM: perTokenToPerM(p.completion),
    };
  }
  // Together: pricing.input / pricing.output already per 1M
  if (p && ('input' in p || 'output' in p)) {
    return { inputPerM: num(p.input), cacheReadPerM: num(p.cached_input), outputPerM: num(p.output) };
  }
  return { inputPerM: null, cacheReadPerM: null, outputPerM: null };
}

export function normalizeCatalog(body: unknown): CatalogModel[] {
  const list: Json[] = Array.isArray(body) ? body : Array.isArray((body as Json)?.data) ? (body as Json).data : [];
  // Some providers list the same id twice; keep the first so ids are unique per provider.
  const seen = new Set<string>();
  return list
    .filter((m) => typeof m?.id === 'string' && !seen.has(m.id) && seen.add(m.id))
    .map((m) => ({
      id: m.id,
      ...prices(m),
      context: num(m.context_size ?? m.context_length ?? m.context_window),
      maxOutput: num(m.max_output_tokens ?? m.max_output_length ?? m.top_provider?.max_completion_tokens ?? m.max_completion_tokens),
    }));
}

// Order matters: gemma before gemini, nemotron before mistral's "nemo".
const FAMILIES: [string, RegExp][] = [
  ['DeepSeek', /deepseek/],
  ['Qwen', /qwen|qwq/],
  ['Kimi', /kimi|moonshot/],
  ['GLM', /glm|zai-org|chatglm/],
  ['MiniMax', /minimax/],
  ['Gemma', /gemma/],
  ['Gemini', /gemini/],
  ['Llama', /llama/],
  ['Nemotron', /nemotron/],
  ['Mistral', /mistral|mixtral|codestral|devstral|magistral/],
  ['GPT', /gpt|openai\//],
  ['Claude', /claude|anthropic\//],
  ['Grok', /grok|x-ai\//],
];

/** Model family for the category filter, e.g. "deepseek/deepseek-v4.1-flash" -> "DeepSeek". */
export function modelFamily(id: string): string {
  const s = id.toLowerCase();
  const hit = FAMILIES.find(([, re]) => re.test(s));
  if (hit) return hit[0];
  const org = s.includes('/') ? s.split('/')[0]! : s.split(/[-_:]/)[0]!;
  return org.charAt(0).toUpperCase() + org.slice(1);
}

export const VARIANTS = ['pro', 'flash', 'turbo', 'lite', 'mini', 'max', 'plus', 'air', 'nano', 'thinking', 'instruct', 'coder', 'vision', 'chat', 'reasoner'] as const;

/** Variant keywords present as whole tokens in the id, e.g. "deepseek-v4.1-flash" -> ["flash"]. */
export function modelVariants(id: string): string[] {
  const tokens = new Set(id.toLowerCase().split(/[/\-_.:\s]+/));
  return VARIANTS.filter((v) => tokens.has(v));
}
