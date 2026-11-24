import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';

interface PromptPlusMenuProps {
  canUpload?: boolean;
  uploadingAttachment?: boolean;
  canEnhance?: boolean;
  enhancingPrompt?: boolean;
  canCloneRepo?: boolean;
  hasInput?: boolean;
  onTriggerUpload?: () => void;
  onTriggerEnhance?: () => void;
  onTriggerCloneRepo?: () => void;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
}

export function PromptPlusMenu({
  canUpload = false,
  uploadingAttachment = false,
  canEnhance = false,
  enhancingPrompt = false,
  canCloneRepo = false,
  hasInput = false,
  onTriggerUpload,
  onTriggerEnhance,
  onTriggerCloneRepo,
}: PromptPlusMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: 16, bottom: 80 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuWidth = 224;
    const spaceAbove = rect.top - 12;
    const spaceBelow = viewportH - rect.bottom - 12;
    const openUpward = spaceAbove >= 140 || spaceAbove >= spaceBelow;
    const left = Math.max(12, Math.min(rect.left, viewportW - menuWidth - 12));

    if (openUpward) {
      setPosition({ left, bottom: viewportH - rect.top + 8 });
    } else {
      setPosition({ left, top: rect.bottom + 8 });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

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
  }, [isOpen, updatePosition]);

  const actionCount = (canUpload ? 1 : 0) + (canEnhance ? 1 : 0) + (canCloneRepo ? 1 : 0);
  const hasActions = actionCount > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={!hasActions || uploadingAttachment || enhancingPrompt}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          if (actionCount === 1) {
            if (canUpload) {
              onTriggerUpload?.();
              return;
            }
            if (canCloneRepo) {
              onTriggerCloneRepo?.();
              return;
            }
            if (canEnhance) {
              if (hasInput) {
                onTriggerEnhance?.();
              } else {
                toast.info('Write a prompt first to enhance it.');
              }
              return;
            }
          }
          setIsOpen((prev) => !prev);
        }}
        title="Add attachment or enhance prompt"
        className={classNames(
          'w-8 h-8 rounded-lg flex items-center justify-center transition-theme cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:opacity-50 disabled:cursor-not-allowed',
          isOpen
            ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary'
            : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
        )}
      >
        {uploadingAttachment || enhancingPrompt ? (
          <span className="i-svg-spinners:90-ring-with-bg text-base text-bolt-elements-loader-progress" />
        ) : (
          <span className="i-ph:plus text-[18px]" />
        )}
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Prompt actions"
            style={{
              position: 'fixed',
              left: `${position.left}px`,
              top: position.top !== undefined ? `${position.top}px` : undefined,
              bottom: position.bottom !== undefined ? `${position.bottom}px` : undefined,
              width: '224px',
              zIndex: 1000,
              animation: 'fadeInMenu 140ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary shadow-2xl p-1.5 space-y-1"
          >
            {canUpload && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onTriggerUpload?.();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer text-left"
              >
                <span className="i-ph:paperclip text-base text-bolt-elements-textSecondary shrink-0" />
                <span>Upload file or image</span>
              </button>
            )}

            {canCloneRepo && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onTriggerCloneRepo?.();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer text-left"
              >
                <span className="i-ph:git-branch text-base text-bolt-elements-textSecondary shrink-0" />
                <span>Clone GitHub repo</span>
              </button>
            )}

            {canEnhance && (
              <button
                type="button"
                role="menuitem"
                disabled={!hasInput || enhancingPrompt}
                onClick={() => {
                  setIsOpen(false);
                  onTriggerEnhance?.();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer text-left disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <span className="i-bolt:stars text-base text-bolt-elements-item-contentAccent shrink-0" />
                <span>Enhance prompt</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

interface VoiceMicButtonProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function VoiceMicButton({ disabled = false, onTranscript }: VoiceMicButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore cleanup stop errors
      }
    };
  }, []);

  const handleToggleListening = () => {
    if (disabled) {
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      toast.info('Voice dictation is not supported in this browser.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor() as SpeechRecognitionInstance;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || 'en-US';

      recognition.onresult = (event: any) => {
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i]?.isFinal) {
            finalChunk += event.results[i][0]?.transcript ?? '';
          }
        }
        const cleaned = finalChunk.trim();
        if (cleaned) {
          onTranscriptRef.current(cleaned);
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error && event.error !== 'aborted' && event.error !== 'no-speech') {
          toast.error('Microphone input error. Check browser permissions.');
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      toast.error('Could not start microphone dictation.');
      setIsListening(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleToggleListening}
      title={isListening ? 'Stop voice input' : 'Voice input'}
      aria-label={isListening ? 'Stop voice input' : 'Voice input'}
      className={classNames(
        'w-8 h-8 rounded-lg flex items-center justify-center transition-theme cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:opacity-50 disabled:cursor-not-allowed',
        isListening
          ? 'bg-red-500/15 text-red-400'
          : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
      )}
    >
      <span
        className={classNames(
          'text-[17px]',
          isListening ? 'i-ph:microphone-fill animate-pulse' : 'i-ph:microphone',
        )}
      />
    </button>
  );
}
