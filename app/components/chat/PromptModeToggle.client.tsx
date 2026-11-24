import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { executionModeStore, setExecutionMode, type ExecutionMode } from '~/lib/stores/executionMode';
import { classNames } from '~/utils/classNames';

interface PromptModeToggleProps {
  disabled?: boolean;
  variant?: 'default' | 'minimal';
  className?: string;
}

interface ModeOption {
  id: ExecutionMode;
  label: string;
  icon: string;
  shortHint: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'build',
    label: 'Build',
    icon: 'i-ph:hammer',
    shortHint: 'Direct execution',
    description: 'Generate code and run the live preview immediately',
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: 'i-ph:list-checks',
    shortHint: 'Blueprint first',
    description: 'Clarify requirements and approve a plan before coding',
  },
];

interface DropdownPosition {
  left: number;
  top?: number;
  bottom?: number;
}

export function PromptModeToggle({ disabled = false, variant = 'minimal', className }: PromptModeToggleProps) {
  const mode = useStore(executionModeStore);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [position, setPosition] = useState<DropdownPosition>({
    left: 16,
    bottom: 80,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeOption = MODE_OPTIONS.find((item) => item.id === mode) ?? MODE_OPTIONS[0];

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuWidth = Math.min(296, viewportW - 24);
    const spaceAbove = rect.top - 12;
    const spaceBelow = viewportH - rect.bottom - 12;
    const openUpward = spaceAbove >= 190 || spaceAbove >= spaceBelow;
    const left = Math.max(12, Math.min(rect.left, viewportW - menuWidth - 12));

    if (openUpward) {
      setPosition({
        left,
        bottom: viewportH - rect.top + 8,
      });
    } else {
      setPosition({
        left,
        top: rect.bottom + 8,
      });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedIndex(MODE_OPTIONS.findIndex((item) => item.id === mode));
    updatePosition();

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % MODE_OPTIONS.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = MODE_OPTIONS[highlightedIndex];
        if (selected) {
          setExecutionMode(selected.id);
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, mode, highlightedIndex, updatePosition]);

  const handleSelectMode = (nextMode: ExecutionMode) => {
    setExecutionMode(nextMode);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        title={`Mode: ${activeOption.label} — ${activeOption.description}`}
        className={classNames(
          'inline-flex items-center gap-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-theme cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:opacity-60 disabled:cursor-not-allowed',
          variant === 'minimal'
            ? classNames(
                'px-2 py-1.5 border border-transparent',
                mode === 'plan'
                  ? 'text-bolt-elements-item-contentAccent bg-bolt-elements-item-backgroundAccent/60'
                  : isOpen
                    ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary'
                    : 'bg-transparent text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
              )
            : classNames(
                'px-2.5 py-1.5 border',
                mode === 'plan'
                  ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive text-bolt-elements-item-contentAccent'
                  : isOpen
                    ? 'bg-bolt-elements-item-backgroundActive border-bolt-elements-borderColorActive text-bolt-elements-textPrimary'
                    : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
              ),
          className,
        )}
      >
        {variant === 'default' && <span className={classNames(activeOption.icon, 'text-sm shrink-0')} />}
        <span>{activeOption.label}</span>
        <span
          className={classNames(
            'i-ph:caret-down text-[11px] opacity-75 transition-transform duration-150 shrink-0',
            isOpen ? 'rotate-180' : undefined,
          )}
        />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Execution Mode"
            style={{
              position: 'fixed',
              left: `${position.left}px`,
              top: position.top !== undefined ? `${position.top}px` : undefined,
              bottom: position.bottom !== undefined ? `${position.bottom}px` : undefined,
              width: 'min(296px, calc(100vw - 24px))',
              zIndex: 1000,
              animation: 'fadeInMenu 140ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3/40 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-bolt-elements-textPrimary">Execution Mode</span>
              <span className="text-[11px] text-bolt-elements-textTertiary">Select workflow</span>
            </div>

            <div className="p-1.5 space-y-1">
              {MODE_OPTIONS.map((option, index) => {
                const isSelected = mode === option.id;
                const isHighlighted = highlightedIndex === index;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelectMode(option.id)}
                    className={classNames(
                      'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-theme cursor-pointer',
                      isSelected
                        ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive'
                        : isHighlighted
                          ? 'bg-bolt-elements-item-backgroundActive border-transparent'
                          : 'bg-transparent border-transparent hover:bg-bolt-elements-item-backgroundActive',
                    )}
                  >
                    <div
                      className={classNames(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border',
                        isSelected
                          ? 'bg-bolt-elements-button-primary-background border-bolt-elements-borderColorActive text-bolt-elements-item-contentAccent'
                          : 'bg-bolt-elements-background-depth-1 border-bolt-elements-borderColor text-bolt-elements-textSecondary',
                      )}
                    >
                      <span className={classNames(option.icon, 'text-base')} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={classNames(
                            'text-xs font-semibold',
                            isSelected ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textPrimary',
                          )}
                        >
                          {option.label}
                        </span>
                        {isSelected ? (
                          <span className="i-ph:check-circle-fill text-sm text-bolt-elements-item-contentAccent shrink-0" />
                        ) : (
                          <span className="text-[11px] text-bolt-elements-textTertiary shrink-0">
                            {option.shortHint}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-bolt-elements-textSecondary leading-snug mt-0.5">
                        {option.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
