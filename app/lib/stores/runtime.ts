import { atom, map } from 'nanostores';
import {
  ensureProjectWorkspace,
  notifyWorkspaceOperationState,
  writeWorkspaceFile,
  writeWorkspaceFilesBatchClient,
} from '~/lib/daytona/workspace.client';
import { getFirebaseIdToken, waitForAuthReady } from '~/lib/firebase';
import type { FileMap } from './files';
import type { PreviewInfo } from './previews';

export type RuntimeEnvironment = 'webcontainer' | 'daytona';
export type RuntimePreference = 'auto' | RuntimeEnvironment;

export interface EnvironmentOption {
  id: RuntimeEnvironment;
  title: string;
  suitability: string;
  reasons: string[];
  limitations: string[];
}

export interface ParsedEnvironmentChoice {
  analysisSummary: string;
  recommended: RuntimeEnvironment;
  options: EnvironmentOption[];
}

export type DaytonaSandboxStatus = 'idle' | 'creating' | 'ready' | 'error';

export interface DaytonaState {
  configured: boolean;
  statusLoaded: boolean;
  projectId: string;
  sandboxId: string | null;
  volumeName: string;
  volumeSubpath: string;
  status: DaytonaSandboxStatus;
  cwd: string;
  workdir: string;
  activeProcessId: string | null;
  error?: string;
}

export type DaytonaLogChannel = 'stdout' | 'stderr' | 'system';

export interface DaytonaTerminalEvent {
  channel: DaytonaLogChannel;
  text: string;
}

type DaytonaLogListener = (event: DaytonaTerminalEvent) => void;
type DaytonaPreviewListener = (preview: PreviewInfo) => void;
export interface DaytonaWorkspaceMutationEvent {
  projectId: string;
  source: 'terminal' | 'action' | 'git';
  command?: string;
}
type DaytonaMutationListener = (event: DaytonaWorkspaceMutationEvent) => void;

const logListeners = new Set<DaytonaLogListener>();
const previewListeners = new Set<DaytonaPreviewListener>();
const mutationListeners = new Set<DaytonaMutationListener>();
const syncedFileSignatures = new Map<string, string>();

export function computeWorkspaceFileSig(content: string): string {
  return `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`;
}

export function markWorkspaceFileSynced(projectId: string, relPath: string, content: string): void {
  if (!projectId || !relPath) {
    return;
  }
  syncedFileSignatures.set(`${projectId}:${relPath}`, computeWorkspaceFileSig(content));
}

export function markWorkspaceFilesSynced(
  projectId: string,
  files: Array<{ path: string; content: string }>,
): void {
  for (const f of files) {
    markWorkspaceFileSynced(projectId, f.path, f.content);
  }
}

export function isWorkspaceFileSynced(projectId: string, relPath: string, content: string): boolean {
  return syncedFileSignatures.get(`${projectId}:${relPath}`) === computeWorkspaceFileSig(content);
}

export function subscribeDaytonaWorkspaceMutation(listener: DaytonaMutationListener) {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

export function notifyDaytonaWorkspaceMutated(event: DaytonaWorkspaceMutationEvent) {
  for (const listener of mutationListeners) {
    listener(event);
  }
}

const READ_ONLY_TERMINAL_CMD_RE = /^(pwd|ls|ll|la|clear|whoami|which|ps|env|printenv|uname|date|echo\s+[^>|]+|git\s+(status|log|branch|remote|diff|show))(\s|$)/i;

export const runtimePreferenceStore = atom<RuntimePreference>('auto');
export const activeEnvironmentStore = atom<RuntimeEnvironment>('webcontainer');
export const environmentChosenForChatStore = atom<boolean>(false);
export const activeTerminalTabStore = atom<'webcontainer' | 'daytona'>('webcontainer');
export const activeProjectIdStore = atom<string>('default_workspace');

export const daytonaStateStore = map<DaytonaState>({
  configured: false,
  statusLoaded: false,
  projectId: 'default_workspace',
  sandboxId: null,
  volumeName: 'whiterchat-project-storage',
  volumeSubpath: '',
  status: 'idle',
  cwd: '/workspace',
  workdir: '/workspace',
  activeProcessId: null,
  error: undefined,
});

export function setActiveProjectId(projectId: string | undefined) {
  const normalized = (projectId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default_workspace';
  activeProjectIdStore.set(normalized);
  if (daytonaStateStore.get().projectId !== normalized) {
    daytonaStateStore.setKey('projectId', normalized);
    daytonaStateStore.setKey('sandboxId', null);
    daytonaStateStore.setKey('status', 'idle');
  }
}

export function subscribeDaytonaTerminalLog(listener: DaytonaLogListener) {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

export function emitDaytonaTerminalLog(channel: DaytonaLogChannel, text: string) {
  for (const listener of logListeners) {
    listener({ channel, text });
  }
}

export function subscribeDaytonaPreview(listener: DaytonaPreviewListener) {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

function emitDaytonaPreview(preview: PreviewInfo) {
  for (const listener of previewListeners) {
    listener(preview);
  }
}

export function setRuntimePreference(preference: RuntimePreference) {
  runtimePreferenceStore.set(preference);

  if (preference === 'webcontainer' || preference === 'daytona') {
    activeEnvironmentStore.set(preference);
    activeTerminalTabStore.set(preference);
    environmentChosenForChatStore.set(true);
  } else {
    environmentChosenForChatStore.set(false);
  }
}

export function setActiveEnvironment(environment: RuntimeEnvironment, syncPreference = false) {
  activeEnvironmentStore.set(environment);
  activeTerminalTabStore.set(environment);
  environmentChosenForChatStore.set(true);

  if (syncPreference) {
    runtimePreferenceStore.set(environment);
  }
}

export function setActiveTerminalTab(tab: 'webcontainer' | 'daytona') {
  activeTerminalTabStore.set(tab);
}

export function resetRuntimeForNewChat() {
  runtimePreferenceStore.set('auto');
  activeEnvironmentStore.set('webcontainer');
  activeTerminalTabStore.set('webcontainer');
  environmentChosenForChatStore.set(false);
  daytonaStateStore.setKey('sandboxId', null);
  daytonaStateStore.setKey('status', 'idle');
  daytonaStateStore.setKey('volumeSubpath', '');
}

export async function checkDaytonaStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/daytona');
    if (!res.ok) {
      daytonaStateStore.setKey('statusLoaded', true);
      return false;
    }

    const data = (await res.json()) as { configured?: boolean };
    const configured = Boolean(data.configured);
    daytonaStateStore.setKey('configured', configured);
    daytonaStateStore.setKey('statusLoaded', true);
    return configured;
  } catch {
    daytonaStateStore.setKey('statusLoaded', true);
    return false;
  }
}

async function getAuthenticatedHeader(): Promise<{ headers: Record<string, string>; uid: string }> {
  const user = await waitForAuthReady();
  const idToken = await getFirebaseIdToken();

  if (!user || !idToken) {
    throw new Error('Authentication required to access Daytona workspace.');
  }

  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    uid: user.uid,
  };
}

let createSandboxPromise: Promise<string> | null = null;
let createSandboxForProject = '';

export async function ensureDaytonaSandbox(projectIdOverride?: string): Promise<string> {
  const targetProjectId = projectIdOverride || activeProjectIdStore.get() || 'default_workspace';
  const current = daytonaStateStore.get();
  if (current.sandboxId && current.status === 'ready' && current.projectId === targetProjectId) {
    return current.sandboxId;
  }

  if (createSandboxPromise && createSandboxForProject === targetProjectId) {
    return createSandboxPromise;
  }

  createSandboxForProject = targetProjectId;
  createSandboxPromise = (async () => {
    daytonaStateStore.setKey('projectId', targetProjectId);
    daytonaStateStore.setKey('status', 'creating');
    daytonaStateStore.setKey('error', undefined);
    emitDaytonaTerminalLog(
      'system',
      `\r\n\x1b[36m[Daytona Volume]\x1b[0m Mounting persistent workspace for project ${targetProjectId}...\r\n`,
    );

    try {
      const data = await ensureProjectWorkspace({
        projectId: targetProjectId,
        includeFiles: false,
      });

      if (typeof data.configured === 'boolean') {
        daytonaStateStore.setKey('configured', data.configured);
        daytonaStateStore.setKey('statusLoaded', true);
      }

      if (!data.sandboxId) {
        throw new Error(data.error || 'Failed to provision Daytona sandbox with mounted volume');
      }

      const workdir = data.workdir || '/workspace';
      daytonaStateStore.setKey('sandboxId', data.sandboxId);
      daytonaStateStore.setKey('workdir', workdir);
      daytonaStateStore.setKey('cwd', workdir);
      daytonaStateStore.setKey('volumeName', data.volumeName || 'whiterchat-project-storage');
      daytonaStateStore.setKey('volumeSubpath', data.volumeSubpath || '');
      daytonaStateStore.setKey('status', 'ready');
      daytonaStateStore.setKey('configured', true);

      emitDaytonaTerminalLog(
        'system',
        `\x1b[32m[Daytona]\x1b[0m Sandbox ready (${data.sandboxId.slice(0, 12)}) · mounted at ${workdir}\r\n`,
      );

      return data.sandboxId;
    } catch (error: any) {
      const message = error?.message || 'Failed to connect to Daytona';
      daytonaStateStore.setKey('status', 'error');
      daytonaStateStore.setKey('error', message);
      emitDaytonaTerminalLog('stderr', `\r\n\x1b[31m[Daytona Error]\x1b[0m ${message}\r\n`);
      throw error;
    } finally {
      createSandboxPromise = null;
    }
  })();

  return createSandboxPromise;
}

export async function restartDaytonaSandbox(): Promise<string> {
  const prevState = daytonaStateStore.get();
  const prevId = prevState.sandboxId;
  const projectId = prevState.projectId || activeProjectIdStore.get();

  daytonaStateStore.setKey('sandboxId', null);
  daytonaStateStore.setKey('status', 'creating');
  daytonaStateStore.setKey('error', undefined);

  if (prevId) {
    try {
      const { headers, uid } = await getAuthenticatedHeader();
      await fetch('/api/daytona', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete', sandboxId: prevId, userId: uid, projectId }),
      }).catch(() => undefined);
    } catch {
      // ignore if unauthenticated
    }
  }

  return ensureDaytonaSandbox(projectId);
}

export async function uploadDaytonaFile(filePath: string, content: string, projectIdOverride?: string): Promise<void> {
  const projectId = projectIdOverride || activeProjectIdStore.get() || 'default_workspace';
  const sandboxId = await ensureDaytonaSandbox(projectId);
  const opId = `upl_${Date.now().toString(36)}`;
  void notifyWorkspaceOperationState(projectId, opId, 'start');
  try {
    const res = await writeWorkspaceFile(projectId, filePath, content, sandboxId);
    markWorkspaceFileSynced(projectId, res.relativePath || filePath, content);
  } finally {
    void notifyWorkspaceOperationState(projectId, opId, 'end');
  }
}

export async function syncAllFilesToDaytona(
  files: FileMap,
  baseDir = '/home/project',
  projectIdOverride?: string,
): Promise<number> {
  const projectId = projectIdOverride || activeProjectIdStore.get() || 'default_workspace';
  const sandboxId = await ensureDaytonaSandbox(projectId);
  const payload: Array<{ path: string; content: string }> = [];

  for (const [fullPath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    if (fullPath.includes('node_modules') || fullPath.includes('/.git/')) {
      continue;
    }

    const relative = fullPath.startsWith(`${baseDir}/`)
      ? fullPath.slice(baseDir.length + 1)
      : fullPath.replace(/^\/+/, '');

    if (relative) {
      payload.push({ path: relative, content: dirent.content });
    }
  }

  if (payload.length === 0) {
    emitDaytonaTerminalLog('system', '\x1b[33m[Daytona]\x1b[0m No workspace files to sync yet.\r\n');
    return 0;
  }

  emitDaytonaTerminalLog('system', `\x1b[36m[Daytona Volume]\x1b[0m Syncing ${payload.length} files to /workspace...\r\n`);
  const opId = `sync_${Date.now().toString(36)}`;
  void notifyWorkspaceOperationState(projectId, opId, 'start');

  try {
    const res = await writeWorkspaceFilesBatchClient(projectId, payload, sandboxId);
    markWorkspaceFilesSynced(projectId, payload);
    emitDaytonaTerminalLog('system', `\x1b[32m[Daytona Volume]\x1b[0m Synced ${res.count} files persistently.\r\n`);
    return res.count;
  } finally {
    void notifyWorkspaceOperationState(projectId, opId, 'end');
  }
}

export async function openDaytonaPreviewPort(port: number): Promise<PreviewInfo | null> {
  try {
    const projectId = activeProjectIdStore.get() || 'default_workspace';
    const sandboxId = await ensureDaytonaSandbox(projectId);
    const { headers, uid } = await getAuthenticatedHeader();

    const res = await fetch('/api/daytona', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'preview', sandboxId, userId: uid, projectId, port }),
    });

    const data = (await res.json()) as { port?: number; url?: string; error?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.error || `Could not open preview link for port ${port}`);
    }

    const preview: PreviewInfo = {
      port: data.port ?? port,
      ready: true,
      baseUrl: data.url,
    };

    emitDaytonaPreview(preview);
    emitDaytonaTerminalLog('system', `\x1b[32m[Daytona Preview]\x1b[0m Port ${preview.port} -> ${preview.baseUrl}\r\n`);
    return preview;
  } catch (error: any) {
    emitDaytonaTerminalLog('stderr', `\x1b[31m[Daytona Preview Error]\x1b[0m ${error?.message || 'Failed'}\r\n`);
    return null;
  }
}

export async function interruptDaytonaProcess(): Promise<void> {
  const { sandboxId, activeProcessId, projectId } = daytonaStateStore.get();
  if (!sandboxId || !activeProcessId) {
    return;
  }

  try {
    const { headers, uid } = await getAuthenticatedHeader();
    await fetch('/api/daytona', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'killProcess',
        sandboxId,
        userId: uid,
        projectId,
        processId: activeProcessId,
      }),
    }).catch(() => undefined);
  } catch {
    // ignore
  }

  daytonaStateStore.setKey('activeProcessId', null);
}

export async function execDaytonaCommand(
  command: string,
  options?: {
    source?: 'terminal' | 'action';
    abortSignal?: AbortSignal;
    onChunk?: (channel: DaytonaLogChannel, text: string) => void;
  },
): Promise<{ exitCode: number }> {
  const projectId = activeProjectIdStore.get() || 'default_workspace';
  const sandboxId = await ensureDaytonaSandbox(projectId);
  const { headers, uid } = await getAuthenticatedHeader();

  if (options?.source === 'action') {
    emitDaytonaTerminalLog('system', `\r\n\x1b[36m$ ${command}\x1b[0m\r\n`);
  }

  const res = await fetch('/api/daytona/exec', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sandboxId,
      userId: uid,
      projectId,
      command,
      waitForServer: options?.source === 'action',
    }),
    signal: options?.abortSignal,
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    const message = data.error || 'Daytona command execution failed';
    emitDaytonaTerminalLog('stderr', `${message}\r\n`);
    options?.onChunk?.('stderr', `${message}\r\n`);
    return { exitCode: 1 };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as {
          type: 'meta' | 'stdout' | 'stderr' | 'cwd' | 'ports' | 'exit' | 'error';
          data?: string;
          processId?: string;
          cwd?: string;
          exitCode?: number;
          ports?: PreviewInfo[];
        };

        if (event.type === 'meta' && event.processId) {
          daytonaStateStore.setKey('activeProcessId', event.processId);
        } else if (event.type === 'stdout' && event.data) {
          emitDaytonaTerminalLog('stdout', event.data);
          options?.onChunk?.('stdout', event.data);
        } else if (event.type === 'stderr' && event.data) {
          emitDaytonaTerminalLog('stderr', event.data);
          options?.onChunk?.('stderr', event.data);
        } else if (event.type === 'cwd' && event.cwd) {
          daytonaStateStore.setKey('cwd', event.cwd);
        } else if (event.type === 'ports' && Array.isArray(event.ports)) {
          for (const p of event.ports) {
            emitDaytonaPreview(p);
          }
        } else if (event.type === 'error' && event.data) {
          emitDaytonaTerminalLog('stderr', `${event.data}\r\n`);
          options?.onChunk?.('stderr', `${event.data}\r\n`);
        } else if (event.type === 'exit') {
          exitCode = event.exitCode ?? 0;
        }
      } catch {
        // ignore malformed NDJSON chunk
      }
    }
  }

  daytonaStateStore.setKey('activeProcessId', null);

  const trimmedCmd = command.trim();
  if (exitCode === 0 && trimmedCmd) {
    const source = options?.source ?? 'terminal';
    if (source === 'action' || !READ_ONLY_TERMINAL_CMD_RE.test(trimmedCmd)) {
      notifyDaytonaWorkspaceMutated({ projectId, source, command: trimmedCmd });
    }
  }

  return { exitCode };
}
