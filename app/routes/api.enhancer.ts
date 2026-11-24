import { json, type ActionFunctionArgs } from '@remix-run/node';
import { StreamingTextResponse, parseStreamPart } from 'ai';
import { ProviderRequestError, streamText } from '~/lib/.server/llm/stream-text';
import type { ProviderId } from '~/types/providers';
import { stripIndents } from '~/utils/stripIndent';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function action(args: ActionFunctionArgs) {
  return enhancerAction(args);
}

async function enhancerAction({ request }: ActionFunctionArgs) {
  const { message, provider, model } = (await request.json()) as {
    message: string;
    provider?: ProviderId;
    model?: string;
  };

  try {
    const result = await streamText(
      [
        {
          role: 'user',
          content: stripIndents`
          I want you to improve the user prompt that is wrapped in \`<original_prompt>\` tags.

          IMPORTANT: Only respond with the improved prompt and nothing else!

          <original_prompt>
            ${message}
          </original_prompt>
        `,
        },
      ],
      process.env,
      { provider, model },
    );

    let buffer = '';

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        const processedChunk = lines
          .filter((line) => line.trim() !== '')
          .map(parseStreamPart)
          .filter((part) => part.type === 'text')
          .map((part) => part.value)
          .join('');

        if (processedChunk) {
          controller.enqueue(encoder.encode(processedChunk));
        }
      },
      flush(controller) {
        if (buffer.trim() !== '') {
          const part = parseStreamPart(buffer.trim());
          if (part.type === 'text' && typeof part.value === 'string') {
            controller.enqueue(encoder.encode(part.value));
          }
        }
      },
    });

    const transformedStream = result.toAIStream().pipeThrough(transformStream);

    return new StreamingTextResponse(transformedStream);
  } catch (error) {
    console.error('[api.enhancer]', error);

    if (error instanceof ProviderRequestError) {
      return json({ error: error.message }, { status: error.status });
    }

    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';

    return json({ error: errorMessage }, { status: 500 });
  }
}
