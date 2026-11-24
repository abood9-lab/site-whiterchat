import { classNames } from '~/utils/classNames';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
}

export function SendButton({ show, isStreaming = false, onClick }: SendButtonProps) {
  const canClick = show || isStreaming;

  return (
    <button
      type="button"
      disabled={!canClick}
      title={isStreaming ? 'Stop generation' : 'Send message'}
      aria-label={isStreaming ? 'Stop generation' : 'Send message'}
      onClick={(event) => {
        event.preventDefault();
        if (canClick) {
          onClick?.(event);
        }
      }}
      className={classNames(
        'w-8 h-8 rounded-lg flex items-center justify-center transition-theme shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
        isStreaming
          ? 'text-bolt-elements-item-contentAccent bg-bolt-elements-item-backgroundAccent cursor-pointer'
          : show
            ? 'text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive cursor-pointer'
            : 'text-bolt-elements-textTertiary opacity-55 cursor-default',
      )}
    >
      {isStreaming ? (
        <span className="i-ph:stop-circle-bold text-[18px]" />
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3.5 11.4L20.4 4.2C20.9 4 21.4 4.5 21.2 5L14 21.9C13.8 22.4 13 22.4 12.8 21.8L10.3 14.3L2.8 11.8C2.2 11.6 2.2 10.8 2.8 10.6L3.5 11.4Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10.3 14.3L20.8 4.6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
