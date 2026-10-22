// The model's maker, from its public id. Catalog slugs ("openai/gpt-…") resolve by prefix to the
// same maker name and logo the public catalog shows; other ids fall back to keyword families.
// ponytail: prefix list mirrors src/data/model-catalog.json makers; add a row when a sync brings a new maker.
export const MAKER_BY_PREFIX: Record<string, { maker: string; logo: string }> = {
  openai: { maker: 'OpenAI', logo: '/logos/catalog/gpt.svg' },
  anthropic: { maker: 'Anthropic', logo: '/logos/catalog/claude.svg' },
  google: { maker: 'Google', logo: '/logos/catalog/gemini.svg' },
  deepseek: { maker: 'DeepSeek', logo: '/logos/catalog/deepseek.svg' },
  qwen: { maker: 'Qwen', logo: '/logos/catalog/qwen.svg' },
  alibaba: { maker: 'Alibaba', logo: '/logos/catalog/alibaba.svg' },
  moonshotai: { maker: 'MoonshotAI', logo: '/logos/catalog/kimi.svg' },
  'x-ai': { maker: 'xAI', logo: '/logos/catalog/grok.svg' },
  'z-ai': { maker: 'Z.ai', logo: '/logos/catalog/zai.svg' },
  minimax: { maker: 'MiniMax', logo: '/logos/catalog/minimax.svg' },
  mistralai: { maker: 'Mistral', logo: '/logos/catalog/mistral.svg' },
  meta: { maker: 'Meta', logo: '/logos/catalog/meta.svg' },
  bytedance: { maker: 'ByteDance', logo: '/logos/catalog/bytedance.svg' },
  tencent: { maker: 'Tencent', logo: '/logos/catalog/hunyuan.svg' },
  xiaomi: { maker: 'Xiaomi', logo: '/logos/catalog/xiaomi.svg' },
  stepfun: { maker: 'StepFun', logo: '/logos/catalog/jieyuexingchen.svg' },
  inclusionai: { maker: 'inclusionAI', logo: '/logos/catalog/inclusionai.svg' },
  meituan: { maker: 'Meituan', logo: '/logos/catalog/long-cat.svg' },
  baidu: { maker: 'Baidu', logo: '/logos/catalog/variant28.svg' },
  bfl: { maker: 'Black Forest Labs', logo: '/logos/catalog/bfi.svg' },
  klingai: { maker: 'KlingAI', logo: '/logos/catalog/keling.svg' },
  pixverse: { maker: 'PixVerse', logo: '/logos/catalog/pixverse.svg' },
  skyreels: { maker: 'SkyReels', logo: '/logos/catalog/skyreels.svg' },
  'sapiens-ai': { maker: 'Sapiens AI', logo: '/logos/catalog/sapiens-al.svg' },
  sakana: { maker: 'Sakana AI', logo: '/logos/catalog/sakana.svg' },
  'atria-asi': { maker: 'Atria', logo: '/logos/catalog/atria-asi.svg' },
  typesafe: { maker: 'TypeSafe', logo: '/logos/catalog/typesafe.svg' },
  mindai: { maker: 'Mind Lab', logo: '/logos/catalog/macaron.svg' },
  'dots-studio': { maker: 'Dots Studio', logo: '/logos/catalog/dots.svg' },
};

const MAKERS: [RegExp, string][] = [
  [/claude|anthropic/i, 'Anthropic'],
  [/gpt|openai/i, 'OpenAI'],
  [/deepseek/i, 'DeepSeek'],
  [/qwen|alibaba/i, 'Qwen'],
  [/kimi|moonshot/i, 'Moonshot'],
  [/grok|xai/i, 'xAI'],
  [/glm|zhipu/i, 'Zhipu'],
  [/minimax/i, 'MiniMax'],
  [/gemini|google/i, 'Google'],
];

export const makerByPrefix = (publicModelId: string) =>
  publicModelId.includes('/') ? MAKER_BY_PREFIX[publicModelId.split('/')[0]!.toLowerCase()] : undefined;

export const makerFromId = (publicModelId: string) =>
  makerByPrefix(publicModelId)?.maker ?? MAKERS.find(([re]) => re.test(publicModelId))?.[1] ?? 'Other';
