import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  activeEnvironmentStore,
  daytonaStateStore,
  environmentChosenForChatStore,
  runtimePreferenceStore,
  setRuntimePreference,
  type RuntimePreference,
} from '~/lib/stores/runtime';
import { classNames } from '~/utils/classNames';

interface RuntimeSelectorProps {
  disabled?: boolean;
  className?: string;
  onSelectPreference?: (preference: RuntimePreference) => void;
}

interface RuntimeOptionItem {
  id: RuntimePreference;
  label: string;
  shortLabel: string;
  icon: string;
  shortHint: string;
  description: string;
}

const RUNTIME_OPTIONS: RuntimeOptionItem[] = [
  {
    id: 'auto',
    label: 'Auto (AI Advises)',
    shortLabel: 'Auto',
    icon: 'i-ph:compass',
    shortHint: 'Recommended',
    description: 'AI analyzes your prompt and lets you pick the best sandbox',
  },
  {
    id: 'webcontainer',
    label: 'WebContainer',
    shortLabel: 'WebContainer',
    icon: 'i-ph:globe',
    shortHint: 'Browser',
    description: 'Instant in-browser Node.js, React, Vite, and frontend apps',
  },
  {
    id: 'daytona',
    label: 'Daytona Cloud',
    shortLabel: 'Daytona',
    icon: 'i-ph:cloud',
    shortHint: 'Cloud VM',
    description: 'Full Linux sandbox for Python, pip, native CLIs, and backends',
  },
];

interface DropdownPosition {
  left: number;
  top?: number;
  bottom?: number;
}

export function RuntimeSelector({ disabled = false, className, onSelectPreference }: RuntimeSelectorProps) {
  const preference = useStore(runtimePreferenceStore);
  const activeEnvironment = useStore(activeEnvironmentStore);
  const chosenForChat = useStore(environmentChosenForChatStore);
  const daytonaState = useStore(daytonaStateStore);

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [position, setPosition] = useState<DropdownPosition>({
    left: 16,
    bottom: 80,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeOption = RUNTIME_OPTIONS.find((item) => item.id === preference) ?? RUNTIME_OPTIONS[0];

  const triggerLabel =
    preference === 'auto' && chosenForChat
      ? `Auto · ${activeEnvironment === 'daytona' ? 'Daytona' : 'WebContainer'}`
      : activeOption.shortLabel;

  const triggerIcon =
    preference === 'auto' && chosenForChat
      ? activeEnvironment === 'daytona'
        ? 'i-ph:cloud'
        : 'i-ph:globe'
      : activeOption.icon;

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuWidth = Math.min(316, viewportW - 24);
    const spaceAbove = rect.top - 12;
    const spaceBelow = viewportH - rect.bottom - 12;
    const openUpward = spaceAbove >= 230 || spaceAbove >= spaceBelow;
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

    setHighlightedIndex(RUNTIME_OPTIONS.findIndex((item) => item.id === preference));
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
        setHighlightedIndex((prev) => (prev + 1) % RUNTIME_OPTIONS.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + RUNTIME_OPTIONS.length) % RUNTIME_OPTIONS.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = RUNTIME_OPTIONS[highlightedIndex];
        if (selected) {
          setRuntimePreference(selected.id);
          onSelectPreference?.(selected.id);
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
  }, [isOpen, preference, highlightedIndex, updatePosition, onSelectPreference]);

  const handleSelect = (nextPreference: RuntimePreference) => {
    setRuntimePreference(nextPreference);
    onSelectPreference?.(nextPreference);
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
        title={`Runtime: ${activeOption.label} — ${activeOption.description}`}
        className={classNames(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-theme cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:opacity-60 disabled:cursor-not-allowed',
          preference === 'daytona' || (preference === 'auto' && chosenForChat && activeEnvironment === 'daytona')
            ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive text-bolt-elements-item-contentAccent'
            : isOpen
              ? 'bg-bolt-elements-item-backgroundActive border-bolt-elements-borderColorActive text-bolt-elements-textPrimary'
              : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
          className,
        )}
      >
        <span className={classNames(triggerIcon, 'text-sm shrink-0')} />
        <span>{triggerLabel}</span>
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
            aria-label="Runtime Environment"
            style={{
              position: 'fixed',
              left: `${position.left}px`,
              top: position.top !== undefined ? `${position.top}px` : undefined,
              bottom: position.bottom !== undefined ? `${position.bottom}px` : undefined,
              width: 'min(316px, calc(100vw - 24px))',
              zIndex: 1000,
              animation: 'fadeInMenu 140ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3/40 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-bolt-elements-textPrimary">Runtime Environment</span>
              <span className="text-[11px] text-bolt-elements-textTertiary">Execution sandbox</span>
            </div>

            <div className="p-1.5 space-y-1">
              {RUNTIME_OPTIONS.map((option, index) => {
                const isSelected = preference === option.id;
                const isHighlighted = highlightedIndex === index;
                const showMissingKey =
                  option.id === 'daytona' && daytonaState.statusLoaded && !daytonaState.configured;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelect(option.id)}
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
                        ) : showMissingKey ? (
                          <span className="text-[10px] font-medium text-amber-500 shrink-0">Key missing</span>
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
