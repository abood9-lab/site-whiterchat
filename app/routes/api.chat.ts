import { json, type ActionFunctionArgs } from '@remix-run/node';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import {
  ProviderRequestError,
  streamText,
  type Messages,
  type StreamingOptions,
} from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { ExecutionMode, PlanPhase } from '~/lib/stores/executionMode';
import type { RuntimeEnvironment } from '~/lib/stores/runtime';
import type { ProviderId } from '~/types/providers';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ request }: ActionFunctionArgs) {
  const { messages, provider, model, mode, planPhase, environment, analyzeEnvironment } =
    (await request.json()) as {
      messages: Messages;
      provider?: ProviderId;
      model?: string;
      mode?: ExecutionMode;
      planPhase?: PlanPhase;
      environment?: RuntimeEnvironment;
      analyzeEnvironment?: boolean;
    };

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      provider,
      model,
      mode: mode === 'plan' ? 'plan' : 'build',
      planPhase,
      environment: environment === 'daytona' ? 'daytona' : 'webcontainer',
      analyzeEnvironment: Boolean(analyzeEnvironment),
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, process.env, options);

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, process.env, options);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[api.chat]', error);

    if (error instanceof ProviderRequestError) {
      return json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Internal Server Error';

    return json({ error: message }, { status: 500 });
  }
}
