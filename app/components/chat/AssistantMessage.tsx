import { memo } from 'react';
import {
  extractPlanSections,
  parseEnvironmentChoiceContent,
  parsePlanBlockContent,
  parsePlanQuestionsContent,
  parseSecretsBlockContent,
} from '~/lib/plan/parser';
import { openQuestionWizard, questionWizardCollapsedStore } from '~/lib/stores/executionMode';
import type { RuntimeEnvironment } from '~/lib/stores/runtime';
import { mergeRequestedSecrets } from '~/lib/stores/secrets';
import { workbenchStore } from '~/lib/stores/workbench';
import { EnvironmentChoiceCard } from './EnvironmentChoiceCard.client';
import { Markdown } from './Markdown';

interface AssistantMessageProps {
  messageId?: string;
  content: string;
  hasFollowUpUserMessage?: boolean;
  selectedEnvironment?: RuntimeEnvironment;
  daytonaConfigured?: boolean;
  isBusy?: boolean;
  onSelectEnvironment?: (env: RuntimeEnvironment) => void;
}

export const AssistantMessage = memo(
  ({
    messageId = 'msg',
    content,
    hasFollowUpUserMessage = false,
    selectedEnvironment,
    daytonaConfigured = false,
    isBusy = false,
    onSelectEnvironment,
  }: AssistantMessageProps) => {
    const envChoiceParsed = parseEnvironmentChoiceContent(content);

    if (envChoiceParsed.status === 'streaming') {
      return (
        <div className="overflow-hidden w-full space-y-3">
          {envChoiceParsed.beforeText && <Markdown html>{envChoiceParsed.beforeText}</Markdown>}
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5 space-y-3">
            <div className="flex items-center gap-3 text-sm font-medium text-bolt-elements-textPrimary">
              <span className="i-svg-spinners:90-ring-with-bg text-lg text-bolt-elements-loader-progress shrink-0" />
              <span>Analyzing your request to recommend the best runtime environment...</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="h-24 rounded-lg bg-bolt-elements-background-depth-3 animate-pulse" />
              <div className="h-24 rounded-lg bg-bolt-elements-background-depth-3 animate-pulse" />
            </div>
          </div>
        </div>
      );
    }

    if (envChoiceParsed.status === 'ready' && envChoiceParsed.data) {
      return (
        <div className="overflow-hidden w-full space-y-4">
          {envChoiceParsed.beforeText && <Markdown html>{envChoiceParsed.beforeText}</Markdown>}
          <EnvironmentChoiceCard
            data={envChoiceParsed.data}
            isCompleted={hasFollowUpUserMessage}
            selectedEnvironment={selectedEnvironment}
            daytonaConfigured={daytonaConfigured}
            isBusy={isBusy}
            onSelectEnvironment={onSelectEnvironment}
          />
          {envChoiceParsed.afterText && <Markdown html>{envChoiceParsed.afterText}</Markdown>}
        </div>
      );
    }

    const questionsParsed = parsePlanQuestionsContent(content);

    if (questionsParsed.status === 'streaming') {
      return (
        <div className="overflow-hidden w-full space-y-3">
          {questionsParsed.beforeText && <Markdown html>{questionsParsed.beforeText}</Markdown>}
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 space-y-2.5">
            <div className="flex items-center gap-3 text-sm font-medium text-bolt-elements-textPrimary">
              <span className="i-svg-spinners:90-ring-with-bg text-lg text-bolt-elements-loader-progress shrink-0" />
              <span>Preparing step-by-step clarifying questions...</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-bolt-elements-background-depth-3 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-bolt-elements-background-depth-3 animate-pulse" />
            </div>
          </div>
        </div>
      );
    }

    if (questionsParsed.status === 'ready' && questionsParsed.data) {
      const qData = questionsParsed.data;

      return (
        <div className="overflow-hidden w-full space-y-4">
          {questionsParsed.beforeText && <Markdown html>{questionsParsed.beforeText}</Markdown>}

          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-bolt-elements-item-backgroundAccent border border-bolt-elements-borderColorActive/30 text-bolt-elements-item-contentAccent flex items-center justify-center shrink-0 mt-0.5">
                <span className="i-ph:list-checks text-base" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-bolt-elements-textPrimary flex-wrap">
                  <span>Clarifying Questions</span>
                  <span className="text-xs font-mono tabular-nums font-normal text-bolt-elements-textSecondary">
                    · {qData.questions.length} steps
                  </span>
                  <span aria-hidden="true" className="text-bolt-elements-textTertiary">
                    ·
                  </span>
                  <span
                    className={
                      hasFollowUpUserMessage
                        ? 'text-xs font-medium text-bolt-elements-icon-success'
                        : 'text-xs font-medium text-bolt-elements-item-contentAccent'
                    }
                  >
                    {hasFollowUpUserMessage ? 'Submitted' : 'Active above prompt box'}
                  </span>
                </div>
                <p dir="auto" className="text-xs text-bolt-elements-textSecondary truncate">
                  {qData.intro || qData.questions[0]?.question}
                </p>
              </div>
            </div>

            {!hasFollowUpUserMessage && (
              <button
                type="button"
                onClick={() => {
                  openQuestionWizard(messageId, qData);
                  questionWizardCollapsedStore.set(false);
                }}
                className="inline-flex h-[36px] items-center justify-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer whitespace-nowrap shrink-0"
              >
                <span className="i-ph:sliders-horizontal text-sm" />
                <span>Open Questions</span>
              </button>
            )}
          </div>

          {questionsParsed.afterText && <Markdown html>{questionsParsed.afterText}</Markdown>}
        </div>
      );
    }

    const planParsed = parsePlanBlockContent(content);

    if (planParsed.status === 'streaming') {
      return (
        <div className="overflow-hidden w-full space-y-3">
          {planParsed.beforeText && <Markdown html>{planParsed.beforeText}</Markdown>}
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bolt-elements-borderColor flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="i-svg-spinners:90-ring-with-bg text-lg text-bolt-elements-loader-progress shrink-0" />
                <span className="text-sm font-semibold text-bolt-elements-textPrimary truncate">
                  Drafting Blueprint: {planParsed.partialTitle || 'Implementation Plan'}
                </span>
              </div>
              <span className="text-xs text-bolt-elements-textTertiary shrink-0">Writing sections</span>
            </div>
            {planParsed.partialContent && (
              <div className="p-5 max-h-[260px] overflow-y-auto text-sm text-bolt-elements-textSecondary">
                <Markdown>{planParsed.partialContent}</Markdown>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (planParsed.status === 'ready' && planParsed.data) {
      const plan = planParsed.data;
      const sections = extractPlanSections(plan.markdown);
      const topSections = sections.slice(0, 4);
      const remainingCount = Math.max(0, sections.length - topSections.length);

      return (
        <div className="overflow-hidden w-full space-y-4">
          {planParsed.beforeText && <Markdown html>{planParsed.beforeText}</Markdown>}

          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
            {/* Top Bar */}
            <div className="px-5 py-3 border-b border-bolt-elements-borderColor flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-bolt-elements-textSecondary">
                <span className="i-ph:list-checks text-base text-bolt-elements-item-contentAccent shrink-0" />
                <span>Implementation Blueprint</span>
              </div>

              <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary font-mono tabular-nums">
                {sections.length > 0 && (
                  <>
                    <span>{sections.length} sections</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span
                  className={
                    hasFollowUpUserMessage
                      ? 'font-sans text-bolt-elements-icon-success font-medium'
                      : 'font-sans text-bolt-elements-item-contentAccent font-medium'
                  }
                >
                  {hasFollowUpUserMessage ? 'Reviewed' : 'Open in Plan Tab'}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="min-w-0 space-y-2.5 flex-1">
                  <h4 dir="auto" className="text-base font-semibold text-bolt-elements-textPrimary leading-snug">
                    {plan.title}
                  </h4>

                  {topSections.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 pt-0.5">
                      {topSections.map((section, idx) => (
                        <div
                          key={section.id}
                          className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary min-w-0"
                        >
                          <span className="font-mono tabular-nums text-[11px] text-bolt-elements-textTertiary shrink-0">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span dir="auto" className="truncate">
                            {section.title}
                          </span>
                        </div>
                      ))}
                      {remainingCount > 0 && (
                        <div className="text-xs text-bolt-elements-textTertiary font-mono tabular-nums">
                          +{remainingCount} more sections
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    workbenchStore.openPlanInWorkbench({
                      ...plan,
                      messageId,
                      isApproved: hasFollowUpUserMessage,
                    })
                  }
                  className="inline-flex h-[38px] items-center justify-center gap-2 px-4 rounded-lg text-xs sm:text-sm font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border border-bolt-elements-borderColorActive/40 transition-theme cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span className="i-ph:blueprint text-base" />
                  <span>Open in Plan Tab</span>
                </button>
              </div>
            </div>
          </div>

          {planParsed.afterText && <Markdown html>{planParsed.afterText}</Markdown>}
        </div>
      );
    }

    const secretsParsed = parseSecretsBlockContent(content);

    if (secretsParsed.status === 'streaming') {
      return (
        <div className="overflow-hidden w-full space-y-3">
          {secretsParsed.beforeText && <Markdown html>{secretsParsed.beforeText}</Markdown>}
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3 flex items-center gap-3 text-xs sm:text-sm text-bolt-elements-textPrimary">
            <span className="i-svg-spinners:90-ring-with-bg text-base text-bolt-elements-loader-progress shrink-0" />
            <span>Detecting required project API secrets...</span>
          </div>
        </div>
      );
    }

    if (secretsParsed.status === 'ready' && secretsParsed.data) {
      const secretsList = secretsParsed.data.secrets;

      return (
        <div className="overflow-hidden w-full space-y-4">
          {secretsParsed.beforeText && <Markdown html>{secretsParsed.beforeText}</Markdown>}

          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-bolt-elements-item-backgroundAccent border border-bolt-elements-borderColorActive/30 text-bolt-elements-item-contentAccent flex items-center justify-center shrink-0 mt-0.5">
                <span className="i-ph:key text-base" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-bolt-elements-textPrimary flex-wrap">
                  <span>API Secrets Requested</span>
                  <span className="text-xs font-mono tabular-nums font-normal text-bolt-elements-textSecondary">
                    · {secretsList.length} key{secretsList.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p dir="auto" className="text-xs text-bolt-elements-textSecondary truncate">
                  {secretsParsed.data.intro || secretsList.map((s) => s.key).join(', ')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                mergeRequestedSecrets(secretsList);
                workbenchStore.openSecretsInWorkbench();
              }}
              className="inline-flex h-[36px] items-center justify-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer whitespace-nowrap shrink-0"
            >
              <span className="i-ph:lock-key text-sm" />
              <span>Open Secrets Tab</span>
            </button>
          </div>

          {secretsParsed.afterText && <Markdown html>{secretsParsed.afterText}</Markdown>}
        </div>
      );
    }

    return (
      <div className="overflow-hidden w-full">
        <Markdown html>{content}</Markdown>
      </div>
    );
  },
);

