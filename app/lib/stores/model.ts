import { atom, map } from 'nanostores';
import type { ModelSelection, ModelsApiResponse, ProviderCatalog, ProviderId } from '~/types/providers';

const STORAGE_KEY = 'bolt_model_selection';
const FAVORITES_KEY = 'bolt_model_favorites';
const RECENTS_KEY = 'bolt_model_recents';
const MAX_RECENTS = 5;

export function makeModelKey(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

const INITIAL_PROVIDERS: ProviderCatalog[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified gateway to 100+ active open & frontier models',
    configured: true,
    source: 'fallback',
    models: [
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
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-low-latency LPU inference for active open models',
    configured: true,
    source: 'fallback',
    models: [
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
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google GenAI active models with 1M+ token context',
    configured: true,
    source: 'live',
    models: [
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
    ],
  },
];

function getInitialSelection(): ModelSelection {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ModelSelection>;
        if (
          (parsed.provider === 'openrouter' || parsed.provider === 'groq' || parsed.provider === 'gemini') &&
          typeof parsed.model === 'string' &&
          parsed.model.length > 0
        ) {
          return { provider: parsed.provider, model: parsed.model };
        }
      }
    } catch {
      // ignore invalid storage
    }
  }

  return {
    provider: 'openrouter',
    model: 'openrouter/free',
  };
}

function getInitialFavorites(): string[] {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string');
        }
      }
    } catch {
      // ignore
    }
  }

  return [];
}

function getInitialRecents(): ModelSelection[] {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(RECENTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is ModelSelection =>
              typeof item === 'object' &&
              item !== null &&
              (item.provider === 'openrouter' || item.provider === 'groq' || item.provider === 'gemini') &&
              typeof item.model === 'string',
          );
        }
      }
    } catch {
      // ignore
    }
  }

  return [];
}

export const modelSelectionStore = atom<ModelSelection>(getInitialSelection());
export const favoriteModelsStore = atom<string[]>(getInitialFavorites());
export const recentModelsStore = atom<ModelSelection[]>(getInitialRecents());

export const providerCatalogsStore = map<{
  providers: ProviderCatalog[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}>({
  providers: INITIAL_PROVIDERS,
  loading: false,
  loaded: false,
  error: null,
});

export function toggleFavoriteModel(provider: ProviderId, model: string) {
  const key = makeModelKey(provider, model);
  const current = favoriteModelsStore.get();
  const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current];

  favoriteModelsStore.set(next);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }
}

function recordRecentModel(provider: ProviderId, model: string) {
  const current = recentModelsStore.get();
  const next = [{ provider, model }, ...current.filter((item) => !(item.provider === provider && item.model === model))].slice(
    0,
    MAX_RECENTS,
  );

  recentModelsStore.set(next);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

export function setSelectedModel(provider: ProviderId, model: string, recordRecent = true) {
  const next: ModelSelection = { provider, model };
  modelSelectionStore.set(next);

  if (recordRecent) {
    recordRecentModel(provider, model);
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }
}

let inFlightRequest: Promise<void> | null = null;

export async function loadProviderCatalogs(forceRefresh = false): Promise<void> {
  if (!forceRefresh && providerCatalogsStore.get().loaded) {
    return;
  }

  if (inFlightRequest && !forceRefresh) {
    return inFlightRequest;
  }

  providerCatalogsStore.setKey('loading', true);
  providerCatalogsStore.setKey('error', null);

  inFlightRequest = (async () => {
    try {
      const response = await fetch(forceRefresh ? '/api/models?refresh=1' : '/api/models');

      if (!response.ok) {
        throw new Error(`Failed to fetch models (${response.status})`);
      }

      const data = (await response.json()) as ModelsApiResponse;

      providerCatalogsStore.set({
        providers: data.providers,
        loading: false,
        loaded: true,
        error: null,
      });

      const validKeys = new Set<string>();
      for (const p of data.providers) {
        for (const m of p.models) {
          validKeys.add(makeModelKey(p.id, m.id));
        }
      }

      const validRecents = recentModelsStore.get().filter((r) => validKeys.has(makeModelKey(r.provider, r.model)));
      if (validRecents.length !== recentModelsStore.get().length) {
        recentModelsStore.set(validRecents);
      }

      const current = modelSelectionStore.get();
      const currentProviderCatalog = data.providers.find((p) => p.id === current.provider);

      if (currentProviderCatalog && currentProviderCatalog.models.length > 0) {
        const stillExists = currentProviderCatalog.models.some((m) => m.id === current.model);
        if (!stillExists) {
          setSelectedModel(currentProviderCatalog.id, currentProviderCatalog.models[0].id, false);
        }
      } else {
        setSelectedModel(data.defaultProvider, data.defaultModel, false);
      }
    } catch (error) {
      providerCatalogsStore.setKey('loading', false);
      providerCatalogsStore.setKey('error', error instanceof Error ? error.message : 'Unable to load active models');
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}
