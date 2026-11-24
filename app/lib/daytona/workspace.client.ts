import { getFirebaseIdToken, waitForAuthReady } from '~/lib/firebase';
import { registerSessionInFirestore } from '~/lib/persistence/projects';
import { normalizeWorkspaceRelPath } from '~/utils/posixPath';

export { normalizeWorkspaceRelPath };

export interface WorkspaceSnapshotEntry {
  path: string;
  absolutePath: string;
  isDir: boolean;
  sizeBytes: number;
  updatedAt?: string;
}

export interface WorkspaceSnapshotFile {
  path: string;
  content: string;
  isBinary: boolean;
  sizeBytes: number;
}

export interface WorkspaceSnapshotResult {
  files: WorkspaceSnapshotFile[];
  entries: WorkspaceSnapshotEntry[];
  usage?: { totalFiles: number; totalBytes: number };
}

export interface WorkspaceGitCloneResult extends WorkspaceSnapshotResult {
  ok: boolean;
  sandboxId: string;
  repoUrl: string;
  branch?: string;
  clonedPath: string;
}

export interface WorkspaceEnsureResult {
  configured: boolean;
  sandboxId?: string;
  workdir?: string;
  volumeId?: string;
  volumeName?: string;
  volumeSubpath?: string;
  status?: string;
  files?: WorkspaceSnapshotFile[];
  entries?: WorkspaceSnapshotEntry[];
  usage?: { totalFiles: number; totalBytes: number };
  error?: string;
}

export interface WorkspaceUploadResult {
  ok: boolean;
  path: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  sandboxId: string;
  mediaUrl: string;
}

const TAB_SESSION_STORAGE_KEY = 'whiterchat_workspace_tab_session_id';

export function getTabWorkspaceSessionId(): string {
  if (typeof window === 'undefined') {
    return 'ssr_session';
  }

  const existing = window.sessionStorage.getItem(TAB_SESSION_STORAGE_KEY);
  if (existing && /^[a-zA-Z0-9_-]{1,128}$/.test(existing)) {
    return existing;
  }

  const generated = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, generated);
  return generated;
}

async function getAuthHeaders(): Promise<{ idToken: string; uid: string } | null> {
  const user = await waitForAuthReady();
  const idToken = await getFirebaseIdToken();
  if (!user || !idToken) {
    return null;
  }
  return { idToken, uid: user.uid };
}

export async function ensureProjectWorkspace(options: {
  projectId: string;
  projectName?: string;
  includeFiles?: boolean;
  requestedSandboxId?: string;
}): Promise<WorkspaceEnsureResult> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return { configured: false, error: 'Authentication required' };
  }

  const sessionId = getTabWorkspaceSessionId();

  const res = await fetch('/api/workspace/ensure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      userId: authInfo.uid,
      projectId: options.projectId,
      projectName: options.projectName,
      sessionId,
      requestedSandboxId: options.requestedSandboxId,
      includeFiles: Boolean(options.includeFiles),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as WorkspaceEnsureResult;
  if (!res.ok) {
    return {
      configured: data.configured ?? res.status !== 503,
      error: data.error || 'Failed to ensure Daytona workspace',
    };
  }

  void registerSessionInFirestore(options.projectId, sessionId, data.sandboxId).catch(() => undefined);
  return data;
}

export async function readWorkspaceSnapshot(
  projectId: string,
  sandboxId?: string | null,
): Promise<WorkspaceSnapshotResult> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return { files: [], entries: [] };
  }

  const params = new URLSearchParams({
    projectId,
    mode: 'snapshot',
    ...(sandboxId ? { sandboxId } : {}),
  });

  const res = await fetch(`/api/workspace/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${authInfo.idToken}`,
    },
  });

  if (!res.ok) {
    return { files: [], entries: [] };
  }

  const data = (await res.json()) as Partial<WorkspaceSnapshotResult>;

  return {
    files: Array.isArray(data.files) ? data.files : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
    usage: data.usage,
  };
}

export async function cloneGitRepoToDaytonaClient(options: {
  projectId: string;
  repoUrl: string;
  branch?: string;
  targetDir?: string;
  depth?: number;
  sandboxId?: string | null;
}): Promise<WorkspaceGitCloneResult> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    throw new Error('Authentication required to clone into Daytona.');
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'gitClone',
      userId: authInfo.uid,
      projectId: options.projectId,
      sandboxId: options.sandboxId || undefined,
      repoUrl: options.repoUrl,
      branch: options.branch,
      targetDir: options.targetDir,
      depth: options.depth ?? 1,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as Partial<WorkspaceGitCloneResult> & { error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to clone Git repository into Daytona.');
  }

  return {
    ok: true,
    sandboxId: data.sandboxId || options.sandboxId || '',
    repoUrl: data.repoUrl || options.repoUrl,
    branch: data.branch,
    clonedPath: data.clonedPath || '/',
    files: Array.isArray(data.files) ? data.files : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
    usage: data.usage,
  };
}

export async function exportProjectToGitHubClient(options: {
  projectId: string;
  githubToken: string;
  repoName?: string;
  commitMessage?: string;
  isPrivate?: boolean;
  sandboxId?: string | null;
}): Promise<{ ok: boolean; repoName: string; githubUsername: string; htmlUrl: string }> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    throw new Error('Authentication required to export to GitHub.');
  }

  const res = await fetch('/api/workspace/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      userId: authInfo.uid,
      projectId: options.projectId,
      sandboxId: options.sandboxId || undefined,
      githubToken: options.githubToken,
      repoName: options.repoName,
      commitMessage: options.commitMessage,
      isPrivate: options.isPrivate,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; repoName?: string; githubUsername?: string; htmlUrl?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to export project to GitHub.');
  }

  return {
    ok: true,
    repoName: data.repoName || options.repoName || 'repo',
    githubUsername: data.githubUsername || '',
    htmlUrl: data.htmlUrl || 'https://github.com',
  };
}

export async function writeWorkspaceFile(
  projectId: string,
  filePath: string,
  content: string,
  sandboxId?: string | null,
): Promise<{ ok: boolean; sandboxId?: string; relativePath?: string }> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return { ok: false };
  }

  const relPath = normalizeWorkspaceRelPath(filePath);
  if (!relPath) {
    return { ok: false };
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'writeText',
      userId: authInfo.uid,
      projectId,
      sandboxId: sandboxId || undefined,
      filePath: relPath,
      content,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Failed to save ${relPath} to Daytona Volume`);
  }

  return (await res.json()) as { ok: boolean; sandboxId?: string; relativePath?: string };
}

export async function writeWorkspaceFilesBatchClient(
  projectId: string,
  files: Array<{ path: string; content: string }>,
  sandboxId?: string | null,
): Promise<{ ok: boolean; count: number; sandboxId?: string }> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return { ok: false, count: 0 };
  }

  const cleaned = files
    .map((f) => ({ path: normalizeWorkspaceRelPath(f.path), content: f.content }))
    .filter((f) => Boolean(f.path));

  if (cleaned.length === 0) {
    return { ok: true, count: 0 };
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'writeBatch',
      userId: authInfo.uid,
      projectId,
      sandboxId: sandboxId || undefined,
      files: cleaned,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to sync workspace batch to Daytona Volume');
  }

  return (await res.json()) as { ok: boolean; count: number; sandboxId?: string };
}

export async function deleteWorkspaceFileClient(
  projectId: string,
  filePath: string,
  recursive = true,
  sandboxId?: string | null,
): Promise<boolean> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return false;
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'delete',
      userId: authInfo.uid,
      projectId,
      sandboxId: sandboxId || undefined,
      filePath: normalizeWorkspaceRelPath(filePath),
      recursive,
    }),
  });

  return res.ok;
}

export async function renameWorkspaceFileClient(
  projectId: string,
  sourcePath: string,
  destinationPath: string,
  sandboxId?: string | null,
): Promise<boolean> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return false;
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'rename',
      userId: authInfo.uid,
      projectId,
      sandboxId: sandboxId || undefined,
      sourcePath: normalizeWorkspaceRelPath(sourcePath),
      destinationPath: normalizeWorkspaceRelPath(destinationPath),
    }),
  });

  return res.ok;
}

export async function mkdirWorkspaceDirectoryClient(
  projectId: string,
  dirPath: string,
  sandboxId?: string | null,
): Promise<boolean> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return false;
  }

  const res = await fetch('/api/workspace/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'mkdir',
      userId: authInfo.uid,
      projectId,
      sandboxId: sandboxId || undefined,
      filePath: normalizeWorkspaceRelPath(dirPath),
    }),
  });

  return res.ok;
}

export async function uploadFileToDaytonaWorkspace(
  file: File,
  options?: { projectId?: string; kind?: 'project' | 'profile'; folder?: string },
): Promise<WorkspaceUploadResult> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    throw new Error('Please sign in first to upload files to your workspace.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', authInfo.uid);
  formData.append('kind', options?.kind ?? 'project');
  if (options?.projectId) {
    formData.append('projectId', options.projectId);
  }
  if (options?.folder) {
    formData.append('folder', options.folder);
  }

  const res = await fetch('/api/workspace/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: formData,
  });

  const data = (await res.json().catch(() => ({}))) as WorkspaceUploadResult & { error?: string };
  if (!res.ok || !data.mediaUrl) {
    throw new Error(data.error || 'Failed to upload file to Daytona workspace.');
  }

  return data;
}

export async function notifyWorkspaceOperationState(
  projectId: string,
  operationId: string,
  state: 'start' | 'end',
): Promise<void> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return;
  }

  await fetch('/api/workspace/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: state === 'start' ? 'opStart' : 'opEnd',
      userId: authInfo.uid,
      projectId,
      operationId,
    }),
  }).catch(() => undefined);
}

export async function notifyLogoutWorkspaceShutdown(): Promise<void> {
  const authInfo = await getAuthHeaders();
  if (!authInfo) {
    return;
  }

  await fetch('/api/workspace/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authInfo.idToken}`,
    },
    body: JSON.stringify({
      action: 'logoutAll',
      userId: authInfo.uid,
    }),
  }).catch(() => undefined);
}

export function startWorkspacePresenceLifecycle(options: {
  projectId: string;
  getSandboxId: () => string | null;
}): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const sessionId = getTabWorkspaceSessionId();
  let stopped = false;

  const sendHeartbeat = async () => {
    if (stopped) return;
    const authInfo = await getAuthHeaders();
    if (!authInfo) return;

    await fetch('/api/workspace/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authInfo.idToken}`,
      },
      body: JSON.stringify({
        action: 'heartbeat',
        userId: authInfo.uid,
        projectId: options.projectId,
        sessionId,
        sandboxId: options.getSandboxId() || undefined,
      }),
    }).catch(() => undefined);
  };

  let cachedToken = '';
  let cachedUid = '';
  void getAuthHeaders().then((info) => {
    if (info) {
      cachedToken = info.idToken;
      cachedUid = info.uid;
    }
  });

  const intervalId = window.setInterval(() => {
    void getAuthHeaders().then((info) => {
      if (info) {
        cachedToken = info.idToken;
        cachedUid = info.uid;
      }
    });
    void sendHeartbeat();
  }, 30_000);

  const sendEndBeacon = () => {
    if (stopped || !cachedToken || !cachedUid) {
      return;
    }
    const payload = JSON.stringify({
      action: 'end',
      idToken: cachedToken,
      userId: cachedUid,
      projectId: options.projectId,
      sessionId,
      sandboxId: options.getSandboxId() || undefined,
      graceDelayMs: 12_000,
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/workspace/session', blob);
    } else {
      void fetch('/api/workspace/session', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cachedToken}`,
        },
        body: payload,
      }).catch(() => undefined);
    }
  };

  const handlePageHide = () => {
    sendEndBeacon();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      void sendHeartbeat();
    }
  };

  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
    document.removeEventListener('visibilitychange', handleVisibility);
    sendEndBeacon();
  };
}
