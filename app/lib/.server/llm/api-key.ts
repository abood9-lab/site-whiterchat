import type { ProviderId } from '~/types/providers';

export function getOpenRouterAPIKey(envOverride?: Record<string, string | undefined>) {
  return process.env.OPENROUTER_API_KEY || envOverride?.OPENROUTER_API_KEY || '';
}

export function getGroqAPIKey(envOverride?: Record<string, string | undefined>) {
  return process.env.GROQ_API_KEY || envOverride?.GROQ_API_KEY || '';
}

export function getGeminiAPIKey(envOverride?: Record<string, string | undefined>) {
  return process.env.GEMINI_API_KEY || envOverride?.GEMINI_API_KEY || '';
}

export function getProviderAPIKey(provider: ProviderId, envOverride?: Record<string, string | undefined>): string {
  switch (provider) {
    case 'openrouter':
      return getOpenRouterAPIKey(envOverride);
    case 'groq':
      return getGroqAPIKey(envOverride);
    case 'gemini':
      return getGeminiAPIKey(envOverride);
  }
}
