export type ProviderId = 'openrouter' | 'groq' | 'gemini';

export type ModelCategory = 'free' | 'coding' | 'reasoning' | 'fast';

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  contextLength?: number;
  isFree?: boolean;
  pricingLabel?: string;
  description?: string;
  categories: ModelCategory[];
  capabilities: string[];
}

export interface ProviderCatalog {
  id: ProviderId;
  name: string;
  description: string;
  configured: boolean;
  source: 'live' | 'fallback';
  models: ModelInfo[];
}

export interface ModelsApiResponse {
  providers: ProviderCatalog[];
  defaultProvider: ProviderId;
  defaultModel: string;
}

export interface ModelSelection {
  provider: ProviderId;
  model: string;
}
