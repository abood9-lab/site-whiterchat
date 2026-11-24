import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import React, { useRef, type RefCallback } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { Workbench } from '~/components/workbench/Workbench.client';
import { executionModeStore } from '~/lib/stores/executionMode';
import type { RuntimeEnvironment } from '~/lib/stores/runtime';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { Messages } from './Messages.client';
import { ModelSelector } from './ModelSelector.client';
import { PromptModeToggle } from './PromptModeToggle.client';
import { PromptPlusMenu, VoiceMicButton } from './PromptPlusMenu.client';
import { PromptQuestionsWizard } from './PromptQuestionsWizard.client';
import { PromptSecretsDock } from './PromptSecretsDock.client';
import { SendButton } from './SendButton.client';

import styles from './BaseChat.module.scss';

export interface UploadedAttachment {
  name: string;
  url: string;
  resourceType: string;
}

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  attachments?: UploadedAttachment[];
  uploadingAttachment?: boolean;
  onUploadFiles?: (files: FileList) => void;
  onRemoveAttachment?: (url: string) => void;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  onVoiceTranscript?: (text: string) => void;
  daytonaConfigured?: boolean;
  onSelectEnvironment?: (env: RuntimeEnvironment, messageIndex: number) => void;
  onSubmitPlanAnswers?: (answersText: string) => void;
}

const EXAMPLE_PROMPTS = [
  { text: 'Build a todo app in React using Tailwind' },
  { text: 'Build a simple blog using Astro' },
  { text: 'Create a cookie consent form using Material UI' },
  { text: 'Make a space invaders game' },
  { text: 'How do I center a div?' },
];

const TEXTAREA_MIN_HEIGHT = 76;

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      enhancingPrompt = false,
      promptEnhanced = false,
      messages,
      input = '',
      attachments = [],
      uploadingAttachment = false,
      onUploadFiles,
      onRemoveAttachment,
      sendMessage,
      handleInputChange,
      enhancePrompt,
      onVoiceTranscript,
      handleStop,
      daytonaConfigured = false,
      onSelectEnvironment,
      onSubmitPlanAnswers,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const executionMode = useStore(executionModeStore);

    return (
      <div
        ref={ref}
        className={classNames(
          styles.BaseChat,
          'relative flex h-full w-full overflow-hidden bg-bolt-elements-background-depth-1',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div ref={scrollRef} className="flex overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow min-w-[var(--chat-min-width)] h-full')}>
            {!chatStarted && (
              <div id="intro" className="mt-[26vh] max-w-chat mx-auto">
                <h1 className="text-5xl text-center font-bold text-bolt-elements-textPrimary mb-2">
                  Where ideas begin
                </h1>
                <p className="mb-4 text-center text-bolt-elements-textSecondary">
                  Bring ideas to life in seconds or get help on existing projects.
                </p>
              </div>
            )}
            <div
              className={classNames('pt-6 px-6', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat px-4 pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                      daytonaConfigured={daytonaConfigured}
                      onSelectEnvironment={onSelectEnvironment}
                    />
                  ) : null;
                }}
              </ClientOnly>
              <div
                className={classNames('relative w-full max-w-chat mx-auto z-prompt', {
                  'sticky bottom-0': chatStarted,
                })}
              >
                <ClientOnly>
                  {() => <PromptQuestionsWizard isBusy={isStreaming} onSubmitAnswers={onSubmitPlanAnswers} />}
                </ClientOnly>
                <ClientOnly>{() => <PromptSecretsDock />}</ClientOnly>
                <div
                  className={classNames(
                    'shadow-sm border border-bolt-elements-borderColor focus-within:border-bolt-elements-borderColorActive/50 bg-bolt-elements-prompt-background backdrop-filter backdrop-blur-[8px] rounded-2xl overflow-visible relative transition-theme',
                  )}
                >
                  <textarea
                    ref={textareaRef}
                    className="w-full px-4 pt-3.5 pb-1.5 rounded-t-2xl focus:outline-none resize-none text-sm sm:text-[15px] text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        if (event.shiftKey) {
                          return;
                        }

                        event.preventDefault();

                        sendMessage?.(event);
                      }
                    }}
                    value={input}
                    onChange={(event) => {
                      handleInputChange?.(event);
                    }}
                    style={{
                      minHeight: TEXTAREA_MIN_HEIGHT,
                      maxHeight: TEXTAREA_MAX_HEIGHT,
                    }}
                    placeholder={
                      executionMode === 'plan' ? 'Message Bolt · Plan mode' : 'Message Bolt'
                    }
                    translate="no"
                  />
                  {onUploadFiles && (
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          onUploadFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                  )}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-4 pt-1 pb-1.5">
                      {attachments.map((att) => (
                        <div
                          key={att.url}
                          className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-xs text-bolt-elements-textPrimary"
                        >
                          {att.resourceType === 'image' ? (
                            <img src={att.url} alt={att.name} className="w-5 h-5 rounded object-cover" />
                          ) : (
                            <div className="i-ph:file-code text-sm" />
                          )}
                          <a href={att.url} target="_blank" rel="noreferrer" className="max-w-[140px] truncate hover:underline">
                            {att.name}
                          </a>
                          {onRemoveAttachment && (
                            <button
                              type="button"
                              onClick={() => onRemoveAttachment(att.url)}
                              className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary cursor-pointer"
                              title="Remove attachment"
                            >
                              <div className="i-ph:x text-xs" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-2 px-3 pb-2.5 pt-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <ClientOnly>
                        {() => (
                          <PromptPlusMenu
                            canUpload={Boolean(onUploadFiles)}
                            uploadingAttachment={uploadingAttachment}
                            canEnhance={Boolean(enhancePrompt)}
                            enhancingPrompt={enhancingPrompt}
                            canCloneRepo={daytonaConfigured}
                            hasInput={input.trim().length > 0}
                            onTriggerUpload={() => fileInputRef.current?.click()}
                            onTriggerEnhance={() => enhancePrompt?.()}
                            onTriggerCloneRepo={() => workbenchStore.openGitHubClonePanel()}
                          />
                        )}
                      </ClientOnly>
                      <ClientOnly>{() => <PromptModeToggle disabled={isStreaming} variant="minimal" />}</ClientOnly>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <ClientOnly>{() => <ModelSelector variant="icon" />}</ClientOnly>
                      <ClientOnly>
                        {() => (
                          <VoiceMicButton
                            disabled={isStreaming}
                            onTranscript={(text) => {
                              if (onVoiceTranscript) {
                                onVoiceTranscript(text);
                              }
                            }}
                          />
                        )}
                      </ClientOnly>
                      <ClientOnly>
                        {() => (
                          <SendButton
                            show={input.trim().length > 0 || attachments.length > 0}
                            isStreaming={isStreaming}
                            onClick={(event) => {
                              if (isStreaming) {
                                handleStop?.();
                                return;
                              }

                              sendMessage?.(event);
                            }}
                          />
                        )}
                      </ClientOnly>
                    </div>
                  </div>
                </div>
                <div className="bg-bolt-elements-background-depth-1 pb-6">{/* Ghost Element */}</div>
              </div>
            </div>
            {!chatStarted && (
              <div id="examples" className="relative w-full max-w-xl mx-auto mt-8 flex justify-center">
                <div className="flex flex-col space-y-2 [mask-image:linear-gradient(to_bottom,black_0%,transparent_180%)] hover:[mask-image:none]">
                  {EXAMPLE_PROMPTS.map((examplePrompt, index) => {
                    return (
                      <button
                        key={index}
                        onClick={(event) => {
                          sendMessage?.(event, examplePrompt.text);
                        }}
                        className="group flex items-center w-full gap-2 justify-center bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-theme"
                      >
                        {examplePrompt.text}
                        <div className="i-ph:arrow-bend-down-left" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
      </div>
    );
  },
);
