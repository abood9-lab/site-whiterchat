import type { ProviderId } from '~/types/providers';

interface ProviderLogoProps {
  provider: ProviderId;
  className?: string;
}

export function ProviderLogo({ provider, className = 'w-4 h-4 shrink-0' }: ProviderLogoProps) {
  switch (provider) {
    case 'openrouter':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2.75" fill="currentColor" />
          <path d="M14.5 10.5L19.5 6.5M14.5 13.5L19.5 17.5M9.5 12H4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'groq':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M14.5 9.25C13.85 8.6 12.97 8.25 12 8.25C9.93 8.25 8.25 9.93 8.25 12C8.25 14.07 9.93 15.75 12 15.75C13.92 15.75 15.5 14.3 15.72 12.43H12.25"
            stroke="#F55036"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'gemini':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <defs>
            <linearGradient id="bolt-gemini-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4285F4" />
              <stop offset="55%" stopColor="#9B72CB" />
              <stop offset="100%" stopColor="#D96570" />
            </linearGradient>
          </defs>
          <path
            d="M12 2.5C12.75 7.45 16.55 11.25 21.5 12C16.55 12.75 12.75 16.55 12 21.5C11.25 16.55 7.45 12.75 2.5 12C7.45 11.25 11.25 7.45 12 2.5Z"
            fill="url(#bolt-gemini-grad)"
          />
        </svg>
      );
  }
}
