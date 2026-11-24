import { useStore } from '@nanostores/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { chatId as chatIdStore } from '~/lib/persistence';
import {
  closePromptSecretsDock,
  getExistingEnvValuesMap,
  parseEnvContent,
  promptRequestedSecretsStore,
  promptSecretsCollapsedStore,
  promptSecretsDockOpenStore,
  promptSecretsIntroStore,
  saveProjectSecretsToWorkspace,
} from '~/lib/stores/secrets';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';

type DockMode = 'fields' | 'paste';

export function PromptSecretsDock() {
  const isOpen = useStore(promptSecretsDockOpenStore);
  const isCollapsed = useStore(promptSecretsCollapsedStore);
  const requestedSecrets = useStore(promptRequestedSecretsStore);
  const intro = useStore(promptSecretsIntroStore);
  const files = useStore(workbenchStore.files);

  const [mode, setMode] = useState<DockMode>('fields');
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [pasteBuffer, setPasteBuffer] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const requestedKeySignature = useMemo(() => requestedSecrets.map((s) => s.key).join('|'), [requestedSecrets]);

  useEffect(() => {
    if (!isOpen) {
      setDraftValues({});
      setRevealedKeys({});
      setPasteBuffer('');
      setMode('fields');
      return;
    }

    const existing = getExistingEnvValuesMap(files);
    const nextDraft: Record<string, string> = {};
    for (const spec of requestedSecrets) {
      if (existing[spec.key]) {
        nextDraft[spec.key] = existing[spec.key];
      }
    }
    setDraftValues((prev) => ({ ...nextDraft, ...prev }));
  }, [isOpen, requestedKeySignature]);

  const parsedPasteEntries = useMemo(() => {
    if (!pasteBuffer.trim()) {
      return [];
    }
    return parseEnvContent(pasteBuffer);
  }, [pasteBuffer]);

  const filledCount = useMemo(() => {
    return requestedSecrets.filter((spec) => (draftValues[spec.key] ?? '').trim().length > 0).length;
  }, [requestedSecrets, draftValues]);

  if (!isOpen || requestedSecrets.length === 0) {
    return null;
  }

  const handleToggleReveal = (key: string) => {
    setRevealedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApplyPastedEnv = () => {
    if (parsedPasteEntries.length === 0) {
      toast.warning('No valid KEY=VALUE pairs detected in pasted text.');
      return;
    }

    const requestedSet = new Set(requestedSecrets.map((s) => s.key));
    const nextDraft = { ...draftValues };
    let matchedCount = 0;

    for (const entry of parsedPasteEntries) {
      if (requestedSet.has(entry.key) || requestedSecrets.length === 0) {
        nextDraft[entry.key] = entry.value;
        matchedCount += 1;
      }
    }

    // Even if keys didn't match requested names strictly, preserve them when user pastes full .env
    if (matchedCount === 0) {
      for (const entry of parsedPasteEntries) {
        nextDraft[entry.key] = entry.value;
      }
    }

    setDraftValues(nextDraft);
    setPasteBuffer('');
    setMode('fields');
    toast.success(`Applied ${parsedPasteEntries.length} variable${parsedPasteEntries.length === 1 ? '' : 's'}`);
  };

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    const valuesToSave: Record<string, string> = { ...draftValues };
    if (mode === 'paste' && parsedPasteEntries.length > 0) {
      for (const entry of parsedPasteEntries) {
        valuesToSave[entry.key] = entry.value;
      }
    }

    const hasAnyValue = Object.values(valuesToSave).some((val) => val.trim().length > 0);
    if (!hasAnyValue) {
      toast.info('Enter at least one API secret or click "Skip for now".');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveProjectSecretsToWorkspace(valuesToSave, workbenchStore.files.get(), {
        chatId: chatIdStore.get(),
      });
      toast.success(
        result.syncedToCloud
          ? `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env & Daytona Volume`
          : result.gitignoreUpdated
            ? `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env and updated .gitignore`
            : `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env`,
      );
      closePromptSecretsDock();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save secrets to .env');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="prompt-secrets-dock"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: cubicEasingFn }}
        className="mb-2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/95 backdrop-blur-md shadow-sm overflow-hidden"
      >
        {isCollapsed ? (
          <div className="px-4 py-2.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => promptSecretsCollapsedStore.set(false)}
              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group bg-transparent"
            >
              <span className="i-ph:key text-base text-bolt-elements-item-contentAccent shrink-0" />
              <span className="text-xs sm:text-sm font-medium text-bolt-elements-textPrimary truncate">
                API Secrets Requested
              </span>
              <span className="text-xs font-mono tabular-nums text-bolt-elements-textSecondary shrink-0">
                · {filledCount}/{requestedSecrets.length}
              </span>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={closePromptSecretsDock}
                className="text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary bg-transparent px-2 py-1 rounded-md cursor-pointer whitespace-nowrap"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => promptSecretsCollapsedStore.set(false)}
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
                <span className="i-ph:key text-base text-bolt-elements-item-contentAccent shrink-0" />
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-semibold text-bolt-elements-textPrimary whitespace-nowrap">
                    API Secrets Requested
                  </span>
                  <span className="text-xs font-mono tabular-nums text-bolt-elements-textSecondary whitespace-nowrap">
                    · {requestedSecrets.length} key{requestedSecrets.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor">
                  <button
                    type="button"
                    onClick={() => setMode('fields')}
                    className={classNames(
                      'px-2 py-1 rounded text-[11px] font-medium transition-theme cursor-pointer whitespace-nowrap',
                      mode === 'fields'
                        ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                        : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent',
                    )}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('paste')}
                    className={classNames(
                      'px-2 py-1 rounded text-[11px] font-medium transition-theme cursor-pointer whitespace-nowrap',
                      mode === 'paste'
                        ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                        : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent',
                    )}
                  >
                    Paste .env
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => workbenchStore.openSecretsInWorkbench()}
                  title="Open full Secrets manager tab"
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive bg-transparent cursor-pointer whitespace-nowrap"
                >
                  <span>All Secrets</span>
                  <span className="i-ph:arrow-square-out text-xs" />
                </button>

                <button
                  type="button"
                  onClick={() => promptSecretsCollapsedStore.set(true)}
                  title="Minimize temporarily"
                  aria-label="Minimize API secrets tray"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive bg-transparent cursor-pointer shrink-0"
                >
                  <span className="i-ph:caret-down text-sm" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 py-3 max-h-[250px] overflow-y-auto bg-bolt-elements-background-depth-1/40 space-y-3">
              {intro && (
                <p dir="auto" className="text-xs text-bolt-elements-textSecondary leading-relaxed">
                  {intro}
                </p>
              )}

              {mode === 'fields' ? (
                <div className="divide-y divide-bolt-elements-borderColor/70">
                  {requestedSecrets.map((field) => {
                    const val = draftValues[field.key] ?? '';
                    const isRevealed = Boolean(revealedKeys[field.key]);

                    return (
                      <div key={field.key} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <label
                            htmlFor={`dock-secret-${field.key}`}
                            className="font-mono tabular-nums text-xs font-semibold text-bolt-elements-textPrimary truncate"
                          >
                            {field.key}
                          </label>
                          {field.description && (
                            <span dir="auto" className="text-[11px] text-bolt-elements-textSecondary truncate max-w-full">
                              {field.description}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            id={`dock-secret-${field.key}`}
                            type={isRevealed ? 'text' : 'password'}
                            value={val}
                            autoComplete="new-password"
                            spellCheck={false}
                            onChange={(e) => setDraftValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.placeholder || `Enter ${field.key}...`}
                            className="flex-1 min-w-0 h-[36px] px-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs font-mono text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme"
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleReveal(field.key)}
                            title={isRevealed ? 'Hide secret' : 'Show secret'}
                            aria-label={isRevealed ? `Hide ${field.key}` : `Show ${field.key}`}
                            className="w-[36px] h-[36px] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary flex items-center justify-center shrink-0 transition-theme cursor-pointer"
                          >
                            <span className={classNames(isRevealed ? 'i-ph:eye-slash' : 'i-ph:eye', 'text-sm')} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-bolt-elements-textSecondary">Paste .env lines to populate requested keys</span>
                    <span className="font-mono tabular-nums text-bolt-elements-textTertiary">
                      {parsedPasteEntries.length} detected
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    value={pasteBuffer}
                    spellCheck={false}
                    onChange={(e) => setPasteBuffer(e.target.value)}
                    placeholder={requestedSecrets.map((s) => `${s.key}=...`).join('\n')}
                    className="w-full p-2.5 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs font-mono text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={parsedPasteEntries.length === 0}
                      onClick={handleApplyPastedEnv}
                      className="inline-flex h-[32px] items-center gap-1.5 px-3 rounded-md text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <span className="i-ph:check text-xs" />
                      <span>Apply to Fields</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] text-bolt-elements-textTertiary">
                <span className="i-ph:cloud-check text-sm text-bolt-elements-icon-success shrink-0" />
                <span>Saved to .env &amp; persisted in Daytona Volume</span>
              </div>

              <div className="flex items-center gap-2 ml-auto shrink-0">
                <button
                  type="button"
                  onClick={closePromptSecretsDock}
                  className="inline-flex h-[34px] items-center justify-center rounded-lg px-3 text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover transition-theme cursor-pointer whitespace-nowrap"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border border-bolt-elements-borderColorActive/40 transition-theme cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {isSaving ? (
                    <span className="i-svg-spinners:90-ring-with-bg text-sm" />
                  ) : (
                    <span className="i-ph:lock-key text-sm" />
                  )}
                  <span>{isSaving ? 'Saving...' : 'Save to .env'}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
