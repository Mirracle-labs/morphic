// The model's maker, from its public id. Same keyword families ModelProviderLogo recognises.
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

export const makerFromId = (publicModelId: string) => MAKERS.find(([re]) => re.test(publicModelId))?.[1] ?? 'Other';
