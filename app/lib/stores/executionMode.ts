import { atom } from 'nanostores';

export type ExecutionMode = 'build' | 'plan';

export type PlanPhase = 'questions' | 'draft' | 'revise';

export interface PlanQuestion {
  id: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
}

export interface ParsedPlanQuestionsBlock {
  intro?: string;
  questions: PlanQuestion[];
}

export interface ParsedPlanBlock {
  title: string;
  markdown: string;
}

export interface QuestionWizardBatch {
  messageId: string;
  data: ParsedPlanQuestionsBlock;
}

export const executionModeStore = atom<ExecutionMode>('build');
export const activeQuestionBatchStore = atom<QuestionWizardBatch | null>(null);
export const questionWizardCollapsedStore = atom<boolean>(false);
export const questionWizardStepStore = atom<number>(0);
export const questionWizardSelectedStore = atom<Record<string, string[]>>({});
export const questionWizardCustomStore = atom<Record<string, string>>({});

export function setExecutionMode(mode: ExecutionMode) {
  executionModeStore.set(mode);
}

export function openQuestionWizard(messageId: string, data: ParsedPlanQuestionsBlock) {
  if (!data.questions || data.questions.length === 0) {
    return;
  }

  const existing = activeQuestionBatchStore.get();
  if (existing?.messageId !== messageId) {
    activeQuestionBatchStore.set({ messageId, data });
    questionWizardStepStore.set(0);
    questionWizardSelectedStore.set({});
    questionWizardCustomStore.set({});
  }

  questionWizardCollapsedStore.set(false);
}

export function closeQuestionWizard() {
  activeQuestionBatchStore.set(null);
  questionWizardCollapsedStore.set(false);
  questionWizardStepStore.set(0);
  questionWizardSelectedStore.set({});
  questionWizardCustomStore.set({});
}

export function resetPlanWorkflowForNewChat() {
  closeQuestionWizard();
}

