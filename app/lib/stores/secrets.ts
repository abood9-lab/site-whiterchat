import { atom } from 'nanostores';
import { writeWorkspaceFile } from '~/lib/daytona/workspace.client';
import { webcontainer } from '~/lib/webcontainer';
import type { FileMap } from './files';
import { activeProjectIdStore, daytonaStateStore } from './runtime';

export interface SecretFieldSpec {
  key: string;
  label?: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
}

export interface ParsedSecretsBlock {
  intro?: string;
  secrets: SecretFieldSpec[];
}

export interface ParsedEnvEntry {
  key: string;
  value: string;
  comment?: string;
}

export const promptSecretsDockOpenStore = atom<boolean>(false);
export const promptSecretsCollapsedStore = atom<boolean>(false);
export const promptSecretsIntroStore = atom<string>('');
export const promptRequestedSecretsStore = atom<SecretFieldSpec[]>([]);
export const requestedSecretsStore = atom<SecretFieldSpec[]>([]);
export const secretsVersionStore = atom<number>(0);

const promptedMessageIds = new Set<string>();
const promptedEnvSignatures = new Set<string>();

const PLACEHOLDER_PATTERNS = [
  /^your[_-]/i,
  /^replace[_-]/i,
  /^enter[_-]/i,
  /^insert[_-]/i,
  /^add[_-]/i,
  /^paste[_-]/i,
  /^change[_-]/i,
  /^todo/i,
  /^xxx+$/i,
  /^<.*>$/,
  /^\[.*\]$/,
  /^pk_test_placeholder/i,
  /^sk_test_placeholder/i,
  /^example/i,
];

const NON_SECRET_DEFAULT_KEYS = new Set(['PORT', 'HOST', 'NODE_ENV', 'APP_ENV', 'VITE_APP_TITLE']);

export function normalizeEnvPath(filePath: string): string {
  return filePath.replace(/^\/home\/project\/?/, '').replace(/^\/+/, '');
}

export function isSensitiveEnvPath(filePath: string): boolean {
  const rel = normalizeEnvPath(filePath);
  const baseName = rel.split('/').pop() ?? '';

  if (!baseName.startsWith('.env')) {
    return false;
  }

  if (
    baseName === '.env.example' ||
    baseName === '.env.template' ||
    baseName === '.env.sample' ||
    baseName.endsWith('.example') ||
    baseName.endsWith('.template') ||
    baseName.endsWith('.sample')
  ) {
    return false;
  }

  return true;
}

export function isPlaceholderEnvValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function parseEnvContent(content: string): ParsedEnvEntry[] {
  const entries: ParsedEnvEntry[] = [];
  const seen = new Map<string, number>();
  const lines = content.split(/\r?\n/);
  let pendingComment: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      pendingComment = [];
      continue;
    }

    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#+\s*/, '').trim();
      if (commentText) {
        pendingComment.push(commentText);
      }
      continue;
    }

    const cleanedLine = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = cleanedLine.indexOf('=');
    if (eqIndex <= 0) {
      pendingComment = [];
      continue;
    }

    const key = cleanedLine.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      pendingComment = [];
      continue;
    }

    let rawValue = cleanedLine.slice(eqIndex + 1).trim();
    let inlineComment = '';

    if (
      (rawValue.startsWith('"') && rawValue.includes('"', 1)) ||
      (rawValue.startsWith("'") && rawValue.includes("'", 1))
    ) {
      const quote = rawValue[0];
      let endIdx = -1;
      for (let i = 1; i < rawValue.length; i++) {
        if (rawValue[i] === quote && rawValue[i - 1] !== '\\') {
          endIdx = i;
          break;
        }
      }
      if (endIdx !== -1) {
        const extracted = rawValue.slice(1, endIdx);
        const remainder = rawValue.slice(endIdx + 1).trim();
        if (remainder.startsWith('#')) {
          inlineComment = remainder.replace(/^#+\s*/, '').trim();
        }
        rawValue = extracted.replace(/\\n/g, '\n').replace(new RegExp(`\\\\${quote}`, 'g'), quote);
      }
    } else {
      const hashIdx = rawValue.indexOf(' #');
      if (hashIdx !== -1) {
        inlineComment = rawValue.slice(hashIdx + 2).trim();
        rawValue = rawValue.slice(0, hashIdx).trim();
      }
    }

    const comment = pendingComment.length > 0 ? pendingComment.join(' ') : inlineComment || undefined;
    pendingComment = [];

    const entry: ParsedEnvEntry = { key, value: rawValue, comment };
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      entries[existingIdx] = entry;
    } else {
      seen.set(key, entries.length);
      entries.push(entry);
    }
  }

  return entries;
}

export function serializeEnvValue(value: string): string {
  if (/[\s#$"'`\\]/.test(value) || value.includes('\n')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `"${escaped}"`;
  }

  return value;
}

export function serializeEnvRecord(values: Record<string, string>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const cleanKey = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
      continue;
    }
    lines.push(`${cleanKey}=${serializeEnvValue(value)}`);
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export function ensureGitignoreHasEnv(existingContent = ''): { content: string; changed: boolean } {
  const requiredEntries = ['.env', '.env.local', '.env.*.local'];
  const existingLines = existingContent ? existingContent.split(/\r?\n/) : [];
  const trimmedSet = new Set(existingLines.map((line) => line.trim()));

  const missing = requiredEntries.filter((entry) => !trimmedSet.has(entry));
  if (missing.length === 0 && existingContent.length > 0) {
    return { content: existingContent, changed: false };
  }

  const nextLines = [...existingLines];
  if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') {
    nextLines.push('');
  }
  if (!trimmedSet.has('# Local environment secrets')) {
    nextLines.push('# Local environment secrets');
  }
  for (const item of missing) {
    nextLines.push(item);
  }
  if (!trimmedSet.has('!.env.example')) {
    nextLines.push('!.env.example');
  }

  return {
    content: `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`,
    changed: true,
  };
}

export function findWorkspaceFileContent(files: FileMap, relativeFileName: string): string | undefined {
  const direct = files[`/home/project/${relativeFileName}`];
  if (direct?.type === 'file' && !direct.isBinary) {
    return direct.content;
  }

  for (const [path, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }
    if (normalizeEnvPath(path) === relativeFileName) {
      return dirent.content;
    }
  }

  return undefined;
}

export function extractSecretSpecsFromEnvExample(envExampleContent: string): SecretFieldSpec[] {
  const parsed = parseEnvContent(envExampleContent);

  return parsed
    .filter((entry) => !NON_SECRET_DEFAULT_KEYS.has(entry.key) || isPlaceholderEnvValue(entry.value))
    .map((entry) => ({
      key: entry.key,
      description: entry.comment,
      placeholder: entry.value || `Enter ${entry.key}`,
      required: true,
    }));
}

export function getExistingEnvValuesMap(files: FileMap): Record<string, string> {
  const envContent = findWorkspaceFileContent(files, '.env');
  if (!envContent) {
    return {};
  }

  const map: Record<string, string> = {};
  for (const entry of parseEnvContent(envContent)) {
    map[entry.key] = entry.value;
  }
  return map;
}

function normalizeSecretSpecList(incoming: SecretFieldSpec[]): SecretFieldSpec[] {
  const deduped = new Map<string, SecretFieldSpec>();

  for (const item of incoming) {
    const cleanKey = item.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
      continue;
    }

    const prev = deduped.get(cleanKey);
    deduped.set(cleanKey, {
      key: cleanKey,
      label: item.label || prev?.label,
      description: item.description || prev?.description,
      required: item.required ?? prev?.required ?? true,
      placeholder: item.placeholder || prev?.placeholder,
    });
  }

  return Array.from(deduped.values());
}

export function mergeRequestedSecrets(incoming: SecretFieldSpec[]): SecretFieldSpec[] {
  const existing = requestedSecretsStore.get();
  const next = normalizeSecretSpecList([...existing, ...incoming]);
  requestedSecretsStore.set(next);
  return next;
}

export function openSecretsDockFromMessage(
  messageId: string,
  specs: SecretFieldSpec[],
  files: FileMap,
  intro?: string,
) {
  const normalized = normalizeSecretSpecList(specs);
  if (normalized.length === 0) {
    return;
  }

  mergeRequestedSecrets(normalized);

  if (promptedMessageIds.has(messageId)) {
    return;
  }
  promptedMessageIds.add(messageId);

  const existingValues = getExistingEnvValuesMap(files);
  const missingSpecs = normalized.filter((spec) => !existingValues[spec.key]?.trim());
  if (missingSpecs.length === 0) {
    return;
  }

  promptRequestedSecretsStore.set(missingSpecs);
  promptSecretsIntroStore.set(intro?.trim() || '');
  promptSecretsCollapsedStore.set(false);
  promptSecretsDockOpenStore.set(true);
}

export function openSecretsDockFromEnvExample(envExampleContent: string, files: FileMap) {
  const specs = normalizeSecretSpecList(extractSecretSpecsFromEnvExample(envExampleContent));
  if (specs.length === 0) {
    return;
  }

  mergeRequestedSecrets(specs);
  const signature = specs.map((s) => s.key).sort().join('|');

  if (promptedEnvSignatures.has(signature)) {
    return;
  }
  promptedEnvSignatures.add(signature);

  const existingValues = getExistingEnvValuesMap(files);
  const missingSpecs = specs.filter((spec) => !existingValues[spec.key]?.trim());
  if (missingSpecs.length === 0) {
    return;
  }

  promptRequestedSecretsStore.set(missingSpecs);
  promptSecretsIntroStore.set('Required environment variables detected for this project.');
  promptSecretsCollapsedStore.set(false);
  promptSecretsDockOpenStore.set(true);
}

export function closePromptSecretsDock() {
  promptSecretsDockOpenStore.set(false);
  promptSecretsCollapsedStore.set(false);
  promptRequestedSecretsStore.set([]);
  promptSecretsIntroStore.set('');
}

export function resetSecretsForNewChat() {
  promptedMessageIds.clear();
  promptedEnvSignatures.clear();
  requestedSecretsStore.set([]);
  closePromptSecretsDock();
}

export async function saveProjectSecretsToWorkspace(
  submittedValues: Record<string, string>,
  files: FileMap,
  options?: { removeEmptyKeys?: boolean; chatId?: string },
): Promise<{ savedKeysCount: number; gitignoreUpdated: boolean; syncedToCloud: boolean }> {
  const currentEnvMap = getExistingEnvValuesMap(files);
  const nextEnvMap: Record<string, string> = { ...currentEnvMap };

  let savedKeysCount = 0;
  for (const [rawKey, rawVal] of Object.entries(submittedValues)) {
    const key = rawKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    const val = rawVal.trim();
    if (val.length > 0) {
      nextEnvMap[key] = val;
      savedKeysCount += 1;
    } else if (options?.removeEmptyKeys) {
      delete nextEnvMap[key];
    }
  }

  const envFileContent = serializeEnvRecord(nextEnvMap);
  const existingGitignore = findWorkspaceFileContent(files, '.gitignore') ?? '';
  const gitignoreResult = ensureGitignoreHasEnv(existingGitignore);

  const wc = await webcontainer;
  await wc.fs.writeFile('.env', envFileContent);

  if (gitignoreResult.changed) {
    await wc.fs.writeFile('.gitignore', gitignoreResult.content);
  }

  let syncedToCloud = false;
  const targetProjectId = options?.chatId || activeProjectIdStore.get() || daytonaStateStore.get().projectId;

  if (daytonaStateStore.get().configured && targetProjectId) {
    try {
      const envWrite = await writeWorkspaceFile(
        targetProjectId,
        '.env',
        envFileContent,
        daytonaStateStore.get().sandboxId,
      );
      syncedToCloud = Boolean(envWrite.ok);

      if (gitignoreResult.changed) {
        await writeWorkspaceFile(
          targetProjectId,
          '.gitignore',
          gitignoreResult.content,
          daytonaStateStore.get().sandboxId,
        );
      }
    } catch {
      syncedToCloud = false;
    }
  }

  secretsVersionStore.set(secretsVersionStore.get() + 1);

  return {
    savedKeysCount,
    gitignoreUpdated: gitignoreResult.changed,
    syncedToCloud,
  };
}
