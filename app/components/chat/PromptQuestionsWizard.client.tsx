import { useStore } from '@nanostores/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  activeQuestionBatchStore,
  closeQuestionWizard,
  questionWizardCollapsedStore,
  questionWizardCustomStore,
  questionWizardSelectedStore,
  questionWizardStepStore,
} from '~/lib/stores/executionMode';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';

interface PromptQuestionsWizardProps {
  isBusy?: boolean;
  onSubmitAnswers?: (formattedAnswers: string) => void;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function PromptQuestionsWizard({ isBusy = false, onSubmitAnswers }: PromptQuestionsWizardProps) {
  const batch = useStore(activeQuestionBatchStore);
  const isCollapsed = useStore(questionWizardCollapsedStore);
  const currentStep = useStore(questionWizardStepStore);
  const selectedOptions = useStore(questionWizardSelectedStore);
  const customAnswers = useStore(questionWizardCustomStore);

  if (!batch || batch.data.questions.length === 0) {
    return null;
  }

  const questions = batch.data.questions;
  const safeStep = Math.min(Math.max(0, currentStep), questions.length - 1);
  const activeQuestion = questions[safeStep];
  const isFirstStep = safeStep === 0;
  const isLastStep = safeStep === questions.length - 1;
  const progressPct = Math.round(((safeStep + 1) / questions.length) * 100);

  const chosenForCurrent = selectedOptions[activeQuestion.id] ?? [];
  const customForCurrent = customAnswers[activeQuestion.id] ?? '';

  const toggleOption = (option: string) => {
    if (isBusy) {
      return;
    }

    const prevMap = questionWizardSelectedStore.get();
    const current = prevMap[activeQuestion.id] ?? [];

    if (activeQuestion.multiSelect) {
      const exists = current.includes(option);
      questionWizardSelectedStore.set({
        ...prevMap,
        [activeQuestion.id]: exists ? current.filter((item) => item !== option) : [...current, option],
      });
      return;
    }

    const isSame = current.length === 1 && current[0] === option;
    questionWizardSelectedStore.set({
      ...prevMap,
      [activeQuestion.id]: isSame ? [] : [option],
    });
  };

  const handleCustomChange = (value: string) => {
    if (isBusy) {
      return;
    }

    const prevMap = questionWizardCustomStore.get();
    questionWizardCustomStore.set({
      ...prevMap,
      [activeQuestion.id]: value,
    });
  };

  const handlePrevious = () => {
    if (isFirstStep || isBusy) {
      return;
    }
    questionWizardStepStore.set(safeStep - 1);
  };

  const handleNextOrSubmit = () => {
    if (isBusy) {
      return;
    }

    if (!isLastStep) {
      questionWizardStepStore.set(safeStep + 1);
      return;
    }

    if (!onSubmitAnswers) {
      return;
    }

    const lines = questions.map((q, idx) => {
      const chosen = selectedOptions[q.id] ?? [];
      const custom = customAnswers[q.id]?.trim() || '';
      const combined = [...chosen, ...(custom ? [custom] : [])];
      const answerText = combined.length > 0 ? combined.join(' — ') : 'Use recommended default';

      return `${idx + 1}. ${q.question}\nAnswer: ${answerText}`;
    });

    closeQuestionWizard();
    onSubmitAnswers(`Here are my answers to your clarifying questions:\n\n${lines.join('\n\n')}`);
  };

  const handleSkipAll = () => {
    if (isBusy || !onSubmitAnswers) {
      return;
    }

    closeQuestionWizard();
    onSubmitAnswers('Please proceed to create a detailed implementation plan using your recommended defaults.');
  };

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={`prompt-questions-wizard-${batch.messageId}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: cubicEasingFn }}
        className="mb-2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/95 backdrop-blur-md shadow-sm overflow-hidden"
      >
        {/* Top Progress Rail */}
        <div className="h-[3px] w-full bg-bolt-elements-background-depth-3">
          <div
            className="h-full bg-bolt-elements-borderColorActive transition-all duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {isCollapsed ? (
          <div className="px-4 py-2.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => questionWizardCollapsedStore.set(false)}
              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer bg-transparent"
            >
              <span className="i-ph:list-checks text-base text-bolt-elements-item-contentAccent shrink-0" />
              <span className="text-xs sm:text-sm font-medium text-bolt-elements-textPrimary whitespace-nowrap">
                Clarifying Questions
              </span>
              <span className="text-xs font-mono tabular-nums text-bolt-elements-textSecondary whitespace-nowrap">
                · {String(safeStep + 1).padStart(2, '0')} / {String(questions.length).padStart(2, '0')}
              </span>
              <span dir="auto" className="text-xs text-bolt-elements-textTertiary truncate hidden sm:inline">
                {activeQuestion.question}
              </span>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSkipAll}
                disabled={isBusy}
                className="text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary bg-transparent px-2 py-1 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                Skip all
              </button>
              <button
                type="button"
                onClick={() => questionWizardCollapsedStore.set(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer whitespace-nowrap"
              >
                <span>Expand</span>
                <span className="i-ph:caret-up text-xs" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-bolt-elements-borderColor flex items-center justify-between gap-3 bg-bolt-elements-background-depth-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="i-ph:list-checks text-base text-bolt-elements-item-contentAccent shrink-0" />
                <span className="text-xs font-mono tabular-nums font-semibold text-bolt-elements-item-contentAccent whitespace-nowrap">
                  {String(safeStep + 1).padStart(2, '0')} / {String(questions.length).padStart(2, '0')}
                </span>
                <span className="text-xs text-bolt-elements-textSecondary truncate">
                  {activeQuestion.multiSelect ? 'Select one or more options' : 'Choose one option'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => questionWizardCollapsedStore.set(true)}
                title="Minimize temporarily"
                aria-label="Minimize clarifying questions"
                className="w-7 h-7 rounded-md flex items-center justify-center text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive bg-transparent cursor-pointer shrink-0"
              >
                <span className="i-ph:caret-down text-sm" />
              </button>
            </div>

            {/* Single Active Question Body */}
            <div className="px-4 py-3.5 space-y-3 bg-bolt-elements-background-depth-1/40 max-h-[280px] overflow-y-auto">
              <h4 dir="auto" className="text-sm font-medium text-bolt-elements-textPrimary leading-snug">
                {activeQuestion.question}
              </h4>

              {activeQuestion.options.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeQuestion.options.map((option, optIndex) => {
                    const isSelected = chosenForCurrent.includes(option);
                    const keyLabel = OPTION_KEYS[optIndex] ?? String(optIndex + 1);

                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={isBusy}
                        aria-pressed={isSelected}
                        onClick={() => toggleOption(option)}
                        className={classNames(
                          'group flex items-center justify-between gap-2.5 min-h-[40px] px-3 py-2 rounded-lg border text-left text-xs sm:text-[13px] transition-theme cursor-pointer disabled:opacity-50',
                          isSelected
                            ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive text-bolt-elements-textPrimary font-medium'
                            : 'bg-bolt-elements-background-depth-1 border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive hover:border-bolt-elements-borderColorActive/50',
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={classNames(
                              'text-sm shrink-0',
                              isSelected
                                ? activeQuestion.multiSelect
                                  ? 'i-ph:check-square-fill text-bolt-elements-item-contentAccent'
                                  : 'i-ph:check-circle-fill text-bolt-elements-item-contentAccent'
                                : activeQuestion.multiSelect
                                  ? 'i-ph:square text-bolt-elements-textTertiary group-hover:text-bolt-elements-textSecondary'
                                  : 'i-ph:circle text-bolt-elements-textTertiary group-hover:text-bolt-elements-textSecondary',
                            )}
                          />
                          <span dir="auto" className="leading-snug">
                            {option}
                          </span>
                        </div>

                        <span
                          className={classNames(
                            'text-[10px] font-mono tabular-nums shrink-0',
                            isSelected ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textTertiary',
                          )}
                        >
                          {keyLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Custom Answer Input */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 focus-within:border-bolt-elements-borderColorActive transition-theme">
                <span className="i-ph:pencil-simple text-sm text-bolt-elements-textTertiary shrink-0" />
                <input
                  type="text"
                  dir="auto"
                  disabled={isBusy}
                  value={customForCurrent}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleNextOrSubmit();
                    }
                  }}
                  placeholder="Write a custom answer or extra detail (optional)..."
                  className="w-full h-[28px] bg-transparent text-xs sm:text-[13px] text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none"
                />
              </div>
            </div>

            {/* Footer Controls */}
            <div className="px-4 py-2.5 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleSkipAll}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent transition-theme cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <span className="i-ph:fast-forward text-sm" />
                <span>Skip all</span>
              </button>

              <div className="flex items-center gap-2 ml-auto shrink-0">
                <button
                  type="button"
                  disabled={isFirstStep || isBusy}
                  onClick={handlePrevious}
                  className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <span className="i-ph:arrow-left text-xs" />
                  <span>Previous</span>
                </button>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleNextOrSubmit}
                  className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border border-bolt-elements-borderColorActive/40 transition-theme cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <span>{isLastStep ? 'Create Plan' : 'Next'}</span>
                  <span className={classNames(isLastStep ? 'i-ph:check-bold' : 'i-ph:arrow-right', 'text-xs')} />
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
