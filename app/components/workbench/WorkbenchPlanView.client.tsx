import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '~/components/chat/Markdown';
import { extractPlanSections } from '~/lib/plan/parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface WorkbenchPlanViewProps {
  isStreaming?: boolean;
}

export function WorkbenchPlanView({ isStreaming = false }: WorkbenchPlanViewProps) {
  const currentPlan = useStore(workbenchStore.currentPlan);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => (currentPlan ? extractPlanSections(currentPlan.markdown) : []),
    [currentPlan],
  );

  useEffect(() => {
    setRevisionNotes('');
    setActiveSectionId(sections[0]?.id ?? null);
  }, [currentPlan?.title, currentPlan?.markdown, sections]);

  if (!currentPlan) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-bolt-elements-background-depth-1/40">
        <div className="w-11 h-11 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-center mb-3 text-bolt-elements-textSecondary">
          <span className="i-ph:list-checks text-xl" />
        </div>
        <h3 className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">No implementation plan yet</h3>
        <p className="text-xs text-bolt-elements-textSecondary max-w-sm leading-relaxed">
          Switch to Plan mode in the prompt box to draft a structured blueprint before generating code.
        </p>
      </div>
    );
  }

  const handleJumpToSection = (sectionTitle: string, sectionId: string) => {
    setActiveSectionId(sectionId);
    const container = contentScrollRef.current;
    if (!container) {
      return;
    }

    const headings = Array.from(container.querySelectorAll('h1, h2, h3'));
    const normalizedTarget = sectionTitle.trim().toLowerCase();
    const match = headings.find((el) => el.textContent?.trim().toLowerCase() === normalizedTarget);

    if (match) {
      match.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSendRevision = () => {
    const trimmed = revisionNotes.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    workbenchStore.requestPlanRevisionFromWorkbench(trimmed, currentPlan);
    setRevisionNotes('');
  };

  const handleApprove = () => {
    if (isStreaming) {
      return;
    }

    workbenchStore.approvePlanFromWorkbench(currentPlan);
  };

  return (
    <div className="h-full w-full flex flex-col bg-bolt-elements-background-depth-1/30 overflow-hidden">
      {/* Plan Header Sub-strip */}
      <div className="px-5 py-3.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0 space-y-0.5">
          <h2 dir="auto" className="text-sm sm:text-base font-semibold text-bolt-elements-textPrimary truncate">
            {currentPlan.title}
          </h2>
          <div className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary flex-wrap">
            <span>Implementation Blueprint</span>
            {sections.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{sections.length} sections</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span
              className={
                currentPlan.isApproved
                  ? 'text-bolt-elements-icon-success font-medium'
                  : 'text-bolt-elements-item-contentAccent font-medium'
              }
            >
              {currentPlan.isApproved ? 'Approved & Executed' : 'Awaiting Approval'}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={isStreaming}
          onClick={handleApprove}
          className="inline-flex h-[36px] items-center justify-center gap-1.5 rounded-lg px-4 text-xs sm:text-sm font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border border-bolt-elements-borderColorActive/40 transition-theme cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <span className="i-ph:hammer text-sm" />
          <span>{currentPlan.isApproved ? 'Rebuild from Plan' : 'Approve & Start Building'}</span>
        </button>
      </div>

      {/* Split Body: Outline Rail + Full Blueprint Content */}
      <div className="flex-1 min-h-0 flex">
        {sections.length > 0 && (
          <aside className="hidden lg:flex lg:w-[225px] shrink-0 flex-col justify-between border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/50 p-3.5 overflow-y-auto">
            <div className="space-y-2">
              <div className="px-2 text-xs font-semibold text-bolt-elements-textSecondary">Blueprint Outline</div>
              <nav className="space-y-0.5" aria-label="Plan sections">
                {sections.map((section, idx) => {
                  const isActive = activeSectionId === section.id;

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => handleJumpToSection(section.title, section.id)}
                      className={classNames(
                        'w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-theme cursor-pointer bg-transparent',
                        section.level === 3 ? 'pl-5' : undefined,
                        isActive
                          ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent font-medium'
                          : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary',
                      )}
                    >
                      <span className="font-mono tabular-nums text-[11px] opacity-75 shrink-0 pt-0.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span dir="auto" className="leading-snug line-clamp-2">
                        {section.title}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 mt-4 border-t border-bolt-elements-borderColor space-y-2 text-xs text-bolt-elements-textSecondary">
              <div className="flex items-center gap-2">
                <span className="i-ph:check-circle-fill text-bolt-elements-icon-success text-sm shrink-0" />
                <span>Scope clarified</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="i-ph:check-circle-fill text-bolt-elements-icon-success text-sm shrink-0" />
                <span>Architecture drafted</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={classNames(
                    'text-sm shrink-0',
                    currentPlan.isApproved
                      ? 'i-ph:check-circle-fill text-bolt-elements-icon-success'
                      : 'i-ph:circle-dashed text-bolt-elements-item-contentAccent',
                  )}
                />
                <span>{currentPlan.isApproved ? 'Build executed' : 'Ready to execute'}</span>
              </div>
            </div>
          </aside>
        )}

        <div ref={contentScrollRef} className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
          <div className="prose-sm max-w-none text-bolt-elements-textPrimary">
            <Markdown>{currentPlan.markdown}</Markdown>
          </div>
        </div>
      </div>

      {/* Bottom Revision Composer */}
      <div className="px-5 py-3 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shrink-0">
        <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 focus-within:border-bolt-elements-borderColorActive transition-theme">
          <div className="flex items-start gap-2 flex-1 min-w-0 px-1.5">
            <span className="i-ph:note-pencil text-base text-bolt-elements-textTertiary mt-1.5 shrink-0" />
            <textarea
              id="workbench-plan-revision-notes"
              dir="auto"
              rows={2}
              value={revisionNotes}
              onChange={(e) => setRevisionNotes(e.target.value)}
              placeholder="Request changes or add revision notes to update this plan before building..."
              className="w-full py-1 bg-transparent text-xs sm:text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none resize-none"
            />
          </div>
          <button
            type="button"
            disabled={isStreaming || revisionNotes.trim().length === 0}
            onClick={handleSendRevision}
            className="inline-flex h-[36px] items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          >
            <span className="i-ph:arrows-clockwise text-sm" />
            <span>Revise Plan</span>
          </button>
        </div>
      </div>
    </div>
  );
}
