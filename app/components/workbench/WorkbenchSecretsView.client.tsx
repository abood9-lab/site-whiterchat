import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { chatId as chatIdStore } from '~/lib/persistence';
import {
  extractSecretSpecsFromEnvExample,
  findWorkspaceFileContent,
  getExistingEnvValuesMap,
  mergeRequestedSecrets,
  parseEnvContent,
  requestedSecretsStore,
  saveProjectSecretsToWorkspace,
  type SecretFieldSpec,
} from '~/lib/stores/secrets';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

type SecretsTabMode = 'variables' | 'paste';

export function WorkbenchSecretsView() {
  const files = useStore(workbenchStore.files);
  const requestedSecrets = useStore(requestedSecretsStore);

  const [tabMode, setTabMode] = useState<SecretsTabMode>('variables');
  const [searchQuery, setSearchQuery] = useState('');
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [customSpecs, setCustomSpecs] = useState<SecretFieldSpec[]>([]);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [pasteBuffer, setPasteBuffer] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const savedEnvMap = useMemo(() => getExistingEnvValuesMap(files), [files]);

  // Keep draftValues synchronized when .env updates externally (e.g., saved from PromptSecretsDock)
  const savedEnvSignature = useMemo(
    () =>
      Object.entries(savedEnvMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    [savedEnvMap],
  );

  useEffect(() => {
    setDraftValues({ ...savedEnvMap });
  }, [savedEnvSignature]);

  // Combine all saved .env keys, .env.example specs, AI-requested specs, and user-added specs
  const combinedFields = useMemo<SecretFieldSpec[]>(() => {
    const map = new Map<string, SecretFieldSpec>();

    for (const [key] of Object.entries(savedEnvMap)) {
      map.set(key, { key, required: false });
    }

    const envExample = findWorkspaceFileContent(files, '.env.example');
    if (envExample) {
      for (const spec of extractSecretSpecsFromEnvExample(envExample)) {
        const prev = map.get(spec.key);
        map.set(spec.key, {
          key: spec.key,
          description: spec.description || prev?.description,
          placeholder: spec.placeholder || prev?.placeholder,
          required: spec.required ?? prev?.required,
        });
      }
    }

    for (const spec of requestedSecrets) {
      const prev = map.get(spec.key);
      map.set(spec.key, {
        key: spec.key,
        label: spec.label || prev?.label,
        description: spec.description || prev?.description,
        required: spec.required ?? prev?.required ?? true,
        placeholder: spec.placeholder || prev?.placeholder,
      });
    }

    for (const spec of customSpecs) {
      if (!map.has(spec.key)) {
        map.set(spec.key, spec);
      }
    }

    return Array.from(map.values());
  }, [files, savedEnvMap, requestedSecrets, customSpecs]);

  const filteredFields = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return combinedFields;
    }
    return combinedFields.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.label?.toLowerCase().includes(q),
    );
  }, [combinedFields, searchQuery]);

  const parsedPasteEntries = useMemo(() => {
    if (!pasteBuffer.trim()) {
      return [];
    }
    return parseEnvContent(pasteBuffer);
  }, [pasteBuffer]);

  const configuredCount = useMemo(() => {
    return combinedFields.filter((f) => (draftValues[f.key] ?? '').trim().length > 0).length;
  }, [combinedFields, draftValues]);

  const isDirty = useMemo(() => {
    const allKeys = new Set([...Object.keys(savedEnvMap), ...Object.keys(draftValues)]);
    for (const key of allKeys) {
      if ((savedEnvMap[key] ?? '') !== (draftValues[key] ?? '')) {
        return true;
      }
    }
    return false;
  }, [savedEnvMap, draftValues]);

  const handleToggleReveal = (key: string) => {
    setRevealedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRemoveVariable = (key: string) => {
    setDraftValues((prev) => {
      const next = { ...prev };
      next[key] = '';
      return next;
    });
    setCustomSpecs((prev) => prev.filter((item) => item.key !== key));
  };

  const handleAddCustomVariable = () => {
    const cleanKey = newVarKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
      toast.error('Variable name must start with a letter or underscore (e.g. STRIPE_SECRET_KEY).');
      return;
    }

    if (!combinedFields.some((f) => f.key === cleanKey)) {
      const spec: SecretFieldSpec = {
        key: cleanKey,
        description: 'Custom project environment variable',
        required: false,
      };
      setCustomSpecs((prev) => [...prev, spec]);
      mergeRequestedSecrets([spec]);
    }

    if (newVarValue.trim()) {
      setDraftValues((prev) => ({ ...prev, [cleanKey]: newVarValue.trim() }));
    }

    setNewVarKey('');
    setNewVarValue('');
  };

  const handleApplyPastedEnv = () => {
    if (parsedPasteEntries.length === 0) {
      toast.warning('No valid KEY=VALUE pairs detected in pasted text.');
      return;
    }

    const nextDraft = { ...draftValues };
    const newSpecs: SecretFieldSpec[] = [];

    for (const entry of parsedPasteEntries) {
      nextDraft[entry.key] = entry.value;
      if (!combinedFields.some((f) => f.key === entry.key)) {
        newSpecs.push({
          key: entry.key,
          description: entry.comment,
          required: false,
        });
      }
    }

    if (newSpecs.length > 0) {
      setCustomSpecs((prev) => [...prev, ...newSpecs]);
      mergeRequestedSecrets(newSpecs);
    }

    setDraftValues(nextDraft);
    setPasteBuffer('');
    setTabMode('variables');
    toast.success(`Applied ${parsedPasteEntries.length} environment variable${parsedPasteEntries.length === 1 ? '' : 's'}`);
  };

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    const valuesToSave: Record<string, string> = { ...draftValues };
    if (tabMode === 'paste' && parsedPasteEntries.length > 0) {
      for (const entry of parsedPasteEntries) {
        valuesToSave[entry.key] = entry.value;
      }
    }

    setIsSaving(true);
    try {
      const result = await saveProjectSecretsToWorkspace(valuesToSave, workbenchStore.files.get(), {
        removeEmptyKeys: true,
        chatId: chatIdStore.get(),
      });
      toast.success(
        result.syncedToCloud
          ? `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env & Daytona Volume`
          : result.gitignoreUpdated
            ? `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env and updated .gitignore`
            : `Saved ${result.savedKeysCount} secret${result.savedKeysCount === 1 ? '' : 's'} to .env`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save secrets to .env');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-bolt-elements-background-depth-1/30 overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm sm:text-base font-semibold text-bolt-elements-textPrimary truncate">
            Environment Secrets
          </h2>
          <div className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary flex-wrap">
            <span className="font-mono tabular-nums">
              {configuredCount} / {combinedFields.length} configured
            </span>
            <span aria-hidden="true">·</span>
            <span>Stored in project .env</span>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor shrink-0">
          <button
            type="button"
            onClick={() => setTabMode('variables')}
            className={classNames(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-theme cursor-pointer flex items-center gap-1.5 whitespace-nowrap',
              tabMode === 'variables'
                ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent',
            )}
          >
            <span className="i-ph:textbox text-sm" />
            <span>Variables</span>
          </button>
          <button
            type="button"
            onClick={() => setTabMode('paste')}
            className={classNames(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-theme cursor-pointer flex items-center gap-1.5 whitespace-nowrap',
              tabMode === 'paste'
                ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent',
            )}
          >
            <span className="i-ph:clipboard-text text-sm" />
            <span>Paste .env</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
        {tabMode === 'variables' ? (
          <>
            {/* Search & Quick Add */}
            {combinedFields.length > 3 && (
              <div className="flex items-center gap-2 px-3 h-[38px] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 focus-within:border-bolt-elements-borderColorActive transition-theme">
                <span className="i-ph:magnifying-glass text-sm text-bolt-elements-textTertiary shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter variables by key or description..."
                  className="w-full bg-transparent text-xs sm:text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary bg-transparent cursor-pointer"
                  >
                    <span className="i-ph:x text-xs" />
                  </button>
                )}
              </div>
            )}

            {filteredFields.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-2 border border-dashed border-bolt-elements-borderColor rounded-xl bg-bolt-elements-background-depth-2/40">
                <span className="i-ph:lock-key text-2xl text-bolt-elements-textTertiary block mx-auto" />
                <div className="text-sm font-medium text-bolt-elements-textPrimary">
                  {combinedFields.length === 0 ? 'No secrets saved yet' : 'No matching variables'}
                </div>
                <p className="text-xs text-bolt-elements-textSecondary max-w-md mx-auto">
                  {combinedFields.length === 0
                    ? 'Add environment variables below or paste an existing .env block to store secrets locally.'
                    : 'Try another search query or add a new variable below.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-bolt-elements-borderColor/70 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/60 px-4">
                {filteredFields.map((field) => {
                  const val = draftValues[field.key] ?? '';
                  const isRevealed = Boolean(revealedKeys[field.key]);
                  const isSavedInEnv = Boolean(savedEnvMap[field.key]?.trim());

                  return (
                    <div key={field.key} className="py-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <label
                            htmlFor={`wb-secret-${field.key}`}
                            className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-bolt-elements-textPrimary truncate"
                          >
                            {field.key}
                          </label>
                          {field.label && field.label !== field.key && (
                            <span className="text-xs text-bolt-elements-textSecondary truncate">· {field.label}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs shrink-0">
                          {isSavedInEnv ? (
                            <span className="inline-flex items-center gap-1 text-bolt-elements-icon-success font-medium">
                              <span className="i-ph:check-circle-fill text-xs" />
                              Saved in .env
                            </span>
                          ) : field.required ? (
                            <span className="text-bolt-elements-item-contentAccent font-medium">Missing</span>
                          ) : (
                            <span className="text-bolt-elements-textTertiary">Unset</span>
                          )}
                        </div>
                      </div>

                      {field.description && (
                        <p dir="auto" className="text-xs text-bolt-elements-textSecondary leading-relaxed">
                          {field.description}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <input
                          id={`wb-secret-${field.key}`}
                          type={isRevealed ? 'text' : 'password'}
                          value={val}
                          autoComplete="new-password"
                          spellCheck={false}
                          onChange={(e) => setDraftValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={field.placeholder || `Enter ${field.key}...`}
                          className="flex-1 min-w-0 h-[38px] px-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs sm:text-sm font-mono text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme"
                        />
                        <button
                          type="button"
                          onClick={() => handleToggleReveal(field.key)}
                          title={isRevealed ? 'Hide value' : 'Reveal value'}
                          aria-label={isRevealed ? `Hide ${field.key}` : `Reveal ${field.key}`}
                          className="w-[38px] h-[38px] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary flex items-center justify-center shrink-0 transition-theme cursor-pointer"
                        >
                          <span className={classNames(isRevealed ? 'i-ph:eye-slash' : 'i-ph:eye', 'text-base')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveVariable(field.key)}
                          title={`Clear ${field.key}`}
                          aria-label={`Clear ${field.key}`}
                          className="w-[38px] h-[38px] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textTertiary hover:text-bolt-elements-icon-error flex items-center justify-center shrink-0 transition-theme cursor-pointer"
                        >
                          <span className="i-ph:trash text-sm" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add New Variable */}
            <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/60 p-4 space-y-2.5">
              <div className="text-xs font-semibold text-bolt-elements-textPrimary">Add New Variable</div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={newVarKey}
                  spellCheck={false}
                  onChange={(e) => setNewVarKey(e.target.value)}
                  placeholder="KEY_NAME"
                  className="sm:w-[190px] h-[38px] px-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs font-mono uppercase text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive"
                />
                <input
                  type="password"
                  value={newVarValue}
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomVariable();
                    }
                  }}
                  placeholder="Secret value (optional)"
                  className="flex-1 min-w-0 h-[38px] px-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs font-mono text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive"
                />
                <button
                  type="button"
                  onClick={handleAddCustomVariable}
                  disabled={!newVarKey.trim()}
                  className="inline-flex h-[38px] items-center justify-center gap-1.5 px-3.5 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <span className="i-ph:plus text-sm" />
                  <span>Add Variable</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="wb-paste-env" className="text-xs font-semibold text-bolt-elements-textPrimary">
                Paste .env block
              </label>
              <span className="text-xs font-mono tabular-nums text-bolt-elements-textSecondary">
                {parsedPasteEntries.length} key{parsedPasteEntries.length === 1 ? '' : 's'} detected
              </span>
            </div>

            <textarea
              id="wb-paste-env"
              rows={10}
              value={pasteBuffer}
              spellCheck={false}
              onChange={(e) => setPasteBuffer(e.target.value)}
              placeholder={`OPENAI_API_KEY=sk-...\nSTRIPE_SECRET_KEY=sk_test_...\nDATABASE_URL=postgresql://...`}
              className="w-full p-3.5 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-xs font-mono text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive resize-y leading-relaxed"
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-bolt-elements-textTertiary">
                Supports comments (#) and quoted multiline values.
              </span>
              <button
                type="button"
                disabled={parsedPasteEntries.length === 0}
                onClick={handleApplyPastedEnv}
                className="inline-flex h-[36px] items-center justify-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <span className="i-ph:magic-wand text-sm" />
                <span>Apply to Variables</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary">
          <span className="i-ph:cloud-check text-sm text-bolt-elements-icon-success shrink-0" />
          <span>Saved to .env, ignored in .gitignore, and persisted in Daytona Volume</span>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {isDirty && (
            <button
              type="button"
              onClick={() => setDraftValues({ ...savedEnvMap })}
              className="inline-flex h-[36px] items-center justify-center rounded-lg px-3.5 text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover transition-theme cursor-pointer whitespace-nowrap"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="inline-flex h-[36px] items-center justify-center gap-1.5 rounded-lg px-4 text-xs sm:text-sm font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border border-bolt-elements-borderColorActive/40 transition-theme cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {isSaving ? (
              <span className="i-svg-spinners:90-ring-with-bg text-sm" />
            ) : (
              <span className="i-ph:lock-key text-sm" />
            )}
            <span>{isSaving ? 'Saving...' : 'Save Secrets to .env'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
