import type {
  EnvironmentOption,
  ParsedEnvironmentChoice,
  RuntimeEnvironment,
} from '~/lib/stores/runtime';
import { classNames } from '~/utils/classNames';

interface EnvironmentChoiceCardProps {
  data: ParsedEnvironmentChoice;
  isCompleted?: boolean;
  selectedEnvironment?: RuntimeEnvironment;
  daytonaConfigured: boolean;
  isBusy?: boolean;
  onSelectEnvironment?: (env: RuntimeEnvironment) => void;
}

const FALLBACK_OPTIONS: Record<RuntimeEnvironment, EnvironmentOption> = {
  webcontainer: {
    id: 'webcontainer',
    title: 'WebContainer',
    suitability: 'Instant browser-based Node.js & Vite runtime',
    reasons: ['Zero cloud provisioning latency', 'Best for React, TypeScript, Vite & Tailwind apps'],
    limitations: ['No Python, pip, Docker, or native Linux system binaries'],
  },
  daytona: {
    id: 'daytona',
    title: 'Daytona Cloud Sandbox',
    suitability: 'Full Linux VM for backends, Python & native tools',
    reasons: ['Supports Python, pip, native binaries, databases & Git', 'Full persistent Linux terminal'],
    limitations: ['Requires DAYTONA_API_KEY and a few seconds to provision'],
  },
};

export function EnvironmentChoiceCard({
  data,
  isCompleted = false,
  selectedEnvironment,
  daytonaConfigured,
  isBusy = false,
  onSelectEnvironment,
}: EnvironmentChoiceCardProps) {
  const optionsMap = new Map<RuntimeEnvironment, EnvironmentOption>();

  for (const opt of data.options) {
    optionsMap.set(opt.id, opt);
  }

  const orderedOptions: EnvironmentOption[] = [
    optionsMap.get('webcontainer') ?? FALLBACK_OPTIONS.webcontainer,
    optionsMap.get('daytona') ?? FALLBACK_OPTIONS.daytona,
  ];

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
      {/* Header Bar */}
      <div className="px-5 py-3 border-b border-bolt-elements-borderColor flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-bolt-elements-textPrimary">
          <span className="i-ph:compass text-base text-bolt-elements-item-contentAccent shrink-0" />
          <span>Environment Recommendation</span>
        </div>

        <span
          className={classNames(
            'text-xs font-medium',
            isCompleted ? 'text-bolt-elements-icon-success' : 'text-bolt-elements-item-contentAccent',
          )}
        >
          {isCompleted ? 'Environment selected' : 'Choose sandbox to continue'}
        </span>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {data.analysisSummary && (
          <p dir="auto" className="text-sm text-bolt-elements-textPrimary leading-relaxed">
            {data.analysisSummary}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {orderedOptions.map((option) => {
            const isRecommended = data.recommended === option.id;
            const isChosen = isCompleted && selectedEnvironment === option.id;
            const isDaytona = option.id === 'daytona';
            const disabled = isCompleted || isBusy || !onSelectEnvironment;

            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectEnvironment?.(option.id)}
                className={classNames(
                  'group flex flex-col justify-between text-left rounded-xl border p-4 transition-theme',
                  disabled ? 'cursor-default' : 'cursor-pointer',
                  isChosen
                    ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive'
                    : isRecommended && !isCompleted
                      ? 'bg-bolt-elements-background-depth-1 border-bolt-elements-borderColorActive/70 hover:bg-bolt-elements-item-backgroundAccent/60'
                      : 'bg-bolt-elements-background-depth-1 border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/60 hover:bg-bolt-elements-item-backgroundActive',
                  isCompleted && !isChosen ? 'opacity-65' : undefined,
                )}
              >
                <div className="space-y-3 w-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={classNames(
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border',
                          isChosen || (isRecommended && !isCompleted)
                            ? 'bg-bolt-elements-button-primary-background border-bolt-elements-borderColorActive text-bolt-elements-item-contentAccent'
                            : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textSecondary',
                        )}
                      >
                        <span className={classNames(isDaytona ? 'i-ph:cloud' : 'i-ph:globe', 'text-base')} />
                      </div>
                      <div className="min-w-0">
                        <h4 dir="auto" className="text-sm font-semibold text-bolt-elements-textPrimary truncate">
                          {option.title}
                        </h4>
                        <p dir="auto" className="text-xs text-bolt-elements-textSecondary leading-snug">
                          {option.suitability}
                        </p>
                      </div>
                    </div>

                    {isChosen ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-bolt-elements-icon-success shrink-0">
                        <span className="i-ph:check-circle-fill text-sm" />
                        Selected
                      </span>
                    ) : isRecommended ? (
                      <span className="text-xs font-semibold text-bolt-elements-item-contentAccent shrink-0">
                        Recommended
                      </span>
                    ) : null}
                  </div>

                  {option.reasons.length > 0 && (
                    <ul className="space-y-1.5 pt-1">
                      {option.reasons.slice(0, 3).map((reason, idx) => (
                        <li
                          key={idx}
                          dir="auto"
                          className="flex items-start gap-2 text-xs text-bolt-elements-textPrimary leading-snug"
                        >
                          <span className="i-ph:check-bold text-xs text-bolt-elements-icon-success mt-0.5 shrink-0" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {option.limitations.length > 0 && (
                    <ul className="space-y-1 pt-0.5">
                      {option.limitations.slice(0, 2).map((limitation, idx) => (
                        <li
                          key={idx}
                          dir="auto"
                          className="flex items-start gap-2 text-xs text-bolt-elements-textTertiary leading-snug"
                        >
                          <span className="mt-0.5 shrink-0">•</span>
                          <span>{limitation}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {isDaytona && !daytonaConfigured && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-400">
                      <span className="i-ph:warning text-sm shrink-0 mt-0.5" />
                      <span>DAYTONA_API_KEY is not configured in server secrets yet.</span>
                    </div>
                  )}
                </div>

                <div className="w-full pt-3 mt-3 border-t border-bolt-elements-borderColor/70 flex items-center justify-between text-xs font-semibold">
                  <span
                    className={
                      isChosen
                        ? 'text-bolt-elements-icon-success'
                        : isRecommended && !isCompleted
                          ? 'text-bolt-elements-item-contentAccent'
                          : 'text-bolt-elements-textSecondary group-hover:text-bolt-elements-textPrimary'
                    }
                  >
                    {isChosen
                      ? 'Active runtime for this task'
                      : isCompleted
                        ? 'Not selected'
                        : `Use ${isDaytona ? 'Daytona Cloud' : 'WebContainer'}`}
                  </span>
                  {!isCompleted && (
                    <span className="i-ph:rocket-launch text-sm text-bolt-elements-textTertiary group-hover:text-bolt-elements-item-contentAccent transition-theme" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-bolt-elements-textTertiary">
          You can switch between WebContainer and Daytona anytime from the terminal bar.
        </p>
      </div>
    </div>
  );
}
