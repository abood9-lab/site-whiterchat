import { useLoaderData, useNavigate } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { setActiveProjectId } from '~/lib/stores/runtime';
import { workbenchStore } from '~/lib/stores/workbench';
import { waitForAuthReady } from '~/lib/firebase';
import { getMessages, getNextId, getUrlId, openDatabase, setMessages } from './db';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

export function useChatHistory() {
  const navigate = useNavigate();
  const loaderData = useLoaderData<{ id?: string } | null>();
  const mixedId = loaderData?.id;

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  useEffect(() => {
    let active = true;

    async function initHistory() {
      if (!db) {
        if (active) {
          setReady(true);

          if (persistenceEnabled) {
            toast.error('Chat persistence is unavailable');
          }
        }

        return;
      }

      if (!mixedId || mixedId === 'new') {
        chatId.set(undefined);
        setActiveProjectId(undefined);
        description.set(undefined);

        if (active) {
          setReady(true);
        }

        return;
      }

      try {
        const user = await waitForAuthReady();

        if (!user) {
          if (active) {
            setReady(true);
          }

          return;
        }

        const storedMessages = await getMessages(db, mixedId);

        if (!active) {
          return;
        }

        if (storedMessages && storedMessages.messages.length > 0) {
          setInitialMessages(storedMessages.messages);
          setUrlId(storedMessages.urlId);
          description.set(storedMessages.description);
          chatId.set(storedMessages.id);
          setActiveProjectId(storedMessages.id);
        } else {
          navigate('/chat/new', { replace: true });
        }

        setReady(true);
      } catch (error: any) {
        if (active) {
          toast.error(error?.message || 'Failed to load conversation');
          setReady(true);
        }
      }
    }

    void initHistory();

    return () => {
      active = false;
    };
  }, [mixedId, navigate]);

  return {
    ready: !mixedId || mixedId === 'new' || ready,
    initialMessages,
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      const user = await waitForAuthReady();

      if (!user) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      let currentId = chatId.get();
      if (!currentId) {
        currentId = await getNextId(db);
        chatId.set(currentId);
        setActiveProjectId(currentId);
      }

      let activeUrlId = urlId;
      if (!activeUrlId) {
        activeUrlId = await getUrlId(db, currentId);
        setUrlId(activeUrlId);
        navigateChat(activeUrlId);
      }

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      await setMessages(db, currentId, messages, activeUrlId, description.get());
    },
  };
}

function navigateChat(nextId: string) {
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;
  url.search = '';

  window.history.replaceState({}, '', url);
}
