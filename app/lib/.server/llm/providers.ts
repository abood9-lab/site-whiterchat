import type { ModelCategory, ModelInfo, ModelsApiResponse, ProviderCatalog, ProviderId } from '~/types/providers';
import { getGeminiAPIKey, getGroqAPIKey, getOpenRouterAPIKey } from './api-key';

export const DEFAULT_PROVIDER: ProviderId = 'openrouter';
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

let openRouterCache: CacheEntry<{ models: ModelInfo[]; source: 'live' | 'fallback' }> | null = null;
let groqCache: CacheEntry<{ models: ModelInfo[]; source: 'live' | 'fallback' }> | null = null;

function buildCapabilities({
  isFree,
  categories,
  contextLength,
}: {
  isFree?: boolean;
  categories: ModelCategory[];
  contextLength?: number;
}): string[] {
  const labels: string[] = [];

  if (isFree) {
    labels.push('Free');
  }

  if (categories.includes('coding')) {
    labels.push('Coding');
  }

  if (categories.includes('reasoning')) {
    labels.push('Reasoning');
  }

  if (categories.includes('fast')) {
    labels.push('Fast');
  }

  if (contextLength && contextLength >= 128000) {
    labels.push('Long Context');
  }

  return labels;
}

function classifyModel({
  id,
  name,
  description,
  isFree,
  contextLength,
}: {
  id: string;
  name: string;
  description?: string;
  isFree?: boolean;
  contextLength?: number;
}): { categories: ModelCategory[]; capabilities: string[] } {
  const haystack = `${id} ${name} ${description ?? ''}`.toLowerCase();
  const categories = new Set<ModelCategory>();

  if (isFree) {
    categories.add('free');
  }

  if (
    /coder|code|codestral|deepseek|claude|gpt-4o|gpt-5|gpt-oss|qwen|sonnet|kimi|devstral|minimax|gemini-4|llama-4|llama-3\.3/.test(
      haystack,
    )
  ) {
    categories.add('coding');
  }

  if (
    /reason|think|r1|o1|o3|o4|qwq|pro|opus|sonnet|gpt-oss-120b|kimi-k2|qwen3|maverick|hydrogen|deepseek-chat|compound/.test(
      haystack,
    )
  ) {
    categories.add('reasoning');
  }

  if (/flash|mini|instant|lite|nano|8b|7b|9b|haiku|fast|scout|turbo|20b|small|speed/.test(haystack)) {
    categories.add('fast');
  }

  const categoryList = Array.from(categories);

  return {
    categories: categoryList,
    capabilities: buildCapabilities({ isFree, categories: categoryList, contextLength }),
  };
}

function formatOpenRouterPricing(promptRaw?: string, completionRaw?: string, isFree?: boolean): string {
  if (isFree) {
    return 'Free';
  }

  const promptPerM = Number(promptRaw ?? '0') * 1_000_000;
  const completionPerM = Number(completionRaw ?? '0') * 1_000_000;

  if (!Number.isFinite(promptPerM) || !Number.isFinite(completionPerM) || (promptPerM === 0 && completionPerM === 0)) {
    return 'Free';
  }

  const fmt = (val: number) => (val < 0.01 ? val.toFixed(3) : val < 10 ? val.toFixed(2) : val.toFixed(1));

  return `$${fmt(promptPerM)} / $${fmt(completionPerM)} per 1M`;
}

function shortenDescription(raw?: string, fallback?: string): string {
  const text = (raw || fallback || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return 'Active text and code generation model';
  }

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;

  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence;
}

const OPENROUTER_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'openrouter/free',
    name: 'OpenRouter Free Models Router',
    provider: 'openrouter',
    contextLength: 200000,
    isFree: true,
    pricingLabel: 'Free',
    description: 'Automatically routes requests to the best available free active model.',
    categories: ['free', 'coding', 'fast'],
    capabilities: ['Free', 'Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct (free)',
    provider: 'openrouter',
    contextLength: 131072,
    isFree: true,
    pricingLabel: 'Free',
    description: 'Strong open-weight 70B instruction and full-stack coding model.',
    categories: ['free', 'coding'],
    capabilities: ['Free', 'Coding', 'Long Context'],
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B Instruct (free)',
    provider: 'openrouter',
    contextLength: 32768,
    isFree: true,
    pricingLabel: 'Free',
    description: 'Code-specialized model tuned for web generation, debugging, and refactoring.',
    categories: ['free', 'coding'],
    capabilities: ['Free', 'Coding'],
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    name: 'Mistral Small 3.1 24B (free)',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricingLabel: 'Free',
    description: 'Compact, responsive Mistral model with 128k context support.',
    categories: ['free', 'fast'],
    capabilities: ['Free', 'Fast', 'Long Context'],
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Google Gemma 3 27B IT (free)',
    provider: 'openrouter',
    contextLength: 131072,
    isFree: true,
    pricingLabel: 'Free',
    description: 'Open-weights Gemma 3 instruction model with long context window.',
    categories: ['free', 'coding'],
    capabilities: ['Free', 'Coding', 'Long Context'],
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'openrouter',
    contextLength: 163840,
    isFree: false,
    pricingLabel: '$0.27 / $1.10 per 1M',
    description: 'High-efficiency frontier coding and general reasoning model.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    contextLength: 163840,
    isFree: false,
    pricingLabel: '$0.55 / $2.19 per 1M',
    description: 'Step-by-step deep reasoning model for complex architecture and debugging.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Google: Gemini 2.5 Flash',
    provider: 'openrouter',
    contextLength: 1048576,
    isFree: false,
    pricingLabel: '$0.15 / $0.60 per 1M',
    description: 'High-speed multimodal workhorse with 1M context window.',
    categories: ['coding', 'fast'],
    capabilities: ['Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Anthropic: Claude 3.5 Sonnet',
    provider: 'openrouter',
    contextLength: 200000,
    isFree: false,
    pricingLabel: '$3.00 / $15.00 per 1M',
    description: 'Flagship code synthesis and software engineering model via OpenRouter.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'OpenAI: GPT-4o-mini',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: false,
    pricingLabel: '$0.15 / $0.60 per 1M',
    description: 'Lightweight, low-cost model for quick iterations and UI tasks.',
    categories: ['coding', 'fast'],
    capabilities: ['Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: false,
    pricingLabel: '$2.50 / $10.00 per 1M',
    description: 'Flagship omni-capable reasoning and coding model.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B Instruct',
    provider: 'openrouter',
    contextLength: 32768,
    isFree: false,
    pricingLabel: '$0.07 / $0.16 per 1M',
    description: 'Dedicated high-accuracy code generation and refactoring model.',
    categories: ['coding'],
    capabilities: ['Coding'],
  },
];

const GROQ_DEPRECATED_IDS = new Set([
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma-7b-it',
  'gemma2-9b-it',
  'llama-3.2-1b-preview',
  'llama-3.2-3b-preview',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
  'llama-guard-3-8b',
  'deepseek-r1-distill-llama-70b',
  'qwen-qwq-32b',
]);

const GROQ_CURATED_CATALOG: ModelInfo[] = [
  {
    id: 'openai/gpt-oss-120b',
    name: 'OpenAI GPT-OSS 120B',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.15 / $0.60 per 1M',
    description: '120B open-weight flagship with strong coding, tool use, and reasoning.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'OpenAI GPT-OSS 20B',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.07 / $0.30 per 1M',
    description: 'Ultra-fast 20B open-weight model built for responsive code edits.',
    categories: ['coding', 'fast'],
    capabilities: ['Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.59 / $0.79 per 1M',
    description: 'Meta production 70B model balanced for full-stack coding and chat.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.05 / $0.08 per 1M',
    description: 'Sub-second LPU inference for rapid prompt enhancement and quick tasks.',
    categories: ['fast'],
    capabilities: ['Fast', 'Long Context'],
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Alibaba Cloud Qwen 3.8 with advanced reasoning and tool execution.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'qwen/qwen3.6-27b',
    name: 'Qwen 3.6 27B',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Balanced Qwen 3.6 model for multi-file code and structured outputs.',
    categories: ['coding'],
    capabilities: ['Coding', 'Long Context'],
  },
  {
    id: 'qwen/qwen3-32b',
    name: 'Qwen 3 32B',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.29 / $0.59 per 1M',
    description: 'High-throughput reasoning and multilingual code synthesis model.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick 17B 128E',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.20 / $0.60 per 1M',
    description: 'Mixture-of-experts Llama 4 model for deep code and architecture tasks.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B 16E',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$0.11 / $0.34 per 1M',
    description: 'High-speed Llama 4 MoE model with fast token streaming.',
    categories: ['coding', 'fast'],
    capabilities: ['Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'moonshotai/kimi-k2-instruct',
    name: 'Kimi K2 Instruct',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: '$1.00 / $3.00 per 1M',
    description: 'Agentic coding specialist built for complex multi-step implementations.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'minimaxai/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Agentic engineering model tuned for tool workflows and web apps.',
    categories: ['coding', 'reasoning'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'meta-models/muse-spark-open',
    name: 'Muse Spark Open',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Fast creative and interactive web development open model on Groq.',
    categories: ['fast', 'coding'],
    capabilities: ['Coding', 'Fast', 'Long Context'],
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Compound AI system combining LPU inference with multi-step reasoning.',
    categories: ['reasoning', 'coding'],
    capabilities: ['Coding', 'Reasoning', 'Long Context'],
  },
  {
    id: 'groq/compound-mini',
    name: 'Groq Compound Mini',
    provider: 'groq',
    contextLength: 131072,
    pricingLabel: 'Groq Cloud',
    description: 'Streamlined low-latency Groq Compound system for rapid workflows.',
    categories: ['fast', 'reasoning'],
    capabilities: ['Reasoning', 'Fast', 'Long Context'],
  },
];

const GEMINI_ACTIVE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    provider: 'gemini',
    contextLength: 1048576,
    isFree: true,
    pricingLabel: 'Standard Key',
    description: 'Balanced Gemini 4 flagship for full-stack coding, UI synthesis, and chat.',
    categories: ['free', 'coding', 'reasoning', 'fast'],
    capabilities: ['Standard Key', 'Coding', 'Reasoning', 'Fast', 'Long Context'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'gemini',
    contextLength: 1048576,
    isFree: true,
    pricingLabel: 'Standard Key',
    description: 'Ultra-low-latency lightweight Gemini model ideal for fast edits and prompt enhancement.',
    categories: ['free', 'fast', 'coding'],
    capabilities: ['Standard Key', 'Coding', 'Fast', 'Long Context'],
  },
];

function isGroqChatModel(id: string): boolean {
  const lower = id.toLowerCase();

  if (GROQ_DEPRECATED_IDS.has(lower)) {
    return false;
  }

  return (
    !lower.includes('whisper') &&
    !lower.includes('tts') &&
    !lower.includes('playai') &&
    !lower.includes('guard') &&
    !lower.includes('safeguard') &&
    !lower.includes('orpheus') &&
    !lower.includes('allam')
  );
}

function formatGroqDisplayName(id: string): string {
  const clean = id.includes('/') ? id.split('/').pop() || id : id;

  return clean
    .split('-')
    .map((part) => (part.length <= 3 && /\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

interface OpenRouterRawModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  expiration_date?: string | null;
  architecture?: {
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

async function fetchOpenRouterModels(forceRefresh = false): Promise<{ models: ModelInfo[]; source: 'live' | 'fallback' }> {
  if (!forceRefresh && openRouterCache && Date.now() < openRouterCache.expiresAt) {
    return openRouterCache.value;
  }

  try {
    const apiKey = getOpenRouterAPIKey();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models?output_modalities=text', {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models API responded with ${response.status}`);
    }

    const json = (await response.json()) as { data?: OpenRouterRawModel[] };
    const now = Date.now();

    const parsed: ModelInfo[] = (json.data ?? [])
      .filter((item) => {
        if (!item.id || !item.name) {
          return false;
        }

        if (item.expiration_date) {
          const exp = Date.parse(item.expiration_date);
          if (!Number.isNaN(exp) && exp <= now) {
            return false;
          }
        }

        const outputs = item.architecture?.output_modalities;
        if (outputs && outputs.length > 0 && !outputs.includes('text')) {
          return false;
        }

        return true;
      })
      .map((item) => {
        const promptCost = Number(item.pricing?.prompt ?? '1');
        const completionCost = Number(item.pricing?.completion ?? '1');
        const isFree = item.id!.endsWith(':free') || (promptCost === 0 && completionCost === 0);
        const { categories, capabilities } = classifyModel({
          id: item.id!,
          name: item.name!,
          description: item.description,
          isFree,
          contextLength: item.context_length,
        });

        return {
          id: item.id!,
          name: item.name!,
          provider: 'openrouter' as const,
          contextLength: item.context_length,
          isFree,
          pricingLabel: formatOpenRouterPricing(item.pricing?.prompt, item.pricing?.completion, isFree),
          description: shortenDescription(item.description),
          categories,
          capabilities,
        };
      });

    if (parsed.length === 0) {
      throw new Error('OpenRouter returned empty model list');
    }

    const preferredOrder = new Map<string, number>([
      ['openrouter/free', 0],
      ['meta-llama/llama-3.3-70b-instruct:free', 1],
      ['qwen/qwen-2.5-coder-32b-instruct:free', 2],
      ['deepseek/deepseek-chat', 3],
      ['deepseek/deepseek-r1', 4],
      ['google/gemini-2.5-flash', 5],
      ['anthropic/claude-3.5-sonnet', 6],
      ['openai/gpt-4o', 7],
      ['openai/gpt-4o-mini', 8],
    ]);

    parsed.sort((a, b) => {
      const rankA = preferredOrder.get(a.id) ?? (a.isFree ? 50 : 100);
      const rankB = preferredOrder.get(b.id) ?? (b.isFree ? 50 : 100);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      return a.name.localeCompare(b.name);
    });

    const result = { models: parsed, source: 'live' as const };
    openRouterCache = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };

    return result;
  } catch (error) {
    console.warn('[models] OpenRouter live fetch failed, using curated fallback:', error);
    return { models: OPENROUTER_FALLBACK_MODELS, source: 'fallback' };
  }
}

interface GroqRawModel {
  id?: string;
  active?: boolean;
  context_window?: number;
}

async function fetchGroqModels(forceRefresh = false): Promise<{ models: ModelInfo[]; source: 'live' | 'fallback' }> {
  const apiKey = getGroqAPIKey();

  if (!apiKey) {
    return { models: GROQ_CURATED_CATALOG, source: 'fallback' };
  }

  if (!forceRefresh && groqCache && Date.now() < groqCache.expiresAt) {
    return groqCache.value;
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Groq models API responded with ${response.status}`);
    }

    const json = (await response.json()) as { data?: GroqRawModel[] };
    const curatedMap = new Map(GROQ_CURATED_CATALOG.map((m) => [m.id, m]));

    const parsed: ModelInfo[] = (json.data ?? [])
      .filter((item) => item.id && item.active !== false && isGroqChatModel(item.id))
      .map((item) => {
        const curated = curatedMap.get(item.id!);
        if (curated) {
          return {
            ...curated,
            contextLength: item.context_window ?? curated.contextLength,
          };
        }

        const displayName = formatGroqDisplayName(item.id!);
        const { categories, capabilities } = classifyModel({
          id: item.id!,
          name: displayName,
          contextLength: item.context_window,
        });

        return {
          id: item.id!,
          name: displayName,
          provider: 'groq' as const,
          contextLength: item.context_window,
          pricingLabel: 'Groq Cloud',
          description: 'Active production model served on Groq LPU inference.',
          categories,
          capabilities,
        };
      });

    if (parsed.length === 0) {
      throw new Error('Groq returned empty active chat model list');
    }

    const preferredOrder = new Map<string, number>(GROQ_CURATED_CATALOG.map((m, idx) => [m.id, idx]));

    parsed.sort((a, b) => {
      const rankA = preferredOrder.get(a.id) ?? 50;
      const rankB = preferredOrder.get(b.id) ?? 50;

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      return a.name.localeCompare(b.name);
    });

    const result = { models: parsed, source: 'live' as const };
    groqCache = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };

    return result;
  } catch (error) {
    console.warn('[models] Groq live fetch failed, using curated fallback:', error);
    return { models: GROQ_CURATED_CATALOG, source: 'fallback' };
  }
}

export async function getProvidersCatalog(forceRefresh = false): Promise<ModelsApiResponse> {
  const [openRouterResult, groqResult] = await Promise.all([
    fetchOpenRouterModels(forceRefresh),
    fetchGroqModels(forceRefresh),
  ]);

  const providers: ProviderCatalog[] = [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      description: 'Unified gateway to 100+ active open & frontier models',
      configured: Boolean(getOpenRouterAPIKey()),
      source: openRouterResult.source,
      models: openRouterResult.models,
    },
    {
      id: 'groq',
      name: 'Groq',
      description: 'Ultra-low-latency LPU inference for active open models',
      configured: Boolean(getGroqAPIKey()),
      source: groqResult.source,
      models: groqResult.models,
    },
    {
      id: 'gemini',
      name: 'Gemini',
      description: 'Google GenAI active models with 1M+ token context',
      configured: Boolean(getGeminiAPIKey()),
      source: 'live',
      models: GEMINI_ACTIVE_MODELS,
    },
  ];

  const openRouterDefault =
    openRouterResult.models.find((m) => m.id === DEFAULT_OPENROUTER_MODEL)?.id ??
    openRouterResult.models.find((m) => m.isFree)?.id ??
    openRouterResult.models[0]?.id ??
    DEFAULT_OPENROUTER_MODEL;

  return {
    providers,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: openRouterDefault,
  };
}

export function getDefaultModelForProvider(provider: ProviderId): string {
  switch (provider) {
    case 'openrouter':
      return DEFAULT_OPENROUTER_MODEL;
    case 'groq':
      return DEFAULT_GROQ_MODEL;
    case 'gemini':
      return DEFAULT_GEMINI_MODEL;
  }
}
