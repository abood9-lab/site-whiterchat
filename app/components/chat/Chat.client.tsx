import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import {
  ensureProjectWorkspace,
  normalizeWorkspaceRelPath,
  notifyWorkspaceOperationState,
  startWorkspacePresenceLifecycle,
  uploadFileToDaytonaWorkspace,
  writeWorkspaceFilesBatchClient,
  type WorkspaceSnapshotEntry,
  type WorkspaceSnapshotFile,
} from '~/lib/daytona/workspace.client';
import { waitForAuthReady } from '~/lib/firebase';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatId as chatIdStore, useChatHistory } from '~/lib/persistence';
import { parsePlanBlockContent, parsePlanQuestionsContent, parseSecretsBlockContent } from '~/lib/plan/parser';
import { chatStore } from '~/lib/stores/chat';
import {
  closeQuestionWizard,
  executionModeStore,
  openQuestionWizard,
  resetPlanWorkflowForNewChat,
  setExecutionMode,
  type ExecutionMode,
  type PlanPhase,
} from '~/lib/stores/executionMode';
import { modelSelectionStore, setSelectedModel } from '~/lib/stores/model';
import {
  activeEnvironmentStore,
  checkDaytonaStatus,
  daytonaStateStore,
  ensureDaytonaSandbox,
  environmentChosenForChatStore,
  isWorkspaceFileSynced,
  markWorkspaceFilesSynced,
  resetRuntimeForNewChat,
  runtimePreferenceStore,
  setActiveEnvironment,
  setActiveProjectId,
  setRuntimePreference,
  type RuntimeEnvironment,
} from '~/lib/stores/runtime';
import { workbenchStore, type ActiveWorkbenchPlan } from '~/lib/stores/workbench';
import {
  findWorkspaceFileContent,
  mergeRequestedSecrets,
  openSecretsDockFromEnvExample,
  openSecretsDockFromMessage,
  resetSecretsForNewChat,
} from '~/lib/stores/secrets';
import type { ProviderId } from '~/types/providers';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat, type UploadedAttachment } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

const SHOULD_SKIP_CLOUD_SYNC = (filePath: string) =>
  /(^|\/)node_modules(\/|$)/.test(filePath) ||
  /(^|\/)\.git(\/|$)/.test(filePath) ||
  /(^|\/)\.vite(\/|$)/.test(filePath);

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialPromptHandledRef = useRef(false);
  const restoredChatIdRef = useRef<string | null>(null);
  const autoOpenedPlanIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const autoOpenedQuestionIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const pendingPromptForEnvChoiceRef = useRef<string>('');

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [isRestoringFiles, setIsRestoringFiles] = useState(false);

  const { showChat } = useStore(chatStore);
  const activeChatId = useStore(chatIdStore);
  const selectedModel = useStore(modelSelectionStore);
  const executionMode = useStore(executionModeStore);
  const activeEnvironment = useStore(activeEnvironmentStore);
  const daytonaState = useStore(daytonaStateStore);
  const workbenchFiles = useStore(workbenchStore.files);

  const [animationScope, animate] = useAnimate();

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    body: {
      provider: selectedModel.provider,
      model: selectedModel.model,
      mode: executionMode,
      environment: activeEnvironment,
    },
    onError: (error) => {
      logger.error('Request failed\n\n', error);
      let message = error.message || 'There was an error processing your request';

      try {
        const parsed = JSON.parse(message) as { error?: string };
        if (parsed.error) {
          message = parsed.error;
        }
      } catch {
        // use raw message
      }

      toast.error(message);
    },
    onFinish: () => {
      logger.debug('Finished streaming');
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
    void checkDaytonaStatus();

    if (initialMessages.length > 0) {
      environmentChosenForChatStore.set(true);
      const lastEnvMsg = [...initialMessages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.includes('Selected environment: '));

      if (lastEnvMsg?.content.includes('Selected environment: Daytona')) {
        setActiveEnvironment('daytona', false);
      } else if (lastEnvMsg?.content.includes('Selected environment: WebContainer')) {
        setActiveEnvironment('webcontainer', false);
      }

      // Restore latest plan and requested secrets metadata from chat history
      let latestPlan: ActiveWorkbenchPlan | null = null;
      for (let i = 0; i < initialMessages.length; i++) {
        const msg = initialMessages[i];
        if (msg.role !== 'assistant') {
          continue;
        }
        const parsedSecrets = parseSecretsBlockContent(msg.content);
        if (parsedSecrets.status === 'ready' && parsedSecrets.data) {
          mergeRequestedSecrets(parsedSecrets.data.secrets);
        }
      }

      for (let i = initialMessages.length - 1; i >= 0; i--) {
        const msg = initialMessages[i];
        if (msg.role !== 'assistant') {
          continue;
        }
        const parsedPlan = parsePlanBlockContent(msg.content);
        if (parsedPlan.status === 'ready' && parsedPlan.data) {
          const hasFollowUp = initialMessages.slice(i + 1).some((item) => item.role === 'user');
          latestPlan = {
            ...parsedPlan.data,
            messageId: msg.id,
            isApproved: hasFollowUp,
          };
          break;
        }
      }
      workbenchStore.setCurrentPlan(latestPlan);
    } else {
      workbenchStore.setCurrentPlan(null);
      resetPlanWorkflowForNewChat();
      resetSecretsForNewChat();
    }
  }, []);

  // Keep active project ID synced and run Daytona sandbox presence + automatic unload shutdown lifecycle
  useEffect(() => {
    const targetProject = activeChatId || 'default_workspace';
    setActiveProjectId(targetProject);

    if (!daytonaState.configured) {
      return;
    }

    return startWorkspacePresenceLifecycle({
      projectId: targetProject,
      getSandboxId: () => daytonaStateStore.get().sandboxId,
    });
  }, [activeChatId, daytonaState.configured]);

  // Prevent automatic sandbox shutdown while an AI generation stream is active
  useEffect(() => {
    if (!isLoading || !daytonaState.configured) {
      return;
    }

    const targetProject = activeChatId || 'default_workspace';
    const opId = `ai_stream_${Date.now().toString(36)}`;
    void notifyWorkspaceOperationState(targetProject, opId, 'start');

    return () => {
      void notifyWorkspaceOperationState(targetProject, opId, 'end');
    };
  }, [isLoading, activeChatId, daytonaState.configured]);

  // Restore saved workspace files and .env secrets from persistent Daytona Volume
  useEffect(() => {
    if (initialMessages.length === 0 || !activeChatId || restoredChatIdRef.current === activeChatId) {
      return;
    }

    let cancelled = false;
    restoredChatIdRef.current = activeChatId;
    setIsRestoringFiles(true);

    void (async () => {
      try {
        const user = await waitForAuthReady();
        if (!user || cancelled) {
          return;
        }

        setActiveProjectId(activeChatId);
        let restoredFiles: WorkspaceSnapshotFile[] = [];
        let restoredEntries: WorkspaceSnapshotEntry[] = [];

        const ensured = await ensureProjectWorkspace({
          projectId: activeChatId,
          includeFiles: true,
        });

        if (cancelled) {
          return;
        }

        if (ensured.configured && ensured.sandboxId) {
          daytonaStateStore.setKey('configured', true);
          daytonaStateStore.setKey('statusLoaded', true);
          daytonaStateStore.setKey('projectId', activeChatId);
          daytonaStateStore.setKey('sandboxId', ensured.sandboxId);
          daytonaStateStore.setKey('workdir', ensured.workdir || '/workspace');
          daytonaStateStore.setKey('cwd', ensured.workdir || '/workspace');
          daytonaStateStore.setKey('volumeName', ensured.volumeName || 'whiterchat-project-storage');
          daytonaStateStore.setKey('volumeSubpath', ensured.volumeSubpath || '');
          daytonaStateStore.setKey('status', 'ready');

          restoredFiles = Array.isArray(ensured.files) ? ensured.files : [];
          restoredEntries = Array.isArray(ensured.entries) ? ensured.entries : [];
        }

        if (cancelled || (restoredFiles.length === 0 && restoredEntries.length === 0)) {
          return;
        }

        workbenchStore.hydrateFromDaytonaSnapshot(restoredFiles, restoredEntries, {
          projectId: activeChatId,
          pruneRemoved: false,
          onlyIfDifferent: false,
          openWorkbench: true,
          selectDefaultFile: true,
        });

        // Re-apply after initial history <boltAction> replay settles so Volume edits and .env never get clobbered
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (cancelled) {
          return;
        }

        workbenchStore.hydrateFromDaytonaSnapshot(restoredFiles, restoredEntries, {
          projectId: activeChatId,
          pruneRemoved: false,
          onlyIfDifferent: true,
          openWorkbench: true,
          selectDefaultFile: false,
        });
      } catch (error) {
        logger.error('Failed to restore workspace files from Daytona Volume', error);
      } finally {
        if (!cancelled) {
          setIsRestoringFiles(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChatId, initialMessages.length]);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  // Auto-open PromptQuestionsWizard above prompt box once clarifying questions finish streaming
  useEffect(() => {
    if (isLoading || messages.length === 0) {
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      return;
    }

    if (autoOpenedQuestionIdsRef.current.has(lastMsg.id)) {
      return;
    }

    const parsedQuestions = parsePlanQuestionsContent(lastMsg.content);
    if (parsedQuestions.status === 'ready' && parsedQuestions.data) {
      autoOpenedQuestionIdsRef.current.add(lastMsg.id);
      openQuestionWizard(lastMsg.id, parsedQuestions.data);
    }
  }, [messages, isLoading]);

  // Auto-open Workbench directly on the Plan tab when a new plan finishes streaming
  useEffect(() => {
    if (isLoading || messages.length === 0) {
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      return;
    }

    if (autoOpenedPlanIdsRef.current.has(lastMsg.id)) {
      return;
    }

    const parsedPlan = parsePlanBlockContent(lastMsg.content);
    if (parsedPlan.status === 'ready' && parsedPlan.data) {
      autoOpenedPlanIdsRef.current.add(lastMsg.id);
      closeQuestionWizard();
      workbenchStore.openPlanInWorkbench({
        ...parsedPlan.data,
        messageId: lastMsg.id,
        isApproved: false,
      });
    }
  }, [messages, isLoading]);

  // Immediately slide out PromptSecretsDock above prompt box as soon as <boltSecrets> finishes parsing
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      return;
    }

    if (initialMessages.some((m) => m.id === lastMsg.id)) {
      return;
    }

    const parsedSecrets = parseSecretsBlockContent(lastMsg.content);
    if (parsedSecrets.status === 'ready' && parsedSecrets.data) {
      openSecretsDockFromMessage(
        lastMsg.id,
        parsedSecrets.data.secrets,
        workbenchStore.files.get(),
        parsedSecrets.data.intro,
      );
    }
  }, [messages, initialMessages]);

  // Fallback trigger: detect newly written .env.example during an active build turn
  useEffect(() => {
    if (messages.length <= initialMessages.length && !isLoading) {
      return;
    }

    const envExampleContent = findWorkspaceFileContent(workbenchFiles, '.env.example');
    if (envExampleContent) {
      openSecretsDockFromEnvExample(envExampleContent, workbenchFiles);
    }
  }, [workbenchFiles, messages.length, initialMessages.length, isLoading]);

  // Automatically execute ?prompt=... passed from Landing Page after sign-in
  useEffect(() => {
    if (initialPromptHandledRef.current || initialMessages.length > 0) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const urlPrompt = params.get('prompt');
    const urlProvider = params.get('provider') as ProviderId | null;
    const urlModel = params.get('model');
    const urlMode = params.get('mode');
    const urlEnv = params.get('env');

    if (urlProvider && urlModel) {
      setSelectedModel(urlProvider, urlModel);
    }

    const modeToUse: ExecutionMode = urlMode === 'plan' ? 'plan' : 'build';
    if (urlMode === 'plan' || urlMode === 'build') {
      setExecutionMode(modeToUse);
    }

    if (urlEnv === 'webcontainer' || urlEnv === 'daytona') {
      setRuntimePreference(urlEnv);
    } else {
      resetRuntimeForNewChat();
    }

    if (urlPrompt && urlPrompt.trim()) {
      initialPromptHandledRef.current = true;

      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = '';
      window.history.replaceState({}, '', cleanUrl);

      const providerToUse = urlProvider || selectedModel.provider;
      const modelToUse = urlModel || selectedModel.model;
      const explicitEnv = urlEnv === 'webcontainer' || urlEnv === 'daytona' ? urlEnv : null;
      const shouldAnalyze = !explicitEnv && runtimePreferenceStore.get() === 'auto';
      const targetEnv = explicitEnv ?? activeEnvironmentStore.get();

      if (shouldAnalyze) {
        pendingPromptForEnvChoiceRef.current = urlPrompt.trim();
      } else if (targetEnv === 'daytona') {
        void ensureDaytonaSandbox().catch((err) => toast.error(err?.message || 'Failed to connect Daytona sandbox'));
      }

      void runAnimation();
      append(
        { role: 'user', content: urlPrompt.trim() },
        {
          body: {
            provider: providerToUse,
            model: modelToUse,
            mode: modeToUse,
            environment: targetEnv,
            analyzeEnvironment: shouldAnalyze,
            ...(!shouldAnalyze && modeToUse === 'plan' ? { planPhase: 'questions' as PlanPhase } : {}),
          },
        },
      );
    }
  }, []);

  // Auto-sync generated/modified workspace files (including .env and .gitignore) directly to Daytona Volume
  useEffect(() => {
    if (isLoading || isRestoringFiles || !activeChatId || !daytonaState.configured) {
      return;
    }

    const entries = Object.entries(workbenchFiles);
    if (entries.length === 0) {
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      const pendingUploads: Array<{ relPath: string; content: string }> = [];

      for (const [filePath, dirent] of entries) {
        if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
          continue;
        }

        if (SHOULD_SKIP_CLOUD_SYNC(filePath)) {
          continue;
        }

        const relPath = normalizeWorkspaceRelPath(filePath);
        if (!relPath) {
          continue;
        }

        if (isWorkspaceFileSynced(activeChatId, relPath, dirent.content)) {
          continue;
        }

        pendingUploads.push({ relPath, content: dirent.content });
      }

      if (pendingUploads.length === 0) {
        return;
      }

      void (async () => {
        const opId = `autosync_${Date.now().toString(36)}`;
        void notifyWorkspaceOperationState(activeChatId, opId, 'start');
        try {
          const batchSize = 12;
          for (let i = 0; i < pendingUploads.length; i += batchSize) {
            if (cancelled) {
              return;
            }
            const batch = pendingUploads.slice(i, i + batchSize);
            try {
              const res = await writeWorkspaceFilesBatchClient(
                activeChatId,
                batch.map((b) => ({ path: b.relPath, content: b.content })),
                daytonaStateStore.get().sandboxId,
              );
              if (res.ok) {
                if (res.sandboxId && !daytonaStateStore.get().sandboxId) {
                  daytonaStateStore.setKey('sandboxId', res.sandboxId);
                }
                markWorkspaceFilesSynced(
                  activeChatId,
                  batch.map((item) => ({ path: item.relPath, content: item.content })),
                );
              }
            } catch (err) {
              logger.error('Failed to sync workspace batch to Daytona Volume', err);
            }
          }
        } finally {
          void notifyWorkspaceOperationState(activeChatId, opId, 'end');
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workbenchFiles, isLoading, isRestoringFiles, activeChatId, daytonaState.configured]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const handleUploadFiles = async (fileList: FileList) => {
    setUploadingAttachment(true);
    try {
      const targetProj = chatIdStore.get() || 'default_workspace';
      for (const file of Array.from(fileList)) {
        const result = await uploadFileToDaytonaWorkspace(file, {
          projectId: targetProj,
          kind: 'project',
        });
        if (result.mediaUrl) {
          const resType = file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('video/')
              ? 'video'
              : 'raw';
          setAttachments((prev) => [
            ...prev,
            {
              name: `${file.name} (${result.path})`,
              url: result.mediaUrl,
              resourceType: resType,
            },
          ]);
        }
      }
      toast.success('Uploaded to Daytona Volume');
    } catch (error: any) {
      toast.error(error?.message || 'Workspace upload failed');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = (url: string) => {
    setAttachments((prev) => prev.filter((item) => item.url !== url));
  };

  const resolvePlanPhaseForPrompt = (): PlanPhase => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

    if (lastAssistant) {
      if (parsePlanBlockContent(lastAssistant.content).status === 'ready') {
        return 'revise';
      }

      if (parsePlanQuestionsContent(lastAssistant.content).status === 'ready') {
        return 'draft';
      }
    }

    return 'questions';
  };

  const handleSelectEnvironment = (chosenEnv: RuntimeEnvironment, messageIndex?: number) => {
    if (isLoading) {
      return;
    }

    setActiveEnvironment(chosenEnv, false);
    chatStore.setKey('aborted', false);
    runAnimation();

    // Find the original user prompt before this choice card
    let originalPrompt = '';
    const searchEnd = typeof messageIndex === 'number' ? messageIndex : messages.length - 1;

    for (let i = searchEnd; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'user' && !msg.content.startsWith('Selected environment:')) {
        originalPrompt = msg.content.trim();
        break;
      }
    }

    if (!originalPrompt) {
      originalPrompt = pendingPromptForEnvChoiceRef.current.trim();
    }

    if (chosenEnv === 'daytona') {
      if (daytonaStateStore.get().configured) {
        void ensureDaytonaSandbox().catch((err) => {
          toast.error(err?.message || 'Failed to provision Daytona sandbox');
        });
      } else {
        toast.warning('DAYTONA_API_KEY is missing in server secrets. Configure it or switch to WebContainer.');
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('code');
        workbenchStore.toggleTerminal(true);
      }
    }

    const label = chosenEnv === 'daytona' ? 'Daytona Cloud Sandbox' : 'WebContainer';
    const confirmationPrompt = originalPrompt
      ? `Selected environment: ${label}.\n\nProceed with my request:\n${originalPrompt}`
      : `Selected environment: ${label}. Please proceed.`;

    append(
      { role: 'user', content: confirmationPrompt },
      {
        body: {
          provider: selectedModel.provider,
          model: selectedModel.model,
          mode: executionMode,
          environment: chosenEnv,
          analyzeEnvironment: false,
          ...(executionMode === 'plan' ? { planPhase: 'questions' as PlanPhase } : {}),
        },
      },
    );
  };

  const handleSubmitPlanAnswers = (answersText: string) => {
    const trimmed = answersText.trim();
    if (!trimmed || isLoading) {
      return;
    }

    chatStore.setKey('aborted', false);
    runAnimation();

    append(
      { role: 'user', content: trimmed },
      {
        body: {
          provider: selectedModel.provider,
          model: selectedModel.model,
          mode: 'plan' as ExecutionMode,
          planPhase: 'draft' as PlanPhase,
          environment: activeEnvironmentStore.get(),
          analyzeEnvironment: false,
        },
      },
    );
  };

  const handleRequestPlanRevision = (feedback: string, plan: ActiveWorkbenchPlan) => {
    const trimmed = feedback.trim();
    if (!trimmed || isLoading) {
      return;
    }

    chatStore.setKey('aborted', false);
    runAnimation();

    append(
      {
        role: 'user',
        content: `Please update the "${plan.title}" plan with these requested changes:\n\n${trimmed}`,
      },
      {
        body: {
          provider: selectedModel.provider,
          model: selectedModel.model,
          mode: 'plan' as ExecutionMode,
          planPhase: 'revise' as PlanPhase,
          environment: activeEnvironmentStore.get(),
          analyzeEnvironment: false,
        },
      },
    );
  };

  const handleApproveAndBuild = (plan: ActiveWorkbenchPlan) => {
    if (isLoading) {
      return;
    }

    setExecutionMode('build');
    workbenchStore.setCurrentPlan({ ...plan, isApproved: true });
    workbenchStore.currentView.set('code');
    chatStore.setKey('aborted', false);
    runAnimation();

    const targetEnv = activeEnvironmentStore.get();
    if (targetEnv === 'daytona' && daytonaStateStore.get().configured) {
      void ensureDaytonaSandbox().catch((err) => toast.error(err?.message || 'Failed to connect Daytona sandbox'));
    }

    append(
      {
        role: 'user',
        content: `Plan approved! Please build the entire application now according to this approved implementation plan:\n\n# ${plan.title}\n\n${plan.markdown}`,
      },
      {
        body: {
          provider: selectedModel.provider,
          model: selectedModel.model,
          mode: 'build' as ExecutionMode,
          environment: targetEnv,
          analyzeEnvironment: false,
        },
      },
    );
  };

  useEffect(() => {
    workbenchStore.setPlanActionHandlers({
      onApproveAndBuild: handleApproveAndBuild,
      onRequestRevision: handleRequestPlanRevision,
    });

    return () => {
      workbenchStore.setPlanActionHandlers(null);
    };
  });

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if ((_input.length === 0 && attachments.length === 0) || isLoading) {
      return;
    }

    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    const attachmentSection =
      attachments.length > 0
        ? `\n\nAttached workspace files (Daytona Volume):\n${attachments
            .map((a) => `- ${a.name} (${a.resourceType}): ${a.url}`)
            .join('\n')}`
        : '';

    const fullInput = `${_input}${attachmentSection}`.trim();
    const activeMode = executionMode;
    const shouldAnalyze = runtimePreferenceStore.get() === 'auto' && !environmentChosenForChatStore.get();
    const targetEnv = activeEnvironmentStore.get();
    const planPhase = !shouldAnalyze && activeMode === 'plan' ? resolvePlanPhaseForPrompt() : undefined;

    if (shouldAnalyze) {
      pendingPromptForEnvChoiceRef.current = fullInput;
    } else if (targetEnv === 'daytona' && daytonaStateStore.get().configured) {
      void ensureDaytonaSandbox().catch((err) => toast.error(err?.message || 'Failed to connect Daytona sandbox'));
    }

    const requestOptions = {
      body: {
        provider: selectedModel.provider,
        model: selectedModel.model,
        mode: activeMode,
        environment: targetEnv,
        analyzeEnvironment: shouldAnalyze,
        ...(planPhase ? { planPhase } : {}),
      },
    };

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      append({ role: 'user', content: `${diff}\n\n${fullInput}` }, requestOptions);
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: fullInput }, requestOptions);
    }

    setInput('');
    setAttachments([]);

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <>
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        attachments={attachments}
        uploadingAttachment={uploadingAttachment}
        onUploadFiles={handleUploadFiles}
        onRemoveAttachment={handleRemoveAttachment}
        sendMessage={sendMessage}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={handleInputChange}
        handleStop={abort}
        daytonaConfigured={daytonaState.configured}
        onSelectEnvironment={handleSelectEnvironment}
        onSubmitPlanAnswers={handleSubmitPlanAnswers}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(input, (input) => {
            setInput(input);
            scrollTextArea();
          });
        }}
        onVoiceTranscript={(text) => {
          setInput((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
        }}
      />
    </>
  );
});
