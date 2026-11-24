import { useState } from 'react';
import { toast } from 'react-toastify';
import { modelSelectionStore } from '~/lib/stores/model';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = () => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (input: string, setInput: (value: string) => void) => {
    setEnhancingPrompt(true);
    setPromptEnhanced(false);

    const { provider, model } = modelSelectionStore.get();
    const originalInput = input;

    try {
      const response = await fetch('/api/enhancer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: input,
          provider,
          model,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Failed to enhance prompt (${response.status})`;

        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) {
            errorMessage = data.error;
          }
        } catch {
          // keep default message
        }

        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();

      if (reader) {
        const decoder = new TextDecoder();
        let _input = '';

        setInput('');

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          _input += decoder.decode(value, { stream: true });

          logger.trace('Set input', _input);

          setInput(_input);
        }

        setPromptEnhanced(true);

        setTimeout(() => {
          setInput(_input);
        });
      }
    } catch (error) {
      logger.error(error);
      setInput(originalInput);
      toast.error(error instanceof Error ? error.message : 'Failed to enhance prompt');
    } finally {
      setEnhancingPrompt(false);
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
