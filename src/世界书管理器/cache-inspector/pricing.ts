import type { CacheCostSnapshot, CacheUsageSnapshot, PricingSnapshot } from './types';

type PricingProvider = PricingSnapshot['provider'];

type PricingRateSet = {
  inputHitUsdPerMillion: number;
  inputMissUsdPerMillion: number;
  outputUsdPerMillion: number;
  note: string | null;
};

type PricingRule = {
  id: string;
  provider: PricingProvider;
  label: string;
  sourceUrl: string;
  sourceDate: string;
  matches: (model: string) => boolean;
  rates: (usage: CacheUsageSnapshot) => PricingRateSet;
};

const SOURCE_DATE = '2026-05-06';
const GEMINI_PRO_THRESHOLD = 200_000;

const PRICING_RULES: PricingRule[] = [
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    label: 'DeepSeek V4 Pro',
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    sourceDate: SOURCE_DATE,
    matches: model => includesAny(model, ['deepseek-v4-pro', 'deepseek_v4_pro', 'deepseek pro', 'deepseek-pro']),
    rates: () => ({
      inputHitUsdPerMillion: 0.003625,
      inputMissUsdPerMillion: 0.435,
      outputUsdPerMillion: 0.87,
      note: 'DeepSeek v4-pro current official listed rate.',
    }),
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    label: 'DeepSeek V4 Flash / chat / reasoner',
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    sourceDate: SOURCE_DATE,
    matches: model =>
      includesAny(model, ['deepseek-v4-flash', 'deepseek_v4_flash', 'deepseek-chat', 'deepseek-reasoner', 'deepseek flash']),
    rates: () => ({
      inputHitUsdPerMillion: 0.0028,
      inputMissUsdPerMillion: 0.14,
      outputUsdPerMillion: 0.28,
      note: 'DeepSeek chat/reasoner compatibility aliases use the v4-flash row.',
    }),
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro Preview',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    sourceDate: SOURCE_DATE,
    matches: model =>
      includesAny(model, [
        'gemini-3.1-pro-preview',
        'gemini-3.1-pro-preview-customtools',
        'gemini-3.1-pro',
        'gemini 3.1 pro',
      ]),
    rates: usage => {
      const promptTokens = usage.totalCacheTokens;
      const largePrompt = promptTokens > GEMINI_PRO_THRESHOLD;
      return {
        inputHitUsdPerMillion: largePrompt ? 0.4 : 0.2,
        inputMissUsdPerMillion: largePrompt ? 4 : 2,
        outputUsdPerMillion: largePrompt ? 18 : 12,
        note: largePrompt ? 'Gemini 3.1 Pro Preview standard prompts > 200k tier.' : 'Gemini 3.1 Pro Preview standard prompts <= 200k tier.',
      };
    },
  },
  {
    id: 'gpt-5.5',
    provider: 'openai',
    label: 'GPT-5.5',
    sourceUrl: 'https://openai.com/api/pricing/',
    sourceDate: SOURCE_DATE,
    matches: model => normalizedModel(model).includes('gpt-5.5'),
    rates: () => ({
      inputHitUsdPerMillion: 0.5,
      inputMissUsdPerMillion: 5,
      outputUsdPerMillion: 30,
      note: 'OpenAI standard processing price for context lengths under 270K.',
    }),
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    label: 'GPT-5.4 mini',
    sourceUrl: 'https://openai.com/api/pricing/',
    sourceDate: SOURCE_DATE,
    matches: model => normalizedModel(model).includes('gpt-5.4-mini') || normalizedModel(model).includes('gpt-5.4 mini'),
    rates: () => ({
      inputHitUsdPerMillion: 0.075,
      inputMissUsdPerMillion: 0.75,
      outputUsdPerMillion: 4.5,
      note: 'OpenAI standard processing price for context lengths under 270K.',
    }),
  },
  {
    id: 'gpt-5.4',
    provider: 'openai',
    label: 'GPT-5.4',
    sourceUrl: 'https://openai.com/api/pricing/',
    sourceDate: SOURCE_DATE,
    matches: model => normalizedModel(model).includes('gpt-5.4'),
    rates: () => ({
      inputHitUsdPerMillion: 0.25,
      inputMissUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
      note: 'OpenAI standard processing price for context lengths under 270K.',
    }),
  },
];

export function estimateCacheCost(
  model: string,
  usage: CacheUsageSnapshot,
): {
  pricingSnapshot: PricingSnapshot | null;
  costSnapshot: CacheCostSnapshot | null;
} {
  const rule = PRICING_RULES.find(candidate => candidate.matches(model));
  if (!rule) {
    return {
      pricingSnapshot: null,
      costSnapshot: null,
    };
  }

  const rates = rule.rates(usage);
  const pricingSnapshot: PricingSnapshot = {
    id: rule.id,
    provider: rule.provider,
    label: rule.label,
    sourceUrl: rule.sourceUrl,
    sourceDate: rule.sourceDate,
    inputHitUsdPerMillion: rates.inputHitUsdPerMillion,
    inputMissUsdPerMillion: rates.inputMissUsdPerMillion,
    outputUsdPerMillion: rates.outputUsdPerMillion,
    note: rates.note,
  };

  const hasBillableTokens = usage.hitTokens > 0 || usage.missTokens > 0 || usage.outputTokens > 0;
  if (!hasBillableTokens) {
    return {
      pricingSnapshot,
      costSnapshot: null,
    };
  }

  const inputHitUsd = priceTokens(usage.hitTokens, rates.inputHitUsdPerMillion);
  const inputMissUsd = priceTokens(usage.missTokens, rates.inputMissUsdPerMillion);
  const outputUsd = priceTokens(usage.outputTokens, rates.outputUsdPerMillion);

  return {
    pricingSnapshot,
    costSnapshot: {
      currency: 'USD',
      inputHitUsd,
      inputMissUsd,
      outputUsd,
      totalUsd: inputHitUsd + inputMissUsd + outputUsd,
      savedUsd: Math.max(0, priceTokens(usage.hitTokens, rates.inputMissUsdPerMillion - rates.inputHitUsdPerMillion)),
    },
  };
}

function priceTokens(tokens: number, usdPerMillion: number): number {
  return (tokens * usdPerMillion) / 1_000_000;
}

function includesAny(model: string, fragments: string[]): boolean {
  const normalized = normalizedModel(model);
  return fragments.some(fragment => normalized.includes(fragment));
}

function normalizedModel(model: string): string {
  return model.trim().toLowerCase();
}
