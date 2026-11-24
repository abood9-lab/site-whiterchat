import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import React from 'react';
import { activeEnvironmentStore, type RuntimeEnvironment } from '~/lib/stores/runtime';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  daytonaConfigured?: boolean;
  onSelectEnvironment?: (env: RuntimeEnvironment, messageIndex: number) => void;
}

export const Messages = React.forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref) => {
  const { id, isStreaming = false, messages = [], daytonaConfigured = false, onSelectEnvironment } = props;
  const activeEnvironment = useStore(activeEnvironmentStore);

  return (
    <div id={id} ref={ref} className={props.className}>
      {messages.length > 0
        ? messages.map((message, index) => {
            const { role, content } = message;
            const isUserMessage = role === 'user';
            const isFirst = index === 0;
            const isLast = index === messages.length - 1;
            const followUpMessages = messages.slice(index + 1);
            const nextUserMessage = followUpMessages.find((item) => item.role === 'user');
            const hasFollowUpUserMessage = Boolean(nextUserMessage);

            let selectedEnvironmentForCard: RuntimeEnvironment | undefined;
            if (nextUserMessage) {
              if (nextUserMessage.content.includes('Selected environment: Daytona')) {
                selectedEnvironmentForCard = 'daytona';
              } else if (nextUserMessage.content.includes('Selected environment: WebContainer')) {
                selectedEnvironmentForCard = 'webcontainer';
              } else {
                selectedEnvironmentForCard = activeEnvironment;
              }
            }

            return (
              <div
                key={index}
                className={classNames('flex gap-4 p-6 w-full rounded-[calc(0.75rem-1px)]', {
                  'bg-bolt-elements-messages-background': isUserMessage || !isStreaming || (isStreaming && !isLast),
                  'bg-gradient-to-b from-bolt-elements-messages-background from-30% to-transparent':
                    isStreaming && isLast,
                  'mt-4': !isFirst,
                })}
              >
                {isUserMessage && (
                  <div className="flex items-center justify-center w-[34px] h-[34px] overflow-hidden bg-white text-gray-600 rounded-full shrink-0 self-start">
                    <div className="i-ph:user-fill text-xl"></div>
                  </div>
                )}
                <div className="grid grid-col-1 w-full">
                  {isUserMessage ? (
                    <UserMessage content={content} />
                  ) : (
                    <AssistantMessage
                      messageId={message.id}
                      content={content}
                      hasFollowUpUserMessage={hasFollowUpUserMessage}
                      selectedEnvironment={selectedEnvironmentForCard}
                      daytonaConfigured={daytonaConfigured}
                      isBusy={isStreaming}
                      onSelectEnvironment={
                        onSelectEnvironment ? (env) => onSelectEnvironment(env, index) : undefined
                      }
                    />
                  )}
                </div>
              </div>
            );
          })
        : null}
      {isStreaming && (
        <div className="text-center w-full text-bolt-elements-textSecondary i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
      )}
    </div>
  );
});
