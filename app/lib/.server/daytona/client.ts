import { Daytona } from '@daytona/sdk';
import type { Sandbox as SandboxV0 } from '@daytona/sdk/v0';
import type { Sandbox as SandboxV2, Session as SessionV2 } from '@daytona/sdk/v2';
import {
  assertValidIdentifier,
  DAYTONA_WORKSPACE_ROOT,
  resolveWorkspacePath,
} from '~/lib/.server/security/auth';
import {
  buildIsolatedProjectSubpath,
  buildUserProfileSubpath,
  ensureCentralProjectVolume,
  getProjectVolumeName,
  inspectCentralProjectVolume,
  type CentralVolumeInfo,
} from './volumes';

export const DAYTONA_DEFAULT_WORKDIR = DAYTONA_WORKSPACE_ROOT;
const DAYTONA_SESSION_NAME = 'bolt-main-shell';

interface CachedV2Context {
  apiVersion: 'v2';
  sandbox: SandboxV2;
  session?: SessionV2;
  workdir: string;
  ownerUid?: string;
  projectId?: string;
  volumeId?: string;
  volumeSubpath?: string;
}

interface CachedV0Context {
  apiVersion: 'v0';
  sandbox: SandboxV0;
  v0MainSessionReady: boolean;
  workdir: string;
  ownerUid?: string;
  projectId?: string;
  volumeId?: string;
  volumeSubpath?: string;
}

export type CachedSandboxContext = CachedV2Context | CachedV0Context;

export interface ProjectSandboxBinding {
  sandboxId: string;
  ownerUid: string;
  projectId: string;
  volumeId: string;
  volumeName: string;
  volumeSubpath: string;
  workdir: string;
  status: 'started' | 'stopped' | 'creating' | 'error';
  lastActivityAt: string;
}

const sandboxCache = new Map<string, CachedSandboxContext>();
const projectBindings = new Map<string, ProjectSandboxBinding>();
const ensureInFlight = new Map<string, Promise<ProjectSandboxBinding>>();

function bindingKey(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

export function isDaytonaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DAYTONA_API_KEY && env.DAYTONA_API_KEY.trim().length > 0);
}

export function shouldUseDaytonaV0(env: NodeJS.ProcessEnv = process.env): boolean {
  const v2Url = env.DAYTONA_V2_API_URL?.trim() || '';
  const v0Url = env.DAYTONA_V0_API_URL?.trim() || env.DAYTONA_API_URL?.trim() || '';

  if (v2Url) {
    if (v2Url.includes('app.daytona.io') || v2Url.endsWith('/api')) {
      return true;
    }
    return false;
  }

  if (v0Url) {
    return true;
  }

  return false;
}

export function createDaytonaRoot(env: NodeJS.ProcessEnv = process.env): Daytona {
  const apiKey = env.DAYTONA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is not configured in server secrets.');
  }

  const v2Url = env.DAYTONA_V2_API_URL?.trim();
  if (v2Url && (v2Url.includes('app.daytona.io') || v2Url.endsWith('/api')) && !env.DAYTONA_V0_API_URL) {
    env.DAYTONA_V0_API_URL = v2Url.replace(/\/+$/, '');
  }

  return new Daytona({ apiKey });
}

function parseListeningPortsFromProcNet(procNetText: string): number[] {
  const ports = new Set<number>();

  for (const line of procNetText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('sl')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    const localAddress = parts[1];
    const state = parts[3];

    if (state !== '0A' || !localAddress) {
      continue;
    }

    const colonIdx = localAddress.lastIndexOf(':');
    if (colonIdx === -1) {
      continue;
    }

    const portHex = localAddress.slice(colonIdx + 1);
    const port = Number.parseInt(portHex, 16);
    const isSystemPort = port === 2280 || port === 2281 || port === 22220 || port === 22222 || port === 33333;

    if (Number.isFinite(port) && port >= 1024 && !isSystemPort) {
      ports.add(port);
    }
  }

  return Array.from(ports);
}

function sanitizeLabelSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 63);
}

async function ensureWorkspaceDirectoryInitialized(ctx: CachedSandboxContext): Promise<void> {
  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.createFolder(DAYTONA_WORKSPACE_ROOT, '755').catch(() => undefined);
  } else {
    await ctx.sandbox.fs.mkdir(DAYTONA_WORKSPACE_ROOT).catch(() => undefined);
  }
}

async function startAndHydrateExistingSandbox(
  daytona: Daytona,
  useV0: boolean,
  sandboxId: string,
  meta: {
    ownerUid?: string;
    projectId?: string;
    volumeId?: string;
    volumeSubpath?: string;
  },
): Promise<CachedSandboxContext | null> {
  try {
    if (useV0) {
      const sandbox = await daytona.v0.get(sandboxId);
      const state = String(sandbox.state || '').toLowerCase();
      if (state === 'destroyed' || state === 'destroying' || state === 'error') {
        return null;
      }

      if (meta.ownerUid && sandbox.labels?.whiterchat_uid && sandbox.labels.whiterchat_uid !== sanitizeLabelSegment(meta.ownerUid)) {
        throw new Error('Sandbox ownership label mismatch.');
      }

      if (state !== 'started') {
        await sandbox.start(90);
        await sandbox.waitUntilStarted(90);
      }

      const ctx: CachedV0Context = {
        apiVersion: 'v0',
        sandbox,
        v0MainSessionReady: false,
        workdir: DAYTONA_WORKSPACE_ROOT,
        ...meta,
      };
      await ensureWorkspaceDirectoryInitialized(ctx);
      sandboxCache.set(sandbox.id, ctx);
      return ctx;
    }

    const sandbox = await daytona.v2.get(sandboxId);
    if (
      meta.ownerUid &&
      sandbox.labels?.whiterchat_uid &&
      sandbox.labels.whiterchat_uid !== sanitizeLabelSegment(meta.ownerUid)
    ) {
      throw new Error('Sandbox ownership label mismatch.');
    }

    if (sandbox.state === 'destroyed' || sandbox.state === 'destroying' || sandbox.state === 'error') {
      return null;
    }

    if (sandbox.state === 'stopped') {
      await sandbox.start({ timeoutSeconds: 90 });
    } else if (sandbox.state === 'paused') {
      await sandbox.resume({ timeoutSeconds: 90 });
    } else if (sandbox.state !== 'started') {
      await sandbox.wait({ until: 'started', timeoutSeconds: 90 });
    }

    const ctx: CachedV2Context = {
      apiVersion: 'v2',
      sandbox,
      workdir: DAYTONA_WORKSPACE_ROOT,
      ...meta,
    };
    await ensureWorkspaceDirectoryInitialized(ctx);
    sandboxCache.set(sandbox.id, ctx);
    return ctx;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ownership label mismatch')) {
      throw error;
    }
    return null;
  }
}

async function findExistingSandboxByProjectLabels(
  daytona: Daytona,
  useV0: boolean,
  ownerUid: string,
  projectId: string,
): Promise<string | null> {
  const safeUid = sanitizeLabelSegment(ownerUid);
  const safeProj = sanitizeLabelSegment(projectId);

  try {
    if (useV0) {
      for await (const sbx of daytona.v0.list({
        labels: {
          whiterchat_uid: safeUid,
          whiterchat_project: safeProj,
        },
      })) {
        if (sbx.state !== 'destroyed' && sbx.state !== 'destroying' && sbx.state !== 'error') {
          return sbx.id;
        }
      }
      return null;
    }

    try {
      const searchRes = await daytona.v2.search({
        labels: {
          whiterchat_uid: safeUid,
          whiterchat_project: safeProj,
        },
        limit: 10,
      });
      const candidate = searchRes.items?.find(
        (sbx) => sbx.state !== 'destroyed' && sbx.state !== 'destroying' && sbx.state !== 'error',
      );
      if (candidate?.id) {
        return candidate.id;
      }
    } catch {
      const listRes = await daytona.v2.list({ limit: 50 });
      const candidate = listRes.items?.find(
        (sbx) =>
          sbx.labels?.whiterchat_uid === safeUid &&
          sbx.labels?.whiterchat_project === safeProj &&
          sbx.state !== 'destroyed' &&
          sbx.state !== 'destroying' &&
          sbx.state !== 'error',
      );
      return candidate?.id || null;
    }

    return null;
  } catch {
    return null;
  }
}

async function createVolumeMountedSandbox(options: {
  daytona: Daytona;
  useV0: boolean;
  volume: CentralVolumeInfo;
  ownerUid: string;
  projectId: string;
  subpath: string;
  kind: 'project' | 'profile';
}): Promise<CachedSandboxContext> {
  const { daytona, useV0, volume, ownerUid, projectId, subpath, kind } = options;
  const safeUid = sanitizeLabelSegment(ownerUid);
  const safeProj = sanitizeLabelSegment(projectId);
  const name = `wc-${safeUid.slice(0, 10)}-${safeProj.slice(0, 14)}-${Date.now().toString(36)}`;
  const labels = {
    whiterchat_uid: safeUid,
    whiterchat_project: safeProj,
    whiterchat_kind: kind,
  };

  if (useV0) {
    const sandbox = await daytona.v0.create(
      {
        name,
        language: 'typescript',
        public: true,
        autoStopInterval: 15,
        labels,
        volumes: [
          {
            volumeId: volume.id,
            mountPath: DAYTONA_WORKSPACE_ROOT,
            subpath,
          },
        ],
      },
      { timeout: 120 },
    );

    await sandbox.waitUntilStarted(120);

    const ctx: CachedV0Context = {
      apiVersion: 'v0',
      sandbox,
      v0MainSessionReady: false,
      workdir: DAYTONA_WORKSPACE_ROOT,
      ownerUid,
      projectId,
      volumeId: volume.id,
      volumeSubpath: subpath,
    };
    await ensureWorkspaceDirectoryInitialized(ctx);
    sandboxCache.set(sandbox.id, ctx);
    return ctx;
  }

  let sandbox: SandboxV2;
  try {
    sandbox = await daytona.v2.create({
      name,
      labels,
      volumes: [
        {
          volumeId: volume.id,
          mountPath: DAYTONA_WORKSPACE_ROOT,
          subpath,
        },
      ],
      lifecyclePolicy: {
        timeoutSeconds: 3600,
        idleExpirySeconds: 900,
      },
    });
  } catch {
    // Retry without explicit lifecyclePolicy if account tier rejects custom timeouts
    sandbox = await daytona.v2.create({
      name,
      labels,
      volumes: [
        {
          volumeId: volume.id,
          mountPath: DAYTONA_WORKSPACE_ROOT,
          subpath,
        },
      ],
    });
  }

  if (sandbox.state !== 'started') {
    await sandbox.wait({ until: 'started', timeoutSeconds: 120 });
  }

  const ctx: CachedV2Context = {
    apiVersion: 'v2',
    sandbox,
    workdir: DAYTONA_WORKSPACE_ROOT,
    ownerUid,
    projectId,
    volumeId: volume.id,
    volumeSubpath: subpath,
  };
  await ensureWorkspaceDirectoryInitialized(ctx);
  sandboxCache.set(sandbox.id, ctx);
  return ctx;
}

export async function ensureProjectSandbox(options: {
  userId: string;
  projectId: string;
  requestedSandboxId?: string | null;
  kind?: 'project' | 'profile';
  env?: NodeJS.ProcessEnv;
}): Promise<ProjectSandboxBinding> {
  const env = options.env ?? process.env;
  const userId = assertValidIdentifier(options.userId, 'userId');
  const projectId = assertValidIdentifier(options.projectId, 'projectId');
  const kind = options.kind ?? 'project';
  const key = bindingKey(userId, kind === 'profile' ? `_profile_${projectId}` : projectId);

  const pending = ensureInFlight.get(key);
  if (pending) {
    return pending;
  }

  const workPromise = (async (): Promise<ProjectSandboxBinding> => {
    const daytona = createDaytonaRoot(env);
    const useV0 = shouldUseDaytonaV0(env);
    const volume = await ensureCentralProjectVolume(daytona, useV0, env);
    const subpath = kind === 'profile' ? buildUserProfileSubpath(userId) : buildIsolatedProjectSubpath(userId, projectId);
    const volumeName = getProjectVolumeName(env);

    const existingBinding = projectBindings.get(key);
    const candidateIds = [
      options.requestedSandboxId?.trim() || '',
      existingBinding?.sandboxId || '',
    ].filter(Boolean);

    if (candidateIds.length === 0) {
      const discovered = await findExistingSandboxByProjectLabels(
        daytona,
        useV0,
        userId,
        kind === 'profile' ? '_profile' : projectId,
      );
      if (discovered) {
        candidateIds.push(discovered);
      }
    }

    let hydratedCtx: CachedSandboxContext | null = null;

    for (const candidateId of candidateIds) {
      const ctx = await startAndHydrateExistingSandbox(daytona, useV0, candidateId, {
        ownerUid: userId,
        projectId,
        volumeId: volume.id,
        volumeSubpath: subpath,
      });

      if (ctx) {
        hydratedCtx = ctx;
        break;
      }
    }

    if (!hydratedCtx) {
      hydratedCtx = await createVolumeMountedSandbox({
        daytona,
        useV0,
        volume,
        ownerUid: userId,
        projectId: kind === 'profile' ? '_profile' : projectId,
        subpath,
        kind,
      });
    }

    const binding: ProjectSandboxBinding = {
      sandboxId: hydratedCtx.sandbox.id,
      ownerUid: userId,
      projectId,
      volumeId: volume.id,
      volumeName,
      volumeSubpath: subpath,
      workdir: DAYTONA_WORKSPACE_ROOT,
      status: 'started',
      lastActivityAt: new Date().toISOString(),
    };

    projectBindings.set(key, binding);
    return binding;
  })();

  ensureInFlight.set(key, workPromise);
  try {
    return await workPromise;
  } finally {
    ensureInFlight.delete(key);
  }
}

export async function verifyAndGetProjectSandboxContext(options: {
  userId: string;
  projectId: string;
  sandboxId?: string | null;
  kind?: 'project' | 'profile';
  env?: NodeJS.ProcessEnv;
}): Promise<{ ctx: CachedSandboxContext; binding: ProjectSandboxBinding }> {
  const env = options.env ?? process.env;
  const binding = await ensureProjectSandbox({
    userId: options.userId,
    projectId: options.projectId,
    requestedSandboxId: options.sandboxId,
    kind: options.kind,
    env,
  });

  const ctx = await getSandboxContext(binding.sandboxId, env);
  ctx.ownerUid = binding.ownerUid;
  ctx.projectId = binding.projectId;
  ctx.volumeId = binding.volumeId;
  ctx.volumeSubpath = binding.volumeSubpath;
  binding.lastActivityAt = new Date().toISOString();

  return { ctx, binding };
}

export function getCachedProjectBinding(userId: string, projectId: string): ProjectSandboxBinding | undefined {
  return projectBindings.get(bindingKey(userId, projectId));
}

export function listCachedProjectBindings(): ProjectSandboxBinding[] {
  return Array.from(projectBindings.values());
}

export async function flushWorkspaceVolumeChanges(
  sandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const ctx = sandboxCache.get(sandboxId);
  if (!ctx) {
    return;
  }

  try {
    if (ctx.apiVersion === 'v0') {
      await ctx.sandbox.process.executeCommand('sync').catch(() => undefined);
    } else {
      await ctx.sandbox.exec('sync').catch(() => undefined);
    }
  } catch {
    // Non-fatal flush safeguard
  }
}

export async function stopProjectSandbox(
  sandboxId: string,
  options?: { userId?: string; projectId?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stopped: boolean; sandboxId: string }> {
  const env = options?.env ?? process.env;
  const daytona = createDaytonaRoot(env);
  const useV0 = shouldUseDaytonaV0(env);

  await flushWorkspaceVolumeChanges(sandboxId, env);
  sandboxCache.delete(sandboxId);

  try {
    if (useV0) {
      const sbx = await daytona.v0.get(sandboxId);
      if (sbx.state === 'started') {
        await sbx.stop(60);
      }
    } else {
      const sbx = await daytona.v2.get(sandboxId);
      if (sbx.state === 'started') {
        await sbx.stop({ timeoutSeconds: 60 });
      }
    }

    if (options?.userId && options?.projectId) {
      const existing = projectBindings.get(bindingKey(options.userId, options.projectId));
      if (existing && existing.sandboxId === sandboxId) {
        existing.status = 'stopped';
        existing.lastActivityAt = new Date().toISOString();
      }
    } else {
      for (const b of projectBindings.values()) {
        if (b.sandboxId === sandboxId) {
          b.status = 'stopped';
          b.lastActivityAt = new Date().toISOString();
        }
      }
    }

    return { stopped: true, sandboxId };
  } catch {
    return { stopped: false, sandboxId };
  }
}

export async function getSandboxContext(
  sandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CachedSandboxContext> {
  const existing = sandboxCache.get(sandboxId);
  if (existing) {
    return existing;
  }

  const daytona = createDaytonaRoot(env);
  const useV0 = shouldUseDaytonaV0(env);

  if (useV0) {
    const sandbox = await daytona.v0.get(sandboxId);
    if (sandbox.state !== 'started') {
      await sandbox.start(60).catch(() => undefined);
      await sandbox.waitUntilStarted(60);
    }

    await sandbox.fs.createFolder(DAYTONA_WORKSPACE_ROOT, '755').catch(() => undefined);

    const ctx: CachedV0Context = {
      apiVersion: 'v0',
      sandbox,
      v0MainSessionReady: false,
      workdir: DAYTONA_WORKSPACE_ROOT,
    };
    sandboxCache.set(sandboxId, ctx);
    return ctx;
  }

  const sandbox = await daytona.v2.get(sandboxId);

  if (sandbox.state === 'stopped') {
    await sandbox.start({ timeoutSeconds: 60 });
  } else if (sandbox.state === 'paused') {
    await sandbox.resume({ timeoutSeconds: 60 });
  } else if (sandbox.state !== 'started') {
    await sandbox.wait({ until: 'started', timeoutSeconds: 60 });
  }

  const ctx: CachedV2Context = {
    apiVersion: 'v2',
    sandbox,
    workdir: DAYTONA_WORKSPACE_ROOT,
  };

  await sandbox.fs.mkdir(ctx.workdir).catch(() => undefined);
  sandboxCache.set(sandboxId, ctx);
  return ctx;
}

async function ensureV2Session(ctx: CachedV2Context): Promise<SessionV2> {
  if (ctx.session) {
    return ctx.session;
  }

  try {
    const existing = await ctx.sandbox.process.list({
      kind: 'session',
      state: 'running',
      name: DAYTONA_SESSION_NAME,
    });
    const match = existing.items.find((item) => item.name === DAYTONA_SESSION_NAME && item.state === 'running');
    if (match) {
      const reconnected = ctx.sandbox.process.connectSession(match.id);
      ctx.session = reconnected;
      return reconnected;
    }
  } catch {
    // proceed to create a new session
  }

  try {
    const session = await ctx.sandbox.process.createSession({
      cwd: DAYTONA_WORKSPACE_ROOT,
      name: DAYTONA_SESSION_NAME,
      env: {
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    });
    ctx.session = session;
    return session;
  } catch {
    const fallbackSession = await ctx.sandbox.process.createSession({
      cwd: DAYTONA_WORKSPACE_ROOT,
      name: `${DAYTONA_SESSION_NAME}-${Date.now().toString(36)}`,
      env: {
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    });
    ctx.session = fallbackSession;
    return fallbackSession;
  }
}

async function ensureV0MainSession(ctx: CachedV0Context): Promise<string> {
  if (ctx.v0MainSessionReady) {
    return DAYTONA_SESSION_NAME;
  }

  await ctx.sandbox.process.createSession(DAYTONA_SESSION_NAME).catch(() => undefined);
  await ctx.sandbox.process
    .executeSessionCommand(DAYTONA_SESSION_NAME, {
      command: `mkdir -p "${DAYTONA_WORKSPACE_ROOT}" && cd "${DAYTONA_WORKSPACE_ROOT}"`,
      runAsync: false,
    })
    .catch(() => undefined);

  ctx.v0MainSessionReady = true;
  return DAYTONA_SESSION_NAME;
}

export function resolveSandboxFilePath(workdir: string, rawPath: string): string {
  return resolveWorkspacePath(rawPath, workdir || DAYTONA_WORKSPACE_ROOT).absolutePath;
}

export async function createDaytonaSandbox(
  env: NodeJS.ProcessEnv = process.env,
  identity?: { userId: string; projectId: string },
): Promise<{
  sandboxId: string;
  workdir: string;
  volumeId?: string;
  volumeName?: string;
  volumeSubpath?: string;
}> {
  if (identity?.userId && identity?.projectId) {
    const binding = await ensureProjectSandbox({
      userId: identity.userId,
      projectId: identity.projectId,
      env,
    });
    return {
      sandboxId: binding.sandboxId,
      workdir: binding.workdir,
      volumeId: binding.volumeId,
      volumeName: binding.volumeName,
      volumeSubpath: binding.volumeSubpath,
    };
  }

  throw new Error('Authenticated userId and projectId are required to provision a persistent Daytona Sandbox.');
}

export async function getDaytonaPreviewInfo(
  sandboxId: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ port: number; url: string }> {
  const ctx = await getSandboxContext(sandboxId, env);

  if (ctx.apiVersion === 'v0') {
    try {
      const signed = await ctx.sandbox.getSignedPreviewUrl(port, 3600);
      return { port, url: signed.url };
    } catch {
      await ctx.sandbox.setPublic(true).catch(() => undefined);
      const link = await ctx.sandbox.getPreviewLink(port);
      return { port, url: link.url };
    }
  }

  await ctx.sandbox.ports.expose(port, { public: true }).catch(() => undefined);
  const signed = await ctx.sandbox.ports.signedPreviewLink(port, { expiresInSeconds: 3600 });
  return { port, url: signed.url };
}

export async function listDaytonaOpenPorts(
  sandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Array<{ port: number; url: string }>> {
  const ctx = await getSandboxContext(sandboxId, env);

  if (ctx.apiVersion === 'v0') {
    const res = await ctx.sandbox.process.executeCommand('cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true');
    const openPorts = parseListeningPortsFromProcNet(res.result ?? '');
    const previews: Array<{ port: number; url: string }> = [];

    for (const port of openPorts) {
      try {
        const link = await getDaytonaPreviewInfo(sandboxId, port, env);
        previews.push(link);
      } catch {
        // skip unexposable port
      }
    }

    return previews;
  }

  const result = await ctx.sandbox.ports.list();
  const previews: Array<{ port: number; url: string }> = [];

  for (const port of result.items) {
    if (port === 2280 || port === 2281 || port === 22220 || port < 1024) {
      continue;
    }

    try {
      const link = await getDaytonaPreviewInfo(sandboxId, port, env);
      previews.push(link);
    } catch {
      // skip unexposable port
    }
  }

  return previews;
}

export async function killDaytonaProcess(
  sandboxId: string,
  processId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const ctx = await getSandboxContext(sandboxId, env);

  if (ctx.apiVersion === 'v0') {
    if (processId.startsWith('v0:')) {
      const parts = processId.split(':');
      const sessionId = parts[1];
      if (sessionId) {
        await ctx.sandbox.process.deleteSession(sessionId).catch(() => undefined);
        if (sessionId === DAYTONA_SESSION_NAME) {
          ctx.v0MainSessionReady = false;
        }
      }
    }
    return;
  }

  const handle = ctx.sandbox.process.connect(processId);
  await handle.kill({ signal: 'INT', escalateAfterSeconds: 2 }).catch(() => undefined);
}

export async function deleteDaytonaSandbox(
  sandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const cached = sandboxCache.get(sandboxId);
  sandboxCache.delete(sandboxId);

  for (const [k, binding] of projectBindings.entries()) {
    if (binding.sandboxId === sandboxId) {
      projectBindings.delete(k);
    }
  }

  if (cached) {
    await cached.sandbox.delete().catch(() => undefined);
    return;
  }

  const daytona = createDaytonaRoot(env);

  if (shouldUseDaytonaV0(env)) {
    const sbx = await daytona.v0.get(sandboxId).catch(() => null);
    if (sbx) {
      await daytona.v0.delete(sbx).catch(() => undefined);
    }
    return;
  }

  await daytona.v2.delete(sandboxId).catch(() => undefined);
}

export async function getDaytonaAdminOverview(env: NodeJS.ProcessEnv = process.env) {
  const configured = isDaytonaConfigured(env);
  if (!configured) {
    return {
      configured: false,
      healthy: false,
      apiVersion: shouldUseDaytonaV0(env) ? 'v0' : 'v2',
      volume: {
        exists: false,
        name: getProjectVolumeName(env),
        state: 'unconfigured',
        error: 'DAYTONA_API_KEY is not configured.',
      },
      sandboxesCount: 0,
      sandboxes: [] as Array<{ id: string; name: string; state: string; labels?: Record<string, string>; createdAt?: string }>,
    };
  }

  const daytona = createDaytonaRoot(env);
  const useV0 = shouldUseDaytonaV0(env);
  const rawVolume = await inspectCentralProjectVolume(daytona, useV0, env);
  const volume = rawVolume.exists
    ? {
        exists: true,
        name: rawVolume.name,
        volumeId: rawVolume.id,
        state: rawVolume.status,
      }
    : {
        exists: false,
        name: rawVolume.name,
        state: rawVolume.status,
      };
  const sandboxes: Array<{ id: string; name: string; state: string; labels?: Record<string, string>; createdAt?: string }> = [];

  try {
    if (useV0) {
      for await (const sbx of daytona.v0.list()) {
        sandboxes.push({
          id: sbx.id,
          name: sbx.name || sbx.id,
          state: String(sbx.state || 'unknown'),
          labels: sbx.labels,
          createdAt: sbx.createdAt,
        });
        if (sandboxes.length >= 50) {
          break;
        }
      }
    } else {
      const res = await daytona.v2.list({ limit: 50 });
      for (const sbx of res.items || []) {
        sandboxes.push({
          id: sbx.id,
          name: sbx.name || sbx.id,
          state: String(sbx.state || 'unknown'),
          labels: { ...(sbx.labels || {}) },
        });
      }
    }
  } catch (error) {
    return {
      configured: true,
      healthy: false,
      apiVersion: useV0 ? 'v0' : 'v2',
      error: error instanceof Error ? error.message : 'Failed to query Daytona API',
      volume,
      sandboxesCount: sandboxes.length,
      sandboxes,
    };
  }

  return {
    configured: true,
    healthy: true,
    apiVersion: useV0 ? 'v0' : 'v2',
    volume,
    sandboxesCount: sandboxes.length,
    sandboxes,
  };
}

export interface DaytonaExecStreamEvent {
  type: 'meta' | 'stdout' | 'stderr' | 'cwd' | 'ports' | 'exit' | 'error';
  data?: string;
  processId?: string;
  cwd?: string;
  exitCode?: number;
  ports?: Array<{ port: number; url: string }>;
}

const GIT_CLONE_VALUE_FLAGS = new Set([
  '-b',
  '--branch',
  '-o',
  '--origin',
  '-u',
  '--upload-pack',
  '-c',
  '--config',
  '--reference',
  '--reference-if-able',
  '--separate-git-dir',
  '--depth',
  '--shallow-since',
  '--shallow-exclude',
  '-j',
  '--jobs',
  '--template',
  '--filter',
  '--server-option',
  '--bundle-uri',
]);

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tokenizeSimpleShellSegment(input: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let hasToken = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '\\' && i + 1 < input.length) {
        current += input[++i];
      } else if (ch === '"') {
        quote = null;
      } else if (ch === '$' || ch === '`') {
        return null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      quote = "'";
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      quote = '"';
      hasToken = true;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[++i];
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    if (ch === '|' || ch === '>' || ch === '<' || ch === '(' || ch === ')' || ch === '$' || ch === '`') {
      return null;
    }

    current += ch;
    hasToken = true;
  }

  if (quote !== null) {
    return null;
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens;
}

function splitTopLevelShellSegments(command: string): Array<{ segment: string; separator: string }> {
  const parts: Array<{ segment: string; separator: string }> = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let parenDepth = 0;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        quote = null;
      }
      continue;
    }

    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth--;
      continue;
    }

    if (parenDepth === 0) {
      if (ch === '&' && command[i + 1] === '&') {
        parts.push({ segment: command.slice(start, i), separator: ' && ' });
        i++;
        start = i + 1;
      } else if (ch === ';') {
        parts.push({ segment: command.slice(start, i), separator: '; ' });
        start = i + 1;
      }
    }
  }

  parts.push({ segment: command.slice(start), separator: '' });
  return parts;
}

function inferRepoDirFromGitArg(repoUrl: string): string {
  const cleaned = repoUrl.trim().replace(/\/+$/, '');
  const lastPart = cleaned.split(/[/:]/).filter(Boolean).pop() || 'repo';
  return lastPart.replace(/\.git$/i, '') || 'repo';
}

function rewriteGitCloneSegment(rawSegment: string): string | null {
  const trimmed = rawSegment.trim();
  if (!trimmed || !/\bgit\s+clone\b/.test(trimmed)) {
    return null;
  }

  const tokens = tokenizeSimpleShellSegment(trimmed);
  if (!tokens || tokens.length < 3) {
    return null;
  }

  let idx = 0;
  const envPrefix: string[] = [];
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    envPrefix.push(tokens[idx]);
    idx++;
  }

  if (tokens[idx] !== 'git' || tokens[idx + 1] !== 'clone') {
    return null;
  }

  const cloneArgs = tokens.slice(idx + 2);
  const flagTokens: string[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < cloneArgs.length; i++) {
    const tok = cloneArgs[i];
    if (tok === '--') {
      positionals.push(...cloneArgs.slice(i + 1));
      break;
    }
    if (tok.startsWith('-')) {
      flagTokens.push(tok);
      if (!tok.includes('=') && GIT_CLONE_VALUE_FLAGS.has(tok) && i + 1 < cloneArgs.length) {
        flagTokens.push(cloneArgs[++i]);
      }
      continue;
    }
    positionals.push(tok);
  }

  if (positionals.length === 0 || positionals.length > 2) {
    return null;
  }

  const repoUrl = positionals[0];
  const explicitTarget = positionals[1];

  // If caller is already cloning into /tmp or /var/tmp, leave untouched
  if (explicitTarget && (explicitTarget.startsWith('/tmp/') || explicitTarget.startsWith('/var/tmp/'))) {
    return null;
  }

  const resolvedTarget = explicitTarget || inferRepoDirFromGitArg(repoUrl);
  const envAssignment = envPrefix.some((e) => e.startsWith('GIT_TERMINAL_PROMPT='))
    ? envPrefix.join(' ')
    : ['GIT_TERMINAL_PROMPT=0', ...envPrefix].join(' ');
  const quotedFlags = flagTokens.map(quotePosixArg).join(' ');
  const cloneInvocation = [
    envAssignment,
    'git',
    'clone',
    quotedFlags,
    quotePosixArg(repoUrl),
    '"$_wc_tmp"',
  ]
    .filter(Boolean)
    .join(' ');
  const qTarget = quotePosixArg(resolvedTarget);

  return `( _wc_tmp="/tmp/wc-clone-$$-$(date +%s)"; _wc_dest=""; rm -rf "$_wc_tmp" && ${cloneInvocation} && mkdir -p ${qTarget} && _wc_dest="$(cd ${qTarget} && pwd)" && rm -rf "$_wc_tmp/.git" && (((cd "$_wc_tmp" && tar -cf - .) | (cd "$_wc_dest" && tar --no-same-owner --no-same-permissions -xf -)) || ((cd "$_wc_tmp" && tar -chf - .) | (cd "$_wc_dest" && tar --no-same-owner --no-same-permissions -xf -)) || cp -rfL --no-preserve=all "$_wc_tmp"/. "$_wc_dest"/ || cp -rf "$_wc_tmp"/. "$_wc_dest"/); _wc_rc=$?; rm -rf "$_wc_tmp"; exit $_wc_rc )`;
}

export function rewriteDaytonaGitCloneCommand(rawCommand: string, cwd?: string): string {
  if (cwd && cwd !== DAYTONA_WORKSPACE_ROOT && !cwd.startsWith(`${DAYTONA_WORKSPACE_ROOT}/`)) {
    return rawCommand;
  }

  if (!/\bgit\s+clone\b/.test(rawCommand)) {
    return rawCommand;
  }

  const segments = splitTopLevelShellSegments(rawCommand);
  let changed = false;

  const rebuilt = segments
    .map(({ segment, separator }) => {
      const rewritten = rewriteGitCloneSegment(segment);
      if (rewritten) {
        changed = true;
        return `${rewritten}${separator}`;
      }
      return `${segment.trim()}${separator}`;
    })
    .join('');

  return changed ? rebuilt : rawCommand;
}

export async function runDaytonaCommandStream(options: {
  sandboxId: string;
  command: string;
  isLikelyServer: boolean;
  onEvent: (event: DaytonaExecStreamEvent) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = options.env ?? process.env;
  const ctx = await getSandboxContext(options.sandboxId, env);
  const effectiveCommand = rewriteDaytonaGitCloneCommand(options.command, ctx.workdir);

  if (ctx.apiVersion === 'v0') {
    let sessionId: string;
    if (options.isLikelyServer) {
      sessionId = `bolt-srv-${Date.now().toString(36)}`;
      await ctx.sandbox.process.createSession(sessionId);
      await ctx.sandbox.process
        .executeSessionCommand(sessionId, {
          command: `mkdir -p "${DAYTONA_WORKSPACE_ROOT}" && cd "${DAYTONA_WORKSPACE_ROOT}"`,
          runAsync: false,
        })
        .catch(() => undefined);
    } else {
      sessionId = await ensureV0MainSession(ctx);
    }

    const execRes = await ctx.sandbox.process.executeSessionCommand(sessionId, {
      command: effectiveCommand,
      runAsync: true,
    });
    const cmdId = execRes.cmdId;
    if (!cmdId) {
      throw new Error('Daytona did not return a command ID');
    }

    options.onEvent({ type: 'meta', processId: `v0:${sessionId}:${cmdId}` });

    let finished = false;
    let finalExitCode = 0;

    const logsPromise = ctx.sandbox.process
      .getSessionCommandLogs(
        sessionId,
        cmdId,
        (chunk) => {
          if (!finished && chunk) {
            options.onEvent({ type: 'stdout', data: chunk });
          }
        },
        (chunk) => {
          if (!finished && chunk) {
            options.onEvent({ type: 'stderr', data: chunk });
          }
        },
      )
      .catch((err) => {
        if (!finished) {
          options.onEvent({
            type: 'error',
            data: err instanceof Error ? err.message : 'Daytona log stream failed',
          });
        }
      });

    if (options.isLikelyServer) {
      const serverWaitPromise = new Promise<void>((resolve) => {
        void (async () => {
          for (let attempt = 0; attempt < 25 && !finished; attempt++) {
            await new Promise((r) => setTimeout(r, 1200));
            if (finished) break;

            try {
              const openPorts = await listDaytonaOpenPorts(options.sandboxId, env);
              if (openPorts.length > 0) {
                options.onEvent({ type: 'ports', ports: openPorts });
                resolve();
                return;
              }
            } catch {
              // ignore transient poll error
            }
          }
          // If no port ever opened, wait for logsPromise to finish instead of cutting off git clone / npm install
        })();
      });

      await Promise.race([logsPromise, serverWaitPromise]);
      finished = true;
    } else {
      await logsPromise;
      finished = true;

      try {
        const cmdInfo = await ctx.sandbox.process.getSessionCommand(sessionId, cmdId);
        if (typeof cmdInfo.exitCode === 'number') {
          finalExitCode = cmdInfo.exitCode;
        }
      } catch {
        // ignore missing exit code
      }

      try {
        const pwdRes = await ctx.sandbox.process.executeSessionCommand(sessionId, {
          command: 'pwd',
          runAsync: false,
        });
        const nextCwd = (pwdRes.stdout || pwdRes.output || '').trim().split('\n').pop()?.trim();
        if (nextCwd && nextCwd.startsWith('/')) {
          ctx.workdir = nextCwd;
          options.onEvent({ type: 'cwd', cwd: nextCwd });
        }
      } catch {
        // ignore cwd error
      }
    }

    try {
      const ports = await listDaytonaOpenPorts(options.sandboxId, env);
      if (ports.length > 0) {
        options.onEvent({ type: 'ports', ports });
      }
    } catch {
      // ignore port scan error
    }

    options.onEvent({ type: 'exit', exitCode: finalExitCode });
    return;
  }

  const handle = options.isLikelyServer
    ? await ctx.sandbox.process.start(effectiveCommand, {
        cwd: DAYTONA_WORKSPACE_ROOT,
        keepLogs: 'on_exit_ttl',
      })
    : await (await ensureV2Session(ctx)).start(effectiveCommand, {
        keepLogs: 'on_exit_ttl',
      });

  options.onEvent({ type: 'meta', processId: handle.id });

  const abortController = new AbortController();
  let finished = false;
  let finalExitCode = 0;

  const portWatcher = options.isLikelyServer
    ? (async () => {
        for (let attempt = 0; attempt < 25 && !finished; attempt++) {
          await new Promise((r) => setTimeout(r, 1200));
          if (finished) break;

          try {
            const openPorts = await listDaytonaOpenPorts(options.sandboxId, env);
            if (openPorts.length > 0) {
              options.onEvent({ type: 'ports', ports: openPorts });
              finished = true;
              abortController.abort();
              break;
            }
          } catch {
            // ignore transient poll error
          }
        }
      })()
    : null;

  try {
    for await (const event of handle.streamLogs({ signal: abortController.signal })) {
      if (event.type === 'log') {
        const channel = event.frame.channel === 'stderr' ? 'stderr' : 'stdout';
        if (event.frame.data) {
          options.onEvent({ type: channel, data: event.frame.data });
        }
      } else if (event.type === 'state') {
        finalExitCode = event.result.exitCode ?? 0;
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      const msg = err instanceof Error ? err.message : 'Stream interrupted';
      options.onEvent({ type: 'error', data: msg });
    }
  } finally {
    finished = true;
    if (portWatcher) {
      await portWatcher.catch(() => undefined);
    }

    if (!options.isLikelyServer && ctx.session) {
      try {
        const info = await ctx.session.get();
        if (info.cwd) {
          ctx.workdir = info.cwd;
          options.onEvent({ type: 'cwd', cwd: info.cwd });
        }
      } catch {
        // ignore cwd error
      }
    }

    try {
      const ports = await listDaytonaOpenPorts(options.sandboxId, env);
      if (ports.length > 0) {
        options.onEvent({ type: 'ports', ports });
      }
    } catch {
      // ignore port scan error
    }

    options.onEvent({ type: 'exit', exitCode: finalExitCode });
  }
}
