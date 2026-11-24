import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ExecutionMode, PlanPhase } from '~/lib/stores/executionMode';
import type { RuntimeEnvironment } from '~/lib/stores/runtime';
import type { ProviderId } from '~/types/providers';
import { getProviderAPIKey } from './api-key';
import { MAX_TOKENS } from './constants';
import { getDefaultModelForProvider } from './providers';
import {
  getEnvironmentAnalysisPrompt,
  getPlanDraftPrompt,
  getPlanQuestionsPrompt,
  getSystemPrompt,
} from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export interface StreamingFinishEvent {
  text: string;
  finishReason: string;
}

export interface StreamingOptions {
  provider?: ProviderId;
  model?: string;
  mode?: ExecutionMode;
  planPhase?: PlanPhase;
  environment?: RuntimeEnvironment;
  analyzeEnvironment?: boolean;
  toolChoice?: string;
  onFinish?: (event: StreamingFinishEvent) => Promise<void> | void;
}

export class ProviderRequestError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
  }
}

function normalizeProvider(provider?: string): ProviderId {
  if (provider === 'groq' || provider === 'gemini' || provider === 'openrouter') {
    return provider;
  }

  return 'openrouter';
}

function createAIStreamResult(
  generatorFactory: () => AsyncGenerator<{ text?: string; finishReason?: string }, void, unknown>,
  onFinish?: StreamingOptions['onFinish'],
) {
  const encoder = new TextEncoder();
  const iterator = generatorFactory();
  let fullText = '';
  let finishReason = 'stop';
  let sentFinishPart = false;
  let closed = false;

  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) {
        return;
      }

      if (sentFinishPart) {
        closed = true;
        controller.close();

        if (onFinish) {
          await onFinish({ text: fullText, finishReason });
        }

        return;
      }

      try {
        while (true) {
          const { value, done } = await iterator.next();

          if (done) {
            sentFinishPart = true;
            controller.enqueue(
              encoder.encode(
                `d:${JSON.stringify({ finishReason, usage: { promptTokens: 0, completionTokens: 0 } })}\n`,
              ),
            );
            return;
          }

          if (value.finishReason) {
            finishReason = value.finishReason;
          }

          if (value.text) {
            fullText += value.text;
            controller.enqueue(encoder.encode(`0:${JSON.stringify(value.text)}\n`));
            return;
          }
        }
      } catch (err) {
        closed = true;
        controller.error(err);
      }
    },
    async cancel() {
      closed = true;
      await iterator.return?.();
    },
  });

  return {
    toAIStream: () => readable,
  };
}

async function streamOpenAICompatible({
  endpoint,
  apiKey,
  providerLabel,
  model,
  systemPrompt,
  messages,
  extraHeaders,
  onFinish,
}: {
  endpoint: string;
  apiKey: string;
  providerLabel: string;
  model: string;
  systemPrompt: string;
  messages: Messages;
  extraHeaders?: Record<string, string>;
  onFinish?: StreamingOptions['onFinish'];
}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      max_tokens: MAX_TOKENS,
      stream: true,
    }),
  });

  if (!response.ok) {
    let errorMessage = `${providerLabel} API request failed (${response.status})`;

    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      errorMessage = parsed.error?.message || parsed.message || errorMessage;
    } catch {
      // keep default error message
    }

    throw new ProviderRequestError(errorMessage, response.status);
  }

  if (!response.body) {
    throw new ProviderRequestError(`${providerLabel} returned an empty response body`, 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return createAIStreamResult(async function* () {
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || !line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();

        if (payload === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(payload) as {
            error?: { message?: string };
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
          };

          if (parsed.error?.message) {
            throw new ProviderRequestError(parsed.error.message, 502);
          }

          const choice = parsed.choices?.[0];
          const deltaText = choice?.delta?.content;
          const finishReason = choice?.finish_reason ?? undefined;

          if (deltaText || finishReason) {
            yield { text: deltaText, finishReason };
          }
        } catch (err) {
          if (err instanceof ProviderRequestError) {
            throw err;
          }
        }
      }
    }
  }, onFinish);
}

export async function streamText(
  messages: Messages,
  env?: Record<string, string | undefined>,
  options?: StreamingOptions,
) {
  const provider = normalizeProvider(options?.provider);
  const model = options?.model?.trim() || getDefaultModelForProvider(provider);
  const apiKey = getProviderAPIKey(provider, env);

  if (!apiKey) {
    const envVarName =
      provider === 'openrouter'
        ? 'OPENROUTER_API_KEY'
        : provider === 'groq'
          ? 'GROQ_API_KEY'
          : 'GEMINI_API_KEY';

    throw new ProviderRequestError(
      `Missing ${envVarName} in server environment secrets. Add ${envVarName} to use ${provider}.`,
      401,
    );
  }

  const targetEnvironment: RuntimeEnvironment = options?.environment === 'daytona' ? 'daytona' : 'webcontainer';

  const systemPrompt = options?.analyzeEnvironment
    ? getEnvironmentAnalysisPrompt()
    : options?.mode === 'plan'
      ? options.planPhase === 'questions'
        ? getPlanQuestionsPrompt(targetEnvironment)
        : getPlanDraftPrompt(targetEnvironment)
      : getSystemPrompt(undefined, targetEnvironment);

  if (provider === 'openrouter') {
    return streamOpenAICompatible({
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey,
      providerLabel: 'OpenRouter',
      model,
      systemPrompt,
      messages,
      extraHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'Bolt',
      },
      onFinish: options?.onFinish,
    });
  }

  if (provider === 'groq') {
    return streamOpenAICompatible({
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey,
      providerLabel: 'Groq',
      model,
      systemPrompt,
      messages,
      onFinish: options?.onFinish,
    });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const isGemini4 = model.startsWith('gemini-4-');

  let response;
  try {
    response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(isGemini4 ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      },
    });
  } catch (err) {
    let message = err instanceof Error ? err.message : 'Gemini API request failed';
    let status = 502;

    if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      status = (err as { status: number }).status;
    }

    try {
      let parsed: unknown = JSON.parse(message);
      while (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        const inner = (parsed as { error: unknown }).error;
        if (typeof inner === 'object' && inner !== null && 'message' in inner && typeof (inner as { message: unknown }).message === 'string') {
          const innerMsg = (inner as { message: string }).message;
          try {
            parsed = JSON.parse(innerMsg);
          } catch {
            message = innerMsg;
            break;
          }
        } else {
          break;
        }
      }
    } catch {
      // keep raw message
    }

    throw new ProviderRequestError(message, status);
  }

  return createAIStreamResult(async function* () {
    for await (const chunk of response) {
      const text = chunk.text;

      if (text) {
        yield { text };
      }
    }

    yield { finishReason: 'stop' };
  }, options?.onFinish);
}
